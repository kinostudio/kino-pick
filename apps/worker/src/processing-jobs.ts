import { z } from 'zod';
import {
  PROCESSING_RECIPES,
  type ProcessingRecipe,
} from '../../../packages/image-processing/src/recipes.ts';
import type {
  ProcessingJobClaim,
  ProcessedOutputMetadata,
  ProcessingJobStore,
} from '../../../packages/image-processing/src/durable-runner.ts';

export class ProcessingFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
const sourceQuery = `SELECT j.*,a.object_key AS source_key,a.byte_size,a.mime,a.checksum_sha256,v.width,v.height,a.version_id,p.id AS photo_id,p.workspace_id,p.project_id,p.album_id
  FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN photo_versions v ON v.id=a.version_id JOIN photos p ON p.id=a.photo_id`;
const rowSchema = z.object({
  id: z.uuid(),
  lease_token: z.uuid(),
  lease_epoch: z.number().int().positive(),
  recipe: z.enum(PROCESSING_RECIPES),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  album_id: z.uuid(),
  photo_id: z.uuid(),
  version_id: z.uuid(),
  source_key: z.string(),
  byte_size: z.number().int().positive().max(67108864),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
});
export class D1ImageProcessingRepository implements ProcessingJobStore {
  private db: D1Database;
  private leaseDurationMs: number;
  private processorVersion: ProcessingRecipe;
  constructor(
    db: D1Database,
    options: {
      leaseDurationMs?: number;
      processorVersion?: ProcessingRecipe;
    } = {},
  ) {
    this.db = db;
    this.processorVersion = z
      .enum(PROCESSING_RECIPES)
      .parse(options.processorVersion ?? 'local-sharp-0.35.5-v1');
    this.leaseDurationMs = z
      .number()
      .int()
      .min(1)
      .max(600000)
      .parse(options.leaseDurationMs ?? 600000);
  }
  async pending(limit = 10, workspaceId?: string): Promise<string[]> {
    const count = z.number().int().min(1).max(100).parse(limit);
    if (workspaceId !== undefined) z.uuid().parse(workspaceId);
    const rows = await this.db
      .prepare(
        "SELECT id FROM image_processing_jobs WHERE recipe=? AND (? IS NULL OR EXISTS(SELECT 1 FROM photo_assets a WHERE a.id=image_processing_jobs.id AND a.workspace_id=?)) AND (status IN('queued','retryable') OR (status='running' AND lease_until_ms<=unixepoch('subsec')*1000)) ORDER BY created_at_ms,id LIMIT ?",
      )
      .bind(
        this.processorVersion,
        workspaceId ?? null,
        workspaceId ?? null,
        count,
      )
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }
  async claim(jobId: string): Promise<ProcessingJobClaim | null> {
    z.uuid().parse(jobId);
    const token = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          `UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=lease_epoch+1,attempts=attempts+1,lease_until_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)+?,reason_code=NULL,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER),transition_id=?
        WHERE id=? AND recipe=? AND (status IN('queued','retryable') OR(status='running' AND lease_until_ms<=unixepoch('subsec')*1000))`,
        )
        .bind(
          token,
          this.leaseDurationMs,
          crypto.randomUUID(),
          jobId,
          this.processorVersion,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (
        message.includes('STORAGE_QUOTA_EXCEEDED') ||
        message.includes('PROCESSING_SOURCE_UNAVAILABLE')
      )
        return null;
      // A transport failure after commit may still have acquired this exact lease.
      const acquired = await this.db
        .prepare(
          "SELECT id FROM image_processing_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until_ms>unixepoch('subsec')*1000",
        )
        .bind(jobId, token)
        .first();
      if (!acquired) throw error;
    }
    const raw = await this.db
      .prepare(
        `${sourceQuery} WHERE j.id=? AND j.status='running' AND j.lease_token=? AND j.lease_until_ms>unixepoch('subsec')*1000`,
      )
      .bind(jobId, token)
      .first();
    if (!raw) return null;
    const row = rowSchema.parse(raw);
    const outputs = await this.db
      .prepare(
        "SELECT kind,object_key AS key,max_bytes AS maxBytes FROM image_processing_outputs WHERE job_id=? ORDER BY CASE kind WHEN 'thumbnail' THEN 0 ELSE 1 END",
      )
      .bind(jobId)
      .all<{ kind: 'thumbnail' | 'preview'; key: string; maxBytes: number }>();
    if (outputs.results.length !== 2)
      throw new ProcessingFailure('PROCESSING_OUTPUTS_MISSING');
    return {
      jobId: row.id,
      leaseToken: row.lease_token,
      leaseEpoch: row.lease_epoch,
      scope: {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        albumId: row.album_id,
      },
      photoId: row.photo_id,
      versionId: row.version_id,
      sourceKey: row.source_key,
      processorVersion: row.recipe,
      expected: {
        bytes: row.byte_size,
        mime: row.mime,
        sha256: row.checksum_sha256,
        width: row.width,
        height: row.height,
      },
      outputs: outputs.results,
    };
  }
  async assertLease(claim: ProcessingJobClaim): Promise<void> {
    const row = await this.db
      .prepare(
        `SELECT j.id FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN workspaces w ON w.id=a.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN photos p ON p.id=a.photo_id JOIN albums al ON al.id=p.album_id JOIN projects pr ON pr.id=p.project_id JOIN storage_nodes n ON n.id=a.storage_node_id AND n.status='active'
      WHERE j.id=? AND j.status='running' AND j.lease_token=? AND j.lease_epoch=? AND j.lease_until_ms>unixepoch('subsec')*1000 AND al.state NOT IN('archived','deleting','deleted') AND pr.status NOT IN('archived','deleting','deleted')`,
      )
      .bind(claim.jobId, claim.leaseToken, claim.leaseEpoch)
      .first();
    if (!row) throw new ProcessingFailure('PROCESSING_LEASE_LOST');
  }
  async complete(
    claim: ProcessingJobClaim,
    outputs: readonly ProcessedOutputMetadata[],
  ): Promise<void> {
    const result = JSON.stringify(
      [...outputs].sort((a, b) =>
        a.kind === 'thumbnail' ? -1 : b.kind === 'thumbnail' ? 1 : 0,
      ),
    );
    try {
      const response = await this.db
        .prepare(
          `UPDATE image_processing_jobs SET status='succeeded',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,result_json=?,reason_code=NULL,transition_id=?,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)
        WHERE id=? AND status='running' AND lease_token=? AND lease_epoch=? AND lease_until_ms>unixepoch('subsec')*1000`,
        )
        .bind(
          result,
          crypto.randomUUID(),
          claim.jobId,
          claim.leaseToken,
          claim.leaseEpoch,
        )
        .run();
      if (response.meta.changes > 0) return;
    } catch (error) {
      const existing = await this.db
        .prepare(
          "SELECT result_json FROM image_processing_jobs WHERE id=? AND status='succeeded'",
        )
        .bind(claim.jobId)
        .first<{ result_json: string }>();
      if (existing?.result_json === result) return;
      throw error;
    }
    const existing = await this.db
      .prepare(
        "SELECT result_json FROM image_processing_jobs WHERE id=? AND status='succeeded'",
      )
      .bind(claim.jobId)
      .first<{ result_json: string }>();
    if (existing?.result_json !== result)
      throw new ProcessingFailure('PROCESSING_LEASE_LOST');
  }
  async fail(
    claim: ProcessingJobClaim,
    reason: 'PROCESSING_CONTENT_INVALID' | 'PROCESSING_IO_UNCERTAIN',
    review: boolean,
  ): Promise<void> {
    const response = await this.db
      .prepare(
        `UPDATE image_processing_jobs SET status=?,reason_code=?,lease_token=NULL,lease_until_ms=NULL,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER),transition_id=?
      WHERE id=? AND status='running' AND lease_token=? AND lease_epoch=? AND lease_until_ms>unixepoch('subsec')*1000`,
      )
      .bind(
        review ? 'needs_review' : 'retryable',
        reason,
        crypto.randomUUID(),
        claim.jobId,
        claim.leaseToken,
        claim.leaseEpoch,
      )
      .run();
    if (response.meta.changes === 0)
      throw new ProcessingFailure('PROCESSING_LEASE_LOST');
  }
}
