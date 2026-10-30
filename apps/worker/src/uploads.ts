import {
  readAlbumMatchingProfile,
  matchingRuleFilenameIndexInsert,
} from './matching-rule-filename-index';
import { D1AssistedCandidateCatalog } from './assisted-candidate-catalog';
import { D1IndexedVersionMatchCandidates } from './indexed-version-match-candidates';
import { matchingFilenameIndexInsert } from './matching-filename-index';
import { D1OwnerExternalIntentStore } from './owner-external-intents';
import { z } from 'zod';
import {
  uploadAuthorizeSchema,
  uploadCancelSchema,
  uploadCompleteSchema,
  uploadInitSchema,
  uploadSessionSchema,
  uploadRecoverySchema,
  type UploadSession,
} from '../../../packages/contracts/src/uploads';
import {
  versionUploadCapabilitiesSchema,
  versionUploadCompletionSchema,
  versionUploadInitResultSchema,
  versionUploadInitSchema,
  versionUploadRecoverySchema,
  versionUploadTargetSchema,
  type VersionUploadInit,
  type VersionUploadTarget,
} from '../../../packages/contracts/src/version-uploads';
import {
  resolvedUploadChoiceSchema,
  resolvedUploadPreviewRequestSchema,
  resolvedUploadPreviewResponseSchema,
  resolvedUploadReservationSchema,
  resolvedUploadReserveSchema,
} from '../../../packages/contracts/src/resolved-uploads';
import type { R2SignerCredentials } from './r2-presign';
import { presignR2Put } from './r2-presign';
import { R2StorageAdapter } from './r2-storage';
import { D1VersionMatchCandidates } from './version-match-candidates';
import {
  inspectImageHeader,
  type ImageDimensions,
} from '../../../packages/contracts/src/image-metadata';
import { WorkspaceFailure } from './workspaces';

const sessionSelect = `SELECT u.id,u.workspace_id AS workspaceId,u.project_id AS projectId,u.album_id AS albumId,u.original_filename AS originalFilename,u.expected_bytes AS expectedBytes,u.reserved_bytes AS reservedBytes,CASE WHEN c.upload_session_id IS NOT NULL OR vc.upload_session_id IS NOT NULL THEN 'completed' WHEN f.upload_session_id IS NOT NULL THEN 'needs_review' ELSE u.status END AS status,u.expires_at_ms AS expiresAtMs,u.created_at_ms AS createdAtMs,u.object_key,u.storage_node_id,p.content_type,p.sha256_hex,a.request_id AS authorization_request_id,a.signed_at_ms,a.expires_at_ms AS authorization_expires_at_ms FROM upload_sessions u LEFT JOIN upload_completions c ON c.upload_session_id=u.id LEFT JOIN upload_version_completions vc ON vc.upload_session_id=u.id LEFT JOIN upload_review_flags f ON f.upload_session_id=u.id`;
const versionRecoverySessionSelect = sessionSelect.replace(
  'SELECT u.id,',
  'SELECT t.photo_id,t.parent_version_id,t.expected_revision,t.change_type,t.change_note,t.labels_json,t.captured_versioning_mode,u.id,',
);

type VersionUploadOptions = {
  versionUploadsEnabled?: boolean;
  matchingUploadsEnabled?: boolean;
  indexedMatchingEnabled?: boolean;
  assistedCatalogEnabled?: boolean;
  matchingRulesEnabled?: boolean;
  catalogSecret?: string | undefined;
};

type CurrentAlbumScope = Readonly<{
  workspaceId: string;
  projectId: string;
  albumId: string;
}>;

type CurrentAlbumScopeRow = CurrentAlbumScope & {
  versioningMode: string;
  projectRevision: number;
  changeSequence: number;
};

type VersionTargetRow = {
  photo_id: string;
  parent_version_id: string;
  expected_revision: number;
  change_type: string;
  change_note: string;
  labels_json: string;
  captured_versioning_mode?: string;
  project_status?: string;
  album_state?: string;
  current_version_id?: string;
  current_revision?: number;
  workspace_id?: string;
  project_id?: string;
  album_id?: string;
};

type UploadDetails = {
  id: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  originalFilename: string;
  expectedBytes: number;
  status: UploadSession['status'];
  expiresAtMs: number;
  createdAtMs: number;
  objectKey: string;
  storageNodeId: string;
  contentType: string | null;
  sha256: string | null;
  authorizationRequestId: string | null;
  signedAtMs: number | null;
  authorizationExpiresAtMs: number | null;
};

function asSession(input: unknown): UploadSession {
  const row = input as Record<string, unknown>;
  const expiresAtMs = Number(row.expiresAtMs);
  const createdAtMs = Number(row.createdAtMs);
  return uploadSessionSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    albumId: row.albumId,
    originalFilename: row.originalFilename,
    expectedBytes: Number(row.expectedBytes),
    reservedBytes: Number(row.reservedBytes),
    status: row.status,
    expiresAt: new Date(expiresAtMs).toISOString(),
    createdAt: new Date(createdAtMs).toISOString(),
  });
}

function translate(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const codes = [
    'OWNER_REQUIRED',
    'REQUEST_ID_CONFLICT',
    'NOT_FOUND',
    'STORAGE_QUOTA_EXCEEDED',
    'UPLOAD_SESSION_EXPIRED',
    'UPLOADS_IN_PROGRESS',
    'INVALID_STATE_TRANSITION',
    'INVALID_INPUT',
    'INVALID_TIMESTAMP',
    'STORAGE_LEDGER_UNAVAILABLE',
    'UPLOAD_ALREADY_AUTHORIZED',
    'UPLOAD_AUTHORIZATION_EXPIRED',
    'UPLOAD_ALREADY_COMPLETED',
    'UPLOAD_NEEDS_REVIEW',
    'UPLOAD_VERIFICATION_MISMATCH',
    'PHOTO_VERSION_REVISION_CONFLICT',
    'RESOURCE_NOT_EDITABLE',
    'VERSIONING_MODE_DISABLED',
    'PHOTO_VERSION_NUMBER_EXHAUSTED',
    'VERSION_UPLOADS_DISABLED',
    'UPLOAD_VERSION_TARGET_UNAVAILABLE',
    'UPLOAD_VERSION_TARGET_MISMATCH',
    'RESOLUTION_STALE',
    'RESOLUTION_REVIEW_REQUIRED',
    'RESOLUTION_DUPLICATE',
    'RESOLUTION_UNAVAILABLE',
    'UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH',
  ];
  const code = codes.find((candidate) => message.includes(candidate));
  if (!code) throw error;
  const status =
    code === 'OWNER_REQUIRED'
      ? 403
      : code === 'NOT_FOUND'
        ? 404
        : code === 'STORAGE_LEDGER_UNAVAILABLE'
          ? 503
          : code === 'VERSION_UPLOADS_DISABLED' ||
              code === 'UPLOAD_VERSION_TARGET_UNAVAILABLE' ||
              code === 'RESOLUTION_UNAVAILABLE'
            ? 503
            : code === 'UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH'
              ? 422
              : code === 'INVALID_INPUT' || code === 'INVALID_TIMESTAMP'
                ? 400
                : 409;
  throw new WorkspaceFailure(code, status);
}

async function readCommandResult(
  db: D1Database,
  actorId: string,
  sessionId: string,
  requestId: string,
  operation: string,
  payloadJson: string,
): Promise<UploadSession> {
  const row = await db
    .prepare(
      "SELECT r.result_json FROM upload_requests r JOIN owners o ON o.user_id=r.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE r.actor_id=? AND r.request_id=? AND r.operation=? AND r.payload_json=?",
    )
    .bind(sessionId, actorId, requestId, operation, payloadJson)
    .first<{ result_json: string }>();
  if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  if (!row.result_json) throw new Error('UPLOAD_RESULT_UNAVAILABLE');
  return asSession(JSON.parse(row.result_json));
}

