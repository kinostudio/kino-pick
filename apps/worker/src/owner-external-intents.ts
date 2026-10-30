import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';

const uuid = z.uuid();
const processingInputSchema = z
  .object({
    jobId: uuid,
    photoId: uuid,
    versionId: uuid,
    expectedEpoch: z.number().int().positive(),
    requestId: uuid,
  })
  .strict();

const externalIntentRowSchema = z
  .object({
    actor_id: uuid,
    request_id: uuid,
    operation: z.enum(['upload.cancelled', 'processing.abandoned']),
    session_id: z.string().min(1),
    workspace_id: uuid,
    project_id: uuid,
    album_id: uuid,
    upload_session_id: uuid.nullable(),
    job_id: uuid.nullable(),
    photo_id: uuid.nullable(),
    version_id: uuid.nullable(),
    expected_epoch: z.number().int().positive().nullable(),
    storage_node_id: z.string().min(1),
    original_object_key: z.string().min(1).nullable(),
    thumbnail_key: z.string().min(1).nullable(),
    preview_key: z.string().min(1).nullable(),
    payload_json: z.string().max(2048),
    created_at_ms: z.number().int().positive(),
  })
  .strict();

type ExternalIntentRow = z.infer<typeof externalIntentRowSchema>;

type UploadTargetRow = {
  upload_session_id: string;
  actor_id: string;
  workspace_id: string;
  project_id: string;
  album_id: string;
  storage_node_id: string;
  original_object_key: string;
  effective_status: string;
  expires_at_ms: number;
  not_expired: number;
  storage_node_status: string;
  project_status: string;
  album_state: string;
};

type ProcessingTargetRow = {
  job_id: string;
  job_status: string;
  lease_epoch: number;
  reserved_bytes: number;
  photo_id: string;
  version_id: string;
  workspace_id: string;
  project_id: string;
  album_id: string;
  storage_node_id: string;
  source_asset_key: string;
  asset_state: string;
  asset_kind: string;
  storage_node_status: string;
  project_status: string;
  album_state: string;
};

type OutputSlotRow = {
  kind: string;
  object_key: string;
};

export type UploadCancellationClaim = Readonly<{
  actorId: string;
  claimedBySessionId: string;
  requestId: string;
  operation: 'upload.cancelled';
  workspaceId: string;
  projectId: string;
  albumId: string;
  uploadSessionId: string;
  storageNodeId: string;
  originalObjectKey: string;
  payloadJson: string;
  createdAtMs: number;
}>;

export type ProcessingAbandonmentClaim = Readonly<{
  actorId: string;
  claimedBySessionId: string;
  requestId: string;
  operation: 'processing.abandoned';
  workspaceId: string;
  projectId: string;
  albumId: string;
  jobId: string;
  photoId: string;
  versionId: string;
  expectedEpoch: number;
  storageNodeId: string;
  thumbnailKey: string;
  previewKey: string;
  payloadJson: string;
  createdAtMs: number;
}>;

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function requestConflict(): never {
  throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
}

function unavailable(): never {
  throw new WorkspaceFailure('OWNER_EXTERNAL_INTENT_UNAVAILABLE', 503);
}

function translate(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const mappings: ReadonlyArray<{
    fragment: string;
    code: string;
    status: 403 | 404 | 409;
  }> = [
    { fragment: 'OWNER_REQUIRED', code: 'OWNER_REQUIRED', status: 403 },
    { fragment: 'NOT_FOUND', code: 'NOT_FOUND', status: 404 },
    {
      fragment: 'UPLOAD_ALREADY_COMPLETED',
      code: 'INVALID_STATE_TRANSITION',
      status: 409,
    },
    {
      fragment: 'UPLOAD_NEEDS_REVIEW',
      code: 'INVALID_STATE_TRANSITION',
      status: 409,
    },
    {
      fragment: 'PROCESSING_SOURCE_UNAVAILABLE',
      code: 'PROCESSING_REVIEW_CONFLICT',
      status: 409,
    },
    {
      fragment: 'REQUEST_ID_CONFLICT',
      code: 'REQUEST_ID_CONFLICT',
      status: 409,
    },
    {
      fragment: 'INVALID_STATE_TRANSITION',
      code: 'INVALID_STATE_TRANSITION',
      status: 409,
    },
    {
      fragment: 'UPLOAD_SESSION_EXPIRED',
      code: 'UPLOAD_SESSION_EXPIRED',
      status: 409,
    },
    {
      fragment: 'PROCESSING_REVIEW_CONFLICT',
      code: 'PROCESSING_REVIEW_CONFLICT',
      status: 409,
    },
  ];
  for (const mapping of mappings) {
    if (message.includes(mapping.fragment))
      throw new WorkspaceFailure(mapping.code, mapping.status);
  }
  throw error;
}

