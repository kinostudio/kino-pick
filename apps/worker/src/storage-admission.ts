import { z } from 'zod';
import { configuration, type WorkerEnv } from './config';
import { storageBucketForNode } from './private-storage';
import { WorkspaceFailure } from './workspaces';

const derivativeBudgetBytes = 16_777_216;
const healthKey = '_kino/system/storage-health.json';
const healthSchema = z
  .object({
    observedAtMs: z.number().int().nonnegative().safe(),
    mounted: z.boolean(),
    freeBytes: z.number().int().nonnegative().safe(),
    maximumQuotaBytes: z.number().int().positive().safe(),
    quotaBytes: z.number().int().positive().safe(),
  })
  .strict();

export type StorageNodeId = 'primary' | 'oracle-vm';

type CapacityRow = {
  id: string;
  provider: string;
  bucket_name: string;
  credential_ref: string;
  status: string;
  quota_bytes: number;
  used_bytes: number;
  reserved_bytes: number;
  pending_bytes: number;
};

function unavailable(): never {
  throw new WorkspaceFailure('STORAGE_NODE_UNAVAILABLE', 503);
}

function fits(row: CapacityRow, requiredBytes: number) {
  return (
    row.used_bytes + row.reserved_bytes + row.pending_bytes + requiredBytes <=
    row.quota_bytes
  );
}

/** Stores an authenticated SigV4 health read for D1 admission guards. */
export async function refreshStorageHealth(env: WorkerEnv): Promise<void> {
  if (configuration(env).ORACLE_STORAGE_ENABLED !== 'true') return;
  try {
    const object = await storageBucketForNode(env, 'oracle-vm').get(healthKey);
    if (!object || object.size > 8192) {
      if (object) await object.body.cancel();
      return unavailable();
    }
    const health = healthSchema.parse(await object.json());
    await env.DB.prepare(
      `INSERT INTO oracle_storage_health(id,observed_at_ms,mounted,free_bytes,maximum_quota_bytes,quota_bytes)
       VALUES(1,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET observed_at_ms=excluded.observed_at_ms,mounted=excluded.mounted,
         free_bytes=excluded.free_bytes,maximum_quota_bytes=excluded.maximum_quota_bytes,quota_bytes=excluded.quota_bytes`,
    )
      .bind(
        health.observedAtMs,
        health.mounted ? 1 : 0,
        health.freeBytes,
        health.maximumQuotaBytes,
        health.quotaBytes,
      )
      .run();
    await env.DB.prepare(
      `UPDATE storage_nodes SET quota_bytes=? WHERE id='oracle-vm' AND provider='s3'
        AND endpoint='https://drive.kinostudio.tw' AND bucket_name='kino-pick-overflow'
        AND credential_ref='env:ORACLE_STORAGE'
        AND EXISTS(SELECT 1 FROM oracle_storage_policy p JOIN oracle_storage_health h ON h.id=1
          WHERE p.id=1 AND p.quota_bytes=? AND h.quota_bytes=p.quota_bytes
            AND h.maximum_quota_bytes>=p.quota_bytes AND h.mounted=1
            AND h.observed_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER)
            AND h.observed_at_ms>=CAST(unixepoch('subsec')*1000 AS INTEGER)-120000
            AND h.free_bytes>=p.free_floor_bytes+storage_nodes.reserved_bytes
              +COALESCE((SELECT SUM(pending_bytes) FROM storage_pending_derivative_capacity
                WHERE storage_node_id='oracle-vm'),0))
        AND used_bytes+reserved_bytes+COALESCE((SELECT SUM(pending_bytes)
          FROM storage_pending_derivative_capacity WHERE storage_node_id='oracle-vm'),0)<=?`,
    )
      .bind(health.quotaBytes, health.quotaBytes, health.quotaBytes)
      .run();
  } catch {
    return unavailable();
  }
}

