import { z } from 'zod';
import type { StorageInventorySnapshot } from '../../../packages/domain/src/storage-reconciliation';
import { WorkspaceFailure } from './workspaces';

const integer = z.number().int().nonnegative().safe();
const key = z.string().min(1).max(1024);
const assetSchema = z
  .object({
    id: z.uuid(),
    object_key: key,
    bytes: integer,
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['private', 'available', 'quarantined']),
  })
  .strict();
const fenceSchema = z
  .object({
    upload_session_id: z.uuid(),
    object_key: key,
    reason: z.enum(['cancel', 'expire']),
    occurred_at_ms: integer,
  })
  .strict();
const metadataSchema = z
  .object({
    provider: z.enum(['r2', 's3']),
    account_id: z.string().min(1).max(256),
    bucket_name: z.string().min(1).max(256),
    endpoint: z.string().max(2048).nullable(),
    credential_ref: z.string().min(1).max(256),
    status: z.enum(['active', 'readonly', 'disabled']),
    priority: z.number().int().safe(),
    node_quota: integer.positive(),
    node_used: integer,
    node_reserved: integer,
    workspace_quota: integer.positive(),
    workspace_used: integer,
    workspace_reserved: integer,
    node_asset_bytes: integer,
    workspace_asset_bytes: integer,
    pending_writes: z.union([z.literal(0), z.literal(1)]),
    inventory_count: integer,
    inventory_key_bytes: integer,
    max_key_bytes: integer,
  })
  .strict();

// Keep the original upload node; routing priority changes never move an existing key.
const scopeSql = `WITH scope AS (
  SELECT w.id AS workspace_id,n.id AS storage_node_id
  FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
  JOIN workspaces w ON w.owner_user_id=o.user_id
  JOIN storage_nodes n ON n.id=?4
  WHERE s.id=?1 AND o.user_id=?2 AND o.enabled=1
    AND s.expiresAt>unixepoch('subsec')*1000 AND w.id=?3
) , inventory_keys AS (
  SELECT length(CAST(a.object_key AS BLOB)) AS key_bytes
  FROM scope c JOIN photo_assets a ON a.workspace_id=c.workspace_id AND a.storage_node_id=c.storage_node_id
  UNION ALL
  SELECT length(CAST(f.object_key AS BLOB)) AS key_bytes
  FROM scope c JOIN upload_sessions s ON s.workspace_id=c.workspace_id AND s.storage_node_id=c.storage_node_id
  JOIN upload_key_fences f ON f.upload_session_id=s.id AND f.object_key=s.object_key
  LIMIT 20001
), inventory_bounds AS (
  SELECT count(*) AS object_count,COALESCE(sum(key_bytes),0) AS key_bytes,COALESCE(max(key_bytes),0) AS max_key_bytes
  FROM inventory_keys
) `;

// Reclamation retains immutable asset metadata and replaces the payload with a fence.
const physicalBytesSql = `CASE WHEN EXISTS(
  SELECT 1 FROM photos p
  JOIN manual_album_deletion_jobs j ON j.album_id=p.album_id
    AND j.workspace_id=p.workspace_id AND j.project_id=p.project_id
  JOIN manual_album_deletion_items i ON i.job_id=j.id AND i.asset_id=a.id
  WHERE p.id=a.photo_id AND p.workspace_id=a.workspace_id
    AND i.storage_node_id=a.storage_node_id AND i.object_key=a.object_key
    AND i.byte_size=a.byte_size AND i.checksum_sha256=a.checksum_sha256
    AND i.status='reclaimed'
) THEN 0 ELSE a.byte_size END`;

const metadataSql = `SELECT n.provider,n.account_id,n.bucket_name,n.endpoint,n.credential_ref,n.status,n.priority,
  n.quota_bytes AS node_quota,n.used_bytes AS node_used,n.reserved_bytes AS node_reserved,
  w.quota_bytes AS workspace_quota,u.used_bytes AS workspace_used,u.reserved_bytes AS workspace_reserved,
  (SELECT COALESCE(sum(${physicalBytesSql}),0) FROM photo_assets a WHERE a.storage_node_id=n.id) AS node_asset_bytes,
  (SELECT COALESCE(sum(${physicalBytesSql}),0) FROM photo_assets a WHERE a.workspace_id=w.id) AS workspace_asset_bytes,
  (n.reserved_bytes<>0 OR u.reserved_bytes<>0
    OR EXISTS(SELECT 1 FROM pending_upload_storage_reservations r WHERE r.workspace_id=w.id AND r.storage_node_id=n.id)
    OR EXISTS(SELECT 1 FROM upload_authorizations g JOIN upload_sessions s ON s.id=g.upload_session_id
      WHERE s.workspace_id=w.id AND s.storage_node_id=n.id AND g.expires_at_ms>unixepoch('subsec')*1000)
    OR EXISTS(SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id
      WHERE a.workspace_id=w.id AND a.storage_node_id=n.id AND (j.status<>'succeeded' OR j.reserved_bytes<>0))
    OR EXISTS(SELECT 1 FROM manual_album_deletion_jobs j WHERE j.workspace_id=w.id AND j.status='deleting')
  ) AS pending_writes,
  b.object_count AS inventory_count,b.key_bytes AS inventory_key_bytes,b.max_key_bytes
  FROM scope c JOIN storage_nodes n ON n.id=c.storage_node_id
  JOIN workspaces w ON w.id=c.workspace_id JOIN workspace_storage_usage u ON u.workspace_id=w.id
  CROSS JOIN inventory_bounds b`;
