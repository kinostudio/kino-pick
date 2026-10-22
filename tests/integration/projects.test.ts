import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { fixtureDb, loginDb, userA, userB, userC } from '../helpers/database';
import {
  projectSchema,
  albumSchema,
} from '../../packages/contracts/src/projects';
let db: PGlite;
let workspaceId: string;
const missing = '99999999-9999-4999-8999-999999999999';
async function call(fn: string, args: (string | number | null)[]) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
  return (
    await db.query<{ result: unknown }>(
      `select public.${fn}(${placeholders}) as result`,
      args,
    )
  ).rows[0]!.result;
}
async function createProject(name = 'Campaign', requestId = randomUUID()) {
  return projectSchema.parse(
    await call('create_project', [workspaceId, name, requestId]),
  );
}
async function createAlbum(projectId: string, requestId = randomUUID()) {
  return albumSchema.parse(
    await call('create_album', [projectId, 'Proofs', requestId]),
  );
}
async function member(role: string, status = 'active') {
  await loginDb(db, userA);
  await call('set_workspace_member', [
    workspaceId,
    userB,
    role,
    status,
    randomUUID(),
  ]);
  await loginDb(db, userB);
}
beforeEach(async () => {
  db = await fixtureDb();
  await loginDb(db, userB);
  await call('ensure_photographer_profile', [randomUUID()]);
  await loginDb(db, userA);
  const result = await db.query<{ result: { id: string } }>(
    'select create_workspace($1,$2) as result',
    ['Studio', randomUUID()],
  );
  workspaceId = result.rows[0]!.result.id;
}, 30000);
afterEach(async () => {
  await db?.close();
});
describe('project/album transactional mutations', () => {
  it('creates scoped draft records and audit once; replays share the global request namespace', async () => {
    const requestId = randomUUID();
    const project = await createProject(' Campaign ', requestId);
    expect(project).toMatchObject({
      workspaceId,
      name: 'Campaign',
      status: 'draft',
      versioningMode: 'manual',
      revision: 1,
    });
    expect(await createProject('Campaign', requestId)).toEqual(project);
    await expect(createProject('Different', requestId)).rejects.toThrow(
      'REQUEST_ID_CONFLICT',
    );
    await expect(createAlbum(project.id, requestId)).rejects.toThrow(
      'REQUEST_ID_CONFLICT',
    );
    const albumRequest = randomUUID();
    const album = await createAlbum(project.id, albumRequest);
    expect(album).toMatchObject({
      workspaceId,
      projectId: project.id,
      state: 'draft',
      isPinned: false,
      legalHold: false,
      revision: 1,
    });
    expect(await createAlbum(project.id, albumRequest)).toEqual(album);
    expect(
      (
        await db.query(
          "select operation,before_json from audit_logs where operation in ('project.created','album.created') order by operation",
        )
      ).rows,
    ).toEqual([
      { operation: 'album.created', before_json: null },
      { operation: 'project.created', before_json: null },
    ]);
    expect((await db.query('select id from projects')).rows).toHaveLength(1);
    expect((await db.query('select id from albums')).rows).toHaveLength(1);
  });
  it('rejects stale revisions; replays preserve later edits; accepted same-name rename records an event', async () => {
    const project = await createProject();
    const album = await createAlbum(project.id);
    for (const [kind, original] of [
      ['project', project],
      ['album', album],
    ] as const) {
      const request = randomUUID();
      const first = await call(`rename_${kind}`, [
        original.id,
        'First edit',
        1,
        request,
      ]);
      expect(first).toMatchObject({ revision: 2, name: 'First edit' });
      await expect(
        call(`rename_${kind}`, [
          original.id,
          'Stale overwrite',
          1,
          randomUUID(),
        ]),
      ).rejects.toThrow('CONCURRENT_MODIFICATION');
      await expect(
        call(`rename_${kind}`, [original.id, 'Different replay', 1, request]),
      ).rejects.toThrow('REQUEST_ID_CONFLICT');
      expect(
        await call(`rename_${kind}`, [
          original.id,
          'Second edit',
          2,
          randomUUID(),
        ]),
      ).toMatchObject({ revision: 3 });
      expect(
        await call(`rename_${kind}`, [original.id, 'First edit', 1, request]),
      ).toEqual(first);
      expect(
        await call(`rename_${kind}`, [
          original.id,
          'Second edit',
          3,
          randomUUID(),
        ]),
      ).toMatchObject({ revision: 4 });
      const rows = (
        await db.query<{
          before_json: { revision: number };
          after_json: { revision: number };
        }>(
          "select before_json,after_json from audit_logs where operation=$1 order by (after_json->>'revision')::int",
          [`${kind}.renamed`],
        )
      ).rows;
      expect(
        rows.map((row) => [row.before_json.revision, row.after_json.revision]),
      ).toEqual([
        [1, 2],
        [2, 3],
        [3, 4],
      ]);
      expect(
        (
          await db.query(`select name,revision from ${kind}s where id=$1`, [
            original.id,
          ])
        ).rows,
      ).toEqual([{ name: 'Second edit', revision: 4 }]);
    }
  });
  it.each(['workspace_editor', 'photographer'])(
    'permits active %s content writes',
    async (role) => {
      await member(role);
      const project = await createProject();
      const album = await createAlbum(project.id);
      expect(
        await call('rename_project', [project.id, 'Edited', 1, randomUUID()]),
      ).toMatchObject({ revision: 2 });
      expect(
        await call('rename_album', [album.id, 'Edited', 1, randomUUID()]),
      ).toMatchObject({ revision: 2 });
    },
  );
  it('keeps retouchers read-only and rechecks role before replay after downgrade/suspension', async () => {
    await member('workspace_editor');
    const projectRequest = randomUUID();
    const project = await createProject('Campaign', projectRequest);
    const album = await createAlbum(project.id);
    const renameRequest = randomUUID();
    await call('rename_album', [album.id, 'Edited', 1, renameRequest]);
    await member('retoucher');
    expect((await db.query('select id from projects')).rows).toHaveLength(1);
    expect((await db.query('select id from albums')).rows).toHaveLength(1);
    const denied = [
      ['create_project', [workspaceId, 'Campaign', projectRequest]],
      ['rename_project', [project.id, 'Edited', 1, randomUUID()]],
      ['create_album', [project.id, 'Proofs', randomUUID()]],
      ['rename_album', [album.id, 'Edited', 1, renameRequest]],
    ] as const;
    for (const [fn, args] of denied)
      await expect(call(fn, [...args])).rejects.toThrow('FORBIDDEN_SCOPE');
    await member('photographer', 'suspended');
    for (const [fn, args] of denied)
      await expect(call(fn, [...args])).rejects.toThrow('NOT_FOUND');
    expect((await db.query('select id from projects')).rows).toHaveLength(0);
    expect((await db.query('select id from albums')).rows).toHaveLength(0);
  });
  it('does not reveal cross-tenant resources through reads, writes or idempotent replay', async () => {
    const project = await createProject();
    const album = await createAlbum(project.id);
    await loginDb(db, userB);
    for (const [fn, args] of [
      ['create_project', [workspaceId, 'Attack', randomUUID()]],
      ['rename_project', [project.id, 'Attack', 1, randomUUID()]],
      ['create_album', [project.id, 'Attack', randomUUID()]],
      ['rename_album', [album.id, 'Attack', 1, randomUUID()]],
      ['rename_project', [missing, 'Attack', 1, randomUUID()]],
      ['rename_album', [missing, 'Attack', 1, randomUUID()]],
    ] as const)
      await expect(call(fn, [...args])).rejects.toThrow('NOT_FOUND');
    expect((await db.query('select id from projects')).rows).toHaveLength(0);
    expect((await db.query('select id from albums')).rows).toHaveLength(0);
    expect(
      (
        await db.query('select id from audit_logs where workspace_id=$1', [
          workspaceId,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it('denies anonymous/non-Google identities and null claims for every content RPC', async () => {
    const project = await createProject();
    const album = await createAlbum(project.id);
    const attempts = [
      ['create_project', [workspaceId, 'x', randomUUID()]],
      ['rename_project', [project.id, 'x', 1, randomUUID()]],
      ['create_album', [project.id, 'x', randomUUID()]],
      ['rename_album', [album.id, 'x', 1, randomUUID()]],
    ] as const;
    await loginDb(db, userC);
    for (const [fn, args] of attempts)
      await expect(call(fn, [...args])).rejects.toThrow(
        'GOOGLE_IDENTITY_REQUIRED',
      );
    await db.exec('set role anon');
    for (const [fn, args] of attempts)
      await expect(call(fn, [...args])).rejects.toThrow('permission denied');
    await db.exec(
      "reset role; select set_config('request.jwt.claim.sub','',false); set role authenticated",
    );
    for (const [fn, args] of attempts)
      await expect(call(fn, [...args])).rejects.toThrow('AUTH_REQUIRED');
  });
  it('rolls back resource changes, revision and idempotency when any content audit insert fails', async () => {
    const project = await createProject();
    const album = await createAlbum(project.id);
    await db.exec('reset role');
    await db.exec(`create function kino_private.reject_content_audit() returns trigger language plpgsql as $$begin
      if new.operation like 'project.%' or new.operation like 'album.%' then raise exception 'INJECTED_AUDIT_FAILURE'; end if; return new; end;$$;
      create trigger reject_content_audit before insert on audit_logs for each row execute function kino_private.reject_content_audit();`);
    const attempts = [
      ['create_project', [workspaceId, 'Fail', randomUUID()]],
      ['rename_project', [project.id, 'Fail', 1, randomUUID()]],
      ['create_album', [project.id, 'Fail', randomUUID()]],
      ['rename_album', [album.id, 'Fail', 1, randomUUID()]],
    ] as const;
    await loginDb(db, userA);
    for (const [fn, args] of attempts)
      await expect(call(fn, [...args])).rejects.toThrow(
        'INJECTED_AUDIT_FAILURE',
      );
    await db.exec('reset role');
    expect((await db.query('select name,revision from projects')).rows).toEqual(
      [{ name: project.name, revision: 1 }],
    );
    expect((await db.query('select name,revision from albums')).rows).toEqual([
      { name: album.name, revision: 1 },
    ]);
    for (const [, args] of attempts)
      expect(
        (
          await db.query(
            'select request_id from kino_private.workspace_requests where request_id=$1',
            [args.at(-1)],
          )
        ).rows,
      ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select id from audit_logs where after_json->>'name'='Fail'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('denies direct writes and enforces immutable parent IDs plus composite tenant FKs', async () => {
    const project = await createProject();
    const otherProject = await createProject('Other');
    const album = await createAlbum(project.id);
    await expect(db.exec("update projects set name='bypass'")).rejects.toThrow(
      'permission denied',
    );
    await expect(db.exec("update albums set name='bypass'")).rejects.toThrow(
      'permission denied',
    );
    await expect(
      db.query('insert into projects(workspace_id,name) values($1,$2)', [
        workspaceId,
        'bypass',
      ]),
    ).rejects.toThrow('permission denied');
    await db.exec('reset role');
    await expect(
      db.query('update projects set workspace_id=$1 where id=$2', [
        missing,
        project.id,
      ]),
    ).rejects.toThrow('IMMUTABLE_PARENT');
    await expect(
      db.query('update projects set id=$1 where id=$2', [missing, project.id]),
    ).rejects.toThrow('IMMUTABLE_PARENT');
    await expect(
      db.query('update albums set project_id=$1 where id=$2', [
        otherProject.id,
        album.id,
      ]),
    ).rejects.toThrow('IMMUTABLE_PARENT');
    await expect(
      db.query('update albums set workspace_id=$1 where id=$2', [
        missing,
        album.id,
      ]),
    ).rejects.toThrow('IMMUTABLE_PARENT');
    await expect(
      db.query('update albums set id=$1 where id=$2', [missing, album.id]),
    ).rejects.toThrow('IMMUTABLE_PARENT');
    await expect(
      db.query(
        'insert into albums(workspace_id,project_id,name) values($1,$2,$3)',
        [missing, project.id, 'cross tenant'],
      ),
    ).rejects.toThrow('foreign key');
  });
  it('validates direct RPC inputs without trusting HTTP validation', async () => {
    const project = await createProject();
    const album = await createAlbum(project.id);
    for (const name of [null, '', ' ', '\t\n\u00a0', 'x'.repeat(161)]) {
      await expect(
        call('create_project', [workspaceId, name, randomUUID()]),
      ).rejects.toThrow('INVALID_INPUT');
      await expect(
        call('create_album', [project.id, name, randomUUID()]),
      ).rejects.toThrow('INVALID_INPUT');
    }
    for (const revision of [null, 0, -1]) {
      await expect(
        call('rename_project', [project.id, 'x', revision, randomUUID()]),
      ).rejects.toThrow('INVALID_INPUT');
      await expect(
        call('rename_album', [album.id, 'x', revision, randomUUID()]),
      ).rejects.toThrow('INVALID_INPUT');
    }
    await expect(
      call('create_project', [workspaceId, 'x', null]),
    ).rejects.toThrow('INVALID_INPUT');
    expect(await createProject('\u00a0\t Name \u3000')).toMatchObject({
      name: 'Name',
    });
    expect(await createProject('📷'.repeat(160))).toMatchObject({
      name: '📷'.repeat(160),
    });
    await expect(createProject('📷'.repeat(161))).rejects.toThrow(
      'INVALID_INPUT',
    );
  });
});
