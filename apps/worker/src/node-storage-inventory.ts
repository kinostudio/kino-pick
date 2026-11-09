import { z } from 'zod';
import type { NodeStorageInventorySnapshot } from '../../../packages/domain/src/storage-reconciliation';
import { storageAssetPhysicalBytesSql } from './storage-inventory';
import { WorkspaceFailure } from './workspaces';

const integer = z.number().int().nonnegative().safe();
const nodeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const encoder = new TextEncoder();
const authStateSchema = z
  .object({
    authorized: z.union([z.literal(0), z.literal(1)]),
    node_exists: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();
const finalAuthSchema = authStateSchema
  .extend({ epoch: integer.nullable() })
  .strict();
const headSchema = z
  .object({
    storage_node_id: nodeIdSchema,
    epoch: integer.nullable(),
    provider: z.enum(['r2', 's3']),
    account_id: z.string().min(1).max(256),
    bucket_name: z.string().min(1).max(256),
    endpoint: z.string().max(2048).nullable(),
    credential_ref: z.enum(['binding:PRIMARY_STORAGE', 'env:ORACLE_STORAGE']),
    status: z.enum(['active', 'readonly', 'disabled']),
    priority: integer,
    node_quota: integer.positive(),
    node_used: integer,
    node_reserved: integer,
    node_asset_bytes: integer,
    reservation_ledgers_valid: z.union([z.literal(0), z.literal(1)]),
    pending_writes: z.union([z.literal(0), z.literal(1)]),
    inventory_count: integer,
    inventory_key_bytes: integer,
    max_key_bytes: integer,
  })
  .strict();
const assetSchema = z
  .object({
    workspace_id: z.uuid(),
    id: z.uuid(),
    object_key: z.string().min(1),
    bytes: integer,
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['private', 'available', 'quarantined']),
  })
  .strict();
const fenceSchema = z
  .object({
    workspace_id: z.uuid(),
    upload_session_id: z.uuid(),
    object_key: z.string().min(1),
    reason: z.enum(['cancel', 'expire']),
    occurred_at_ms: integer,
  })
  .strict();

// The registered manifest is bounded before either object-key query returns rows.
const scopeSql = `WITH scope AS (
  SELECT n.id AS storage_node_id,n.provider,n.account_id,n.bucket_name,n.endpoint,n.credential_ref,
    n.status,n.priority,n.quota_bytes AS node_quota,n.used_bytes AS node_used,
    n.reserved_bytes AS node_reserved,c.epoch
  FROM storage_nodes n
  JOIN owner_bootstrap b ON b.id=1 AND b.user_id=?1
  JOIN owners o ON o.id=1 AND o.user_id=b.user_id AND o.enabled=1
  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2
    AND s.expiresAt>CAST(unixepoch('subsec')*1000 AS INTEGER)
  JOIN storage_inventory_clock c ON c.id=1
  WHERE n.id=?3
), inventory_keys AS (
  SELECT length(CAST(a.object_key AS BLOB)) AS key_bytes
  FROM scope c JOIN photo_assets a ON a.storage_node_id=c.storage_node_id
  UNION ALL
  SELECT length(CAST(f.object_key AS BLOB)) AS key_bytes
  FROM scope c JOIN upload_sessions u ON u.storage_node_id=c.storage_node_id
  JOIN upload_key_fences f ON f.upload_session_id=u.id AND f.object_key=u.object_key
  LIMIT 20001
), inventory_bounds AS (
  SELECT count(*) AS object_count,COALESCE(sum(key_bytes),0) AS key_bytes,
    COALESCE(max(key_bytes),0) AS max_key_bytes
  FROM inventory_keys
) `;

const authStateSql = `SELECT
  EXISTS(SELECT 1 FROM owner_bootstrap b JOIN owners o ON o.id=1 AND o.user_id=b.user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2
      AND s.expiresAt>CAST(unixepoch('subsec')*1000 AS INTEGER)
    WHERE b.id=1 AND b.user_id=?1) AS authorized,
  EXISTS(SELECT 1 FROM storage_nodes WHERE id=?3) AS node_exists`;
const finalAuthSql = `SELECT
  EXISTS(SELECT 1 FROM owner_bootstrap b JOIN owners o ON o.id=1 AND o.user_id=b.user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2
      AND s.expiresAt>CAST(unixepoch('subsec')*1000 AS INTEGER)
    WHERE b.id=1 AND b.user_id=?1) AS authorized,
  EXISTS(SELECT 1 FROM storage_nodes WHERE id=?3) AS node_exists,
  c.epoch AS epoch
  FROM (SELECT 1) AS seed LEFT JOIN storage_inventory_clock c ON c.id=1`;
const headSql = `SELECT c.storage_node_id,c.epoch,c.provider,c.account_id,c.bucket_name,c.endpoint,
  c.credential_ref,c.status,c.priority,c.node_quota,c.node_used,c.node_reserved,
  (SELECT COALESCE(sum(${storageAssetPhysicalBytesSql}),0) FROM photo_assets a
    WHERE a.storage_node_id=c.storage_node_id) AS node_asset_bytes,
  (c.node_reserved<>0
    OR EXISTS(SELECT 1 FROM pending_upload_storage_reservations r
      WHERE r.storage_node_id=c.storage_node_id)
    OR EXISTS(SELECT 1 FROM upload_authorizations g JOIN upload_sessions u
      ON u.id=g.upload_session_id WHERE u.storage_node_id=c.storage_node_id
      AND g.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER))
    OR EXISTS(SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id
      WHERE a.storage_node_id=c.storage_node_id AND (j.status<>'succeeded' OR j.reserved_bytes<>0))
    OR EXISTS(SELECT 1 FROM manual_album_deletion_jobs j
      WHERE j.status='deleting' AND EXISTS(SELECT 1 FROM manual_album_deletion_items i
        WHERE i.job_id=j.id AND i.storage_node_id=c.storage_node_id))
    OR EXISTS(SELECT 1 FROM storage_pending_derivative_capacity p
      WHERE p.storage_node_id=c.storage_node_id)
  ) AS pending_writes,
  NOT EXISTS(SELECT 1 FROM workspace_storage_usage usage
    WHERE (EXISTS(SELECT 1 FROM photo_assets a
        WHERE a.workspace_id=usage.workspace_id AND a.storage_node_id=c.storage_node_id)
      OR EXISTS(SELECT 1 FROM upload_sessions u
        WHERE u.workspace_id=usage.workspace_id AND u.storage_node_id=c.storage_node_id))
      AND usage.reserved_bytes<>(
        COALESCE((SELECT sum(r.reserved_bytes) FROM pending_upload_storage_reservations r
          WHERE r.workspace_id=usage.workspace_id),0)
        + COALESCE((SELECT sum(j.reserved_bytes) FROM image_processing_jobs j
          JOIN photo_assets a ON a.id=j.id WHERE a.workspace_id=usage.workspace_id),0)
      )
  ) AS reservation_ledgers_valid,
  b.object_count AS inventory_count,b.key_bytes AS inventory_key_bytes,
  b.max_key_bytes AS max_key_bytes
  FROM scope c CROSS JOIN inventory_bounds b`;
const assetsSql = `SELECT a.workspace_id,a.id,a.object_key,${storageAssetPhysicalBytesSql} AS bytes,
  a.checksum_sha256,a.state
  FROM scope c JOIN photo_assets a ON a.storage_node_id=c.storage_node_id
  JOIN inventory_bounds b ON b.object_count<=20000 AND b.key_bytes<=4194304
    AND b.max_key_bytes<=1024
  ORDER BY a.workspace_id,a.object_key,a.id LIMIT 20001`;
const fencesSql = `SELECT u.workspace_id,f.upload_session_id,f.object_key,f.reason,f.occurred_at_ms
  FROM scope c JOIN upload_sessions u ON u.storage_node_id=c.storage_node_id
  JOIN upload_key_fences f ON f.upload_session_id=u.id AND f.object_key=u.object_key
  JOIN inventory_bounds b ON b.object_count<=20000 AND b.key_bytes<=4194304
    AND b.max_key_bytes<=1024
  ORDER BY u.workspace_id,f.object_key,f.upload_session_id LIMIT 20001`;

const unavailable = () =>
  new WorkspaceFailure('STORAGE_INVENTORY_UNAVAILABLE', 503);

function requireSafeProviderConfig(head: z.infer<typeof headSchema>) {
  const expected =
    head.storage_node_id === 'primary'
      ? {
          provider: 'r2',
          account_id: 'binding-account',
          bucket_name: 'PRIMARY_STORAGE',
          endpoint: null,
          credential_ref: 'binding:PRIMARY_STORAGE',
        }
      : head.storage_node_id === 'oracle-vm'
        ? {
            provider: 's3',
            bucket_name: 'kino-pick-overflow',
            endpoint: 'https://drive.kinostudio.tw',
            credential_ref: 'env:ORACLE_STORAGE',
          }
        : null;
  if (
    !expected ||
    head.provider !== expected.provider ||
    ('account_id' in expected && head.account_id !== expected.account_id) ||
    head.bucket_name !== expected.bucket_name ||
    head.endpoint !== expected.endpoint ||
    head.credential_ref !== expected.credential_ref ||
    head.status === 'disabled' ||
    head.node_used + head.node_reserved > head.node_quota ||
    !Number.isSafeInteger(head.node_used + head.node_reserved)
  )
    throw unavailable();
}

function validateObjectKey(
  workspaceId: string,
  key: string,
  seen: Set<string>,
) {
  const prefix = workspaceId + '/';
  const bytes = encoder.encode(key).length;
  if (
    workspaceId !== workspaceId.toLowerCase() ||
    !z.uuid().safeParse(workspaceId).success ||
    !key.startsWith(prefix) ||
    key.length === prefix.length ||
    key.includes('..') ||
    key.includes('%') ||
    key.includes('\\') ||
    bytes > 1024 ||
    seen.has(key)
  )
    throw unavailable();
  seen.add(key);
  return bytes;
}

/** Internal platform-Owner manifest across every workspace for one registered storage node. */
export class D1NodeStorageInventoryRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: string,
    private readonly session: string,
  ) {}

  private statement(sql: string, nodeId: string) {
    return this.db.prepare(sql).bind(this.actor, this.session, nodeId);
  }

  private async checkAuthorization(nodeId: string) {
    const row = await this.statement(authStateSql, nodeId).first<unknown>();
    const state = authStateSchema.safeParse(row);
    if (!state.success) throw unavailable();
    if (state.data.authorized !== 1)
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    if (state.data.node_exists !== 1)
      throw new WorkspaceFailure('NOT_FOUND', 404);
  }

  async read(nodeId: string): Promise<NodeStorageInventorySnapshot> {
    const parsedNode = nodeIdSchema.safeParse(nodeId);
    if (!parsedNode.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
    const node = parsedNode.data;

    try {
      await this.checkAuthorization(node);
      const [headResult, assetsResult, fencesResult] = await this.db.batch([
        this.statement(scopeSql + headSql, node),
        this.statement(scopeSql + assetsSql, node),
        this.statement(scopeSql + fencesSql, node),
      ]);
      if (
        !headResult?.success ||
        !assetsResult?.success ||
        !fencesResult?.success ||
        !Array.isArray(headResult.results) ||
        !Array.isArray(assetsResult.results) ||
        !Array.isArray(fencesResult.results)
      )
        throw unavailable();
      if (headResult.results.length !== 1) {
        await this.checkAuthorization(node);
        throw unavailable();
      }

      const parsedHead = headSchema.safeParse(headResult.results[0]);
      if (!parsedHead.success) throw unavailable();
      const head = parsedHead.data;
      if (head.storage_node_id !== node) throw unavailable();
      requireSafeProviderConfig(head);
      if (head.reservation_ledgers_valid !== 1) throw unavailable();
      if (head.epoch === null) throw unavailable();
      if (
        head.inventory_count > 20_000 ||
        head.inventory_key_bytes > 4_194_304 ||
        head.max_key_bytes > 1024
      )
        throw new WorkspaceFailure('STORAGE_INVENTORY_LIMIT', 503);
      if (
        head.node_used !== head.node_asset_bytes ||
        assetsResult.results.length + fencesResult.results.length !==
          head.inventory_count ||
        assetsResult.results.length + fencesResult.results.length > 20_000
      )
        throw unavailable();

      const assets = assetsResult.results.map((row) => assetSchema.parse(row));
      const fences = fencesResult.results.map((row) => fenceSchema.parse(row));
      const registeredObjects = [
        ...assets.map((row) => ({
          workspaceId: row.workspace_id,
          key: row.object_key,
          bytes: row.bytes,
        })),
        ...fences.map((row) => ({
          workspaceId: row.workspace_id,
          key: row.object_key,
          bytes: 0,
        })),
      ].sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      );
      const seen = new Set<string>();
      let keyBytes = 0;
      let maxKeyBytes = 0;
      let objectBytes = 0;
      for (const object of registeredObjects) {
        const currentKeyBytes = validateObjectKey(
          object.workspaceId,
          object.key,
          seen,
        );
        keyBytes += currentKeyBytes;
        maxKeyBytes = Math.max(maxKeyBytes, currentKeyBytes);
        objectBytes += object.bytes;
        if (
          !Number.isSafeInteger(keyBytes) ||
          !Number.isSafeInteger(objectBytes)
        )
          throw unavailable();
      }
      const objects = registeredObjects.map(({ key, bytes }) => ({
        key,
        bytes,
      }));
      if (
        keyBytes !== head.inventory_key_bytes ||
        maxKeyBytes !== head.max_key_bytes ||
        objectBytes !== head.node_asset_bytes
      )
        throw unavailable();

      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify({ node, epoch: head.epoch, head, assets, fences }),
        ),
      );
      const authResult = await this.statement(
        finalAuthSql,
        node,
      ).first<unknown>();
      const finalAuth = finalAuthSchema.safeParse(authResult);
      if (!finalAuth.success) throw unavailable();
      if (finalAuth.data.authorized !== 1)
        throw new WorkspaceFailure('OWNER_REQUIRED', 403);
      if (finalAuth.data.node_exists !== 1)
        throw new WorkspaceFailure('NOT_FOUND', 404);
      if (finalAuth.data.epoch === null) throw unavailable();
      if (finalAuth.data.epoch !== head.epoch)
        throw new WorkspaceFailure('CONCURRENT_MODIFICATION', 409);

      return {
        scope: 'node',
        storageNodeId: node,
        revision: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
        pendingWrites: head.pending_writes === 1,
        objects,
      };
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      throw unavailable();
    }
  }
}
