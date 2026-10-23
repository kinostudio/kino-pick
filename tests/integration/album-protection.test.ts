import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { fixtureDb, loginDb, userA, userB, userC } from '../helpers/database';
import { albumSchema } from '../../packages/contracts/src/projects';
let db: PGlite;
let workspaceId: string;
let albumId: string;
async function call(fn: string, args: (string | number | boolean | null)[]) {
  return (
    await db.query<{ result: unknown }>(
      `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`,
      args,
    )
  ).rows[0]!.result;
}
async function protect(
  pinned: boolean,
  hold: boolean,
  revision: number,
  confirm = false,
  requestId = randomUUID(),
) {
  return albumSchema.parse(
    await call('set_album_protection', [
      albumId,
      pinned,
      hold,
      revision,
      confirm,
      requestId,
    ]),
  );
}
beforeEach(async () => {
  db = await fixtureDb();
  await loginDb(db, userB);
  await call('ensure_photographer_profile', [randomUUID()]);
  await loginDb(db, userA);
  const workspace = (await call('create_workspace', [
    'Protection',
    randomUUID(),
  ])) as { id: string };
  workspaceId = workspace.id;
  const project = (await call('create_project', [
    workspaceId,
    'Protected project',
    randomUUID(),
  ])) as { id: string };
  albumId = albumSchema.parse(
    await call('create_album', [project.id, 'Proofs', randomUUID()]),
  ).id;
}, 30000);
afterEach(async () => {
  await db?.close();
});
it('records protection and before/after audit once; replay cannot restore later flags', async () => {
  const req = randomUUID();
  const first = await protect(true, true, 1, false, req);
  expect(first).toMatchObject({ isPinned: true, legalHold: true, revision: 2 });
  expect(await protect(true, true, 1, false, req)).toEqual(first);
  await expect(protect(false, true, 1, false, req)).rejects.toThrow(
    'REQUEST_ID_CONFLICT',
  );
  await expect(protect(false, false, 2)).rejects.toThrow(
    'PROTECTION_CONFIRMATION_REQUIRED',
  );
  const next = await protect(false, false, 2, true);
  expect(next.revision).toBe(3);
  expect(await protect(true, true, 1, false, req)).toEqual(first);
  expect(
    (
      await db.query(
        'select is_pinned,legal_hold,revision from albums where id=$1',
        [albumId],
      )
    ).rows[0],
  ).toEqual({ is_pinned: false, legal_hold: false, revision: 3 });
  const rows = (
    await db.query<{ before_json: unknown; after_json: unknown }>(
      "select before_json,after_json from audit_logs where operation='album.protection_changed' order by occurred_at,id",
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(
    rows.some(
      (r) =>
        JSON.stringify(r.before_json).includes('"isPinned":false') &&
        JSON.stringify(r.after_json).includes('"isPinned":true'),
    ),
  ).toBe(true);
});
it('shares CAS with renames; stale protection cannot overwrite newer state', async () => {
  await call('rename_album', [albumId, 'Renamed', 1, randomUUID()]);
  await expect(protect(true, false, 1)).rejects.toThrow(
    'CONCURRENT_MODIFICATION',
  );
  await protect(true, false, 2);
  await expect(
    call('rename_album', [albumId, 'Stale', 2, randomUUID()]),
  ).rejects.toThrow('CONCURRENT_MODIFICATION');
  expect(await protect(true, false, 3)).toMatchObject({
    revision: 4,
    name: 'Renamed',
  });
});
it('only current owner may change flags; roles and revoked callers fail before replay', async () => {
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
    await expect(protect(true, true, 1)).rejects.toThrow('FORBIDDEN_SCOPE');
  }
  await loginDb(db, userA);
  const req = randomUUID();
  await protect(true, false, 1, false, req);
  // Simulate a trusted ownership transfer; no owner-transfer application endpoint exists.
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
  await expect(protect(true, false, 1, false, req)).rejects.toThrow(
    'NOT_FOUND',
  );
});
it('rejects missing/cross-tenant, unsupported/anonymous/null identity and direct writes', async () => {
  await loginDb(db, userB);
  await expect(protect(true, true, 1)).rejects.toThrow('NOT_FOUND');
  await loginDb(db, userC);
  await expect(protect(true, true, 1)).rejects.toThrow(
    'OAUTH_IDENTITY_REQUIRED',
  );
  await db.exec('set role anon');
  await expect(protect(true, true, 1)).rejects.toThrow('permission denied');
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false); set role authenticated",
  );
  await expect(protect(true, true, 1)).rejects.toThrow('AUTH_REQUIRED');
  await loginDb(db, userA);
  await expect(
    db.query('update albums set is_pinned=true where id=$1', [albumId]),
  ).rejects.toThrow('permission denied');
  albumId = randomUUID();
  await expect(protect(true, true, 1)).rejects.toThrow('NOT_FOUND');
});
it('audit failure rolls flags/revision/ledger back and retry can succeed once repaired', async () => {
  await db.exec('reset role');
  await db.exec(`create function kino_private.fail_protection() returns trigger language plpgsql as $$begin if new.operation='album.protection_changed' then raise exception 'INJECTED_AUDIT_FAILURE'; end if; return new; end;$$;
 create trigger fail_protection before insert on audit_logs for each row execute function kino_private.fail_protection();`);
  await loginDb(db, userA);
  const req = randomUUID();
  await expect(protect(true, true, 1, false, req)).rejects.toThrow(
    'INJECTED_AUDIT_FAILURE',
  );
  await db.exec('reset role');
  expect(
    (
      await db.query(
        'select is_pinned,legal_hold,revision from albums where id=$1',
        [albumId],
      )
    ).rows[0],
  ).toEqual({ is_pinned: false, legal_hold: false, revision: 1 });
  expect(
    (
      await db.query(
        'select request_id from kino_private.workspace_requests where request_id=$1',
        [req],
      )
    ).rows,
  ).toHaveLength(0);
  await db.exec('drop trigger fail_protection on audit_logs');
  await loginDb(db, userA);
  expect(await protect(true, true, 1, false, req)).toMatchObject({
    revision: 2,
  });
});
it('never changes protection after deleting/deleted; archived albums may still be protected', async () => {
  for (const state of ['deleting', 'deleted']) {
    await db.exec('reset role');
    await db.query('update albums set state=$1 where id=$2', [state, albumId]);
    await loginDb(db, userA);
    await expect(protect(true, true, 1)).rejects.toThrow(
      'RESOURCE_NOT_EDITABLE',
    );
  }
  await db.exec('reset role');
  await db.query("update albums set state='archived' where id=$1", [albumId]);
  await loginDb(db, userA);
  expect(await protect(true, true, 1)).toMatchObject({
    state: 'archived',
    isPinned: true,
    legalHold: true,
  });
});
it('validates direct RPC nulls and revision independently of HTTP', async () => {
  const valid: (string | number | boolean | null)[] = [
    albumId,
    true,
    true,
    1,
    false,
    randomUUID(),
  ];
  for (let index = 0; index < valid.length; index++) {
    const args = [...valid];
    args[index] = null;
    await expect(call('set_album_protection', args)).rejects.toThrow(
      'INVALID_INPUT',
    );
  }
  await expect(protect(true, true, 0)).rejects.toThrow('INVALID_INPUT');
});
