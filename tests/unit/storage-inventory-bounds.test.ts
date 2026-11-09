import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { D1StorageInventoryRepository } from '../../apps/worker/src/storage-inventory';

// Adversarial SQLite input fixtures exercise the actual SELECTs, not D1 transport/performance.
const db = new DatabaseSync(':memory:');
for (const name of readdirSync(resolve('apps/worker/migrations'))
  .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
  .sort())
  db.exec(readFileSync(resolve('apps/worker/migrations', name), 'utf8'));
const actor = randomUUID();
const session = randomUUID();
const workspace = randomUUID();
db.prepare(
  'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
).run(actor, randomUUID());
db.prepare(
  'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
).run(
  session,
  randomUUID(),
  actor,
  Date.now() + 3600000,
  Date.now(),
  Date.now(),
);
db.prepare(
  'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
).run(actor, randomUUID(), session, 'Bounded inventory fixture', workspace);
type Statement = {
  sql: string;
  values: SQLInputValue[];
  bind(...values: SQLInputValue[]): Statement;
  first(): Promise<unknown>;
};
let payloadRows: number[] = [];
const adapter = {
  prepare(sql: string): Statement {
    return {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        return db.prepare(this.sql).get(...this.values) ?? null;
      },
    };
  },
  async batch(statements: Statement[]) {
    db.exec('BEGIN');
    try {
      const results = statements.map(({ sql, values }) => ({
        success: true,
        results: db.prepare(sql).all(...values),
      }));
      payloadRows = results.slice(1).map((result) => result.results.length);
      db.exec('COMMIT');
      return results;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
};
const repository = new D1StorageInventoryRepository(
  adapter as unknown as D1Database,
  actor,
  session,
);
afterAll(() => db.close());

describe('product inventory bounds before returning key payloads', () => {
  it.each([
    ['one oversized key', 1, 1100],
    ['combined key-byte budget', 10000, 600],
    ['combined object-count budget', 20001, 1],
  ] as const)(
    'rejects %s without transferring asset or fence rows',
    async (_name, count, keyWidth) => {
      db.exec('DROP VIEW IF EXISTS temp.photo_assets');
      db.prepare(
        "UPDATE storage_nodes SET used_bytes=? WHERE id='primary'",
      ).run(count);
      db.prepare(
        'UPDATE workspace_storage_usage SET used_bytes=? WHERE workspace_id=?',
      ).run(count, workspace);
      // A TEMP view models malformed/large input without altering the real migration schema.
      db.exec(`CREATE TEMP VIEW photo_assets AS WITH RECURSIVE ids(i) AS (
      SELECT 1 UNION ALL SELECT i+1 FROM ids WHERE i<${count}
    ) SELECT printf('00000000-0000-4000-8000-%012x',i) AS id,
      '${workspace}' AS workspace_id,'primary' AS storage_node_id,NULL AS photo_id,
      '${workspace}/'||printf('%0${keyWidth}d',i) AS object_key,
      1 AS byte_size,'${'a'.repeat(64)}' AS checksum_sha256,'private' AS state FROM ids`);
      payloadRows = [];
      await expect(repository.read(workspace, 'primary')).rejects.toMatchObject(
        { code: 'STORAGE_INVENTORY_LIMIT', status: 503 },
      );
      expect(payloadRows).toEqual([0, 0]);
      db.exec('DROP VIEW temp.photo_assets');
    },
  );
});
