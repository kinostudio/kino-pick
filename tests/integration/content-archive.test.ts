import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { fixtureDb, loginDb, userA, userB, userC } from '../helpers/database';
import {
  projectSchema,
  albumSchema,
} from '../../packages/contracts/src/projects';
let db: PGlite;
let workspaceId: string;
let projectId: string;
let albumId: string;
async function call(fn: string, args: (string | number | boolean | null)[]) {
  return (
    await db.query<{ result: unknown }>(
      `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`,
      args,
    )
  ).rows[0]!.result;
}
async function change(
  kind: 'project' | 'album',
  archived: boolean,
  revision: number,
  req = randomUUID(),
) {
  return call('set_content_archived', [
    kind,
    kind === 'project' ? projectId : albumId,
    archived,
    revision,
    req,
  ]);
}
beforeEach(async () => {
  db = await fixtureDb();
  await loginDb(db, userB);
  await call('ensure_photographer_profile', [randomUUID()]);
  await loginDb(db, userA);
  workspaceId = (
    (await call('create_workspace', ['Archive', randomUUID()])) as {
      id: string;
    }
  ).id;
  projectId = projectSchema.parse(
    await call('create_project', [
      workspaceId,
      'Archive project',
      randomUUID(),
    ]),
  ).id;
  albumId = albumSchema.parse(
    await call('create_album', [projectId, 'Draft album', randomUUID()]),
  ).id;
}, 30000);
afterEach(async () => {
  await db?.close();
});
it('archives/restores origin states, preserves child state, protection and human-view clocks', async () => {
  await db.exec('reset role');
  await db.query(
    "update albums set is_pinned=true,legal_hold=true,published_at='2026-01-01Z',last_valid_viewed_at='2026-01-02Z' where id=$1",
    [albumId],
  );
  const prior = (
    await db.query(
      'select is_pinned,legal_hold,published_at,last_valid_viewed_at from albums where id=$1',
      [albumId],
    )
  ).rows;
  await loginDb(db, userA);
  expect(await change('album', true, 1)).toMatchObject({
    state: 'archived',
    revision: 2,
    isPinned: true,
    legalHold: true,
  });
  expect(await change('project', true, 1)).toMatchObject({
    status: 'archived',
    revision: 2,
  });
  await expect(change('album', false, 2)).rejects.toThrow(
    'RESOURCE_NOT_EDITABLE',
  );
  expect(await change('project', false, 2)).toMatchObject({
    status: 'draft',
    revision: 3,
  });
  expect(
    (await db.query('select state from albums where id=$1', [albumId])).rows[0],
  ).toEqual({ state: 'archived' });
  expect(await change('album', false, 2)).toMatchObject({
    state: 'draft',
    revision: 3,
  });
  expect(
    (
      await db.query(
        'select is_pinned,legal_hold,published_at,last_valid_viewed_at from albums where id=$1',
        [albumId],
      )
    ).rows,
  ).toEqual(prior);
  await db.exec('reset role');
  await db.query("update projects set status='delivered' where id=$1", [
    projectId,
  ]);
  await loginDb(db, userA);
  await change('project', true, 3);
  expect(await change('project', false, 4)).toMatchObject({
    status: 'delivered',
    revision: 5,
  });
  const events = (
    await db.query<{ operation: string }>(
      "select operation from audit_logs where operation like '%.archived' or operation like '%.restored'",
    )
  ).rows;
  expect(events).toHaveLength(6);
});
it('freezes names/new children when archived while permitting owner protection; historical replay stays historical', async () => {
  const req = randomUUID();
  await call('rename_album', [albumId, 'Before', 1, req]);
  await change('album', true, 2);
  await expect(
    call('rename_album', [albumId, 'Before', 3, randomUUID()]),
  ).rejects.toThrow('RESOURCE_NOT_EDITABLE');
  expect(await call('rename_album', [albumId, 'Before', 1, req])).toMatchObject(
    { state: 'draft', revision: 2 },
  );
  await change('project', true, 1);
  await expect(
    call('rename_project', [projectId, 'Archive project', 2, randomUUID()]),
  ).rejects.toThrow('RESOURCE_NOT_EDITABLE');
  await expect(
    call('create_album', [projectId, 'New', randomUUID()]),
  ).rejects.toThrow('RESOURCE_NOT_EDITABLE');
  expect(
    await call('set_album_protection', [
      albumId,
      true,
      true,
      3,
      false,
      randomUUID(),
    ]),
  ).toMatchObject({ state: 'archived', revision: 4, isPinned: true });
  await change('project', false, 2);
  await change('album', false, 4);
  expect(
    await call('rename_album', [albumId, 'After', 5, randomUUID()]),
  ).toMatchObject({ name: 'After', revision: 6 });
});
it('rejects nonempty or busy content and unknown legacy archive origins without inventing a restore state', async () => {
  await db.exec('reset role');
  await db.query(
    "insert into photos(workspace_id,project_id,album_id,original_filename,canonical_name) values($1,$2,$3,'photo.jpg','photo.jpg')",
    [workspaceId, projectId, albumId],
  );
  await loginDb(db, userA);
  await expect(change('album', true, 1)).rejects.toThrow(
    'CONTENT_NOT_EMPTY_OR_IDLE',
  );
  await expect(change('project', true, 1)).rejects.toThrow(
    'CONTENT_NOT_EMPTY_OR_IDLE',
  );
  await db.exec('reset role');
  await db.exec('delete from photos');
  for (const state of ['active', 'deleting', 'deleted']) {
    await db.query('update albums set state=$1 where id=$2', [state, albumId]);
    await loginDb(db, userA);
    await expect(change('album', true, 1)).rejects.toThrow(
      'INVALID_STATE_TRANSITION',
    );
    await expect(change('project', true, 1)).rejects.toThrow(
      'CONTENT_NOT_EMPTY_OR_IDLE',
    );
    await db.exec('reset role');
  }
  await db.query("update albums set state='draft' where id=$1", [albumId]);
  for (const status of [
    'uploading',
    'selecting',
    'submitted',
    'retouching',
    'reviewing',
    'approved',
  ]) {
    await db.query('update projects set status=$1 where id=$2', [
      status,
      projectId,
    ]);
    await loginDb(db, userA);
    await expect(change('project', true, 1)).rejects.toThrow(
      'INVALID_STATE_TRANSITION',
    );
    await expect(change('album', true, 1)).rejects.toThrow(
      'CONTENT_NOT_EMPTY_OR_IDLE',
    );
    await db.exec('reset role');
  }
  await db.query("update projects set status='archived' where id=$1", [
    projectId,
  ]);
  await loginDb(db, userA);
  await expect(change('project', false, 1)).rejects.toThrow(
    'INVALID_STATE_TRANSITION',
  );
  await db.exec('reset role');
  await db.query("update projects set status='draft' where id=$1", [projectId]);
  await db.query("update albums set state='archived' where id=$1", [albumId]);
  await loginDb(db, userA);
  await expect(change('album', false, 1)).rejects.toThrow(
    'INVALID_STATE_TRANSITION',
  );
});
it('authorizes current owner before replay and denies other roles/tenants/unsupported/anonymous identity', async () => {
  for (const role of ['workspace_editor', 'photographer', 'retoucher']) {
    await loginDb(db, userA);
    await call('set_workspace_member', [
      workspaceId,
      userB,
      role,
      'active',
      randomUUID(),
    ]);
    await loginDb(db, userB);
    for (const kind of ['project', 'album'] as const)
      await expect(change(kind, true, 1)).rejects.toThrow('FORBIDDEN_SCOPE');
  }
  await loginDb(db, userC);
  await expect(change('project', true, 1)).rejects.toThrow(
    'OAUTH_IDENTITY_REQUIRED',
  );
  await db.exec('set role anon');
  await expect(change('album', true, 1)).rejects.toThrow('permission denied');
  await loginDb(db, userA);
  const req = randomUUID();
  await change('project', true, 1, req);
  await db.exec('reset role');
  await db.query('update workspaces set owner_user_id=$1 where id=$2', [
    userB,
    workspaceId,
  ]);
  await db.query(
    'delete from workspace_members where workspace_id=$1 and user_id=$2',
    [workspaceId, userA],
  );
  await loginDb(db, userA);
  await expect(change('project', true, 1, req)).rejects.toThrow('NOT_FOUND');
});
it('CAS, replay and global request namespace preserve later state and avoid extra audit', async () => {
  const req = randomUUID();
  const first = await change('project', true, 1, req);
  expect(await change('project', true, 1, req)).toEqual(first);
  await expect(change('project', false, 1, req)).rejects.toThrow(
    'REQUEST_ID_CONFLICT',
  );
  await expect(change('project', false, 1)).rejects.toThrow(
    'CONCURRENT_MODIFICATION',
  );
  await change('project', false, 2);
  expect(await change('project', true, 1, req)).toEqual(first);
  expect(
    (
      await db.query('select status,revision from projects where id=$1', [
        projectId,
      ])
    ).rows[0],
  ).toEqual({ status: 'draft', revision: 3 });
  await expect(
    call('rename_project', [projectId, 'Wrong', 3, req]),
  ).rejects.toThrow('REQUEST_ID_CONFLICT');
  await call('set_album_protection', [
    albumId,
    true,
    false,
    1,
    false,
    randomUUID(),
  ]);
  await expect(change('album', true, 1)).rejects.toThrow(
    'CONCURRENT_MODIFICATION',
  );
  await change('album', true, 2);
  await expect(change('album', true, 3)).rejects.toThrow(
    'INVALID_STATE_TRANSITION',
  );
});
it('audit failure rolls archive origin/state/revision and ledger back for both kinds', async () => {
  await db.exec('reset role');
  await db.exec(
    `create function kino_private.reject_archive() returns trigger language plpgsql as $$begin if new.operation like '%.archived' then raise exception 'INJECTED_AUDIT_FAILURE'; end if;return new;end;$$;create trigger reject_archive before insert on audit_logs for each row execute function kino_private.reject_archive();`,
  );
  await loginDb(db, userA);
  const requests = [randomUUID(), randomUUID()];
  for (const [index, kind] of (['project', 'album'] as const).entries())
    await expect(change(kind, true, 1, requests[index]!)).rejects.toThrow(
      'INJECTED_AUDIT_FAILURE',
    );
  await db.exec('reset role');
  expect(
    (
      await db.query(
        'select status,revision,archived_from_status from projects where id=$1',
        [projectId],
      )
    ).rows[0],
  ).toEqual({ status: 'draft', revision: 1, archived_from_status: null });
  expect(
    (
      await db.query(
        'select state,revision,archived_from_state from albums where id=$1',
        [albumId],
      )
    ).rows[0],
  ).toEqual({ state: 'draft', revision: 1, archived_from_state: null });
  for (const req of requests)
    expect(
      (
        await db.query(
          'select request_id from kino_private.workspace_requests where request_id=$1',
          [req],
        )
      ).rows,
    ).toHaveLength(0);
  await db.exec('drop trigger reject_archive on audit_logs');
  await loginDb(db, userA);
  await change('album', true, 1, requests[1]!);
});
it('validates RPC inputs and denies direct writes independently of HTTP', async () => {
  const args: (string | number | boolean | null)[] = [
    'project',
    projectId,
    true,
    1,
    randomUUID(),
  ];
  for (let i = 0; i < args.length; i++) {
    const invalid = [...args];
    invalid[i] = null;
    await expect(call('set_content_archived', invalid)).rejects.toThrow(
      'INVALID_INPUT',
    );
  }
  await expect(
    call('set_content_archived', ['photo', projectId, true, 1, randomUUID()]),
  ).rejects.toThrow('INVALID_INPUT');
  await expect(change('project', true, 0)).rejects.toThrow('INVALID_INPUT');
  await expect(
    db.query("update projects set status='archived' where id=$1", [projectId]),
  ).rejects.toThrow('permission denied');
  await db.exec('reset role');
  await expect(
    db.query(
      "update projects set archived_from_status='delivered' where id=$1",
      [projectId],
    ),
  ).rejects.toThrow('project_archive_origin_only_when_archived');
});