function parseIntentRow(value: unknown): ExternalIntentRow {
  const parsed = externalIntentRowSchema.safeParse(value);
  if (!parsed.success) unavailable();
  return parsed.data;
}

function activeParent(projectStatus: string, albumState: string) {
  return (
    !['archived', 'deleting', 'deleted'].includes(projectStatus) &&
    !['archived', 'deleting', 'deleted'].includes(albumState)
  );
}

function expectedOriginalObjectKey(target: UploadTargetRow) {
  return (
    target.workspace_id +
    '/' +
    target.project_id +
    '/' +
    target.album_id +
    '/' +
    target.upload_session_id +
    '/original'
  );
}

function expectedOutputKey(
  target: ProcessingTargetRow,
  kind: 'thumbnail' | 'preview',
) {
  return (
    target.workspace_id +
    '/' +
    target.project_id +
    '/' +
    target.album_id +
    '/' +
    target.job_id +
    '/derived/local-sharp-0.35.5-v1/' +
    kind +
    '.jpg'
  );
}

/**
 * D1-only boundary for claims that must exist before an R2 fence.
 * Returned keys are internal immutable targets; never serialize them to a UI
 * or log them. The caller still owns the fenced R2 operation and final ledger.
 */
export class D1OwnerExternalIntentStore {
  constructor(
    private readonly db: D1Database,
    private readonly actorId: string,
    private readonly sessionId: string,
    private readonly storageNodeId = 'primary',
  ) {
    if (!uuid.safeParse(actorId).success || !sessionId) invalidInput();
  }

  private async assertCurrentOwner() {
    const row = await this.db
      .prepare(
        "SELECT 1 AS authorized FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=? AND o.enabled=1 AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
      )
      .bind(this.actorId, this.sessionId)
      .first<{ authorized: number }>();
    if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  private async uploadTarget(
    uploadSessionId: string,
  ): Promise<UploadTargetRow> {
    const row = await this.db
      .prepare(
        `SELECT u.id AS upload_session_id,u.actor_id,u.workspace_id,u.project_id,u.album_id,
          u.storage_node_id,u.object_key AS original_object_key,
          CASE WHEN c.upload_session_id IS NOT NULL OR vc.upload_session_id IS NOT NULL THEN 'completed'
            WHEN f.upload_session_id IS NOT NULL THEN 'needs_review' ELSE u.status END AS effective_status,
          u.expires_at_ms,CAST(u.expires_at_ms>unixepoch('subsec')*1000 AS INTEGER) AS not_expired,
          n.status AS storage_node_status,pr.status AS project_status,al.state AS album_state
        FROM upload_sessions u
        JOIN workspaces w ON w.id=u.workspace_id AND w.owner_user_id=?
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
        JOIN projects pr ON pr.id=u.project_id AND pr.workspace_id=u.workspace_id
        JOIN albums al ON al.id=u.album_id AND al.project_id=u.project_id AND al.workspace_id=u.workspace_id
        JOIN storage_nodes n ON n.id=u.storage_node_id
        LEFT JOIN upload_completions c ON c.upload_session_id=u.id
        LEFT JOIN upload_version_completions vc ON vc.upload_session_id=u.id
        LEFT JOIN upload_review_flags f ON f.upload_session_id=u.id
        WHERE u.id=? AND u.actor_id=?`,
      )
      .bind(this.actorId, this.sessionId, uploadSessionId, this.actorId)
      .first<UploadTargetRow>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    return row;
  }

  private assertUploadParentActive(target: UploadTargetRow) {
    if (!activeParent(target.project_status, target.album_state))
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
  }

  private assertUploadTargetStable(target: UploadTargetRow) {
    if (target.not_expired !== 1)
      throw new WorkspaceFailure('UPLOAD_SESSION_EXPIRED', 409);
    if (
      target.effective_status !== 'reserved' ||
      !activeParent(target.project_status, target.album_state) ||
      target.storage_node_id !== this.storageNodeId ||
      target.storage_node_status !== 'active' ||
      target.original_object_key !== expectedOriginalObjectKey(target)
    )
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
  }

  private async processingTarget(
    input: z.infer<typeof processingInputSchema>,
  ): Promise<{
    target: ProcessingTargetRow;
    thumbnailKey: string;
    previewKey: string;
  }> {
    const row = await this.db
      .prepare(
        `SELECT j.id AS job_id,j.status AS job_status,j.lease_epoch,j.reserved_bytes,
          p.id AS photo_id,a.version_id,p.workspace_id,p.project_id,p.album_id,
          a.storage_node_id,a.object_key AS source_asset_key,a.state AS asset_state,
          a.asset_kind,n.status AS storage_node_status,pr.status AS project_status,al.state AS album_state
        FROM image_processing_jobs j
        JOIN photo_assets a ON a.id=j.id AND a.asset_kind='original'
        JOIN photos p ON p.id=a.photo_id
        JOIN photo_versions v ON v.id=a.version_id AND v.photo_id=p.id AND v.workspace_id=p.workspace_id
        JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
        JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id
        JOIN albums al ON al.id=p.album_id AND al.project_id=p.project_id AND al.workspace_id=p.workspace_id
        JOIN storage_nodes n ON n.id=a.storage_node_id
        WHERE j.id=? AND p.id=? AND a.version_id=?`,
      )
      .bind(
        this.actorId,
        this.sessionId,
        input.jobId,
        input.photoId,
        input.versionId,
      )
      .first<ProcessingTargetRow>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }

    const slots = await this.db
      .prepare(
        'SELECT kind,object_key FROM image_processing_outputs WHERE job_id=? ORDER BY kind',
      )
      .bind(row.job_id)
      .all<OutputSlotRow>();
    await this.assertCurrentOwner();

    if (
      slots.results.length !== 2 ||
      new Set(slots.results.map((slot) => slot.kind)).size !== 2
    )
      throw new WorkspaceFailure('PROCESSING_REVIEW_CONFLICT', 409);
    const byKind = new Map(
      slots.results.map((slot) => [slot.kind, slot.object_key]),
    );
    const thumbnailKey = byKind.get('thumbnail');
    const previewKey = byKind.get('preview');
    if (
      !thumbnailKey ||
      !previewKey ||
      thumbnailKey !== expectedOutputKey(row, 'thumbnail') ||
      previewKey !== expectedOutputKey(row, 'preview')
    )
      throw new WorkspaceFailure('PROCESSING_REVIEW_CONFLICT', 409);

    return { target: row, thumbnailKey, previewKey };
  }

