import { D1OwnerExternalIntentStore } from './owner-external-intents';
import { z } from 'zod';
import {
  processingReviewPreviewSchema,
  abandonProcessingSchema,
  abandonedProcessingSchema,
} from '../../../packages/contracts/src/processing-review';
import {
  R2ProcessingReviewStore,
  type ReviewOutputSlot,
} from './processing-review-storage';
import { WorkspaceFailure } from './workspaces';

export class D1ProcessingReviewRepository {
  private db: D1Database;
  private storage:
    R2ProcessingReviewStore | ((nodeId: string) => R2ProcessingReviewStore);
  private actor: string;
  private session: string;
  constructor(
    db: D1Database,
    storage:
      R2ProcessingReviewStore | ((nodeId: string) => R2ProcessingReviewStore),
    actor: string,
    session: string,
  ) {
    this.db = db;
    this.storage = storage;
    this.actor = actor;
    this.session = session;
  }
  private storageFor(row: { storage_node_id: string }) {
    return typeof this.storage === 'function'
      ? this.storage(row.storage_node_id)
      : this.storage;
  }
  private async current(
    photoId: string,
    versionId: string,
    requireReview = true,
  ) {
    const row = await this.db
      .prepare(
        `SELECT j.id,j.recipe,j.status,j.lease_epoch,j.reason_code,j.reserved_bytes,p.workspace_id,p.project_id,p.album_id,a.storage_node_id,n.status AS node_status,al.state AS album_state,pr.status AS project_state
      FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id AND a.asset_kind='original' JOIN photos p ON p.id=a.photo_id
      JOIN albums al ON al.id=p.album_id JOIN projects pr ON pr.id=p.project_id JOIN workspaces w ON w.id=p.workspace_id
      JOIN storage_nodes n ON n.id=a.storage_node_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      WHERE p.id=? AND a.version_id=? AND w.owner_user_id=? AND a.state='private' AND ((a.storage_node_id='primary' AND n.provider='r2') OR (a.storage_node_id='oracle-vm' AND n.provider='s3')) AND al.state NOT IN('deleting','deleted') AND pr.status NOT IN('deleting','deleted') AND (?=1 OR(al.state<>'archived' AND pr.status<>'archived'))`,
      )
      .bind(this.session, photoId, versionId, this.actor, requireReview ? 0 : 1)
      .first<{
        id: string;
        recipe: string;
        status: string;
        lease_epoch: number;
        reason_code: string;
        reserved_bytes: number;
        workspace_id: string;
        project_id: string;
        album_id: string;
        storage_node_id: string;
        node_status: string;
        album_state: string;
        project_state: string;
      }>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (requireReview && row.status !== 'needs_review')
      throw new WorkspaceFailure('PROCESSING_REVIEW_REQUIRED', 409);
    return row;
  }
  private async slots(row: {
    id: string;
    recipe: string;
    workspace_id: string;
    project_id: string;
    album_id: string;
  }): Promise<ReviewOutputSlot[]> {
    const records = await this.db
      .prepare(
        'SELECT kind,object_key FROM image_processing_outputs WHERE job_id=? ORDER BY kind',
      )
      .bind(row.id)
      .all<{ kind: 'thumbnail' | 'preview'; object_key: string }>();
    if (
      records.results.length !== 2 ||
      new Set(records.results.map((slot) => slot.kind)).size !== 2
    )
      throw new Error('PROCESSING_OUTPUTS_MISSING');
    return records.results.map((record) => ({
      jobId: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      albumId: row.album_id,
      recipe:
        row.recipe as import('../../../packages/image-processing/src/recipes.ts').ProcessingRecipe,
      kind: record.kind,
      key: record.object_key,
    }));
  }
  async abandon(photoId: string, versionId: string, input: unknown) {
    z.uuid().parse(photoId);
    z.uuid().parse(versionId);
    const value = abandonProcessingSchema.parse(input);
    const row = await this.current(photoId, versionId, false);
    const payload = JSON.stringify({
      photoId,
      versionId,
      expectedLeaseEpoch: value.expectedLeaseEpoch,
      confirmAbandon: true,
    });
    const previous = async () => {
      const existing = await this.db
        .prepare(
          `SELECT c.job_id,c.expected_epoch,c.payload_json FROM processing_review_commands c
        JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE c.actor_id=? AND c.request_id=?`,
        )
        .bind(this.session, this.actor, value.requestId)
        .first<{
          job_id: string;
          expected_epoch: number;
          payload_json: string;
        }>();
      if (!existing) return null;
      if (existing.job_id !== row.id || existing.payload_json !== payload)
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      return abandonedProcessingSchema.parse({
        jobId: existing.job_id,
        status: 'abandoned',
        leaseEpoch: existing.expected_epoch,
        releasedBytes: 16777216,
        originalRetained: true,
      });
    };
    const replay = await previous();
    if (replay) return replay;
    try {
      const collision = await this.db
        .prepare(
          `SELECT 1 FROM request_commands WHERE actor_id=? AND request_id=? UNION ALL SELECT 1 FROM upload_requests WHERE actor_id=? AND request_id=? UNION ALL SELECT 1 FROM upload_workflow_requests WHERE actor_id=? AND request_id=? LIMIT 1`,
        )
        .bind(
          this.actor,
          value.requestId,
          this.actor,
          value.requestId,
          this.actor,
          value.requestId,
        )
        .first();
      if (collision) throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (
        row.status !== 'needs_review' ||
        row.lease_epoch !== value.expectedLeaseEpoch ||
        row.node_status !== 'active' ||
        row.album_state === 'archived' ||
        row.project_state === 'archived'
      )
        throw new WorkspaceFailure('PROCESSING_REVIEW_CONFLICT', 409);
      const intent = await new D1OwnerExternalIntentStore(
        this.db,
        this.actor,
        this.session,
      ).claimProcessingAbandonment({
        jobId: row.id,
        photoId,
        versionId,
        expectedEpoch: value.expectedLeaseEpoch,
        requestId: value.requestId,
      });
      if (intent.payloadJson !== payload || intent.jobId !== row.id)
        throw new WorkspaceFailure('OWNER_EXTERNAL_INTENT_UNAVAILABLE', 503);
      const slots: ReviewOutputSlot[] = [
        {
          jobId: intent.jobId,
          workspaceId: intent.workspaceId,
          projectId: intent.projectId,
          albumId: intent.albumId,
          recipe:
            row.recipe as import('../../../packages/image-processing/src/recipes.ts').ProcessingRecipe,
          kind: 'thumbnail',
          key: intent.thumbnailKey,
        },
        {
          jobId: intent.jobId,
          workspaceId: intent.workspaceId,
          projectId: intent.projectId,
          albumId: intent.albumId,
          recipe:
            row.recipe as import('../../../packages/image-processing/src/recipes.ts').ProcessingRecipe,
          kind: 'preview',
          key: intent.previewKey,
        },
      ];
      const physical = await this.storageFor(row).fenceBoth(slots);
      if (!physical.bothFenced)
        throw new WorkspaceFailure(
          physical.outputs.some((output) => output.state === 'occupied')
            ? 'PROCESSING_OUTPUTS_OCCUPIED'
            : 'PROCESSING_FENCE_UNCERTAIN',
          physical.outputs.some((output) => output.state === 'occupied')
            ? 409
            : 503,
        );
      try {
        await this.db
          .prepare(
            `INSERT INTO processing_review_commands(actor_id,request_id,session_id,job_id,expected_epoch,payload_json,fences_json,created_at_ms) VALUES(?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))`,
          )
          .bind(
            this.actor,
            value.requestId,
            this.session,
            row.id,
            value.expectedLeaseEpoch,
            payload,
            JSON.stringify(
              physical.outputs.map((output) => ({
                kind: output.kind,
                key:
                  output.kind === 'thumbnail'
                    ? intent.thumbnailKey
                    : intent.previewKey,
                state: output.state,
              })),
            ),
          )
          .run();
      } catch (failure) {
        const committed = await previous();
        if (committed) return committed;
        const message = failure instanceof Error ? failure.message : '';
        for (const code of [
          'OWNER_REQUIRED',
          'REQUEST_ID_CONFLICT',
          'PROCESSING_REVIEW_CONFLICT',
          'PROCESSING_FENCES_REQUIRED',
          'PROCESSING_SOURCE_UNAVAILABLE',
        ]) {
          if (message.includes(code))
            throw new WorkspaceFailure(
              code,
              code === 'OWNER_REQUIRED' ? 403 : 409,
            );
        }
        throw failure;
      }
      const result = await previous();
      if (!result) throw new Error('PROCESSING_REVIEW_RESULT_UNAVAILABLE');
      return result;
    } catch (error) {
      const committed = await previous();
      if (committed) return committed;
      throw error;
    }
  }
  async preview(photoId: string, versionId: string) {
    z.uuid().parse(photoId);
    z.uuid().parse(versionId);
    const row = await this.current(photoId, versionId);
    const slots = await this.slots(row);
    const storage = this.storageFor(row);
    const outputs = await Promise.all(
      slots.map(async (slot) => {
        return { kind: slot.kind, state: await storage.inspect(slot) };
      }),
    );
    const latest = await this.current(photoId, versionId);
    if (latest.id !== row.id || latest.lease_epoch !== row.lease_epoch)
      throw new WorkspaceFailure('CONCURRENT_MODIFICATION', 409);
    return processingReviewPreviewSchema.parse({
      jobId: row.id,
      photoId,
      versionId,
      status: 'needs_review',
      leaseEpoch: row.lease_epoch,
      reason: row.reason_code,
      heldBytes: row.reserved_bytes,
      potentialReleaseBytes: outputs.every(
        (output) => output.state === 'missing' || output.state === 'fenced',
      )
        ? 16777216
        : 0,
      originalRetained: true,
      dryRun: true,
      outputs,
    });
  }
}
