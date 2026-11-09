import { describe, expect, it } from 'vitest';
import { D1NodeStorageInventoryRepository } from '../../apps/worker/src/node-storage-inventory';

const workspaceA = '11111111-1111-4111-8111-111111111111';
const workspaceB = '22222222-2222-4222-8222-222222222222';

function fixture(
  overrides: {
    head?: Record<string, unknown>;
    assets?: Array<Record<string, unknown>>;
    fences?: Array<Record<string, unknown>>;
  } = {},
) {
  const assets = overrides.assets ?? [
    {
      workspace_id: workspaceA,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      object_key: workspaceA + '/project/album/photo.jpg',
      bytes: 5,
      checksum_sha256: 'a'.repeat(64),
      state: 'available',
    },
  ];
  const fences = overrides.fences ?? [
    {
      workspace_id: workspaceB,
      upload_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      object_key: workspaceB + '/project/album/fenced/original',
      reason: 'cancel',
      occurred_at_ms: 1_800_000_000_000,
    },
  ];
  const objects = [
    ...assets.map((row) => ({
      key: String(row.object_key),
      bytes: Number(row.bytes),
    })),
    ...fences.map((row) => ({ key: String(row.object_key), bytes: 0 })),
  ];
  const keyLengths = objects.map(
    ({ key }) => new TextEncoder().encode(key).length,
  );
  return {
    assets,
    fences,
    head: {
      storage_node_id: 'primary',
      epoch: 4,
      provider: 'r2',
      account_id: 'binding-account',
      bucket_name: 'PRIMARY_STORAGE',
      endpoint: null,
      credential_ref: 'binding:PRIMARY_STORAGE',
      status: 'active',
      priority: 1,
      node_quota: 9_000_000_000,
      node_used: objects.reduce((sum, object) => sum + object.bytes, 0),
      node_reserved: 0,
      node_asset_bytes: objects.reduce((sum, object) => sum + object.bytes, 0),
      reservation_ledgers_valid: 1,
      pending_writes: 1,
      inventory_count: objects.length,
      inventory_key_bytes: keyLengths.reduce((sum, value) => sum + value, 0),
      max_key_bytes: Math.max(0, ...keyLengths),
      ...overrides.head,
    },
  };
}

function mockDb(
  data: ReturnType<typeof fixture>,
  options: {
    authorization?: unknown;
    finalAuthorization?: unknown;
    headRows?: unknown[];
    assetRows?: unknown[];
    fenceRows?: unknown[];
    batchSuccess?: boolean;
  } = {},
) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ sql, values });
          return {
            async first() {
              if (sql.includes('c.epoch AS epoch'))
                return (
                  options.finalAuthorization ?? {
                    authorized: 1,
                    node_exists: 1,
                    epoch: data.head.epoch,
                  }
                );
              return options.authorization ?? { authorized: 1, node_exists: 1 };
            },
          };
        },
      };
    },
    async batch() {
      const result = (results: unknown[]) => ({
        success: options.batchSuccess ?? true,
        results,
      });
      return [
        result(options.headRows ?? [data.head]),
        result(options.assetRows ?? data.assets),
        result(options.fenceRows ?? data.fences),
      ];
    },
  };
  return { db: db as unknown as D1Database, calls };
}

function expectFailure(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  return expect(promise).rejects.toMatchObject({
    code,
    status,
  });
}