async function readExistingCommandResult(
  db: D1Database,
  actorId: string,
  sessionId: string,
  requestId: string,
  operation: string,
  payloadJson: string,
) {
  const row = await db
    .prepare(
      "SELECT r.result_json FROM upload_requests r JOIN owners o ON o.user_id=r.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE r.actor_id=? AND r.request_id=? AND r.operation=? AND r.payload_json=?",
    )
    .bind(sessionId, actorId, requestId, operation, payloadJson)
    .first<{ result_json: string }>();
  return row?.result_json ? asSession(JSON.parse(row.result_json)) : null;
}

export class D1UploadRepository {
  constructor(
    private db: D1Database,
    private actorId: string,
    private sessionId: string,
    private storage: R2StorageAdapter,
    private options: VersionUploadOptions = {},
  ) {}

  private async commitReservation(
    statement: D1PreparedStatement,
    uploadSessionId: string,
    filename: string,
  ) {
    if (this.options.indexedMatchingEnabled !== true) {
      await statement.run();
      return;
    }
    let results: D1Result<unknown>[];
    try {
      results = await this.db.batch([
        statement,
        matchingFilenameIndexInsert(
          this.db,
          this.actorId,
          this.sessionId,
          uploadSessionId,
          filename,
        ),
        ...(this.options.matchingRulesEnabled === true
          ? [
              matchingRuleFilenameIndexInsert(
                this.db,
                this.actorId,
                this.sessionId,
                uploadSessionId,
                filename,
              ),
            ]
          : []),
      ]);
    } catch (error) {
      // Preserve quota, authority, stale-snapshot and request-conflict failures.
      // An unknown derived-index failure must not leak SQL or masquerade as success.
      try {
        translate(error);
      } catch (failure) {
        if (failure instanceof WorkspaceFailure) throw failure;
        throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
      }
    }
    if (
      results.length !== (this.options.matchingRulesEnabled === true ? 3 : 2) ||
      results.some((result) => !result.success)
    )
      throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
  }

  private assistedCatalog() {
    return new D1AssistedCandidateCatalog(
      this.db,
      this.actorId,
      this.sessionId,
      this.options.catalogSecret,
      this.options.assistedCatalogEnabled === true,
    );
  }

  private versionUploadsEnabled() {
    return this.options.versionUploadsEnabled === true;
  }

  private requireVersionUploadsEnabled() {
    if (!this.versionUploadsEnabled())
      throw new WorkspaceFailure('VERSION_UPLOADS_DISABLED', 503);
  }

  private matchingUploadsEnabled() {
    return (
      this.options.matchingUploadsEnabled === true &&
      this.versionUploadsEnabled()
    );
  }

  private requireMatchingUploadsEnabled() {
    if (!this.matchingUploadsEnabled())
      throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
  }

  private async currentAlbumScope(
    albumId: string,
  ): Promise<CurrentAlbumScopeRow> {
    const row = await this.db
      .prepare(
        `SELECT a.workspace_id AS workspaceId,a.project_id AS projectId,a.id AS albumId,
          p.versioning_mode AS versioningMode,p.revision AS projectRevision,
          COALESCE((SELECT MAX(m.sequence) FROM album_matching_changes m
            WHERE m.album_id=a.id AND m.project_id=a.project_id
              AND m.workspace_id=a.workspace_id),0) AS changeSequence
        FROM albums a
        JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
        JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?
          AND s.expiresAt>unixepoch('subsec')*1000
        WHERE a.id=? AND a.state NOT IN('archived','deleting','deleted')
          AND p.status NOT IN('archived','deleting','deleted')`,
      )
      .bind(this.actorId, this.sessionId, albumId)
      .first<CurrentAlbumScopeRow>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return {
      ...row,
      projectRevision: Number(row.projectRevision),
      changeSequence: Number(row.changeSequence),
    };
  }

  private async resolveCandidates(
    albumId: string,
    file: {
      originalFilename: string;
      sha256: string;
      dimensions: { width: number; height: number };
    },
    selectedPhotoId?: string,
  ) {
    try {
      const policy = await readAlbumMatchingProfile(
        this.db,
        this.actorId,
        this.sessionId,
        albumId,
      );
      if (
        this.options.matchingRulesEnabled !== true &&
        policy.profile !== 'default-v1'
      )
        throw new WorkspaceFailure('MATCHING_RULES_UNAVAILABLE', 503);
      const assertPolicy = (snapshot: {
        projectRevision: number;
        scope: { workspaceId: string; projectId: string; albumId: string };
      }) => {
        if (
          snapshot.projectRevision !== policy.projectRevision ||
          snapshot.scope.workspaceId !== policy.workspaceId ||
          snapshot.scope.projectId !== policy.projectId ||
          snapshot.scope.albumId !== policy.albumId
        )
          throw new WorkspaceFailure('RESOLUTION_STALE', 409);
      };
      if (this.options.indexedMatchingEnabled === true) {
        const indexed = await new D1IndexedVersionMatchCandidates(
          this.db,
          this.actorId,
          this.sessionId,
          this.options.matchingRulesEnabled === true ? policy : undefined,
        ).resolve(albumId, {
          filename: file.originalFilename,
          sha256: file.sha256,
          dimensions: file.dimensions,
        });
        assertPolicy(indexed.snapshot);
        // Mode is read in the indexed snapshot itself. Preserve the complete
        // existing Assisted picker whenever that snapshot is not automatic.
        if (indexed.snapshot.mode === 'auto_filename') return indexed;
        if (
          indexed.snapshot.mode === 'assisted' &&
          this.options.assistedCatalogEnabled === true
        ) {
          const permitted =
            indexed.decision.outcome === 'new_photo' ||
            indexed.decision.outcome === 'new_version' ||
            (indexed.decision.outcome === 'requires_review' &&
              [
                'ambiguous_filename_match',
                'missing_dimension_evidence',
                'dimension_change_requires_review',
                'assisted_choice_required',
              ].includes(indexed.decision.reason));
          if (
            selectedPhotoId &&
            !indexed.snapshot.candidatesTruncated &&
            permitted
          ) {
            const chosen = await this.assistedCatalog().authorizeHead(
              indexed.snapshot,
              selectedPhotoId,
            );
            return {
              ...indexed,
              snapshot: {
                ...indexed.snapshot,
                candidates: [
                  ...indexed.snapshot.candidates.filter(
                    (candidate) => candidate.photoId !== selectedPhotoId,
                  ),
                  chosen.candidate,
                ],
                heads: {
                  ...indexed.snapshot.heads,
                  [selectedPhotoId]: chosen.head,
                },
              },
            };
          }
          return indexed;
        }
      }
      const legacy = await new D1VersionMatchCandidates(
        this.db,
        this.actorId,
        this.sessionId,
      ).resolve(albumId, {
        filename: file.originalFilename,
        sha256: file.sha256,
        dimensions: file.dimensions,
      });
      assertPolicy(legacy.snapshot);
      return legacy;
    } catch (error) {
      if (
        error instanceof WorkspaceFailure &&
        error.code === 'VERSION_MATCHING_UNAVAILABLE'
      )
        throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
      throw error;
    }
  }

