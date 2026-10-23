import { beforeEach, afterEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
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
const hash = 'a'.repeat(64);
async function begin(provider = 'github', token = hash, request = requestA) {
  return (
    await db.query<{
      result: {
        actorId: string;
        provider: string;
        requestId: string;
        expiresAt: string;
      };
    }>('select begin_oauth_link($1,$2,$3) as result', [
      provider,
      token,
      request,
    ])
  ).rows[0]!.result;
}
it('allows GitHub-only ownership and content writes; linking another provider preserves one profile and tenant identity', async () => {
  await db.query(
    "update auth.identities set provider='github' where user_id=$1",
    [userB],
  );
  await loginDb(db, userB);
  const w = (
    await db.query<{ result: { id: string; ownerUserId: string } }>(
      'select create_workspace($1,$2) as result',
      ['Github workspace', requestA],
    )
  ).rows[0]!.result;
  expect(w.ownerUserId).toBe(userB);
  const p = (
    await db.query<{ result: { id: string } }>(
      'select create_project($1,$2,$3) as result',
      [w.id, 'Project', requestB],
    )
  ).rows[0]!.result;
  const a = (
    await db.query<{ result: { id: string } }>(
      'select create_album($1,$2,$3) as result',
      [p.id, 'Album', requestC],
    )
  ).rows[0]!.result;
  await db.query('select rename_project($1,$2,$3,$4)', [
    p.id,
    'Renamed project',
    1,
    randomUUID(),
  ]);
  await db.query('select rename_album($1,$2,$3,$4)', [
    a.id,
    'Renamed album',
    1,
    randomUUID(),
  ]);
  await db.exec('reset role');
  await db.query("insert into auth.identities values($1,'google')", [userB]);
  await loginDb(db, userB);
  await db.query('select ensure_photographer_profile($1)', [randomUUID()]);
  expect((await db.query('select id from profiles')).rows).toEqual([
    { id: userB },
  ]);
  expect((await db.query('select id from workspaces')).rows).toEqual([
    { id: w.id },
  ]);
  expect(
    (
      await db.query(
        "select id from audit_logs where operation='profile.created'",
      )
    ).rows,
  ).toHaveLength(1);
  await loginDb(db, userA);
  expect((await db.query('select id from workspaces')).rows).toEqual([]);
  await expect(
    db.query('select create_project($1,$2,$3)', [
      w.id,
      'Forbidden',
      randomUUID(),
    ]),
  ).rejects.toThrow('NOT_FOUND');
  await loginDb(db, userC);
  await expect(
    db.query('select create_workspace($1,$2)', ['Denied', randomUUID()]),
  ).rejects.toThrow('OAUTH_IDENTITY_REQUIRED');
});
it('scopes hashed intents to their actor and verifies a real identity before audit completion', async () => {
  await loginDb(db, userA);
  const intent = await begin();
  expect(intent.actorId).toBe(userA);
  expect(await begin()).toEqual(intent);
  await expect(begin('github', hash, requestB)).rejects.toThrow();
  await expect(
    db.exec('select * from kino_private.oauth_link_intents'),
  ).rejects.toThrow();
  await expect(
    db.query('select complete_oauth_link($1)', [hash]),
  ).rejects.toThrow('LINK_NOT_VERIFIED');
  await loginDb(db, userB);
  await expect(db.query('select read_oauth_link($1)', [hash])).rejects.toThrow(
    'LINK_INTENT_INVALID',
  );
  await expect(
    db.query('select complete_oauth_link($1)', [hash]),
  ).rejects.toThrow('LINK_INTENT_INVALID');
  await db.exec('reset role');
  await db.query("insert into auth.identities values($1,'github')", [userA]);
  await loginDb(db, userA);
  const complete = await db.query('select complete_oauth_link($1) as result', [
    hash,
  ]);
  expect(
    (await db.query('select complete_oauth_link($1) as result', [hash])).rows,
  ).toEqual(complete.rows);
  expect(
    (
      await db.query(
        "select operation from audit_logs where operation like 'identity.%' order by operation",
      )
    ).rows,
  ).toEqual([
    { operation: 'identity.link_started' },
    { operation: 'identity.linked' },
  ]);
  await expect(db.query('select read_oauth_link($1)', [hash])).rejects.toThrow(
    'LINK_INTENT_INVALID',
  );
});
it('rejects expired intent and invalid/reused request input without linking or changing account ownership', async () => {
  await loginDb(db, userA);
  await begin();
  await expect(begin('google', hash, requestA)).rejects.toThrow(
    'REQUEST_ID_CONFLICT',
  );
  await expect(begin('email', 'b'.repeat(64), requestB)).rejects.toThrow(
    'INVALID_INPUT',
  );
  await expect(begin('github', 'raw-token', requestB)).rejects.toThrow(
    'INVALID_INPUT',
  );
  await db.exec('reset role');
  await db.query(
    "update kino_private.oauth_link_intents set expires_at=now()-interval '1 second' where token_hash=$1",
    [hash],
  );
  await loginDb(db, userA);
  await expect(db.query('select read_oauth_link($1)', [hash])).rejects.toThrow(
    'LINK_INTENT_INVALID',
  );
  await expect(
    db.query('select complete_oauth_link($1)', [hash]),
  ).rejects.toThrow('LINK_INTENT_INVALID');
  expect(
    (
      await db.query(
        "select id from audit_logs where operation='identity.linked'",
      )
    ).rows,
  ).toEqual([]);
});
it('rolls back intent and ledger if the initiation audit fails', async () => {
  await db.exec(
    `create function kino_private.fail_link_audit() returns trigger language plpgsql as $$begin if new.operation='identity.link_started' then raise exception 'INJECTED_AUDIT_FAILURE';end if;return new;end;$$;create trigger fail_link_audit before insert on audit_logs for each row execute function kino_private.fail_link_audit();`,
  );
  await loginDb(db, userA);
  await expect(begin()).rejects.toThrow('INJECTED_AUDIT_FAILURE');
  await db.exec('reset role');
  for (const table of [
    'kino_private.oauth_link_intents',
    'kino_private.workspace_requests',
    'audit_logs',
  ])
    expect(
      (await db.query(`select count(*)::int as n from ${table}`)).rows,
    ).toEqual([{ n: 0 }]);
});
it('rolls back completion and allows safe retry if completion audit fails', async () => {
  await loginDb(db, userA);
  await begin();
  await db.exec('reset role');
  await db.query("insert into auth.identities values($1,'github')", [userA]);
  await db.exec(
    `create function kino_private.fail_link_completion() returns trigger language plpgsql as $$begin if new.operation='identity.linked' then raise exception 'INJECTED_AUDIT_FAILURE';end if;return new;end;$$;create trigger fail_link_completion before insert on audit_logs for each row execute function kino_private.fail_link_completion();`,
  );
  await loginDb(db, userA);
  await expect(
    db.query('select complete_oauth_link($1)', [hash]),
  ).rejects.toThrow('INJECTED_AUDIT_FAILURE');
  await db.query('select read_oauth_link($1)', [hash]);
  await db.exec('reset role;drop trigger fail_link_completion on audit_logs');
  await loginDb(db, userA);
  await db.query('select complete_oauth_link($1)', [hash]);
  expect(
    (
      await db.query(
        "select id from audit_logs where operation='identity.linked'",
      )
    ).rows,
  ).toHaveLength(1);
});
it('limits pending link attempts and refuses linking an already bound provider', async () => {
  await loginDb(db, userA);
  await expect(begin('google')).rejects.toThrow('IDENTITY_ALREADY_LINKED');
  for (let i = 0; i < 5; i++)
    await begin('github', i.toString(16).repeat(64), randomUUID());
  await expect(begin('github', 'f'.repeat(64), randomUUID())).rejects.toThrow(
    'LINK_LIMIT_REACHED',
  );
});
