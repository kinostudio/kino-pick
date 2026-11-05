import { z } from 'zod';
import { configuration, type WorkerEnv } from './config';
import {
  oracleStorageCredentials,
  storageBucketForNode,
} from './private-storage';
import { WorkspaceFailure } from './workspaces';
import { refreshStorageHealth } from './storage-admission';

const vmPolicySchema = z
  .object({
    quotaBytes: z.number().int().min(1e9).max(100e9),
    revision: z.number().int().nonnegative().safe(),
  })
  .strict();

async function publishVmPolicy(env: WorkerEnv) {
  if (configuration(env).ORACLE_STORAGE_ENABLED !== 'true') return;
  const row = await env.DB.prepare(
    'SELECT quota_bytes,revision FROM oracle_storage_policy WHERE id=1',
  ).first<Pick<Policy, 'quota_bytes' | 'revision'>>();
  if (!row) throw new WorkspaceFailure('STORAGE_POLICY_UNAVAILABLE', 503);
  const bucket = storageBucketForNode(env, 'oracle-vm');
  const key = '_kino/system/storage-policy.json';
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await bucket.get(key);
    if (previous) {
      if (previous.size > 8192) {
        await previous.body.cancel();
        throw new Error('INVALID_VM_POLICY');
      }
      const current = vmPolicySchema.parse(await previous.json());
      if (current.revision > row.revision) return;
      if (current.revision === row.revision) {
        if (current.quotaBytes !== row.quota_bytes)
          throw new Error('VM_POLICY_CONFLICT');
        return;
      }
    }
    const written = await bucket.put(
      key,
      JSON.stringify({ quotaBytes: row.quota_bytes, revision: row.revision }),
      {
        onlyIf: previous
          ? { etagMatches: previous.etag }
          : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' },
      },
    );
    if (written) return;
  }
  throw new WorkspaceFailure('STORAGE_POLICY_UNAVAILABLE', 503);
}

export const oraclePolicyInput = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().safe(),
    enabled: z.boolean(),
    quotaGb: z.number().int().min(1).max(100),
  })
  .strict();

type Policy = {
  requested_enabled: number;
  quota_bytes: number;
  free_floor_bytes: number;
  revision: number;
};

function requireAdmin(env: WorkerEnv, actor: string) {
  if (
    !z.uuid().safeParse(env.ORACLE_STORAGE_ADMIN_USER_ID).success ||
    env.ORACLE_STORAGE_ADMIN_USER_ID !== actor
  )
    throw new WorkspaceFailure('NOT_FOUND', 404);
}

export async function readOraclePolicy(env: WorkerEnv, actor: string) {
  requireAdmin(env, actor);
  const schema = await env.DB.prepare(
    "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='oracle_storage_policy'",
  ).first<{ n: number }>();
  if (schema?.n !== 1)
    throw new WorkspaceFailure('STORAGE_POLICY_UNAVAILABLE', 503);
  const row = await env.DB.prepare(
    'SELECT requested_enabled,quota_bytes,free_floor_bytes,revision FROM oracle_storage_policy WHERE id=1',
  ).first<Policy>();
  if (!row) throw new WorkspaceFailure('STORAGE_POLICY_UNAVAILABLE', 503);
  let reason = '尚未開通 Oracle 儲存連線';
  let ready = false;
  if (configuration(env).ORACLE_STORAGE_ENABLED === 'true') {
    try {
      oracleStorageCredentials(env);
      await refreshStorageHealth(env);
      const node = await env.DB.prepare(
        "SELECT status,quota_bytes FROM storage_nodes WHERE id='oracle-vm' AND provider='s3' AND endpoint='https://drive.kinostudio.tw' AND bucket_name='kino-pick-overflow'",
      ).first<{ status: string; quota_bytes: number }>();
      const guard = await env.DB.prepare(
        "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='upload_request_guard'",
      ).first<{ sql: string }>();
      if (!node || node.status !== 'active') reason = '儲存空間尚未就緒';
      else if (!guard) reason = '照片上傳接線尚未完成';
      else {
        const health = await env.DB.prepare(
          'SELECT observed_at_ms AS observedAtMs,mounted,free_bytes AS freeBytes,maximum_quota_bytes AS maximumQuotaBytes,quota_bytes AS quotaBytes FROM oracle_storage_health WHERE id=1',
        ).first<{
          observedAtMs: number;
          mounted: number;
          freeBytes: number;
          maximumQuotaBytes: number;
          quotaBytes: number;
        }>();
        if (!health) {
          reason = '暫時無法確認剩餘空間';
        } else {
          ready =
            health.mounted === 1 &&
            Date.now() - health.observedAtMs >= 0 &&
            Date.now() - health.observedAtMs <= 120000 &&
            health.freeBytes >= row.free_floor_bytes &&
            health.maximumQuotaBytes >= row.quota_bytes &&
            health.quotaBytes === row.quota_bytes &&
            node.quota_bytes === row.quota_bytes;
          reason = ready ? '' : '磁碟容量尚未同步，或可用空間不足';
        }
      }
    } catch {
      reason = '暫時無法連接 Oracle 儲存空間';
    }
  }
  return {
    requestedEnabled: row.requested_enabled === 1,
    effectiveEnabled: row.requested_enabled === 1 && ready,
    ready,
    reason,
    quotaGb: row.quota_bytes / 1e9,
    freeFloorGb: row.free_floor_bytes / 1e9,
    revision: row.revision,
  };
}

export async function saveOraclePolicy(
  env: WorkerEnv,
  actor: string,
  session: string,
  input: unknown,
) {
  requireAdmin(env, actor);
  const value = oraclePolicyInput.parse(input);
  await readOraclePolicy(env, actor);
  const payload = JSON.stringify(value);
  try {
    await env.DB.prepare(
      'INSERT INTO oracle_storage_policy_commands(request_id,actor_id,session_id,expected_revision,requested_enabled,quota_bytes,occurred_at_ms,payload_json) VALUES(?,?,?,?,?,?,?,?)',
    )
      .bind(
        value.requestId,
        actor,
        session,
        value.expectedRevision,
        value.enabled ? 1 : 0,
        value.quotaGb * 1e9,
        Date.now(),
        payload,
      )
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = [
      'STORAGE_POLICY_CONFLICT',
      'STORAGE_POLICY_BELOW_USAGE',
      'REQUEST_ID_CONFLICT',
      'OWNER_REQUIRED',
    ].find((code) => message.includes(code));
    if (code) throw new WorkspaceFailure(code, 409);
    throw new WorkspaceFailure('STORAGE_POLICY_UNAVAILABLE', 503);
  }
  await publishVmPolicy(env);
  return readOraclePolicy(env, actor);
}
