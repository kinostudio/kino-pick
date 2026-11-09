import { describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../../apps/worker/src/config';
import { readStorageCapacity } from '../../apps/worker/src/storage-capacity';

const ownerId = '00000000-0000-4000-8000-000000000001';
const sessionId = 'owner-session-1';
const databaseNowMs = Date.parse('2026-11-09T00:00:00.000Z');

function capacityRow(overrides: Record<string, unknown> = {}) {
  return {
    databaseNowMs,
    primaryId: 'primary',
    primaryProvider: 'r2',
    primaryBucket: 'PRIMARY_STORAGE',
    primaryQuotaBytes: 9_000_000_000,
    primaryUsedBytes: 1_000_000_000,
    primaryReservedBytes: 200_000_000,
    primaryPendingBytes: 300_000_000,
    primaryLastReconciledAt: '2026-11-08T23:00:00.000Z',
    oracleId: 'oracle-vm',
    oracleProvider: 's3',
    oracleEndpoint: 'https://drive.kinostudio.tw',
    oracleBucket: 'kino-pick-overflow',
    oracleQuotaBytes: 30_000_000_000,
    oracleUsedBytes: 20_000_000_000,
    oracleReservedBytes: 1_000_000_000,
    oraclePendingBytes: 10_000_000_000,
    oracleLastReconciledAt: null,
    oracleHealthId: 1,
    oracleObservedAtMs: databaseNowMs - 60_000,
    oracleMounted: 1,
    oracleFreeBytes: 8_000_000_000,
    oracleMaximumQuotaBytes: 30_000_000_000,
    oracleHealthQuotaBytes: 30_000_000_000,
    ...overrides,
  };
}

function fixture(result: unknown, envOverrides: Record<string, unknown> = {}) {
  const sql: string[] = [];
  const bound: unknown[][] = [];
  const first = vi.fn(async () => result);
  const bind = vi.fn((...values: unknown[]) => {
    bound.push(values);
    return { first };
  });
  const prepare = vi.fn((query: string) => {
    sql.push(query);
    return { bind };
  });
  const env = {
    DB: { prepare } as unknown as D1Database,
    ORACLE_STORAGE_ADMIN_USER_ID: ownerId,
    ORACLE_STORAGE_ENABLED: 'true',
    ...envOverrides,
  } as unknown as WorkerEnv;
  return { env, prepare, first, sql, bound };
}

describe('readStorageCapacity', () => {
  it('reads the owner-scoped ledger and health snapshot in one query', async () => {
    const db = fixture(capacityRow());
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).resolves.toEqual({
      observedAt: new Date(databaseNowMs).toISOString(),
      nodes: [
        {
          id: 'primary',
          quotaBytes: 9_000_000_000,
          usedBytes: 1_000_000_000,
          reservedBytes: 200_000_000,
          pendingBytes: 300_000_000,
          availableBytes: 7_500_000_000,
          lastReconciledAt: '2026-11-08T23:00:00.000Z',
        },
        {
          id: 'oracle-vm',
          quotaBytes: 30_000_000_000,
          usedBytes: 20_000_000_000,
          reservedBytes: 1_000_000_000,
          pendingBytes: 10_000_000_000,
          availableBytes: 0,
          lastReconciledAt: null,
        },
      ],
      oracleDisk: {
        freeBytes: 8_000_000_000,
        observedAt: new Date(databaseNowMs - 60_000).toISOString(),
        mounted: true,
        fresh: true,
      },
    });
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(db.first).toHaveBeenCalledTimes(1);
    expect(db.bound).toEqual([[sessionId, ownerId]]);
    expect(db.sql[0]).toContain('storage_pending_derivative_capacity');
    expect(db.sql[0]).toContain('s.userId=o.user_id');
    expect(db.sql[0]).toContain('s.expiresAt>clock.now_ms');
  });

  it('rejects an invalid or different admin before reading the database', async () => {
    const db = fixture(capacityRow());
    await expect(
      readStorageCapacity(
        db.env,
        '00000000-0000-4000-8000-000000000002',
        sessionId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(
      readStorageCapacity(
        { ...db.env, ORACLE_STORAGE_ADMIN_USER_ID: 'invalid' },
        ownerId,
        sessionId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('rejects a missing, expired, or cross-owner database session', async () => {
    const db = fixture(null);
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED', status: 403 });
  });

  it('shows only primary when Oracle is unconfigured and absent', async () => {
    const db = fixture(
      capacityRow({
        oracleId: null,
        oracleHealthId: null,
        oraclePendingBytes: 0,
      }),
      { ORACLE_STORAGE_ENABLED: 'false' },
    );
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).resolves.toMatchObject({
      nodes: [{ id: 'primary' }],
      oracleDisk: null,
    });
  });

  it('fails closed when enabled Oracle has no storage node', async () => {
    const db = fixture(
      capacityRow({
        oracleId: null,
        oracleHealthId: null,
        oraclePendingBytes: 0,
      }),
    );
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).rejects.toMatchObject({
      code: 'STORAGE_CAPACITY_UNAVAILABLE',
      status: 503,
    });
  });

  it('keeps Oracle ledger data when the VM health row is absent', async () => {
    const db = fixture(capacityRow({ oracleHealthId: null }));
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).resolves.toMatchObject({
      nodes: [
        { id: 'primary' },
        { id: 'oracle-vm', quotaBytes: 30_000_000_000 },
      ],
      oracleDisk: null,
    });
  });

  it('keeps observational capacity visible while health quota metadata is unsynced', async () => {
    const db = fixture(
      capacityRow({
        oracleHealthQuotaBytes: 31_000_000_000,
        oracleMaximumQuotaBytes: 1,
      }),
    );
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).resolves.toMatchObject({
      nodes: [
        { id: 'primary' },
        { id: 'oracle-vm', quotaBytes: 30_000_000_000 },
      ],
      oracleDisk: { freeBytes: 8_000_000_000, mounted: true },
    });
  });

  it.each([
    [databaseNowMs - 120_001, false],
    [databaseNowMs + 1, false],
  ])(
    'marks stale or future Oracle health as not fresh',
    async (observedAtMs, fresh) => {
      const db = fixture(capacityRow({ oracleObservedAtMs: observedAtMs }));
      await expect(
        readStorageCapacity(db.env, ownerId, sessionId),
      ).resolves.toMatchObject({ oracleDisk: { fresh } });
    },
  );

  it.each([
    ['missing primary', { primaryId: null }],
    ['unsafe quota', { primaryQuotaBytes: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid reconciliation date', { primaryLastReconciledAt: 'tomorrow' }],
    [
      'unsafe committed-byte total',
      { primaryUsedBytes: Number.MAX_SAFE_INTEGER, primaryReservedBytes: 1 },
    ],
    ['invalid health integer', { oracleObservedAtMs: 'yesterday' }],
    ['invalid mounted flag', { oracleMounted: 2 }],
  ])('fails closed on %s', async (_name, overrides) => {
    const db = fixture(capacityRow(overrides));
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).rejects.toMatchObject({
      code: 'STORAGE_CAPACITY_UNAVAILABLE',
      status: 503,
    });
  });

  it('maps query failures to the existing workspace failure type', async () => {
    const db = fixture(null);
    db.first.mockRejectedValueOnce(new Error('missing schema'));
    await expect(
      readStorageCapacity(db.env, ownerId, sessionId),
    ).rejects.toMatchObject({
      code: 'STORAGE_CAPACITY_UNAVAILABLE',
      status: 503,
    });
  });
});