  private assertProcessingParentActive(target: ProcessingTargetRow) {
    if (!activeParent(target.project_status, target.album_state))
      throw new WorkspaceFailure('PROCESSING_REVIEW_CONFLICT', 409);
  }

  private assertProcessingTargetStable(
    input: z.infer<typeof processingInputSchema>,
    target: ProcessingTargetRow,
  ) {
    if (
      target.job_id !== input.jobId ||
      target.photo_id !== input.photoId ||
      target.version_id !== input.versionId ||
      target.job_status !== 'needs_review' ||
      target.lease_epoch !== input.expectedEpoch ||
      target.reserved_bytes !== 16777216 ||
      target.asset_state !== 'private' ||
      target.asset_kind !== 'original' ||
      target.storage_node_id !== 'primary' ||
      target.storage_node_status !== 'active' ||
      !target.source_asset_key ||
      !activeParent(target.project_status, target.album_state)
    )
      throw new WorkspaceFailure('PROCESSING_REVIEW_CONFLICT', 409);
  }

  private async existingClaim(
    requestId: string,
  ): Promise<ExternalIntentRow | null> {
    const row = await this.db
      .prepare(
        'SELECT actor_id,request_id,operation,session_id,workspace_id,project_id,album_id,upload_session_id,job_id,photo_id,version_id,expected_epoch,storage_node_id,original_object_key,thumbnail_key,preview_key,payload_json,created_at_ms FROM owner_external_intents WHERE actor_id=? AND request_id=?',
      )
      .bind(this.actorId, requestId)
      .first<unknown>();
    return row ? parseIntentRow(row) : null;
  }

  private assertUploadClaimMatches(
    row: ExternalIntentRow,
    target: UploadTargetRow,
    uploadSessionId: string,
    requestId: string,
    payloadJson: string,
  ) {
    if (
      row.actor_id !== this.actorId ||
      row.request_id !== requestId ||
      row.operation !== 'upload.cancelled' ||
      row.upload_session_id !== uploadSessionId ||
      row.payload_json !== payloadJson ||
      row.job_id !== null ||
      row.photo_id !== null ||
      row.version_id !== null ||
      row.expected_epoch !== null
    )
      requestConflict();

    if (
      row.workspace_id !== target.workspace_id ||
      row.project_id !== target.project_id ||
      row.album_id !== target.album_id ||
      row.storage_node_id !== target.storage_node_id ||
      row.original_object_key !== target.original_object_key ||
      row.thumbnail_key !== null ||
      row.preview_key !== null
    )
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
  }