/** R2 wins whenever its effective ledger can hold this original and derivative budget. */
export async function selectStorageNodeForUpload(
  env: WorkerEnv,
  originalBytes: number,
): Promise<StorageNodeId> {
  const bytes = z
    .number()
    .int()
    .positive()
    .max(5_363_466_240)
    .parse(originalBytes);
  const primary = await env.DB.prepare(
    `SELECT n.id,n.provider,n.bucket_name,n.credential_ref,n.status,n.quota_bytes,n.used_bytes,n.reserved_bytes,
       COALESCE(c.pending_bytes,0) AS pending_bytes
     FROM storage_nodes n LEFT JOIN (
       SELECT storage_node_id,SUM(pending_bytes) AS pending_bytes
       FROM storage_pending_derivative_capacity GROUP BY storage_node_id
     ) c ON c.storage_node_id=n.id WHERE n.id='primary'`,
  ).first<CapacityRow>();
  if (
    !primary ||
    primary.id !== 'primary' ||
    primary.provider !== 'r2' ||
    primary.bucket_name !== 'PRIMARY_STORAGE' ||
    primary.credential_ref !== 'binding:PRIMARY_STORAGE' ||
    primary.status !== 'active' ||
    ![
      primary.quota_bytes,
      primary.used_bytes,
      primary.reserved_bytes,
      primary.pending_bytes,
    ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    !Number.isSafeInteger(primary.used_bytes + primary.reserved_bytes) ||
    primary.used_bytes + primary.reserved_bytes > primary.quota_bytes
  )
    return unavailable();
  const requiredBytes = bytes + derivativeBudgetBytes;
  if (fits(primary, requiredBytes)) return 'primary';

  try {
    if (configuration(env).ORACLE_STORAGE_ENABLED !== 'true')
      return unavailable();
    const ready = await env.DB.prepare(
      `SELECT n.provider,n.endpoint,n.bucket_name,n.credential_ref,n.status,p.requested_enabled
       FROM storage_nodes n JOIN oracle_storage_policy p ON p.id=1 WHERE n.id='oracle-vm'`,
    ).first<{
      provider: string;
      endpoint: string;
      bucket_name: string;
      credential_ref: string;
      status: string;
      requested_enabled: number;
    }>();
    if (
      !ready ||
      ready.provider !== 's3' ||
      ready.endpoint !== 'https://drive.kinostudio.tw' ||
      ready.bucket_name !== 'kino-pick-overflow' ||
      ready.credential_ref !== 'env:ORACLE_STORAGE' ||
      ready.status !== 'active' ||
      ready.requested_enabled !== 1
    )
      return unavailable();
    await refreshStorageHealth(env);
    const oracle = await env.DB.prepare(
      `SELECT n.id,n.provider,n.endpoint,n.bucket_name,n.credential_ref,n.status,n.quota_bytes,n.used_bytes,n.reserved_bytes,
         COALESCE(c.pending_bytes,0) AS pending_bytes,p.requested_enabled,p.quota_bytes AS policy_quota_bytes,
         p.free_floor_bytes,h.observed_at_ms,h.mounted,h.free_bytes,h.maximum_quota_bytes,h.quota_bytes AS health_quota_bytes
       FROM storage_nodes n JOIN oracle_storage_policy p ON p.id=1
       JOIN oracle_storage_health h ON h.id=1 LEFT JOIN (
         SELECT storage_node_id,SUM(pending_bytes) AS pending_bytes
         FROM storage_pending_derivative_capacity GROUP BY storage_node_id
       ) c ON c.storage_node_id=n.id WHERE n.id='oracle-vm'`,
    ).first<{
      id: string;
      provider: string;
      endpoint: string;
      bucket_name: string;
      credential_ref: string;
      status: string;
      quota_bytes: number;
      used_bytes: number;
      reserved_bytes: number;
      pending_bytes: number;
      requested_enabled: number;
      policy_quota_bytes: number;
      free_floor_bytes: number;
      observed_at_ms: number;
      mounted: number;
      free_bytes: number;
      maximum_quota_bytes: number;
      health_quota_bytes: number;
    }>();
    if (!oracle) return unavailable();
    const healthAge = Date.now() - oracle.observed_at_ms;
    const knownNode =
      oracle.id === 'oracle-vm' &&
      oracle.provider === 's3' &&
      oracle.endpoint === 'https://drive.kinostudio.tw' &&
      oracle.bucket_name === 'kino-pick-overflow' &&
      oracle.credential_ref === 'env:ORACLE_STORAGE' &&
      oracle.status === 'active' &&
      oracle.requested_enabled === 1 &&
      oracle.quota_bytes === oracle.policy_quota_bytes &&
      oracle.health_quota_bytes === oracle.policy_quota_bytes &&
      oracle.maximum_quota_bytes >= oracle.policy_quota_bytes;
    const healthIsFresh =
      Number.isSafeInteger(oracle.observed_at_ms) &&
      healthAge >= 0 &&
      healthAge <= 120_000;
    if (
      !knownNode ||
      oracle.mounted !== 1 ||
      !healthIsFresh ||
      ![
        oracle.quota_bytes,
        oracle.used_bytes,
        oracle.reserved_bytes,
        oracle.pending_bytes,
        oracle.policy_quota_bytes,
        oracle.free_floor_bytes,
        oracle.free_bytes,
        oracle.maximum_quota_bytes,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      !Number.isSafeInteger(oracle.used_bytes + oracle.reserved_bytes) ||
      oracle.used_bytes + oracle.reserved_bytes > oracle.quota_bytes
    )
      return unavailable();
    if (
      !fits(oracle, requiredBytes) ||
      oracle.free_bytes <
        oracle.free_floor_bytes +
          oracle.reserved_bytes +
          oracle.pending_bytes +
          requiredBytes
    )
      throw new WorkspaceFailure('STORAGE_QUOTA_EXCEEDED', 409);
    return 'oracle-vm';
  } catch (error) {
    if (error instanceof WorkspaceFailure) throw error;
    return unavailable();
  }
}
