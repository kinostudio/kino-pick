import { z } from 'zod';
import type { WorkerEnv } from './config';
import { WorkspaceFailure } from './workspaces';

type CapacityRow = {
  databaseNowMs: unknown;
  primaryId: unknown;
  primaryProvider: unknown;
  primaryBucket: unknown;
  primaryQuotaBytes: unknown;
  primaryUsedBytes: unknown;
  primaryReservedBytes: unknown;
  primaryPendingBytes: unknown;
  primaryLastReconciledAt: unknown;
  oracleId: unknown;
  oracleProvider: unknown;
  oracleEndpoint: unknown;
  oracleBucket: unknown;
  oracleQuotaBytes: unknown;
  oracleUsedBytes: unknown;
  oracleReservedBytes: unknown;
  oraclePendingBytes: unknown;
  oracleLastReconciledAt: unknown;
  oracleHealthId: unknown;
  oracleObservedAtMs: unknown;
  oracleMounted: unknown;
  oracleFreeBytes: unknown;
  oracleMaximumQuotaBytes: unknown;
  oracleHealthQuotaBytes: unknown;
};

type CapacityNode = {
  id: 'primary' | 'oracle-vm';
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  pendingBytes: number;
  availableBytes: number;
  lastReconciledAt: string | null;
};

function unavailable(): never {
  throw new WorkspaceFailure('STORAGE_CAPACITY_UNAVAILABLE', 503);
}

function integer(value: unknown, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    return unavailable();
  return value;
}

function isoDate(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return unavailable();
  if (!z.iso.datetime({ offset: true }).safeParse(value).success)
    return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return unavailable();
  return new Date(milliseconds).toISOString();
}

function isoMilliseconds(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return unavailable();
  return date.toISOString();
}

function capacityNode(
  row: CapacityRow,
  id: 'primary' | 'oracle-vm',
): CapacityNode | null {
  const values =
    id === 'primary'
      ? {
          id: row.primaryId,
          provider: row.primaryProvider,
          bucket: row.primaryBucket,
          quotaBytes: row.primaryQuotaBytes,
          usedBytes: row.primaryUsedBytes,
          reservedBytes: row.primaryReservedBytes,
          pendingBytes: row.primaryPendingBytes,
          lastReconciledAt: row.primaryLastReconciledAt,
        }
      : {
          id: row.oracleId,
          provider: row.oracleProvider,
          bucket: row.oracleBucket,
          quotaBytes: row.oracleQuotaBytes,
          usedBytes: row.oracleUsedBytes,
          reservedBytes: row.oracleReservedBytes,
          pendingBytes: row.oraclePendingBytes,
          lastReconciledAt: row.oracleLastReconciledAt,
        };
  if (values.id === null) return null;
  if (values.id !== id) return unavailable();

  if (
    values.provider !== (id === 'primary' ? 'r2' : 's3') ||
    values.bucket !==
      (id === 'primary' ? 'PRIMARY_STORAGE' : 'kino-pick-overflow')
  )
    return unavailable();
  if (
    id === 'oracle-vm' &&
    row.oracleEndpoint !== 'https://drive.kinostudio.tw'
  )
    return unavailable();

  const quotaBytes = integer(values.quotaBytes, 1);
  const usedBytes = integer(values.usedBytes);
  const reservedBytes = integer(values.reservedBytes);
  const pendingBytes = integer(values.pendingBytes);
  const committedBytes = usedBytes + reservedBytes + pendingBytes;
  if (!Number.isSafeInteger(committedBytes)) return unavailable();
  return {
    id,
    quotaBytes,
    usedBytes,
    reservedBytes,
    pendingBytes,
    availableBytes: Math.max(0, quotaBytes - committedBytes),
    lastReconciledAt: isoDate(values.lastReconciledAt),
  };
}