  private assertResolvedChoice(
    snapshot: Awaited<ReturnType<D1VersionMatchCandidates['read']>>,
    decision: Awaited<
      ReturnType<D1VersionMatchCandidates['resolve']>
    >['decision'],
    choice: ReturnType<typeof resolvedUploadReserveSchema.parse>['choice'],
  ) {
    if (snapshot.mode === 'off' || snapshot.mode === 'manual')
      throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);
    if (snapshot.candidatesTruncated)
      throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);
    if (decision.outcome === 'duplicate')
      throw new WorkspaceFailure('RESOLUTION_DUPLICATE', 409);
    if (
      decision.outcome === 'requires_review' &&
      ![
        'ambiguous_filename_match',
        'missing_dimension_evidence',
        'dimension_change_requires_review',
        'assisted_choice_required',
      ].includes(decision.reason)
    )
      throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);

    const selectedHead =
      choice.kind === 'new_version' ? snapshot.heads[choice.photoId] : null;
    const selectedHeadIsAuthorized =
      choice.kind === 'new_version' &&
      selectedHead?.versionId !== null &&
      selectedHead?.versionId !== undefined &&
      selectedHead.revision !== null &&
      selectedHead.revision !== undefined &&
      snapshot.candidates.some(
        (candidate) =>
          candidate.photoId === choice.photoId &&
          candidate.versionId === selectedHead.versionId,
      ) &&
      choice.parentVersionId === selectedHead.versionId &&
      choice.expectedRevision === selectedHead.revision;

    if (snapshot.mode === 'auto_filename') {
      if (choice.kind === 'new_photo' && decision.outcome === 'new_photo')
        return;
      if (
        choice.kind === 'new_version' &&
        decision.outcome === 'new_version' &&
        decision.photoId === choice.photoId &&
        selectedHeadIsAuthorized
      )
        return;
      throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);
    }

    if (snapshot.mode !== 'assisted')
      throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);
    if (choice.kind === 'new_photo' || selectedHeadIsAuthorized) return;
    throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);
  }

  private async readResolvedReservationResult(
    requestId: string,
    payloadJson: string,
    scope: CurrentAlbumScope,
  ) {
    const row = await this.db
      .prepare(
        `SELECT r.result_json,t.photo_id,t.parent_version_id,t.expected_revision,
          t.captured_versioning_mode,t.change_type
        FROM upload_requests r
        JOIN upload_sessions u ON u.id=r.upload_session_id
          AND u.actor_id=r.actor_id AND u.workspace_id=r.workspace_id
          AND u.project_id=r.project_id AND u.album_id=r.album_id
        JOIN workspaces w ON w.id=r.workspace_id AND w.owner_user_id=?
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?
          AND s.expiresAt>unixepoch('subsec')*1000
        JOIN projects pr ON pr.id=r.project_id AND pr.workspace_id=r.workspace_id
        JOIN albums al ON al.id=r.album_id AND al.project_id=r.project_id
          AND al.workspace_id=r.workspace_id
        LEFT JOIN upload_version_targets t ON t.upload_session_id=u.id
          AND t.actor_id=r.actor_id AND t.request_id=r.request_id
          AND t.session_id=r.session_id
        WHERE r.actor_id=? AND r.request_id=? AND r.operation='upload.reserved'
          AND r.payload_json=? AND r.workspace_id=? AND r.project_id=? AND r.album_id=?
          AND pr.status NOT IN('archived','deleting','deleted')
          AND al.state NOT IN('archived','deleting','deleted')`,
      )
      .bind(
        this.actorId,
        this.sessionId,
        this.actorId,
        requestId,
        payloadJson,
        scope.workspaceId,
        scope.projectId,
        scope.albumId,
      )
      .first<{
        result_json: string | null;
        photo_id: string | null;
        parent_version_id: string | null;
        expected_revision: number | null;
        captured_versioning_mode: string | null;
        change_type: string | null;
      }>();
    if (!row?.result_json)
      throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
    let canonicalPayload: unknown;
    try {
      canonicalPayload = JSON.parse(payloadJson) as unknown;
    } catch {
      throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
    }
    const canonical = z
      .object({
        resolution: z
          .object({
            expectedMode: z.enum(['auto_filename', 'assisted']),
            choice: resolvedUploadChoiceSchema,
          })
          .passthrough(),
      })
      .passthrough()
      .safeParse(canonicalPayload);
    if (!canonical.success)
      throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);

    let target: unknown;
    if (canonical.data.resolution.choice.kind === 'new_photo') {
      if (row.photo_id !== null)
        throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
      target = { kind: 'new_photo' };
    } else {
      const choice = canonical.data.resolution.choice;
      if (
        row.photo_id !== choice.photoId ||
        row.parent_version_id !== choice.parentVersionId ||
        row.expected_revision === null ||
        Number(row.expected_revision) !== choice.expectedRevision ||
        row.captured_versioning_mode !==
          canonical.data.resolution.expectedMode ||
        row.change_type !== 'new_retouch'
      )
        throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
      target = {
        kind: 'new_version',
        photoId: row.photo_id,
        parentVersionId: row.parent_version_id,
        expectedRevision: Number(row.expected_revision),
        capturedVersioningMode: row.captured_versioning_mode,
        changeType: 'new_retouch',
      };
    }
    return resolvedUploadReservationSchema.parse({
      uploadSession: asSession(JSON.parse(row.result_json) as unknown),
      target,
    });
  }

  private async readExistingResolvedReservation(
    requestId: string,
    payloadJson: string,
    scope: CurrentAlbumScope,
  ) {
    const existing = await this.db
      .prepare(
        'SELECT operation,payload_json,upload_session_id FROM upload_requests WHERE actor_id=? AND request_id=?',
      )
      .bind(this.actorId, requestId)
      .first<{
        operation: string;
        payload_json: string;
        upload_session_id: string | null;
      }>();
    if (!existing) return null;
    if (
      existing.operation !== 'upload.reserved' ||
      existing.payload_json !== payloadJson ||
      !existing.upload_session_id
    )
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    return this.readResolvedReservationResult(requestId, payloadJson, scope);
  }

  private async assertResolvedDimensions(
    uploadSessionId: string,
    requestId: string,
    actual: ImageDimensions,
  ) {
    const row = await this.db
      .prepare(
        `SELECT json_type(r.payload_json,'$.resolution') AS resolution_type,
          json_extract(r.payload_json,'$.resolution.dimensions.width') AS width,
          json_extract(r.payload_json,'$.resolution.dimensions.height') AS height
        FROM upload_requests r
        JOIN owners o ON o.user_id=r.actor_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?
          AND s.expiresAt>unixepoch('subsec')*1000
        WHERE r.actor_id=? AND r.upload_session_id=?
          AND r.operation='upload.reserved'`,
      )
      .bind(this.sessionId, this.actorId, uploadSessionId)
      .first<{
        resolution_type: string | null;
        width: number | null;
        height: number | null;
      }>();
    if (!row || row.resolution_type === null) return;
    const expected = z
      .object({
        width: z.number().int().positive().safe(),
        height: z.number().int().positive().safe(),
      })
      .strict()
      .safeParse({ width: row.width, height: row.height });
    if (row.resolution_type !== 'object' || !expected.success)
      throw new WorkspaceFailure('RESOLUTION_UNAVAILABLE', 503);
    if (
      expected.data.width === actual.width &&
      expected.data.height === actual.height
    )
      return;

    await this.db
      .prepare(
        'INSERT OR IGNORE INTO upload_review_flags(upload_session_id,actor_id,session_id,reason_code,occurred_at_ms,request_id) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        uploadSessionId,
        this.actorId,
        this.sessionId,
        'UPLOAD_METADATA_MISMATCH',
        Date.now(),
        requestId,
      )
      .run();
    throw new WorkspaceFailure('UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH', 422);
  }

  private targetFromRow(row: VersionTargetRow): VersionUploadTarget {
    let labels: unknown;
    try {
      labels = JSON.parse(row.labels_json) as unknown;
    } catch {
      throw new WorkspaceFailure('UPLOAD_VERSION_TARGET_UNAVAILABLE', 503);
    }
    return versionUploadTargetSchema.parse({
      photoId: row.photo_id,
      parentVersionId: row.parent_version_id,
      expectedRevision: Number(row.expected_revision),
      changeType: row.change_type,
      changeNote: row.change_note,
      labels,
    });
  }

  private async readVersionReservationResult(
    requestId: string,
    payloadJson: string,
    photoId: string,
  ) {
    const row = await this.db
      .prepare(
        "SELECT r.result_json,t.photo_id,t.parent_version_id,t.expected_revision,\n          t.change_type,t.change_note,t.labels_json,t.captured_versioning_mode\n        FROM upload_requests r\n        JOIN upload_version_targets t ON t.upload_session_id=r.upload_session_id\n          AND t.actor_id=r.actor_id AND t.request_id=r.request_id\n          AND t.session_id=r.session_id\n        JOIN upload_sessions u ON u.id=t.upload_session_id\n          AND u.actor_id=t.actor_id AND u.workspace_id=t.workspace_id\n          AND u.project_id=t.project_id AND u.album_id=t.album_id\n        JOIN photos ph ON ph.id=t.photo_id AND ph.workspace_id=t.workspace_id\n          AND ph.project_id=t.project_id AND ph.album_id=t.album_id\n        JOIN photo_versions parent_version ON parent_version.id=t.parent_version_id\n          AND parent_version.workspace_id=t.workspace_id\n          AND parent_version.photo_id=t.photo_id\n        JOIN workspaces w ON w.id=t.workspace_id AND w.owner_user_id=?\n        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1\n        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?\n          AND s.expiresAt>unixepoch('subsec')*1000\n        JOIN projects pr ON pr.id=t.project_id AND pr.workspace_id=t.workspace_id\n        JOIN albums al ON al.id=t.album_id AND al.project_id=t.project_id\n          AND al.workspace_id=t.workspace_id\n        WHERE r.actor_id=? AND r.request_id=? AND r.operation='upload.reserved'\n          AND r.payload_json=? AND r.result_json IS NOT NULL\n          AND t.photo_id=? AND t.actor_id=? AND u.actor_id=?\n          AND pr.status NOT IN('archived','deleting','deleted')\n          AND al.state NOT IN('archived','deleting','deleted')",
      )
      .bind(
        this.actorId,
        this.sessionId,
        this.actorId,
        requestId,
        payloadJson,
        photoId,
        this.actorId,
        this.actorId,
      )
      .first<
        Record<string, unknown> & VersionTargetRow & { result_json: string }
      >();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);

    return versionUploadInitResultSchema.parse({
      uploadSession: asSession(JSON.parse(row.result_json)),
      target: this.targetFromRow(row),
    });
  }

  private async readVersionCompletionResult(
    uploadSessionId: string,
    requestId: string,
    payloadJson: string,
  ) {
    const row = await this.db
      .prepare(
        "SELECT vc.result_json\n        FROM upload_version_completions vc\n        JOIN upload_workflow_requests r ON r.actor_id=vc.actor_id\n          AND r.request_id=vc.request_id AND r.operation='upload.completed'\n          AND r.upload_session_id=vc.upload_session_id\n          AND r.payload_json=? AND r.result_json=vc.result_json\n        JOIN upload_version_targets t ON t.upload_session_id=vc.upload_session_id\n          AND t.actor_id=vc.actor_id AND t.photo_id=vc.photo_id\n          AND t.parent_version_id=vc.parent_version_id\n          AND t.change_type=vc.change_type AND t.change_note=vc.change_note\n          AND json(t.labels_json)=json(vc.labels_json)\n        JOIN upload_sessions u ON u.id=vc.upload_session_id\n          AND u.actor_id=vc.actor_id AND u.workspace_id=vc.workspace_id\n          AND u.project_id=vc.project_id AND u.album_id=vc.album_id\n        JOIN photos ph ON ph.id=t.photo_id AND ph.workspace_id=t.workspace_id\n          AND ph.project_id=t.project_id AND ph.album_id=t.album_id\n        JOIN photo_versions parent_version ON parent_version.id=t.parent_version_id\n          AND parent_version.workspace_id=t.workspace_id\n          AND parent_version.photo_id=t.photo_id\n        JOIN workspaces w ON w.id=t.workspace_id AND w.owner_user_id=?\n        JOIN owners o ON o.user_id=vc.actor_id AND o.enabled=1\n        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?\n          AND s.expiresAt>unixepoch('subsec')*1000\n        JOIN projects pr ON pr.id=t.project_id AND pr.workspace_id=t.workspace_id\n        JOIN albums al ON al.id=t.album_id AND al.project_id=t.project_id\n          AND al.workspace_id=t.workspace_id\n        WHERE vc.upload_session_id=? AND vc.actor_id=? AND vc.request_id=?\n          AND pr.status NOT IN('archived','deleting','deleted')\n          AND al.state NOT IN('archived','deleting','deleted')",
      )
      .bind(
        payloadJson,
        this.actorId,
        this.sessionId,
        uploadSessionId,
        this.actorId,
        requestId,
      )
      .first<{ result_json: string }>();
    if (!row?.result_json) return null;

    try {
      return versionUploadCompletionSchema.parse(
        JSON.parse(row.result_json) as unknown,
      );
    } catch {
      throw new WorkspaceFailure('UPLOAD_VERSION_TARGET_UNAVAILABLE', 503);
    }
  }
  /** Load a version target only after rechecking this Owner session and live photo parents. */
  private async currentVersionTargetScope(uploadSessionId: string) {
    const row = await this.db
      .prepare(
        `SELECT t.photo_id,t.parent_version_id,t.expected_revision,t.change_type,t.change_note,t.labels_json,t.captured_versioning_mode,
          p.workspace_id,p.project_id,p.album_id,pr.status AS project_status,al.state AS album_state
        FROM upload_version_targets t
        JOIN upload_sessions u ON u.id=t.upload_session_id AND u.actor_id=t.actor_id
        JOIN photos p ON p.id=t.photo_id AND p.workspace_id=t.workspace_id AND p.project_id=t.project_id AND p.album_id=t.album_id
        JOIN photo_versions parent_version ON parent_version.id=t.parent_version_id AND parent_version.workspace_id=t.workspace_id AND parent_version.photo_id=t.photo_id
        JOIN workspaces w ON w.id=t.workspace_id AND w.owner_user_id=?
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
        JOIN projects pr ON pr.id=t.project_id AND pr.workspace_id=t.workspace_id
        JOIN albums al ON al.id=t.album_id AND al.workspace_id=t.workspace_id AND al.project_id=t.project_id
        WHERE t.upload_session_id=? AND t.actor_id=?`,
      )
      .bind(this.actorId, this.sessionId, uploadSessionId, this.actorId)
      .first<VersionTargetRow>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (
      ['archived', 'deleting', 'deleted'].includes(row.project_status ?? '') ||
      ['archived', 'deleting', 'deleted'].includes(row.album_state ?? '')
    )
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    return row;
  }

  private async currentPhotoScope(photoId: string) {
    const row = await this.db
      .prepare(
        `SELECT p.workspace_id,p.project_id,p.album_id,h.version_id AS current_version_id,
          h.revision AS current_revision,pr.versioning_mode,pr.status AS project_status,al.state AS album_state
        FROM photos p
        JOIN photo_version_heads h ON h.photo_id=p.id AND h.workspace_id=p.workspace_id AND h.project_id=p.project_id AND h.album_id=p.album_id
        JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
        JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id
        JOIN albums al ON al.id=p.album_id AND al.workspace_id=p.workspace_id AND al.project_id=p.project_id
        WHERE p.id=?`,
      )
      .bind(this.actorId, this.sessionId, photoId)
      .first<{
        workspace_id: string;
        project_id: string;
        album_id: string;
        current_version_id: string;
        current_revision: number;
        versioning_mode: string;
        project_status: string;
        album_state: string;
      }>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (
      ['archived', 'deleting', 'deleted'].includes(row.project_status) ||
      ['archived', 'deleting', 'deleted'].includes(row.album_state)
    )
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    return row;
  }

  private async hasVersionTarget(uploadSessionId: string) {
    return Boolean(
      await this.db
        .prepare(
          `SELECT 1 AS found FROM upload_version_targets t
          JOIN upload_sessions u ON u.id=t.upload_session_id AND u.actor_id=t.actor_id
          JOIN owners o ON o.user_id=u.actor_id AND o.enabled=1
          JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
          WHERE t.upload_session_id=? AND t.actor_id=?`,
        )
        .bind(this.sessionId, uploadSessionId, this.actorId)
        .first(),
    );
  }

  async completeVersionForPhoto(
    photoIdInput: string,
    uploadSessionIdInput: string,
    input: unknown,
  ) {
    this.requireVersionUploadsEnabled();
    const photoId = z.uuid().parse(photoIdInput);
    const uploadSessionId = z.uuid().parse(uploadSessionIdInput);
    const target = await this.currentVersionTargetScope(uploadSessionId);
    if (target.photo_id !== photoId)
      throw new WorkspaceFailure('NOT_FOUND', 404);
    return this.complete(uploadSessionId, input);
  }

  versionUploadCapabilities() {
    return versionUploadCapabilitiesSchema.parse({
      enabled: this.versionUploadsEnabled(),
    });
  }

  resolvedUploadCapabilities() {
    return { enabled: this.matchingUploadsEnabled() };
  }

  async previewResolved(albumIdInput: string, input: unknown) {
    this.requireMatchingUploadsEnabled();
    const albumId = z.uuid().parse(albumIdInput);
    const value = resolvedUploadPreviewRequestSchema.parse(input);
    const { snapshot, decision } = await this.resolveCandidates(
      albumId,
      value.file,
    );
    const candidates = new Map<
      string,
      {
        photoId: string;
        filename: string;
        currentVersionId: string | null;
        revision: number | null;
      }
    >();
    for (const candidate of snapshot.candidates) {
      const head = snapshot.heads[candidate.photoId];
      const currentVersionId = head?.versionId ?? null;
      const previous = candidates.get(candidate.photoId);
      if (previous === undefined || candidate.versionId === currentVersionId) {
        candidates.set(candidate.photoId, {
          photoId: candidate.photoId,
          filename: candidate.filename,
          currentVersionId,
          revision: head?.revision ?? null,
        });
      }
    }
    return resolvedUploadPreviewResponseSchema.parse({
      workspaceId: snapshot.scope.workspaceId,
      projectId: snapshot.scope.projectId,
      albumId: snapshot.scope.albumId,
      mode: snapshot.mode,
      projectRevision: snapshot.projectRevision,
      changeSequence: snapshot.changeSequence,
      decision,
      candidatesTruncated: snapshot.candidatesTruncated,
      candidates: [...candidates.values()],
      ...(snapshot.matchingProfile
        ? { matchingProfile: snapshot.matchingProfile }
        : {}),
      ...(this.options.assistedCatalogEnabled === true &&
      snapshot.mode === 'assisted' &&
      !snapshot.candidatesTruncated &&
      decision.outcome !== 'duplicate'
        ? { catalogCursor: await this.assistedCatalog().start(snapshot) }
        : {}),
    });
  }

  async reserveResolved(albumIdInput: string, input: unknown) {
    this.requireMatchingUploadsEnabled();
    const albumId = z.uuid().parse(albumIdInput);
    const value = resolvedUploadReserveSchema.parse(input);
    const initialScope = await this.currentAlbumScope(albumId);
    const payload: Record<string, unknown> = {
      workspaceId: initialScope.workspaceId,
      projectId: initialScope.projectId,
      albumId: initialScope.albumId,
      originalFilename: value.file.originalFilename,
      expectedBytes: value.file.expectedBytes,
      contentType: value.file.contentType,
      sha256: value.file.sha256,
      ...(value.choice.kind === 'new_version'
        ? {
            versionTarget: {
              photoId: value.choice.photoId,
              parentVersionId: value.choice.parentVersionId,
              expectedRevision: value.choice.expectedRevision,
              changeType: 'new_retouch',
              changeNote: '',
              labels: [],
              confirm: true,
            },
          }
        : {}),
      resolution: {
        expectedChangeSequence: value.expectedChangeSequence,
        expectedProjectRevision: value.expectedProjectRevision,
        expectedMode: value.expectedMode,
        choice: value.choice,
        dimensions: value.file.dimensions,
        confirm: true,
        ...(value.matchingProfile
          ? { matchingProfile: value.matchingProfile }
          : {}),
      },
    };
    const payloadJson = JSON.stringify(payload);
    const existing = await this.readExistingResolvedReservation(
      value.requestId,
      payloadJson,
      initialScope,
    );
    if (existing) return existing;

    const { snapshot, decision } = await this.resolveCandidates(
      albumId,
      value.file,
      value.choice.kind === 'new_version' ? value.choice.photoId : undefined,
    );
    if (
      snapshot.scope.workspaceId !== initialScope.workspaceId ||
      snapshot.scope.projectId !== initialScope.projectId ||
      snapshot.scope.albumId !== initialScope.albumId
    )
      throw new WorkspaceFailure('RESOLUTION_STALE', 409);
    if (
      snapshot.changeSequence !== value.expectedChangeSequence ||
      snapshot.projectRevision !== value.expectedProjectRevision ||
      snapshot.mode !== value.expectedMode
    )
      throw new WorkspaceFailure('RESOLUTION_STALE', 409);
    if (value.matchingProfile) {
      if (
        !snapshot.matchingProfile ||
        value.matchingProfile.profile !== snapshot.matchingProfile.profile ||
        value.matchingProfile.ruleRevision !==
          snapshot.matchingProfile.ruleRevision
      )
        throw new WorkspaceFailure('RESOLUTION_STALE', 409);
    } else if (
      snapshot.matchingProfile &&
      snapshot.matchingProfile.profile !== 'default-v1'
    ) {
      throw new WorkspaceFailure('RESOLUTION_STALE', 409);
    }
    this.assertResolvedChoice(snapshot, decision, value.choice);

    await expireDueReservations(this.db);
    const uploadSessionId = crypto.randomUUID();
    const objectKey = `${initialScope.workspaceId}/${initialScope.projectId}/${initialScope.albumId}/${uploadSessionId}/original`;
    try {
      const statement = this.db
        .prepare(
          'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          this.actorId,
          value.requestId,
          'upload.reserved',
          payloadJson,
          this.sessionId,
          uploadSessionId,
          initialScope.workspaceId,
          initialScope.projectId,
          initialScope.albumId,
          'primary',
          objectKey,
          value.file.originalFilename,
          value.file.expectedBytes,
          Date.now(),
        );
      await this.commitReservation(
        statement,
        uploadSessionId,
        value.file.originalFilename,
      );
    } catch (error) {
      const retryScope = await this.currentAlbumScope(albumId);
      const raced = await this.readExistingResolvedReservation(
        value.requestId,
        payloadJson,
        retryScope,
      );
      if (raced) return raced;
      translate(error);
    }

    const currentScope = await this.currentAlbumScope(albumId);
    return this.readResolvedReservationResult(
      value.requestId,
      payloadJson,
      currentScope,
    );
  }

  private async details(uploadSessionId: string): Promise<UploadDetails> {
    const row = await this.db
      .prepare(
        `${sessionSelect} JOIN owners o ON o.user_id=u.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 LEFT JOIN upload_specs p ON p.upload_session_id=u.id LEFT JOIN upload_authorizations a ON a.upload_session_id=u.id WHERE u.id=? AND u.actor_id=?`,
      )
      .bind(this.sessionId, uploadSessionId, this.actorId)
      .first<Record<string, unknown>>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      projectId: String(row.projectId),
      albumId: String(row.albumId),
      originalFilename: String(row.originalFilename),
      expectedBytes: Number(row.expectedBytes),
      status: String(row.status) as UploadSession['status'],
      expiresAtMs: Number(row.expiresAtMs),
      createdAtMs: Number(row.createdAtMs),
      objectKey: String(row.object_key),
      storageNodeId: String(row.storage_node_id),
      contentType: row.content_type ? String(row.content_type) : null,
      sha256: row.sha256_hex ? String(row.sha256_hex) : null,
      authorizationRequestId: row.authorization_request_id
        ? String(row.authorization_request_id)
        : null,
      signedAtMs:
        row.signed_at_ms === null || row.signed_at_ms === undefined
          ? null
          : Number(row.signed_at_ms),
      authorizationExpiresAtMs:
        row.authorization_expires_at_ms === null ||
        row.authorization_expires_at_ms === undefined
          ? null
          : Number(row.authorization_expires_at_ms),
    };
  }

  async reserve(input: unknown): Promise<UploadSession> {
    const value = uploadInitSchema.parse(input);
    await expireDueReservations(this.db);
    const payload = {
      workspaceId: value.workspaceId,
      projectId: value.projectId,
      albumId: value.albumId,
      originalFilename: value.originalFilename,
      expectedBytes: value.expectedBytes,
      contentType: value.contentType,
      sha256: value.sha256,
    };
    const payloadJson = JSON.stringify(payload);
    const uploadSessionId = crypto.randomUUID();
    const objectKey = `${value.workspaceId}/${value.projectId}/${value.albumId}/${uploadSessionId}/original`;
    try {
      const statement = this.db
        .prepare(
          'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          this.actorId,
          value.requestId,
          'upload.reserved',
          payloadJson,
          this.sessionId,
          uploadSessionId,
          value.workspaceId,
          value.projectId,
          value.albumId,
          'primary',
          objectKey,
          value.originalFilename,
          value.expectedBytes,
          Date.now(),
        );
      await this.commitReservation(
        statement,
        uploadSessionId,
        value.originalFilename,
      );
    } catch (error) {
      translate(error);
    }
    return readCommandResult(
      this.db,
      this.actorId,
      this.sessionId,
      value.requestId,
      'upload.reserved',
      payloadJson,
    );
  }

  /** Explicit, route-scoped manual-version reservation. Photo scope is derived from D1. */
  async reserveVersion(photoIdInput: string, input: unknown) {
    this.requireVersionUploadsEnabled();
    const photoId = z.uuid().parse(photoIdInput);
    const value: VersionUploadInit = versionUploadInitSchema.parse(input);
    const scope = await this.currentPhotoScope(photoId);
    const payload = {
      workspaceId: scope.workspace_id,
      projectId: scope.project_id,
      albumId: scope.album_id,
      originalFilename: value.originalFilename,
      expectedBytes: value.expectedBytes,
      contentType: value.contentType,
      sha256: value.sha256,
      versionTarget: {
        photoId,
        parentVersionId: value.expectedCurrentVersionId,
        expectedRevision: value.expectedRevision,
        changeType: value.changeType,
        changeNote: value.changeNote,
        labels: value.labels,
        confirm: true,
      },
    };
    const payloadJson = JSON.stringify(payload);

    // Return an exact prior reservation only after current Owner/session/photo scope succeeds.
    const existing = await this.db
      .prepare(
        'SELECT operation,payload_json,upload_session_id FROM upload_requests WHERE actor_id=? AND request_id=?',
      )
      .bind(this.actorId, value.requestId)
      .first<{
        operation: string;
        payload_json: string;
        upload_session_id: string | null;
      }>();
    if (existing) {
      if (
        existing.operation !== 'upload.reserved' ||
        existing.payload_json !== payloadJson ||
        !existing.upload_session_id
      )
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      return this.readVersionReservationResult(
        value.requestId,
        payloadJson,
        photoId,
      );
    }

    if (
      scope.current_version_id !== value.expectedCurrentVersionId ||
      Number(scope.current_revision) !== value.expectedRevision
    )
      throw new WorkspaceFailure('PHOTO_VERSION_REVISION_CONFLICT', 409);
    if (
      scope.versioning_mode === 'off' &&
      value.changeType !== 'replace_current'
    )
      throw new WorkspaceFailure('VERSIONING_MODE_DISABLED', 409);

    await expireDueReservations(this.db);
    const uploadSessionId = crypto.randomUUID();
    const objectKey = `${scope.workspace_id}/${scope.project_id}/${scope.album_id}/${uploadSessionId}/original`;
    try {
      const statement = this.db
        .prepare(
          'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          this.actorId,
          value.requestId,
          'upload.reserved',
          payloadJson,
          this.sessionId,
          uploadSessionId,
          scope.workspace_id,
          scope.project_id,
          scope.album_id,
          'primary',
          objectKey,
          value.originalFilename,
          value.expectedBytes,
          Date.now(),
        );
      await this.commitReservation(
        statement,
        uploadSessionId,
        value.originalFilename,
      );
    } catch (error) {
      translate(error);
    }

    return this.readVersionReservationResult(
      value.requestId,
      payloadJson,
      photoId,
    );
  }

  async get(uploadSessionId: string): Promise<UploadSession> {
    await expireDueReservations(this.db);
    const row = await this.db
      .prepare(
        `${sessionSelect} JOIN owners o ON o.user_id=u.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 LEFT JOIN upload_specs p ON p.upload_session_id=u.id LEFT JOIN upload_authorizations a ON a.upload_session_id=u.id WHERE u.id=? AND u.actor_id=?`,
      )
      .bind(this.sessionId, uploadSessionId, this.actorId)
      .first();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return asSession(row);
  }

  /** Read-only recovery by the original intent, including a lost init response. No URL/key/session secret. */
  async recovery(initRequestId: string) {
    const row = await this.db
      .prepare(
        `${sessionSelect}
      JOIN upload_requests r ON r.upload_session_id=u.id AND r.operation='upload.reserved'
      JOIN owners o ON o.user_id=u.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      LEFT JOIN upload_specs p ON p.upload_session_id=u.id LEFT JOIN upload_authorizations a ON a.upload_session_id=u.id
      WHERE r.request_id=? AND r.actor_id=? AND u.actor_id=?
        AND NOT EXISTS(SELECT 1 FROM upload_version_targets vt WHERE vt.upload_session_id=u.id)`,
      )
      .bind(this.sessionId, initRequestId, this.actorId, this.actorId)
      .first<Record<string, unknown>>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return uploadRecoverySchema.parse({
      initRequestId,
      uploadSession: asSession(row),
      contentType: row.content_type ?? null,
      sha256: row.sha256_hex ?? null,
      authorizationRequestId: row.authorization_request_id ?? null,
      authorizationExpiresAt:
        row.authorization_expires_at_ms == null
          ? null
          : new Date(Number(row.authorization_expires_at_ms)).toISOString(),
    });
  }

  /** Version recovery requires current Owner/session/photo scope before returning the stored target. */
  async recoveryVersion(photoIdInput: string, initRequestIdInput: string) {
    this.requireVersionUploadsEnabled();
    const photoId = z.uuid().parse(photoIdInput);
    const initRequestId = z.uuid().parse(initRequestIdInput);
    const row = await this.db
      .prepare(
        `${versionRecoverySessionSelect}
        JOIN upload_requests r ON r.upload_session_id=u.id AND r.operation='upload.reserved'
        JOIN upload_version_targets t ON t.upload_session_id=u.id
        JOIN workspaces w ON w.id=t.workspace_id AND w.owner_user_id=?
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
        JOIN photos ph ON ph.id=t.photo_id AND ph.workspace_id=t.workspace_id AND ph.project_id=t.project_id AND ph.album_id=t.album_id
        JOIN photo_versions parent_version ON parent_version.id=t.parent_version_id AND parent_version.workspace_id=t.workspace_id AND parent_version.photo_id=t.photo_id
        JOIN projects pr ON pr.id=t.project_id AND pr.workspace_id=t.workspace_id
        JOIN albums al ON al.id=t.album_id AND al.workspace_id=t.workspace_id AND al.project_id=t.project_id
        LEFT JOIN upload_specs p ON p.upload_session_id=u.id
        LEFT JOIN upload_authorizations a ON a.upload_session_id=u.id
        WHERE t.photo_id=? AND t.actor_id=?
          AND r.request_id=? AND r.actor_id=? AND u.actor_id=?
          AND pr.status NOT IN('archived','deleting','deleted')
          AND al.state NOT IN('archived','deleting','deleted')`,
      )
      .bind(
        this.actorId,
        this.sessionId,
        photoId,
        this.actorId,
        initRequestId,
        this.actorId,
        this.actorId,
      )
      .first<Record<string, unknown> & VersionTargetRow>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    const recovery = uploadRecoverySchema.parse({
      initRequestId,
      uploadSession: asSession(row),
      contentType: row.content_type ?? null,
      sha256: row.sha256_hex ?? null,
      authorizationRequestId: row.authorization_request_id ?? null,
      authorizationExpiresAt:
        row.authorization_expires_at_ms == null
          ? null
          : new Date(Number(row.authorization_expires_at_ms)).toISOString(),
    });
    return versionUploadRecoverySchema.parse({
      ...recovery,
      target: this.targetFromRow(row),
    });
  }

  async authorize(
    uploadSessionId: string,
    input: unknown,
    credentials: R2SignerCredentials,
    nowMs = Date.now(),
  ) {
    const value = uploadAuthorizeSchema.parse(input);
    const versionTarget = await this.hasVersionTarget(uploadSessionId);
    if (versionTarget) {
      this.requireVersionUploadsEnabled();
      await this.currentVersionTargetScope(uploadSessionId);
    }
    await expireDueReservations(this.db, nowMs);
    let detail = await this.details(uploadSessionId);
    if (detail.status !== 'reserved')
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
    if (!detail.contentType || !detail.sha256)
      throw new WorkspaceFailure('DIRECT_UPLOAD_NOT_CONFIGURED', 503);
    if (detail.authorizationRequestId) {
      if (detail.authorizationRequestId !== value.requestId)
        throw new WorkspaceFailure('UPLOAD_ALREADY_AUTHORIZED', 409);
      if ((detail.authorizationExpiresAtMs ?? 0) <= nowMs)
        throw new WorkspaceFailure('UPLOAD_AUTHORIZATION_EXPIRED', 409);
    } else {
      const signedAtMs = Math.floor(nowMs / 1000) * 1000;
      const expiresAtMs = Math.min(signedAtMs + 600_000, detail.expiresAtMs);
      if (expiresAtMs <= signedAtMs)
        throw new WorkspaceFailure('UPLOAD_SESSION_EXPIRED', 409);
      const payloadJson = JSON.stringify({ uploadSessionId });
      try {
        await this.db
          .prepare(
            'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            this.actorId,
            value.requestId,
            'upload.authorized',
            payloadJson,
            this.sessionId,
            uploadSessionId,
            signedAtMs,
            signedAtMs,
            expiresAtMs,
            detail.contentType,
            detail.sha256,
          )
          .run();
      } catch (error) {
        translate(error);
      }
      detail = await this.details(uploadSessionId);
      if (detail.authorizationRequestId !== value.requestId)
        throw new WorkspaceFailure('UPLOAD_ALREADY_AUTHORIZED', 409);
    }
    const signedAtMs = detail.signedAtMs;
    const expiresAtMs = detail.authorizationExpiresAtMs;
    if (
      signedAtMs === null ||
      expiresAtMs === null ||
      detail.contentType === null ||
      detail.sha256 === null
    )
      throw new WorkspaceFailure('DIRECT_UPLOAD_NOT_CONFIGURED', 503);
    try {
      const presigned = await presignR2Put(credentials, {
        objectKey: detail.objectKey,
        bytes: detail.expectedBytes,
        contentType: detail.contentType,
        sha256Hex: detail.sha256,
        signedAtMs,
        expiresAtMs,
      });
      return {
        uploadSessionId,
        method: 'PUT' as const,
        ...presigned,
      };
    } catch {
      throw new WorkspaceFailure('DIRECT_UPLOAD_NOT_CONFIGURED', 503);
    }
  }

  async cancel(
    uploadSessionId: string,
    input: unknown,
  ): Promise<UploadSession> {
    const value = uploadCancelSchema.parse(input);
    const payloadJson = JSON.stringify({ uploadSessionId });
    const replay = await readExistingCommandResult(
      this.db,
      this.actorId,
      this.sessionId,
      value.requestId,
      'upload.cancelled',
      payloadJson,
    );
    if (replay) return replay;
    try {
      const detail = await this.details(uploadSessionId);
      if (detail.status !== 'reserved')
        throw new WorkspaceFailure(
          detail.status === 'completed'
            ? 'UPLOAD_ALREADY_COMPLETED'
            : 'INVALID_STATE_TRANSITION',
          409,
        );
      const intent = await new D1OwnerExternalIntentStore(
        this.db,
        this.actorId,
        this.sessionId,
        this.storage.storageNodeId,
      ).claimUploadCancellation(uploadSessionId, value.requestId);
      if (
        intent.uploadSessionId !== uploadSessionId ||
        intent.payloadJson !== payloadJson
      )
        throw new WorkspaceFailure('OWNER_EXTERNAL_INTENT_UNAVAILABLE', 503);
      if (detail.authorizationRequestId) {
        const result = await this.storage.fenceIfAbsent(
          {
            workspaceId: intent.workspaceId,
            projectId: intent.projectId,
            albumId: intent.albumId,
          },
          intent.originalObjectKey,
          uploadSessionId,
        );
        if (result !== 'fenced')
          throw new WorkspaceFailure('UPLOAD_OBJECT_EXISTS', 409);
        try {
          await this.db
            .prepare(
              "INSERT OR IGNORE INTO upload_key_fences(upload_session_id,object_key,reason,actor_type,actor_id,session_id,request_id,occurred_at_ms) VALUES(?,?,'cancel','user',?,?,?,?)",
            )
            .bind(
              uploadSessionId,
              intent.originalObjectKey,
              this.actorId,
              this.sessionId,
              value.requestId,
              Date.now(),
            )
            .run();
        } catch (error) {
          translate(error);
        }
      }
      try {
        await this.db
          .prepare(
            'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(
            this.actorId,
            value.requestId,
            'upload.cancelled',
            payloadJson,
            this.sessionId,
            uploadSessionId,
            Date.now(),
          )
          .run();
      } catch (error) {
        translate(error);
      }
      return readCommandResult(
        this.db,
        this.actorId,
        this.sessionId,
        value.requestId,
        'upload.cancelled',
        payloadJson,
      );
    } catch (error) {
      // A concurrent identical request may have finalized after the first read.
      // Replay still requires the current Owner/session and exact original intent.
      const committed = await readExistingCommandResult(
        this.db,
        this.actorId,
        this.sessionId,
        value.requestId,
        'upload.cancelled',
        payloadJson,
      );
      if (committed) return committed;
      throw error;
    }
  }

  async complete(uploadSessionId: string, input: unknown) {
    const value = uploadCompleteSchema.parse(input);
    const payloadJson = JSON.stringify({ uploadSessionId });
    const versionTarget = await this.hasVersionTarget(uploadSessionId);
    if (versionTarget) {
      this.requireVersionUploadsEnabled();
      const targetScope = await this.currentVersionTargetScope(uploadSessionId);
      return this.completeVersion(
        uploadSessionId,
        value.requestId,
        payloadJson,
        targetScope,
      );
    }
    const previous = await this.db
      .prepare(
        "SELECT r.result_json FROM upload_workflow_requests r JOIN owners o ON o.user_id=r.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE r.actor_id=? AND r.request_id=? AND r.operation='upload.completed' AND r.payload_json=?",
      )
      .bind(this.sessionId, this.actorId, value.requestId, payloadJson)
      .first<{ result_json: string }>();
    if (previous?.result_json) return JSON.parse(previous.result_json);

    const detail = await this.details(uploadSessionId);
    if (detail.status === 'completed')
      throw new WorkspaceFailure('UPLOAD_ALREADY_COMPLETED', 409);
    if (detail.status === 'needs_review')
      throw new WorkspaceFailure('UPLOAD_NEEDS_REVIEW', 409);
    if (
      detail.status !== 'reserved' ||
      !detail.authorizationRequestId ||
      !detail.contentType ||
      !detail.sha256
    )
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
    const object = await this.storage.inspectUpload(
      {
        workspaceId: detail.workspaceId,
        projectId: detail.projectId,
        albumId: detail.albumId,
      },
      detail.objectKey,
    );
    if (!object) throw new WorkspaceFailure('UPLOAD_OBJECT_NOT_FOUND', 409);
    if (object.fence === uploadSessionId)
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
    let dimensions: ImageDimensions | null = null;
    try {
      dimensions = inspectImageHeader(
        object.prefix,
        detail.contentType,
        object.bytes,
      );
    } catch {
      // Header parsing is bounded structural validation, not a complete decode.
      // Invalid/oversized content remains reserved and requires explicit review.
    }
    const isImage = dimensions !== null;
    const matches =
      object.bytes === detail.expectedBytes &&
      object.mime === detail.contentType &&
      object.sha256 === detail.sha256 &&
      isImage;
    if (!matches || !dimensions) {
      const reason = isImage
        ? 'UPLOAD_METADATA_MISMATCH'
        : 'UPLOAD_CONTENT_INVALID';
      await this.db
        .prepare(
          'INSERT OR IGNORE INTO upload_review_flags(upload_session_id,actor_id,session_id,reason_code,occurred_at_ms,request_id) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          uploadSessionId,
          this.actorId,
          this.sessionId,
          reason,
          Date.now(),
          value.requestId,
        )
        .run();
      throw new WorkspaceFailure('UPLOAD_CONTENT_INVALID', 422);
    }
    await this.assertResolvedDimensions(
      uploadSessionId,
      value.requestId,
      dimensions,
    );
    const photoId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,content_type,sha256_hex,actual_bytes,photo_id,version_id,asset_id,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          this.actorId,
          value.requestId,
          'upload.completed',
          payloadJson,
          this.sessionId,
          uploadSessionId,
          Date.now(),
          detail.contentType,
          detail.sha256,
          object.bytes,
          photoId,
          versionId,
          assetId,
          dimensions.width,
          dimensions.height,
        )
        .run();
    } catch (error) {
      translate(error);
    }
    const row = await this.db
      .prepare(
        "SELECT result_json FROM upload_workflow_requests WHERE actor_id=? AND request_id=? AND operation='upload.completed' AND payload_json=?",
      )
      .bind(this.actorId, value.requestId, payloadJson)
      .first<{ result_json: string }>();
    if (!row?.result_json) throw new Error('UPLOAD_RESULT_UNAVAILABLE');
    return JSON.parse(row.result_json);
  }

  private async completeVersion(
    uploadSessionId: string,
    requestId: string,
    payloadJson: string,
    target: VersionTargetRow,
  ) {
    // The caller checks target scope before entering; this read binds the replay result
    // to current Owner, photo, parent, and active-ancestor scope in one SQL statement.
    const previous = await this.readVersionCompletionResult(
      uploadSessionId,
      requestId,
      payloadJson,
    );
    if (previous) return previous;
    const detail = await this.details(uploadSessionId);
    if (detail.status === 'completed')
      throw new WorkspaceFailure('UPLOAD_ALREADY_COMPLETED', 409);
    if (detail.status === 'needs_review')
      throw new WorkspaceFailure('UPLOAD_NEEDS_REVIEW', 409);
    if (
      detail.status !== 'reserved' ||
      !detail.authorizationRequestId ||
      !detail.contentType ||
      !detail.sha256
    )
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);

    const object = await this.storage.inspectUpload(
      {
        workspaceId: detail.workspaceId,
        projectId: detail.projectId,
        albumId: detail.albumId,
      },
      detail.objectKey,
    );
    if (!object) throw new WorkspaceFailure('UPLOAD_OBJECT_NOT_FOUND', 409);
    if (object.fence === uploadSessionId)
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
    let dimensions: ImageDimensions | null = null;
    try {
      dimensions = inspectImageHeader(
        object.prefix,
        detail.contentType,
        object.bytes,
      );
    } catch {
      // Header parsing is bounded structural validation, not a complete decode.
      // Invalid/oversized content remains reserved and requires explicit review.
    }
    const isImage = dimensions !== null;
    const matches =
      object.bytes === detail.expectedBytes &&
      object.mime === detail.contentType &&
      object.sha256 === detail.sha256 &&
      isImage;
    if (!matches || !dimensions) {
      const reason = isImage
        ? 'UPLOAD_METADATA_MISMATCH'
        : 'UPLOAD_CONTENT_INVALID';
      await this.db
        .prepare(
          'INSERT OR IGNORE INTO upload_review_flags(upload_session_id,actor_id,session_id,reason_code,occurred_at_ms,request_id) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          uploadSessionId,
          this.actorId,
          this.sessionId,
          reason,
          Date.now(),
          requestId,
        )
        .run();
      throw new WorkspaceFailure('UPLOAD_CONTENT_INVALID', 422);
    }

    await this.assertResolvedDimensions(uploadSessionId, requestId, dimensions);

    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,content_type,sha256_hex,actual_bytes,photo_id,version_id,asset_id,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          this.actorId,
          requestId,
          'upload.completed',
          payloadJson,
          this.sessionId,
          uploadSessionId,
          Date.now(),
          detail.contentType,
          detail.sha256,
          object.bytes,
          target.photo_id,
          versionId,
          assetId,
          dimensions.width,
          dimensions.height,
        )
        .run();
    } catch (error) {
      translate(error);
    }

    const result = await this.readVersionCompletionResult(
      uploadSessionId,
      requestId,
      payloadJson,
    );
    if (!result) throw new WorkspaceFailure('NOT_FOUND', 404);
    return result;
  }
}

