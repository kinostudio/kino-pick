import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { fixtureDb, loginDb, userA } from '../helpers/database';
import { workspaceSchema } from '../../packages/contracts/src/identity';
let db: PGlite;
beforeEach(async () => {
  db = await fixtureDb();
  await loginDb(db, userA);
}, 30000);
afterEach(async () => {
  await db?.close();
});
async function create(name: string, requestId = randomUUID()) {
  const result = await db.query<{ result: unknown }>(
    'select create_workspace($1,$2) as result',
    [name, requestId],
  );
  return workspaceSchema.parse(result.rows[0]!.result);
}
describe('workspace RPC Unicode name normalization', () => {
  it('persists and returns 120 astral characters without poisoning workspace response validation', async () => {
    const name = '😀'.repeat(120);
    const workspace = await create(name);
    expect(workspace.name).toBe(name);
    const rows = await db.query<{ name: string; characters: number }>(
      'select name,char_length(name) as characters from workspaces',
    );
    expect(rows.rows).toEqual([{ name, characters: 120 }]);
    await expect(create('😀'.repeat(121))).rejects.toThrow('INVALID_INPUT');
    expect((await db.query('select id from workspaces')).rows).toHaveLength(1);
  });
  it('rejects all trim-whitespace-only names before profile/workspace/audit/ledger writes', async () => {
    const whitespace =
      '\t\n\r\v\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
    await expect(create(whitespace)).rejects.toThrow('INVALID_INPUT');
    await db.exec('reset role');
    for (const table of [
      'profiles',
      'workspaces',
      'workspace_members',
      'audit_logs',
      'kino_private.workspace_requests',
    ])
      expect(
        (await db.query(`select count(*)::int as count from ${table}`)).rows,
      ).toEqual([{ count: 0 }]);
  });
  it('uses normalized names for storage, audit and idempotent replay', async () => {
    const requestId = randomUUID();
    const first = await create('\u00a0\t\ufeff Studio \u3000\u2029', requestId);
    expect(first.name).toBe('Studio');
    expect(await create('Studio', requestId)).toEqual(first);
    expect(await create('\u2003Studio\u205f', requestId)).toEqual(first);
    await expect(create('Other', requestId)).rejects.toThrow(
      'REQUEST_ID_CONFLICT',
    );
    expect((await db.query('select name from workspaces')).rows).toEqual([
      { name: 'Studio' },
    ]);
    expect(
      (
        await db.query(
          "select after_json->>'name' as name from audit_logs where operation='workspace.created'",
        )
      ).rows,
    ).toEqual([{ name: 'Studio' }]);
    await db.exec('reset role');
    expect(
      (
        await db.query(
          'select payload from kino_private.workspace_requests where request_id=$1',
          [requestId],
        )
      ).rows,
    ).toEqual([{ payload: { name: 'Studio' } }]);
  });
});
