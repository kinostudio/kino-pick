import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { D1StorageInventoryRepository } from '../../apps/worker/src/storage-inventory';

type Row = Record<string, unknown>;
type StatementRecord = { sql: string; values: unknown[] };
type MockStatement = {
  record: StatementRecord;
  bind(...values: unknown[]): MockStatement;
  first<T>(): Promise<T | null>;
};
type MockBatchResult = { success: boolean; results: Row[] };
type InventoryRows = {
  metadata: Row;
  assets: Row[];
  fences: Row[];
};
type MockOptions = {
  rows?: InventoryRows;
  batchResults?: MockBatchResult[];
  batchFailure?: Error;
  scopeResults?: boolean[];
  ownerValid?: boolean;
};

const actorId = randomUUID();
const sessionId = randomUUID();
const workspaceId = randomUUID();
const projectId = randomUUID();
const albumId = randomUUID();
const storageNodeId = 'primary';

function inventoryBounds(rows: InventoryRows) {
  const keyLengths = [...rows.assets, ...rows.fences].map((row) => {
    if (typeof row.object_key !== 'string')
      throw new Error('Expected a string object key in the synthetic fixture');
    return new TextEncoder().encode(row.object_key).length;
  });
  return {
    inventory_count: keyLengths.length,
    inventory_key_bytes: keyLengths.reduce(
      (total, length) => total + length,
      0,
    ),
    max_key_bytes: Math.max(0, ...keyLengths),
  };
}

function refreshInventoryBounds(rows: InventoryRows) {
  rows.metadata = { ...rows.metadata, ...inventoryBounds(rows) };
}

function baseRows(overrides: Partial<InventoryRows> = {}): InventoryRows {
  const assetId = randomUUID();
  const assetBytes = 120;
  const rows: InventoryRows = {
    metadata: {
      provider: 'r2',
      account_id: 'synthetic-account',
      bucket_name: 'synthetic-primary',
      endpoint: null,
      credential_ref: 'binding:PRIMARY_STORAGE',
      status: 'active',
      priority: 1,
      node_quota: 1_000_000,
      node_used: assetBytes,
      node_reserved: 0,
      workspace_quota: 500_000,
      workspace_used: assetBytes,
      workspace_reserved: 0,
      node_asset_bytes: assetBytes,
      workspace_asset_bytes: assetBytes,
      pending_writes: 0,
    },
    assets: [
      {
        id: assetId,
        object_key: `${workspaceId}/${projectId}/${albumId}/${assetId}/original`,
        bytes: assetBytes,
        checksum_sha256: 'a'.repeat(64),
        state: 'available',
      },
    ],
    fences: [],
    ...overrides,
  };
  refreshInventoryBounds(rows);
  return rows;
}

function result(results: Row[] = [], success = true): MockBatchResult {
  return { success, results };
}

function rowsToBatch(rows: InventoryRows): MockBatchResult[] {
  return [result([rows.metadata]), result(rows.assets), result(rows.fences)];
}

function mockD1(options: MockOptions = {}) {
  const rows = options.rows ?? baseRows();
  const prepared: StatementRecord[] = [];
  const batched: StatementRecord[][] = [];
  const scopeResults = [...(options.scopeResults ?? [true])];
  const ownerValid = options.ownerValid ?? true;
  const statements = new WeakMap<MockStatement, StatementRecord>();
  const db = {
    prepare(sql: string): MockStatement {
      const record: StatementRecord = { sql, values: [] };
      prepared.push(record);
      const statement: MockStatement = {
        record,
        bind(...values: unknown[]) {
          record.values = values;
          return statement;
        },
        async first<T>() {
          if (sql.includes('SELECT 1 FROM scope'))
            return (
              (scopeResults.shift() ?? true) ? { scope: 1 } : null
            ) as T | null;
          if (sql.includes('SELECT 1 FROM owners o JOIN owner_sessions s'))
            return (ownerValid ? { owner: 1 } : null) as T | null;
          throw new Error('Unexpected mock D1 first() query');
        },
      };
      statements.set(statement, record);
      return statement;
    },
    async batch(input: MockStatement[]) {
      batched.push(input.map((statement) => statements.get(statement)!));
      if (options.batchFailure) throw options.batchFailure;
      return options.batchResults ?? rowsToBatch(rows);
    },
  };
  return {
    db: db as unknown as D1Database,
    prepared,
    batched,
  };
}

function repository(options: MockOptions = {}) {
  const mock = mockD1(options);
  return {
    ...mock,
    read: () =>
      new D1StorageInventoryRepository(mock.db, actorId, sessionId).read(
        workspaceId,
        storageNodeId,
      ),
  };
}

async function readRevision(rows: InventoryRows) {
  return (await repository({ rows }).read()).revision;
}

async function expectFailure(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  await expect(promise).rejects.toMatchObject({ code, status });
}