  private assertProcessingClaimMatches(
    row: ExternalIntentRow,
    target: ProcessingTargetRow,
    thumbnailKey: string,
    previewKey: string,
    input: z.infer<typeof processingInputSchema>,
    payloadJson: string,
  ) {
    if (
      row.actor_id !== this.actorId ||
      row.request_id !== input.requestId ||
      row.operation !== 'processing.abandoned' ||
      row.job_id !== input.jobId ||
      row.photo_id !== input.photoId ||
      row.version_id !== input.versionId ||
      row.expected_epoch !== input.expectedEpoch ||
      row.payload_json !== payloadJson ||
      row.upload_session_id !== null ||
      row.original_object_key !== null
    )
      requestConflict();

    if (
      row.workspace_id !== target.workspace_id ||
      row.project_id !== target.project_id ||
      row.album_id !== target.album_id ||
      row.storage_node_id !== target.storage_node_id ||
      row.thumbnail_key !== thumbnailKey ||
      row.preview_key !== previewKey
    )
      throw new WorkspaceFailure('PROCESSING_REVIEW_CONFLICT', 409);
  }

  private uploadClaimFromRow(row: ExternalIntentRow): UploadCancellationClaim {
    if (
      row.operation !== 'upload.cancelled' ||
      !row.upload_session_id ||
      !row.original_object_key ||
      row.thumbnail_key !== null ||
      row.preview_key !== null
    )
      unavailable();
    return Object.freeze({
      actorId: row.actor_id,
      claimedBySessionId: row.session_id,
      requestId: row.request_id,
      operation: 'upload.cancelled' as const,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      albumId: row.album_id,
      uploadSessionId: row.upload_session_id,
      storageNodeId: row.storage_node_id,
      originalObjectKey: row.original_object_key,
      payloadJson: row.payload_json,
      createdAtMs: row.created_at_ms,
    });
  }

  private processingClaimFromRow(
    row: ExternalIntentRow,
  ): ProcessingAbandonmentClaim {
    if (
      row.operation !== 'processing.abandoned' ||
      !row.job_id ||
      !row.photo_id ||
      !row.version_id ||
      !row.expected_epoch ||
      !row.thumbnail_key ||
      !row.preview_key ||
      row.upload_session_id !== null ||
      row.original_object_key !== null
    )
      unavailable();
    return Object.freeze({
      actorId: row.actor_id,
      claimedBySessionId: row.session_id,
      requestId: row.request_id,
      operation: 'processing.abandoned' as const,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      albumId: row.album_id,
      jobId: row.job_id,
      photoId: row.photo_id,
      versionId: row.version_id,
      expectedEpoch: row.expected_epoch,
      storageNodeId: row.storage_node_id,
      thumbnailKey: row.thumbnail_key,
      previewKey: row.preview_key,
      payloadJson: row.payload_json,
      createdAtMs: row.created_at_ms,
    });
  }