/** Release only reservations with no R2 capability. Authorized rows require an atomic object-key fence. */
export async function expireDueReservations(
  db: D1Database,
  cutoffMs = Date.now(),
  storage?: R2StorageAdapter,
) {
  const safeCutoff = Math.floor(cutoffMs);
  const unissued = await db
    .prepare(
      "UPDATE upload_sessions SET status='expired',updated_at_ms=?,updated_by_request_id='reservation-expired:'||id,updated_by_session_id=NULL,updated_by_actor_type='system' WHERE status='reserved' AND expires_at_ms<=? AND NOT EXISTS(SELECT 1 FROM upload_authorizations a WHERE a.upload_session_id=upload_sessions.id) AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=upload_sessions.id) AND NOT EXISTS(SELECT 1 FROM upload_version_completions vc WHERE vc.upload_session_id=upload_sessions.id)",
    )
    .bind(safeCutoff, safeCutoff)
    .run();
  if (!storage) return unissued;

  const authorized = await db
    .prepare(
      "SELECT u.id,u.workspace_id,u.project_id,u.album_id,u.object_key FROM upload_sessions u JOIN upload_authorizations a ON a.upload_session_id=u.id WHERE u.status='reserved' AND u.storage_node_id=? AND u.expires_at_ms<=? AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id) AND NOT EXISTS(SELECT 1 FROM upload_version_completions vc WHERE vc.upload_session_id=u.id) AND NOT EXISTS(SELECT 1 FROM upload_review_flags f WHERE f.upload_session_id=u.id) ORDER BY u.expires_at_ms,u.id LIMIT 100",
    )
    .bind(storage.storageNodeId, safeCutoff)
    .all<{
      id: string;
      workspace_id: string;
      project_id: string;
      album_id: string;
      object_key: string;
    }>();
  let fencedCount = 0;
  for (const row of authorized.results) {
    const outcome = await storage.fenceIfAbsent(
      {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        albumId: row.album_id,
      },
      row.object_key,
      row.id,
    );
    if (outcome !== 'fenced') continue;
    await db
      .prepare(
        "INSERT OR IGNORE INTO upload_key_fences(upload_session_id,object_key,reason,actor_type,actor_id,session_id,request_id,occurred_at_ms) VALUES(?,?,'expire','system',NULL,NULL,'reservation-expired:'||?,?)",
      )
      .bind(row.id, row.object_key, row.id, safeCutoff)
      .run();
    await db
      .prepare(
        "UPDATE upload_sessions SET status='expired',updated_at_ms=?,updated_by_request_id='reservation-expired:'||id,updated_by_session_id=NULL,updated_by_actor_type='system' WHERE id=? AND status='reserved' AND expires_at_ms<=? AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=upload_sessions.id) AND NOT EXISTS(SELECT 1 FROM upload_version_completions vc WHERE vc.upload_session_id=upload_sessions.id)",
      )
      .bind(safeCutoff, row.id, safeCutoff)
      .run();
    fencedCount++;
  }
  return { success: true, unissued: unissued.success, fencedCount };
}
