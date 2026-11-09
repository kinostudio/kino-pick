import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'vitest';
import type { StorageInventoryPage } from '../../packages/domain/src/storage-reconciliation';
import { D1StorageReconciliationReceipts } from '../../apps/worker/src/storage-reconciliation-receipts';
import {
  D1WorkspaceRepository,
  WorkspaceFailure,
} from '../../apps/worker/src/workspaces';

type NativeStatement = {
  bind(...values: (number | string | null | Uint8Array)[]): NativeStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};
type NativeD1 = {
  batch(statements: NativeStatement[]): Promise<unknown>;
  prepare(sql: string): NativeStatement;
};
type NativeR2Page = {
  objects: Array<{ key: string; size: number }>;
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
};
type NativeR2Bucket = {
  put(key: string, value: Uint8Array): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(options: {
    prefix: string;
    limit: number;
    cursor?: string;
  }): Promise<NativeR2Page>;
};
type NativeMiniflare = {
  getD1Database(binding: string, workerName: string): Promise<NativeD1>;
  getR2Bucket(binding: string, workerName: string): Promise<NativeR2Bucket>;
  dispose(): Promise<void>;
};

const workerRequire = createRequire(resolve('apps/worker/package.json'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare') as {
  Miniflare: new (options: unknown) => NativeMiniflare;
  convertV4MiniflareOptions: (options: unknown) => unknown;
};
const { unstable_splitSqlQuery } = workerRequire('wrangler') as {
  unstable_splitSqlQuery: (sql: string) => string[];
};

const workerName = 'storage-reconciliation-receipts-native';

test('schema69 plus proposal0070 records a fenced receipt against the primary R2 bucket', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: workerName,
          modules: true,
          script:
            "export default { async fetch() { return new Response('ok'); } };",
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: workerName },
          r2Buckets: { PRIMARY_STORAGE: workerName },
        },
      ],
    }),
  );

  try {
    const db = await mf.getD1Database('DB', workerName);
    const bucket = await mf.getR2Bucket('PRIMARY_STORAGE', workerName);
    const migrationDirectory = resolve('apps/worker/migrations');
    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    assert.equal(files.length, 69);
    assert.equal(files.at(-1), '0069_inherited_share_expiry.sql');

    const apply = async (source: string) =>
      db.batch(unstable_splitSqlQuery(source).map((sql) => db.prepare(sql)));
    for (const file of files)
      await apply(await readFile(resolve(migrationDirectory, file), 'utf8'));
    await apply(
      await readFile(
        resolve(
          'apps/worker/migration-proposals/0070_storage_reconciliation.sql',
        ),
        'utf8',
      ),
    );

    const actor = randomUUID();
    const session = 'storage-receipt-native-owner-session';
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
      )
      .bind(actor, randomUUID())
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(session, randomUUID(), actor, now + 3_600_000, now, now)
      .run();
    const workspace = await new D1WorkspaceRepository(
      db as unknown as D1Database,
      actor,
      session,
    ).create({ name: 'Native receipt fixture', requestId: randomUUID() });
    const receipts = new D1StorageReconciliationReceipts(
      db as unknown as D1Database,
      actor,
      session,
    );

    const listPage = async ({
      prefix,
      limit,
      cursor,
    }: {
      prefix: string;
      limit: 1000;
      cursor?: string;
    }): Promise<StorageInventoryPage> => {
      const page = await bucket.list({
        prefix,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return {
        objects: page.objects.map(({ key, size }) => ({ key, size })),
        truncated: page.truncated,
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
        ...(page.delimitedPrefixes === undefined
          ? {}
          : { delimitedPrefixes: page.delimitedPrefixes }),
      };
    };

    const count = async (table: string) => {
      const row = await db
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .first<{ count: number }>();
      assert.ok(row);
      return row.count;
    };
    const state = async () => {
      const [usage, node, quota, clock] = await Promise.all([
        db
          .prepare(
            'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace.id)
          .first<{ used_bytes: number; reserved_bytes: number }>(),
        db
          .prepare(
            "SELECT quota_bytes,used_bytes,reserved_bytes,priority FROM storage_nodes WHERE id='primary'",
          )
          .first<{
            quota_bytes: number;
            used_bytes: number;
            reserved_bytes: number;
            priority: number;
          }>(),
        db
          .prepare('SELECT quota_bytes FROM workspaces WHERE id=?')
          .bind(workspace.id)
          .first<{ quota_bytes: number }>(),
        db
          .prepare('SELECT epoch FROM storage_inventory_clock WHERE id=1')
          .first<{ epoch: number }>(),
      ]);
      assert.ok(usage && node && quota && clock);
      return {
        usage,
        node,
        workspaceQuota: quota.quota_bytes,
        assetCount: await count('photo_assets'),
        auditCount: await count('audit_events'),
        receiptCount: await count('storage_reconciliation_receipts'),
        epoch: clock.epoch,
      };
    };
    const expectFailure = async (
      operation: Promise<unknown>,
      code: string,
      status: number,
    ) => {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof WorkspaceFailure);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
      });
    };
    const clockEpoch = async () => {
      const row = await db
        .prepare('SELECT epoch FROM storage_inventory_clock WHERE id=1')
        .first<{ epoch: number }>();
      assert.ok(row);
      return row.epoch;
    };

    // An actual R2 object without immutable D1 metadata cannot get a receipt.
    const orphanKey = `${workspace.id}/untracked.bin`;
    const beforeOrphan = await state();
    await bucket.put(orphanKey, new Uint8Array([1, 2, 3]));
    const orphan = await receipts.reconcile(workspace.id, 'primary', listPage);
    assert.equal(orphan.status, 'blocked');
    if (orphan.status === 'blocked')
      assert.equal(orphan.reason, 'unexpected_object');
    assert.deepEqual(await state(), beforeOrphan);
    await bucket.delete(orphanKey);

    const before = await state();
    const first = await receipts.reconcile(workspace.id, 'primary', listPage);
    assert.equal(first.status, 'recorded');
    if (first.status !== 'recorded')
      throw new Error('EMPTY_INVENTORY_NOT_RECORDED');
    assert.equal(first.receipt.object_count, 0);
    assert.equal(first.receipt.confirmed_bytes, 0);
    assert.equal(first.deletesData, false);
    assert.deepEqual(
      await receipts.current(workspace.id, 'primary', first.receipt.id),
      first.receipt,
    );
    const after = await state();
    assert.deepEqual(after, {
      ...before,
      auditCount: before.auditCount + 1,
      receiptCount: before.receiptCount + 1,
    });
    const receiptAudit = await db
      .prepare(
        'SELECT event_id,action,request_id FROM audit_events WHERE request_id=?',
      )
      .bind(first.receipt.id)
      .first<{ event_id: string; action: string; request_id: string }>();
    assert.deepEqual(receiptAudit, {
      event_id: `storage-reconciliation:${first.receipt.id}`,
      action: 'storage.reconciled',
      request_id: first.receipt.id,
    });
    await assert.rejects(
      db
        .prepare(
          'UPDATE storage_reconciliation_receipts SET object_count=1 WHERE id=?',
        )
        .bind(first.receipt.id)
        .run(),
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM storage_reconciliation_receipts WHERE id=?')
        .bind(first.receipt.id)
        .run(),
    );
    assert.deepEqual(
      await receipts.current(workspace.id, 'primary', first.receipt.id),
      first.receipt,
    );

    const setPriority = (priority: number) =>
      db
        .prepare("UPDATE storage_nodes SET priority=? WHERE id='primary'")
        .bind(priority)
        .run();
    const beforeMutation = await clockEpoch();
    await setPriority(2);
    assert.ok((await clockEpoch()) > beforeMutation);
    assert.equal(
      await receipts.current(workspace.id, 'primary', first.receipt.id),
      null,
    );

    const second = await receipts.reconcile(workspace.id, 'primary', listPage);
    assert.equal(second.status, 'recorded');
    if (second.status !== 'recorded')
      throw new Error('SECOND_RECEIPT_NOT_RECORDED');
    const beforeAba = await clockEpoch();
    await setPriority(1);
    await setPriority(2);
    assert.ok((await clockEpoch()) > beforeAba);
    assert.equal(
      await receipts.current(workspace.id, 'primary', second.receipt.id),
      null,
    );

    // Mutate D1 after the final read but immediately before the atomic insert.
    let raced = false;
    const racingDb = new Proxy(db, {
      get(target, property) {
        if (property === 'prepare')
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!sql.includes('INSERT INTO storage_reconciliation_receipts'))
              return statement;
            const wrap = (inner: NativeStatement): NativeStatement =>
              new Proxy(inner, {
                get(statementTarget, method) {
                  if (method === 'bind')
                    return (
                      ...values: (number | string | null | Uint8Array)[]
                    ) => wrap(statementTarget.bind(...values));
                  if (method === 'run')
                    return async () => {
                      if (!raced) {
                        raced = true;
                        await setPriority(1);
                      }
                      return statementTarget.run();
                    };
                  const value = Reflect.get(
                    statementTarget,
                    method,
                    statementTarget,
                  );
                  return typeof value === 'function'
                    ? value.bind(statementTarget)
                    : value;
                },
              });
            return wrap(statement);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as NativeD1;
    const beforeRace = await state();
    const racedResult = await new D1StorageReconciliationReceipts(
      racingDb as unknown as D1Database,
      actor,
      session,
    ).reconcile(workspace.id, 'primary', listPage);
    assert.ok(raced);
    assert.equal(racedResult.status, 'blocked');
    assert.deepEqual(
      await count('storage_reconciliation_receipts'),
      beforeRace.receiptCount,
    );
    assert.deepEqual(await count('audit_events'), beforeRace.auditCount);

    const third = await receipts.reconcile(workspace.id, 'primary', listPage);
    assert.equal(third.status, 'recorded');
    if (third.status !== 'recorded')
      throw new Error('THIRD_RECEIPT_NOT_RECORDED');

    const foreignUser = randomUUID();
    await db
      .prepare(
        'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(
        foreignUser,
        'Foreign receipt fixture',
        `${foreignUser}@fixture.invalid`,
        now,
        now,
      )
      .run();
    await db
      .prepare('UPDATE workspaces SET owner_user_id=? WHERE id=?')
      .bind(foreignUser, workspace.id)
      .run();
    await expectFailure(
      receipts.current(workspace.id, 'primary', third.receipt.id),
      'NOT_FOUND',
      404,
    );
    await db
      .prepare('UPDATE workspaces SET owner_user_id=? WHERE id=?')
      .bind(actor, workspace.id)
      .run();

    await db
      .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
      .bind(actor)
      .run();
    await expectFailure(
      receipts.current(workspace.id, 'primary', third.receipt.id),
      'OWNER_REQUIRED',
      403,
    );
    await db
      .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
      .bind(actor)
      .run();

    const replacementSession = 'storage-receipt-native-replacement-session';
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(replacementSession, randomUUID(), actor, now + 3_600_000, now, now)
      .run();
    await db
      .prepare('DELETE FROM owner_sessions WHERE id=?')
      .bind(session)
      .run();
    await expectFailure(
      receipts.current(workspace.id, 'primary', third.receipt.id),
      'OWNER_REQUIRED',
      403,
    );

    const triggers = await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='trigger' AND instr(sql,'storage_inventory_clock')>0",
      )
      .all<{ name: string }>();
    for (const { name } of triggers.results)
      await db.prepare(`DROP TRIGGER "${name.replaceAll('"', '""')}"`).run();
    await db.prepare('DELETE FROM storage_inventory_clock WHERE id=1').run();
    await expectFailure(
      new D1StorageReconciliationReceipts(
        db as unknown as D1Database,
        actor,
        replacementSession,
      ).current(workspace.id, 'primary', third.receipt.id),
      'STORAGE_RECONCILIATION_UNAVAILABLE',
      503,
    );
  } finally {
    await mf.dispose();
  }
}, 30_000);