describe('global node storage inventory', () => {
  it('returns a stable whole-node manifest across workspaces and preserves zero-byte fences', async () => {
    const data = fixture();
    const { db, calls } = mockDb(data);
    const repository = new D1NodeStorageInventoryRepository(
      db,
      'bootstrap-owner',
      'owner-session',
    );

    const first = await repository.read('primary');
    const second = await repository.read('primary');

    expect(first).toEqual({
      scope: 'node',
      storageNodeId: 'primary',
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      pendingWrites: true,
      objects: [
        { key: workspaceA + '/project/album/photo.jpg', bytes: 5 },
        { key: workspaceB + '/project/album/fenced/original', bytes: 0 },
      ],
    });
    expect(second.revision).toBe(first.revision);
    expect(
      calls.filter(({ sql }) => sql.startsWith('WITH scope AS')).length,
    ).toBe(6);
    expect(calls.some(({ sql }) => sql.includes('owner_bootstrap'))).toBe(true);
    expect(
      calls.some(({ sql }) =>
        sql.includes('WHERE a.storage_node_id=c.storage_node_id'),
      ),
    ).toBe(true);
    expect(first).not.toHaveProperty('credential_ref');
    expect(first).not.toHaveProperty('account_id');
  });

  it.each([
    [
      'unregistered owner',
      { authorized: 0, node_exists: 1 },
      'OWNER_REQUIRED',
      403,
    ],
    [
      'workspace owner without bootstrap',
      { authorized: 0, node_exists: 1 },
      'OWNER_REQUIRED',
      403,
    ],
    ['missing node', { authorized: 1, node_exists: 0 }, 'NOT_FOUND', 404],
  ])(
    'requires platform bootstrap identity for %s',
    async (_name, authorization, code, status) => {
      const { db } = mockDb(fixture(), { authorization });
      await expectFailure(
        new D1NodeStorageInventoryRepository(db, 'actor', 'session').read(
          'primary',
        ),
        code,
        status,
      );
    },
  );

  it('fails closed when proposal70 clock is absent', async () => {
    const { db, calls } = mockDb(fixture(), {
      headRows: [],
      assetRows: [],
      fenceRows: [],
    });
    await expectFailure(
      new D1NodeStorageInventoryRepository(db, 'actor', 'session').read(
        'primary',
      ),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );
    expect(
      calls.some(({ sql }) => sql.includes('JOIN storage_inventory_clock')),
    ).toBe(true);
  });

  it('does not attribute a workspace-wide Oracle reservation to a historical primary session', async () => {
    const { db, calls } = mockDb(
      fixture({ head: { node_reserved: 0, pending_writes: 0 } }),
    );
    const result = await new D1NodeStorageInventoryRepository(
      db,
      'actor',
      'session',
    ).read('primary');
    const headQuery = calls.find(({ sql }) =>
      sql.includes('AS node_asset_bytes'),
    )?.sql;
    const pendingCheck = headQuery?.slice(
      headQuery.indexOf('AS node_asset_bytes'),
      headQuery.indexOf('AS pending_writes'),
    );
    const ledgerCheck = headQuery?.slice(
      headQuery.indexOf('NOT EXISTS(SELECT 1 FROM workspace_storage_usage'),
    );
    const ledgerTotals = ledgerCheck?.slice(
      ledgerCheck.indexOf('usage.reserved_bytes<>'),
    );
    expect(result.pendingWrites).toBe(false);
    expect(pendingCheck).not.toContain('workspace_storage_usage');
    expect(ledgerCheck).toContain('sum(r.reserved_bytes)');
    expect(ledgerCheck).toContain('sum(j.reserved_bytes)');
    expect(ledgerCheck).toContain('a.workspace_id=usage.workspace_id');
    expect(ledgerTotals).not.toContain('storage_node_id');
  });

  it('bounds the object-key selects in SQL before they can return payload rows', async () => {
    const { db, calls } = mockDb(
      fixture({ head: { inventory_count: 20_001 } }),
      { assetRows: [], fenceRows: [] },
    );
    await expectFailure(
      new D1NodeStorageInventoryRepository(db, 'actor', 'session').read(
        'primary',
      ),
      'STORAGE_INVENTORY_LIMIT',
      503,
    );
    const selects = calls.filter(({ sql }) =>
      /SELECT (?:a|u)\.workspace_id/.test(sql),
    );
    expect(selects).toHaveLength(2);
    for (const { sql } of selects) {
      expect(sql).toContain('b.object_count<=20000');
      expect(sql).toContain('b.key_bytes<=4194304');
      expect(sql).toContain('b.max_key_bytes<=1024');
      expect(sql).toContain('LIMIT 20001');
    }
  });

  it.each([
    ['wrong workspace prefix', workspaceB + '/x'],
    ['empty tail', workspaceA + '/'],
    ['traversal segment', workspaceA + '/album/../file'],
    ['percent encoding', workspaceA + '/album%2f/file'],
    ['backslash', workspaceA + '/album\\file'],
  ])('rejects a registered key with %s', async (_name, key) => {
    const row = fixture().assets[0]!;
    const data = fixture({
      assets: [{ ...row, object_key: key }],
      fences: [],
    });
    const { db } = mockDb(data);
    await expectFailure(
      new D1NodeStorageInventoryRepository(db, 'actor', 'session').read(
        'primary',
      ),
      'STORAGE_INVENTORY_UNAVAILABLE',
      503,
    );
  });

  it('rejects duplicate registered keys, mismatched usage, and unsafe provider refs', async () => {
    const row = fixture().assets[0]!;
    const duplicate = fixture({
      assets: [row],
      fences: [
        {
          workspace_id: workspaceA,
          upload_session_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          object_key: row.object_key,
          reason: 'expire',
          occurred_at_ms: 1_800_000_000_000,
        },
      ],
    });
    const usedMismatch = fixture({ head: { node_used: 6 } });
    const untrustedPrimary = fixture({ head: { account_id: 'other-account' } });
    const disabledNode = fixture({ head: { status: 'disabled' } });
    const unexplainedWorkspaceReserve = fixture({
      head: { reservation_ledgers_valid: 0 },
    });
    const unsafeProvider = fixture({
      head: { credential_ref: 'access-secret-key' },
    });
    for (const data of [
      duplicate,
      usedMismatch,
      untrustedPrimary,
      disabledNode,
      unexplainedWorkspaceReserve,
      unsafeProvider,
    ]) {
      const { db } = mockDb(data);
      await expectFailure(
        new D1NodeStorageInventoryRepository(db, 'actor', 'session').read(
          'primary',
        ),
        'STORAGE_INVENTORY_UNAVAILABLE',
        503,
      );
    }
  });

  it('rejects epoch changes and session loss after hashing', async () => {
    const data = fixture();
    const changedEpoch = mockDb(data, {
      finalAuthorization: { authorized: 1, node_exists: 1, epoch: 5 },
    });
    await expectFailure(
      new D1NodeStorageInventoryRepository(
        changedEpoch.db,
        'actor',
        'session',
      ).read('primary'),
      'CONCURRENT_MODIFICATION',
      409,
    );

    const expiredSession = mockDb(data, {
      finalAuthorization: { authorized: 0, node_exists: 1, epoch: 4 },
    });
    await expectFailure(
      new D1NodeStorageInventoryRepository(
        expiredSession.db,
        'actor',
        'session',
      ).read('primary'),
      'OWNER_REQUIRED',
      403,
    );
  });

  it('changes revision when a registered row or global epoch changes', async () => {
    const firstData = fixture();
    const first = await new D1NodeStorageInventoryRepository(
      mockDb(firstData).db,
      'actor',
      'session',
    ).read('primary');
    const changedData = fixture({ head: { epoch: 5 } });
    const changedEpoch = await new D1NodeStorageInventoryRepository(
      mockDb(changedData).db,
      'actor',
      'session',
    ).read('primary');
    const changedRowData = fixture({
      assets: [{ ...firstData.assets[0], checksum_sha256: 'b'.repeat(64) }],
    });
    const changedRow = await new D1NodeStorageInventoryRepository(
      mockDb(changedRowData).db,
      'actor',
      'session',
    ).read('primary');
    expect(changedEpoch.revision).not.toBe(first.revision);
    expect(changedRow.revision).not.toBe(first.revision);
  });

  it('does not expose object keys from the metadata query or select signer credentials', () => {
    const { db, calls } = mockDb(fixture());
    return new D1NodeStorageInventoryRepository(db, 'actor', 'session')
      .read('primary')
      .then(() => {
        const headQuery = calls.find(({ sql }) =>
          sql.includes('AS node_asset_bytes'),
        )?.sql;
        expect(headQuery).toBeDefined();
        expect(headQuery).not.toMatch(/SELECT\s+a\.object_key/);
        expect(headQuery).not.toContain('secret_access_key');
        expect(headQuery).not.toContain('access_key_id');
      });
  });
});