describe('D1 storage inventory repository (mocked D1 rows; native Worker covers SQL truth)', () => {
  it('returns a stable content hash and binds every read and final reauthorization', async () => {
    const mock = repository();
    const first = await mock.read();
    const second = await mock.read();

    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(second.revision).toBe(first.revision);
    expect(first.workspaceId).toBe(workspaceId);
    expect(first.storageNodeId).toBe(storageNodeId);
    expect(first.pendingWrites).toBe(false);
    expect(first.objects).toHaveLength(1);
    expect(first.objects[0]?.key).toMatch(
      new RegExp(
        `^${workspaceId}/${projectId}/${albumId}/[0-9a-f-]{36}/original$`,
      ),
    );
    expect(first.objects[0]?.bytes).toBe(120);
    expect(mock.batched).toHaveLength(2);
    for (const batch of mock.batched) {
      expect(batch).toHaveLength(3);
      for (const statement of batch) {
        expect(statement.values).toEqual([
          sessionId,
          actorId,
          workspaceId,
          storageNodeId,
        ]);
        expect(statement.sql).toMatch(/^WITH scope AS \(/);
        expect(statement.sql).not.toContain(actorId);
        expect(statement.sql).not.toContain(sessionId);
        expect(statement.sql).not.toContain(workspaceId);
        expect(statement.sql).not.toContain(storageNodeId);
      }
    }
    const firstPayloadQueries = mock.batched[0]!;
    expect(firstPayloadQueries[1]?.sql).toContain(
      'JOIN inventory_bounds b ON b.object_count<=20000 AND b.key_bytes<=4194304 AND b.max_key_bytes<=1024',
    );
    expect(firstPayloadQueries[2]?.sql).toContain(
      'JOIN inventory_bounds b ON b.object_count<=20000 AND b.key_bytes<=4194304 AND b.max_key_bytes<=1024',
    );
    expect(mock.prepared).toHaveLength(8);
    for (const statement of mock.prepared) {
      expect(statement.sql).toMatch(/^WITH scope AS \(/);
      expect(statement.sql).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i,
      );
    }
    expect(mock.prepared[3]?.values).toEqual([
      sessionId,
      actorId,
      workspaceId,
      storageNodeId,
    ]);
    expect(mock.prepared[7]?.values).toEqual([
      sessionId,
      actorId,
      workspaceId,
      storageNodeId,
    ]);
  });

  it('changes the revision when checksums, node quota, fences, or source rows change', async () => {
    const baseline = baseRows();
    const originalRevision = await readRevision(baseline);
    const changedChecksum: InventoryRows = {
      ...baseline,
      assets: baseline.assets.map((asset) => ({
        ...asset,
        checksum_sha256: 'b'.repeat(64),
      })),
    };
    const changedQuota: InventoryRows = {
      ...baseline,
      metadata: { ...baseline.metadata, node_quota: 1_000_001 },
    };
    const changedFence: InventoryRows = {
      ...baseline,
      fences: [
        {
          upload_session_id: randomUUID(),
          object_key: `${workspaceId}/${projectId}/${albumId}/${randomUUID()}/original`,
          reason: 'expire',
          occurred_at_ms: 1_800_000_000_000,
        },
      ],
    };
    refreshInventoryBounds(changedFence);
    const changedSource: InventoryRows = {
      ...baseline,
      assets: baseline.assets.map((asset) => ({
        ...asset,
        state: 'quarantined',
      })),
    };

    for (const changed of [
      changedChecksum,
      changedQuota,
      changedFence,
      changedSource,
    ])
      expect(await readRevision(changed)).not.toBe(originalRevision);
  });

  it('rejects duplicate asset/fence keys instead of coalescing them', async () => {
    const assetRows = baseRows();
    const asset = assetRows.assets[0]!;
    assetRows.assets.push({ ...asset, id: randomUUID() });
    assetRows.metadata = {
      ...assetRows.metadata,
      node_used: 240,
      workspace_used: 240,
      node_asset_bytes: 240,
      workspace_asset_bytes: 240,
    };
    refreshInventoryBounds(assetRows);

    const fenceRows = baseRows();
    const duplicateFenceKey = `${workspaceId}/${projectId}/${albumId}/${randomUUID()}/original`;
    fenceRows.fences = [
      {
        upload_session_id: randomUUID(),
        object_key: duplicateFenceKey,
        reason: 'cancel',
        occurred_at_ms: 1_800_000_000_000,
      },
      {
        upload_session_id: randomUUID(),
        object_key: duplicateFenceKey,
        reason: 'expire',
        occurred_at_ms: 1_800_000_000_001,
      },
    ];
    refreshInventoryBounds(fenceRows);

    const assetAndFenceRows = baseRows();
    assetAndFenceRows.fences = [
      {
        upload_session_id: randomUUID(),
        object_key: assetAndFenceRows.assets[0]!.object_key,
        reason: 'cancel',
        occurred_at_ms: 1_800_000_000_000,
      },
    ];
    refreshInventoryBounds(assetAndFenceRows);

    for (const rows of [assetRows, fenceRows, assetAndFenceRows]) {
      const mock = repository({ rows });
      await expectFailure(mock.read(), 'STORAGE_INVENTORY_UNAVAILABLE', 503);
      expect(mock.batched).toHaveLength(1);
      expect(mock.prepared).toHaveLength(3);
    }
  });

  it('rejects cross-prefix and oversized object keys', async () => {
    const crossPrefix = baseRows();
    const originalKey = crossPrefix.assets[0]?.object_key;
    if (typeof originalKey !== 'string')
      throw new Error('Expected a string object key in the synthetic fixture');
    crossPrefix.assets = crossPrefix.assets.map((asset) => ({
      ...asset,
      object_key: `${randomUUID()}/${originalKey.split('/').slice(1).join('/')}`,
    }));
    refreshInventoryBounds(crossPrefix);
    await expectFailure(
      repository({ rows: crossPrefix }).read(),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );

    const oversized = baseRows();
    oversized.assets = oversized.assets.map((asset) => ({
      ...asset,
      object_key: `${workspaceId}/${'x'.repeat(1025)}`,
    }));
    refreshInventoryBounds(oversized);
    await expectFailure(
      repository({
        rows: oversized,
        batchResults: [result([oversized.metadata]), result([]), result([])],
      }).read(),
      'STORAGE_INVENTORY_LIMIT',
      503,
    );
  });

  it('rejects aggregate key-budget overflow, count mismatch, and inventory caps', async () => {
    const rows = baseRows();
    const prefix = `${workspaceId}/${projectId}/${albumId}/`;
    const count = 4097;
    rows.assets = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      object_key:
        prefix +
        String(index).padStart(6, '0') +
        'x'.repeat(1024 - prefix.length - 6),
      bytes: 1,
      checksum_sha256: 'a'.repeat(64),
      state: 'available',
    }));
    rows.metadata = {
      ...rows.metadata,
      node_used: count,
      workspace_used: count,
      node_asset_bytes: count,
      workspace_asset_bytes: count,
    };
    refreshInventoryBounds(rows);
    await expectFailure(
      repository({
        rows,
        batchResults: [result([rows.metadata]), result([]), result([])],
      }).read(),
      'STORAGE_INVENTORY_LIMIT',
      503,
    );

    const mismatchedCount = baseRows();
    mismatchedCount.metadata.inventory_count = 2;
    await expectFailure(
      repository({ rows: mismatchedCount }).read(),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );

    const byteCap = baseRows();
    byteCap.metadata.inventory_key_bytes = 4_194_305;
    byteCap.metadata.max_key_bytes = 1025;
    await expectFailure(
      repository({
        rows: byteCap,
        batchResults: [result([byteCap.metadata]), result([]), result([])],
      }).read(),
      'STORAGE_INVENTORY_LIMIT',
      503,
    );

    const tooManyRows = baseRows();
    tooManyRows.metadata.inventory_count = 20_001;
    await expectFailure(
      repository({
        rows: tooManyRows,
        batchResults: [result([tooManyRows.metadata]), result([]), result([])],
      }).read(),
      'STORAGE_INVENTORY_LIMIT',
      503,
    );
  });

  it('maps malformed rows, failed batches, and used-byte mismatches to 503', async () => {
    const malformed = baseRows();
    malformed.assets = [{ ...malformed.assets[0]!, checksum_sha256: 'bad' }];
    await expectFailure(
      repository({ rows: malformed }).read(),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );

    const failedBatch = baseRows();
    await expectFailure(
      repository({
        rows: failedBatch,
        batchResults: [
          result([failedBatch.metadata]),
          result(failedBatch.assets, false),
          result(failedBatch.fences),
        ],
      }).read(),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );
    await expectFailure(
      repository({
        rows: failedBatch,
        batchFailure: new Error('synthetic D1 failure'),
      }).read(),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );

    const mismatch = baseRows({
      metadata: { ...failedBatch.metadata, node_used: 121 },
    });
    await expectFailure(
      repository({ rows: mismatch }).read(),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );
  });

  it('distinguishes a missing scope from an invalid Owner session', async () => {
    const missing = baseRows();
    await expectFailure(
      repository({
        rows: missing,
        batchResults: [result([]), result([]), result([])],
        scopeResults: [false],
        ownerValid: true,
      }).read(),
      'NOT_FOUND',
      404,
    );
    await expectFailure(
      repository({
        batchResults: [result([]), result([]), result([])],
        scopeResults: [false],
        ownerValid: false,
      }).read(),
      'OWNER_REQUIRED',
      403,
    );
    await expectFailure(
      repository({
        batchResults: [result([]), result([]), result([])],
        scopeResults: [true],
      }).read(),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );
  });

  it('rejects a snapshot when Owner scope is revoked at the final reauthorization', async () => {
    const rows = baseRows();
    const mock = repository({ rows, scopeResults: [false], ownerValid: true });
    await expectFailure(mock.read(), 'NOT_FOUND', 404);
    expect(mock.batched).toHaveLength(1);
    expect(mock.prepared.at(-2)?.sql).toContain('SELECT 1 FROM scope');
    expect(mock.prepared.at(-1)?.sql).toContain(
      'SELECT 1 FROM owners o JOIN owner_sessions s',
    );
    expect(mock.prepared.at(-1)?.values).toEqual([sessionId, actorId]);
  });
});
