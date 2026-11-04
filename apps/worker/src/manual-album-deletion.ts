import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';
import { R2StorageAdapter } from './r2-storage';

export const manualAlbumDeletionSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().positive().max(2147483646),
    confirmationName: z.string().min(1).max(320),
    inventoryCount: z.number().int().nonnegative().max(100000),
    bytesBefore: z.number().int().nonnegative().safe(),
    confirmPermanent: z.literal(true),
  })
  .strict();

type Album = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  revision: number;
  state: string;
};
type Job = {
  id: string;
  status: 'deleting' | 'completed';
  inventory_count: number;
  bytes_before: number;
  bytes_reclaimed: number;
  actor_id: string;
  request_id: string;
  expected_revision: number;
  confirmation_name: string;
};
const policy = JSON.stringify({
  reason: 'manual',
  graceHours: 0,
  minimumRetentionDays: 0,
  confirmed: true,
});

export class D1ManualAlbumDeletion {
  constructor(
    private db: D1Database,
    private storage: R2StorageAdapter,
    private actor: string,
    private session: string,
  ) {}
  private async album(id: string) {
    const row = await this.db
      .prepare(
        "SELECT a.* FROM albums a JOIN workspaces w ON w.id=a.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE a.id=? AND w.owner_user_id=?",
      )
      .bind(this.session, z.uuid().parse(id), this.actor)
      .first<Album>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return row;
  }
  private job(albumId: string) {
    return this.db
      .prepare('SELECT * FROM manual_album_deletion_jobs WHERE album_id=?')
      .bind(albumId)
      .first<Job>();
  }
  async preview(albumId: string) {
    const album = await this.album(albumId);
    const job = await this.job(album.id);
    const inventory = await this.db
      .prepare(
        'SELECT count(DISTINCT a.id) AS assetCount,COALESCE(sum(a.byte_size),0) AS totalBytes,count(DISTINCT a.version_id) AS versionCount,count(DISTINCT p.id) AS photoCount FROM photos p LEFT JOIN photo_assets a ON a.photo_id=p.id AND a.workspace_id=p.workspace_id WHERE p.album_id=? AND p.workspace_id=? AND p.project_id=?',
      )
      .bind(album.id, album.workspace_id, album.project_id)
      .first<{
        assetCount: number;
        totalBytes: number;
        versionCount: number;
        photoCount: number;
      }>();
    if (!inventory)
      throw new WorkspaceFailure('DELETION_INVENTORY_UNAVAILABLE', 503);
    const blockers = job
      ? []
      : (
          await this.db
            .prepare(
              'SELECT blocker FROM manual_album_deletion_blockers WHERE album_id=?',
            )
            .bind(album.id)
            .all<{ blocker: string }>()
        ).results.map((r) => r.blocker);
    const progress = job
      ? await this.db
          .prepare(
            "SELECT sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,sum(CASE WHEN status='pending' AND last_error_code IS NOT NULL THEN 1 ELSE 0 END) AS failed FROM manual_album_deletion_items WHERE job_id=?",
          )
          .bind(job.id)
          .first<{ pending: number | null; failed: number | null }>()
      : null;
    return {
      album: { id: album.id, name: album.name, revision: album.revision },
      preview: { ...inventory, blockers },
      job: job
        ? {
            id: job.id,
            status: job.status,
            inventoryCount: job.inventory_count,
            bytesBefore: job.bytes_before,
            bytesReclaimed: job.bytes_reclaimed,
            pending: progress?.pending ?? 0,
            failed: progress?.failed ?? 0,
          }
        : null,
    };
  }
  async start(albumId: string, input: unknown) {
    const album = await this.album(albumId);
    const body = manualAlbumDeletionSchema.parse(input);
    let job = await this.job(album.id);
    if (job) {
      if (
        job.actor_id !== this.actor ||
        job.request_id !== body.requestId ||
        job.expected_revision !== body.expectedRevision ||
        job.confirmation_name !== body.confirmationName ||
        job.inventory_count !== body.inventoryCount ||
        job.bytes_before !== body.bytesBefore
      )
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    } else {
      const id = crypto.randomUUID();
      try {
        await this.db
          .prepare(
            "INSERT INTO manual_album_deletion_jobs(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,expected_revision,confirmation_name,policy_snapshot,created_at_ms,status,inventory_count,bytes_before,bytes_reclaimed) VALUES(?,?,?,?,?,?,?,?,?,?,?,'deleting',?,?,0)",
          )
          .bind(
            id,
            this.actor,
            this.session,
            body.requestId,
            album.workspace_id,
            album.project_id,
            album.id,
            body.expectedRevision,
            body.confirmationName,
            policy,
            Date.now(),
            body.inventoryCount,
            body.bytesBefore,
          )
          .run();
      } catch (error) {
        this.fail(error);
      }
      job = await this.job(album.id);
    }
    if (!job) throw new WorkspaceFailure('DELETION_INVENTORY_UNAVAILABLE', 503);
    return this.advance(album.id, job.id);
  }
  async advance(albumId: string, jobId: string) {
    const album = await this.album(albumId);
    const job = await this.job(album.id);
    if (!job || job.id !== z.uuid().parse(jobId) || job.actor_id !== this.actor)
      throw new WorkspaceFailure('NOT_FOUND', 404);
    if (job.status === 'completed') return this.preview(album.id);
    const items = await this.db
      .prepare(
        "SELECT asset_id,storage_node_id,object_key,byte_size,checksum_sha256 FROM manual_album_deletion_items WHERE job_id=? AND status='pending' ORDER BY asset_id LIMIT 4",
      )
      .bind(job.id)
      .all<{
        asset_id: string;
        storage_node_id: string;
        object_key: string;
        byte_size: number;
        checksum_sha256: string;
      }>();
    for (const item of items.results) {
      // Reauthenticate immediately before each irreversible object operation.
      await this.album(album.id);
      try {
        if (item.storage_node_id !== this.storage.storageNodeId)
          throw new Error('DELETION_STORAGE_NODE_MISMATCH');
        const fence = await this.storage.eraseAssetToFence(
          {
            workspaceId: album.workspace_id,
            projectId: album.project_id,
            albumId: album.id,
          },
          {
            id: item.asset_id,
            objectKey: item.object_key,
            bytes: item.byte_size,
            sha256: item.checksum_sha256,
          },
          job.id,
        );
        await this.db
          .prepare(
            "UPDATE manual_album_deletion_items SET status='reclaimed',attempts=attempts+1,last_error_code=NULL,fence_etag=?,verified_at_ms=?,execution_actor_id=?,execution_session_id=? WHERE job_id=? AND asset_id=? AND status='pending'",
          )
          .bind(
            fence,
            Date.now(),
            this.actor,
            this.session,
            job.id,
            item.asset_id,
          )
          .run();
      } catch (error) {
        const code =
          error instanceof Error &&
          /^DELETION_(?:OBJECT|CHECKSUM|STORAGE_NODE)_MISMATCH$/.test(
            error.message,
          )
            ? 'STORAGE_WITNESS_MISMATCH'
            : 'STORAGE_IO_UNCERTAIN';
        await this.db
          .prepare(
            "UPDATE manual_album_deletion_items SET attempts=attempts+1,last_error_code=?,execution_actor_id=?,execution_session_id=? WHERE job_id=? AND asset_id=? AND status='pending'",
          )
          .bind(code, this.actor, this.session, job.id, item.asset_id)
          .run();
        break;
      }
    }
    return this.preview(album.id);
  }
  private fail(error: unknown): never {
    const message = error instanceof Error ? error.message : '';
    const aliases: Record<string, string> = {
      INVALID_DELETE_CONFIRMATION: 'DELETION_CONFIRMATION_REQUIRED',
      ALBUM_NOT_DELETABLE: 'CONCURRENT_MODIFICATION',
      DELETE_BLOCKED: 'DELETION_BLOCKED',
      DELETE_PROTECTED: 'DELETION_BLOCKED',
      DELETE_CONTENT_BUSY: 'DELETION_BLOCKED',
      DELETE_SHARED_REFERENCE: 'DELETION_BLOCKED',
      DELETE_INVENTORY_CHANGED: 'DELETION_INVENTORY_CHANGED',
      DELETE_LEDGER_UNAVAILABLE: 'DELETION_LEDGER_UNAVAILABLE',
    };
    for (const code of [
      'OWNER_REQUIRED',
      'NOT_FOUND',
      'REQUEST_ID_CONFLICT',
      'CONCURRENT_MODIFICATION',
      'DELETION_CONFIRMATION_REQUIRED',
      'DELETION_BLOCKED',
      'DELETION_INVENTORY_CHANGED',
      'DELETION_LEDGER_UNAVAILABLE',
      'INVALID_DELETE_CONFIRMATION',
      'ALBUM_NOT_DELETABLE',
      'DELETE_BLOCKED',
      'DELETE_PROTECTED',
      'DELETE_CONTENT_BUSY',
      'DELETE_SHARED_REFERENCE',
      'DELETE_INVENTORY_CHANGED',
      'DELETE_LEDGER_UNAVAILABLE',
    ]) {
      if (message.includes(code))
        throw new WorkspaceFailure(
          aliases[code] ?? code,
          code === 'NOT_FOUND' ? 404 : code === 'OWNER_REQUIRED' ? 403 : 409,
        );
    }
    throw error;
  }
}
