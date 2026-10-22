import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  fixtureDb,
  loginDb,
  userA,
  userB,
  userC,
  requestA,
  requestB,
  requestC,
} from '../helpers/database';
let db: PGlite;
beforeEach(async () => {
  db = await fixtureDb();
}, 30000);
afterEach(async () => {
  await db?.close();
});
async function create(name = '攝影工作室', id = requestA) {
  return (
    await db.query<{ result: { id: string; role: string; name: string } }>(
      'select create_workspace($1,$2) as result',
      [name, id],
    )
  ).rows[0]!.result;
}
describe('workspace transactional provisioning', () => {
  it('creates profile/owner membership/audit atomically and replays only identical payload', async () => {
    await loginDb(db, userA);
    const workspace = await create();
    const replay = await create();
    expect(replay).toEqual(workspace);
    expect(workspace.role).toBe('workspace_owner');
    expect((await db.query('select id from workspaces')).rows).toEqual([
      { id: workspace.id },
    ]);
    expect(
      (await db.query('select role,status from workspace_members')).rows,
    ).toEqual([{ role: 'workspace_owner', status: 'active' }]);
    expect(
      (await db.query('select operation from audit_logs order by operation'))
        .rows,
    ).toEqual([
      { operation: 'profile.created' },
      { operation: 'workspace.created' },
    ]);
    await expect(create('different')).rejects.toThrow('REQUEST_ID_CONFLICT');
    await expect(
      db.exec("update workspaces set name='tampered'"),
    ).rejects.toThrow();
    await expect(db.exec('delete from audit_logs')).rejects.toThrow();
    await expect(
      db.exec("update audit_logs set operation='tampered'"),
    ).rejects.toThrow();
    await db.exec('reset role');
    await expect(db.exec('delete from audit_logs')).rejects.toThrow(
      'AUDIT_APPEND_ONLY',
    );
  });
  it('isolates actors even if request IDs repeat; rejects non-Google and anonymous callers', async () => {
    await loginDb(db, userA);
    const a = await create();
    await loginDb(db, userB);
    const b = await create();
    expect(a.id).not.toBe(b.id);
    expect((await db.query('select id from workspaces')).rows).toEqual([
      { id: b.id },
    ]);
    await loginDb(db, userC);
    await expect(create()).rejects.toThrow('GOOGLE_IDENTITY_REQUIRED');
    await db.exec('set role anon');
    await expect(create()).rejects.toThrow();
    await db.exec(
      "reset role; select set_config('request.jwt.claim.sub','',false); set role authenticated",
    );
    await expect(create()).rejects.toThrow('AUTH_REQUIRED');
  });
  it('rolls back every write if audit insertion fails', async () => {
    await db.exec(`create function kino_private.test_reject_event() returns trigger language plpgsql as $$begin if new.operation='workspace.created' then raise exception 'INJECTED_AUDIT_FAILURE'; end if;return new;end;$$;
   create trigger test_reject_event before insert on public.audit_logs for each row execute function kino_private.test_reject_event();`);
    await loginDb(db, userA);
    await expect(create()).rejects.toThrow('INJECTED_AUDIT_FAILURE');
    await db.exec('reset role');
    for (const table of [
      'profiles',
      'workspaces',
      'workspace_members',
      'audit_logs',
      'kino_private.workspace_requests',
    ])
      expect(
        (await db.query(`select count(*)::int as n from ${table}`)).rows,
      ).toEqual([{ n: 0 }]);
  });
  it('grants role changes only to owner; suspending member immediately removes tenant visibility', async () => {
    await loginDb(db, userB);
    await db.query('select ensure_photographer_profile($1)', [requestA]);
    await loginDb(db, userA);
    const a = await create();
    const args = [a.id, userB, 'workspace_editor', 'active', requestB];
    await db.query('select set_workspace_member($1,$2,$3,$4,$5)', args);
    await db.query('select set_workspace_member($1,$2,$3,$4,$5)', args);
    expect(
      (
        await db.query(
          "select operation from audit_logs where operation='workspace.member_changed'",
        )
      ).rows,
    ).toHaveLength(1);
    await loginDb(db, userB);
    expect((await db.query('select id from workspaces')).rows).toEqual([
      { id: a.id },
    ]);
    await expect(
      db.query('select set_workspace_member($1,$2,$3,$4,$5)', [
        a.id,
        userA,
        'retoucher',
        'suspended',
        requestC,
      ]),
    ).rejects.toThrow('FORBIDDEN_SCOPE');
    expect((await db.query('select id from audit_logs')).rows).toHaveLength(1); // own profile only
    await loginDb(db, userA);
    await expect(
      db.query('select set_workspace_member($1,$2,$3,$4,$5)', [
        a.id,
        userA,
        'retoucher',
        'suspended',
        requestC,
      ]),
    ).rejects.toThrow('OWNER_ROLE_IMMUTABLE');
    await expect(
      db.query('select set_workspace_member($1,$2,$3,$4,$5)', [
        a.id,
        userB,
        'workspace_owner',
        'active',
        requestC,
      ]),
    ).rejects.toThrow('INVALID_INPUT');
    await db.query('select set_workspace_member($1,$2,$3,$4,$5)', [
      a.id,
      userB,
      'retoucher',
      'suspended',
      requestC,
    ]);
    await loginDb(db, userB);
    expect((await db.query('select id from workspaces')).rows).toHaveLength(0);
  });
  it('rejects cross-tenant role writes and missing target without leaking profile existence', async () => {
    await loginDb(db, userA);
    const a = await create();
    await loginDb(db, userB);
    await expect(
      db.query('select set_workspace_member($1,$2,$3,$4,$5)', [
        a.id,
        userC,
        'retoucher',
        'active',
        requestA,
      ]),
    ).rejects.toThrow('FORBIDDEN_SCOPE');
    await loginDb(db, userA);
    await expect(
      db.query('select set_workspace_member($1,$2,$3,$4,$5)', [
        a.id,
        userC,
        'retoucher',
        'active',
        requestB,
      ]),
    ).rejects.toThrow('MEMBER_NOT_FOUND');
    expect(
      (await db.query('select user_id from workspace_members')).rows,
    ).toEqual([{ user_id: userA }]);
  });
});
