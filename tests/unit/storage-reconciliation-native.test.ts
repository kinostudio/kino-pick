import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  reconcileStorageInventory,
  type StorageInventoryPage,
  type StorageInventorySnapshot,
} from '../../packages/domain/src/storage-reconciliation';

type NativeStatement = {
  bind(...values: (number | string | null)[]): NativeStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};
type NativeD1 = {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): NativeStatement;
};
type NativeR2Object = { arrayBuffer(): Promise<ArrayBuffer> };
type NativeR2Page = {
  objects: Array<{ key: string; size: number }>;
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
};
type NativeR2Bucket = {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<NativeR2Object | null>;
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

const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.url)(
  '../../apps/worker/node_modules/miniflare/dist/src/index.js',
) as {
  Miniflare: new (options: unknown) => NativeMiniflare;
  convertV4MiniflareOptions: (options: unknown) => unknown;
};

test('storage reconciliation uses paginated native R2 and rereads scoped D1 inventory', async () => {
  const workerName = 'storage-reconciliation-native';
  const databaseName = 'storage-reconciliation-native';
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: workerName,
          modules: true,
          script:
            "export default { async fetch() { return new Response('ok'); } };",
          compatibilityDate: '2026-10-23',
          d1Databases: { DB: databaseName },
          r2Buckets: { BUCKET: databaseName },
        },
      ],
    }),
  );

  try {
    const db = await mf.getD1Database('DB', workerName);
    const bucket = await mf.getR2Bucket('BUCKET', workerName);
    // This is intentionally a test-only inventory schema, not a product migration.
    await db
      .prepare(
        `
        CREATE TABLE fixture_inventory_state (
        workspace_id TEXT NOT NULL,
        storage_node_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        pending_writes INTEGER NOT NULL CHECK(pending_writes IN (0,1)),
        PRIMARY KEY(workspace_id,storage_node_id)
        )
      `,
      )
      .run();
    await db
      .prepare(
        `
        CREATE TABLE fixture_inventory_objects (
        workspace_id TEXT NOT NULL,
        storage_node_id TEXT NOT NULL,
        object_key TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        PRIMARY KEY(workspace_id,storage_node_id,object_key),
        FOREIGN KEY(workspace_id,storage_node_id)
          REFERENCES fixture_inventory_state(workspace_id,storage_node_id)
        )
      `,
      )
      .run();
    await db
      .prepare(
        `
        CREATE TABLE fixture_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL
        )
      `,
      )
      .run();
    await db
      .prepare(
        'CREATE TABLE fixture_inventory_write_log(table_name TEXT NOT NULL,operation TEXT NOT NULL)',
      )
      .run();

    const workspaceId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const storageNodeId = 'primary';
    const initialRevision = 'a'.repeat(64);
    const changedRevision = 'b'.repeat(64);
    const payloads = new Map([
      [`${workspaceId}/asset-001`, Uint8Array.from([1, 2, 3, 4])],
      [`${workspaceId}/asset-002`, Uint8Array.from([5, 6, 7, 8, 9])],
      [`${foreignWorkspaceId}/private`, Uint8Array.from([10, 11, 12])],
    ]);

    for (const [key, payload] of payloads) await bucket.put(key, payload);
    for (const [workspace, revision] of [
      [workspaceId, initialRevision],
      [foreignWorkspaceId, 'c'.repeat(64)],
    ] as const) {
      await db
        .prepare(
          'INSERT INTO fixture_inventory_state(workspace_id,storage_node_id,revision,pending_writes) VALUES(?,?,?,0)',
        )
        .bind(workspace, storageNodeId, revision)
        .run();
    }
    for (const [key, payload] of payloads) {
      const workspace = key.split('/')[0]!;
      await db
        .prepare(
          'INSERT INTO fixture_inventory_objects(workspace_id,storage_node_id,object_key,byte_size) VALUES(?,?,?,?)',
        )
        .bind(workspace, storageNodeId, key, payload.byteLength)
        .run();
    }
    for (const table of [
      'fixture_inventory_state',
      'fixture_inventory_objects',
    ]) {
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        const lowerOperation = operation.toLowerCase();
        await db
          .prepare(
            `CREATE TRIGGER fixture_watch_${table}_${lowerOperation} AFTER ${operation} ON ${table} BEGIN INSERT INTO fixture_inventory_write_log(table_name,operation) VALUES('${table}','${operation}'); END`,
          )
          .run();
      }
    }

    const auditCount = async () =>
      (await db
        .prepare('SELECT count(*) AS count FROM fixture_audit_events')
        .first<{ count: number }>())!.count;
    const writeLog = async () =>
      (
        await db
          .prepare(
            'SELECT table_name,operation FROM fixture_inventory_write_log ORDER BY rowid',
          )
          .all<{ table_name: string; operation: string }>()
      ).results;
    const storedInventory = async () =>
      (
        await db
          .prepare(
            'SELECT object_key,byte_size FROM fixture_inventory_objects WHERE workspace_id=? AND storage_node_id=? ORDER BY object_key',
          )
          .bind(workspaceId, storageNodeId)
          .all<{ object_key: string; byte_size: number }>()
      ).results;

    let inventoryReads = 0;
    const readInventory = async (): Promise<StorageInventorySnapshot> => {
      inventoryReads++;
      const state = await db
        .prepare(
          'SELECT revision,pending_writes FROM fixture_inventory_state WHERE workspace_id=? AND storage_node_id=?',
        )
        .bind(workspaceId, storageNodeId)
        .first<{ revision: string; pending_writes: number }>();
      assert.ok(state, 'scoped D1 inventory state exists');
      const objects = await db
        .prepare(
          'SELECT object_key,byte_size FROM fixture_inventory_objects WHERE workspace_id=? AND storage_node_id=? ORDER BY object_key',
        )
        .bind(workspaceId, storageNodeId)
        .all<{ object_key: string; byte_size: number }>();
      return {
        workspaceId,
        storageNodeId,
        revision: state.revision,
        pendingWrites: state.pending_writes === 1,
        objects: objects.results.map(({ object_key, byte_size }) => ({
          key: object_key,
          bytes: byte_size,
        })),
      };
    };
    const listPage = async ({
      prefix,
      cursor,
    }: {
      prefix: string;
      limit: 1000;
      cursor?: string;
    }): Promise<StorageInventoryPage> => {
      const page = await bucket.list({
        prefix,
        limit: 1,
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

    const originalInventory = await storedInventory();
    const originalAuditCount = await auditCount();
    const originalWriteLog = await writeLog();
    const cursors: Array<string | undefined> = [];
    let firstScanPages = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory,
      listPage: async (options) => {
        cursors.push(options.cursor);
        firstScanPages++;
        return listPage(options);
      },
    });

    assert.deepEqual(result, {
      status: 'matched',
      workspaceId,
      storageNodeId,
      inventoryRevision: initialRevision,
      objectCount: 2,
      confirmedBytes: 9,
      pages: 2,
      readOnly: true,
    });
    assert.equal(inventoryReads, 2, 'D1 inventory is read before and after R2');
    assert.equal(firstScanPages, 2, 'native R2 page size forces two pages');
    assert.equal(cursors[0], undefined);
    assert.ok(cursors[1], 'the second native R2 page uses its returned cursor');
    assert.deepEqual(await storedInventory(), originalInventory);
    assert.equal(await auditCount(), originalAuditCount);
    assert.deepEqual(await writeLog(), originalWriteLog);

    const changedInventoryReadsBefore = inventoryReads;
    const writesBeforeRace = await writeLog();
    const auditBeforeRace = await auditCount();
    let changed = false;
    let racePages = 0;
    const raced = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory,
      listPage: async (options) => {
        racePages++;
        const page = await listPage(options);
        if (!changed) {
          changed = true;
          await db
            .prepare(
              'UPDATE fixture_inventory_state SET revision=? WHERE workspace_id=? AND storage_node_id=?',
            )
            .bind(changedRevision, workspaceId, storageNodeId)
            .run();
        }
        return page;
      },
    });

    assert.deepEqual(raced, {
      status: 'blocked',
      reason: 'inventory_changed',
      readOnly: true,
    });
    assert.equal(inventoryReads - changedInventoryReadsBefore, 2);
    assert.equal(racePages, 2);
    assert.deepEqual(await storedInventory(), originalInventory);
    assert.equal(await auditCount(), auditBeforeRace);
    assert.deepEqual(await writeLog(), [
      ...writesBeforeRace,
      { table_name: 'fixture_inventory_state', operation: 'UPDATE' },
    ]);

    const actualObjects = await bucket.list({ prefix: '', limit: 10 });
    assert.equal(actualObjects.objects.length, 3);
    assert.deepEqual(
      actualObjects.objects
        .map(({ key, size }) => ({ key, size }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      [...payloads]
        .map(([key, value]) => ({ key, size: value.byteLength }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    );
    for (const [key, expected] of payloads) {
      const stored = await bucket.get(key);
      assert.ok(stored, `R2 object ${key} remains present`);
      assert.deepEqual(
        new Uint8Array(await stored.arrayBuffer()),
        expected,
        `R2 object ${key} remains byte-for-byte unchanged`,
      );
    }
  } finally {
    await mf.dispose();
  }
}, 120_000);