  async claimUploadCancellation(
    uploadSessionIdInput: string,
    requestIdInput: string,
  ): Promise<UploadCancellationClaim> {
    const uploadSessionId = uuid.safeParse(uploadSessionIdInput);
    const requestId = uuid.safeParse(requestIdInput);
    if (!uploadSessionId.success || !requestId.success) invalidInput();
    const payloadJson = JSON.stringify({
      uploadSessionId: uploadSessionId.data,
    });

    await this.assertCurrentOwner();
    const target = await this.uploadTarget(uploadSessionId.data);
    this.assertUploadParentActive(target);
    const existing = await this.existingClaim(requestId.data);
    if (existing) {
      this.assertUploadClaimMatches(
        existing,
        target,
        uploadSessionId.data,
        requestId.data,
        payloadJson,
      );
      this.assertUploadTargetStable(target);
      await this.assertCurrentOwner();
      return this.uploadClaimFromRow(existing);
    }

    this.assertUploadTargetStable(target);
    try {
      await this.db
        .prepare(
          `INSERT INTO owner_external_intents(
            actor_id,request_id,operation,session_id,workspace_id,project_id,album_id,
            upload_session_id,job_id,photo_id,version_id,expected_epoch,storage_node_id,
            original_object_key,thumbnail_key,preview_key,payload_json,created_at_ms
          ) VALUES(?,?,'upload.cancelled',?,?,?,?,?,NULL,NULL,NULL,NULL,?,?,NULL,NULL,?,CAST(unixepoch('subsec')*1000 AS INTEGER))`,
        )
        .bind(
          this.actorId,
          requestId.data,
          this.sessionId,
          target.workspace_id,
          target.project_id,
          target.album_id,
          target.upload_session_id,
          target.storage_node_id,
          target.original_object_key,
          payloadJson,
        )
        .run();
    } catch (error) {
      const current = await this.uploadTarget(uploadSessionId.data);
      this.assertUploadParentActive(current);
      const raced = await this.existingClaim(requestId.data);
      if (raced) {
        this.assertUploadClaimMatches(
          raced,
          current,
          uploadSessionId.data,
          requestId.data,
          payloadJson,
        );
        this.assertUploadTargetStable(current);
        await this.assertCurrentOwner();
        return this.uploadClaimFromRow(raced);
      }
      translate(error);
    }

    const current = await this.uploadTarget(uploadSessionId.data);
    this.assertUploadParentActive(current);
    this.assertUploadTargetStable(current);
    const created = await this.existingClaim(requestId.data);
    if (!created) throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
    this.assertUploadClaimMatches(
      created,
      current,
      uploadSessionId.data,
      requestId.data,
      payloadJson,
    );
    await this.assertCurrentOwner();
    return this.uploadClaimFromRow(created);
  }

  async claimProcessingAbandonment(
    inputValue: z.input<typeof processingInputSchema>,
  ): Promise<ProcessingAbandonmentClaim> {
    const parsed = processingInputSchema.safeParse(inputValue);
    if (!parsed.success) invalidInput();
    const input = parsed.data;
    const payloadJson = JSON.stringify({
      photoId: input.photoId,
      versionId: input.versionId,
      expectedLeaseEpoch: input.expectedEpoch,
      confirmAbandon: true,
    });

    await this.assertCurrentOwner();
    const captured = await this.processingTarget(input);
    this.assertProcessingParentActive(captured.target);
    const existing = await this.existingClaim(input.requestId);
    if (existing) {
      this.assertProcessingClaimMatches(
        existing,
        captured.target,
        captured.thumbnailKey,
        captured.previewKey,
        input,
        payloadJson,
      );
      this.assertProcessingTargetStable(input, captured.target);
      await this.assertCurrentOwner();
      return this.processingClaimFromRow(existing);
    }

    this.assertProcessingTargetStable(input, captured.target);
    try {
      await this.db
        .prepare(
          `INSERT INTO owner_external_intents(
            actor_id,request_id,operation,session_id,workspace_id,project_id,album_id,
            upload_session_id,job_id,photo_id,version_id,expected_epoch,storage_node_id,
            original_object_key,thumbnail_key,preview_key,payload_json,created_at_ms
          ) VALUES(?,?,'processing.abandoned',?,?,?,?,NULL,?,?,?,?,?,NULL,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))`,
        )
        .bind(
          this.actorId,
          input.requestId,
          this.sessionId,
          captured.target.workspace_id,
          captured.target.project_id,
          captured.target.album_id,
          input.jobId,
          input.photoId,
          input.versionId,
          input.expectedEpoch,
          captured.target.storage_node_id,
          captured.thumbnailKey,
          captured.previewKey,
          payloadJson,
        )
        .run();
    } catch (error) {
      const current = await this.processingTarget(input);
      this.assertProcessingParentActive(current.target);
      const raced = await this.existingClaim(input.requestId);
      if (raced) {
        this.assertProcessingClaimMatches(
          raced,
          current.target,
          current.thumbnailKey,
          current.previewKey,
          input,
          payloadJson,
        );
        this.assertProcessingTargetStable(input, current.target);
        await this.assertCurrentOwner();
        return this.processingClaimFromRow(raced);
      }
      translate(error);
    }

    const current = await this.processingTarget(input);
    this.assertProcessingParentActive(current.target);
    this.assertProcessingTargetStable(input, current.target);
    const created = await this.existingClaim(input.requestId);
    if (!created) throw new WorkspaceFailure('PROCESSING_REVIEW_CONFLICT', 409);
    this.assertProcessingClaimMatches(
      created,
      current.target,
      current.thumbnailKey,
      current.previewKey,
      input,
      payloadJson,
    );
    await this.assertCurrentOwner();
    return this.processingClaimFromRow(created);
  }
}