const assetsSql = `SELECT a.id,a.object_key,${physicalBytesSql} AS bytes,a.checksum_sha256,a.state
  FROM scope c JOIN photo_assets a ON a.workspace_id=c.workspace_id AND a.storage_node_id=c.storage_node_id
  JOIN inventory_bounds b ON b.object_count<=20000 AND b.key_bytes<=4194304 AND b.max_key_bytes<=1024
  ORDER BY a.object_key LIMIT 20001`;
const fencesSql = `SELECT f.upload_session_id,f.object_key,f.reason,f.occurred_at_ms
  FROM scope c JOIN upload_sessions s ON s.workspace_id=c.workspace_id AND s.storage_node_id=c.storage_node_id
  JOIN upload_key_fences f ON f.upload_session_id=s.id AND f.object_key=s.object_key
  JOIN inventory_bounds b ON b.object_count<=20000 AND b.key_bytes<=4194304 AND b.max_key_bytes<=1024
  ORDER BY f.object_key LIMIT 20001`;

/** Internal Owner-only, read-only inventory; never send its object keys over HTTP.
 * revision is a content fingerprint,
 * not a monotonic write fence or a persisted reconciliation receipt.
 */
export class D1StorageInventoryRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: string,
    private readonly session: string,
  ) {}

  private query(sql: string, workspaceId: string, storageNodeId: string) {
    return this.db
      .prepare(scopeSql + sql)
      .bind(this.session, this.actor, workspaceId, storageNodeId);
  }

  private async requireScope(workspaceId: string, storageNodeId: string) {
    if (
      await this.query(
        'SELECT 1 FROM scope',
        workspaceId,
        storageNodeId,
      ).first()
    )
      return;
    const owner = await this.db
      .prepare(
        'SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id ' +
          "WHERE s.id=? AND o.user_id=? AND o.enabled=1 AND s.expiresAt>unixepoch('subsec')*1000",
      )
      .bind(this.session, this.actor)
      .first();
    throw new WorkspaceFailure(
      owner ? 'NOT_FOUND' : 'OWNER_REQUIRED',
      owner ? 404 : 403,
    );
  }

  async read(
    workspaceId: string,
    storageNodeId: string,
  ): Promise<StorageInventorySnapshot> {
    const workspace = z.uuid().parse(workspaceId).toLowerCase();
    const node = z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .parse(storageNodeId);
    try {
      const [head, assetsResult, fencesResult] = await this.db.batch([
        this.query(metadataSql, workspace, node),
        this.query(assetsSql, workspace, node),
        this.query(fencesSql, workspace, node),
      ]);
      if (!head?.success || !assetsResult?.success || !fencesResult?.success)
        throw new WorkspaceFailure('STORAGE_INVENTORY_UNAVAILABLE', 503);
      if (head.results.length !== 1) {
        await this.requireScope(workspace, node);
        throw new WorkspaceFailure('STORAGE_INVENTORY_UNAVAILABLE', 503);
      }
      const metadata = metadataSchema.parse(head.results[0]);
      if (
        metadata.inventory_count > 20000 ||
        metadata.inventory_key_bytes > 4194304 ||
        metadata.max_key_bytes > 1024
      )
        throw new WorkspaceFailure('STORAGE_INVENTORY_LIMIT', 503);
      if (
        metadata.inventory_count !==
        assetsResult.results.length + fencesResult.results.length
      )
        throw new WorkspaceFailure('STORAGE_INVENTORY_UNAVAILABLE', 503);
      if (
        metadata.node_used !== metadata.node_asset_bytes ||
        metadata.workspace_used !== metadata.workspace_asset_bytes
      )
        throw new WorkspaceFailure('STORAGE_INVENTORY_UNAVAILABLE', 503);
      if (assetsResult.results.length + fencesResult.results.length > 20000)
        throw new WorkspaceFailure('STORAGE_INVENTORY_LIMIT', 503);
      const assets = assetsResult.results.map((row) => assetSchema.parse(row));
      const fences = fencesResult.results.map((row) => fenceSchema.parse(row));
      const objects = [
        ...assets.map((row) => ({ key: row.object_key, bytes: row.bytes })),
        ...fences.map((row) => ({ key: row.object_key, bytes: 0 })),
      ];
      let keyBytes = 0;
      const encoder = new TextEncoder();
      const keys = new Set<string>();
      for (const object of objects) {
        const bytes = encoder.encode(object.key).length;
        keyBytes += bytes;
        if (
          !object.key.startsWith(workspace + '/') ||
          bytes > 1024 ||
          keyBytes > 4194304 ||
          keys.has(object.key)
        )
          throw new WorkspaceFailure('STORAGE_INVENTORY_UNAVAILABLE', 503);
        keys.add(object.key);
      }
      const digest = await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(
          JSON.stringify({ workspace, node, metadata, assets, fences }),
        ),
      );
      const revision = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      await this.requireScope(workspace, node);
      return {
        workspaceId: workspace,
        storageNodeId: node,
        revision,
        pendingWrites: metadata.pending_writes === 1,
        objects,
      };
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      throw new WorkspaceFailure('STORAGE_INVENTORY_UNAVAILABLE', 503);
    }
  }
}