export async function readStorageCapacity(
  env: WorkerEnv,
  actorId: string,
  sessionId: string,
) {
  const adminId = env.ORACLE_STORAGE_ADMIN_USER_ID;
  if (!z.uuid().safeParse(adminId).success || adminId !== actorId)
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (!sessionId) throw new WorkspaceFailure('OWNER_REQUIRED', 403);

  let row: CapacityRow | null;
  try {
    row = await env.DB.prepare(
      `WITH clock AS (
         SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms
       ), authorized AS (
         SELECT clock.now_ms
         FROM owners o
         JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?
         CROSS JOIN clock
         WHERE o.user_id=? AND o.enabled=1 AND s.expiresAt>clock.now_ms
       ), pending AS (
         SELECT storage_node_id,SUM(pending_bytes) AS pending_bytes
         FROM storage_pending_derivative_capacity
         WHERE storage_node_id IN ('primary','oracle-vm')
         GROUP BY storage_node_id
       )
       SELECT authorized.now_ms AS databaseNowMs,
         p.id AS primaryId,p.provider AS primaryProvider,p.bucket_name AS primaryBucket,
         p.quota_bytes AS primaryQuotaBytes,p.used_bytes AS primaryUsedBytes,
         p.reserved_bytes AS primaryReservedBytes,COALESCE(pp.pending_bytes,0) AS primaryPendingBytes,
         p.last_reconciled_at AS primaryLastReconciledAt,
         o.id AS oracleId,o.provider AS oracleProvider,o.endpoint AS oracleEndpoint,o.bucket_name AS oracleBucket,
         o.quota_bytes AS oracleQuotaBytes,o.used_bytes AS oracleUsedBytes,
         o.reserved_bytes AS oracleReservedBytes,COALESCE(op.pending_bytes,0) AS oraclePendingBytes,
         o.last_reconciled_at AS oracleLastReconciledAt,
         h.id AS oracleHealthId,h.observed_at_ms AS oracleObservedAtMs,h.mounted AS oracleMounted,
         h.free_bytes AS oracleFreeBytes,h.maximum_quota_bytes AS oracleMaximumQuotaBytes,
         h.quota_bytes AS oracleHealthQuotaBytes
       FROM authorized
       LEFT JOIN storage_nodes p ON p.id='primary'
       LEFT JOIN storage_nodes o ON o.id='oracle-vm'
       LEFT JOIN pending pp ON pp.storage_node_id='primary'
       LEFT JOIN pending op ON op.storage_node_id='oracle-vm'
       LEFT JOIN oracle_storage_health h ON h.id=1`,
    )
      .bind(sessionId, actorId)
      .first<CapacityRow>();
  } catch {
    return unavailable();
  }
  if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);

  const databaseNowMs = integer(row.databaseNowMs);
  const observedAt = isoMilliseconds(databaseNowMs);

  const primary = capacityNode(row, 'primary');
  if (!primary) return unavailable();
  const oracle = capacityNode(row, 'oracle-vm');
  if (!oracle) {
    if (
      env.ORACLE_STORAGE_ENABLED === 'true' ||
      integer(row.oraclePendingBytes) !== 0 ||
      row.oracleHealthId !== null
    )
      return unavailable();
    return { observedAt, nodes: [primary], oracleDisk: null };
  }

  if (row.oracleHealthId === null)
    return { observedAt, nodes: [primary, oracle], oracleDisk: null };
  if (row.oracleHealthId !== 1) return unavailable();

  const healthObservedAtMs = integer(row.oracleObservedAtMs);
  const mounted = integer(row.oracleMounted);
  const freeBytes = integer(row.oracleFreeBytes);
  integer(row.oracleMaximumQuotaBytes, 1);
  integer(row.oracleHealthQuotaBytes, 1);
  if (mounted > 1) return unavailable();

  const age = databaseNowMs - healthObservedAtMs;
  return {
    observedAt,
    nodes: [primary, oracle],
    oracleDisk: {
      freeBytes,
      observedAt: isoMilliseconds(healthObservedAtMs),
      mounted: mounted === 1,
      fresh: age >= 0 && age <= 120_000,
    },
  };
}
