import { z } from 'zod';
import {
  createSharedReviewSchema,
  guestSharedReviewListSchema,
  guestSharedReviewMetadataSchema,
  ownerSharedReviewListSchema,
  reopenSharedReviewSchema,
  sharedReviewOwnerResultSchema,
  sharedReviewSelectionPageSchema,
  sharedReviewSelectionResultSchema,
  sharedReviewSubmissionDetailSchema,
  sharedReviewSubmissionPageSchema,
  sharedReviewSubmitResultSchema,
  sharedReviewSummarySchema,
  setSharedReviewSelectionSchema,
  submitSharedReviewSchema,
} from '../../../packages/contracts/src/shared-review';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const canViewBit = guestPermissionBit('can_view');
const canSelectBit = guestPermissionBit('can_select');
const canSubmitBit = guestPermissionBit('can_submit');

const selectionCursorSchema = z
  .object({
    reviewId: z.uuid(),
    roundNo: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    selectedAtMs: z.number().int().nonnegative(),
    photoId: z.uuid(),
  })
  .strict();
const detailCursorSchema = z
  .object({
    reviewId: z.uuid(),
    submissionId: z.uuid(),
    selectedAtMs: z.number().int().nonnegative(),
    photoId: z.uuid(),
  })
  .strict();

function decodeCursor<T extends z.ZodTypeAny>(
  schema: T,
  input?: string,
): z.infer<T> | null {
  if (input === undefined) return null;
  const raw = z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .safeParse(input);
  if (!raw.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.data, 'base64url').toString('utf8'));
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
  const value = schema.safeParse(parsed);
  if (!value.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  return value.data;
}
function encodeCursor<T extends z.ZodTypeAny>(
  schema: T,
  value: z.input<T>,
): string {
  return Buffer.from(JSON.stringify(schema.parse(value))).toString('base64url');
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}
function ownerSqlFailure(
  error: unknown,
  fallback = 'SHARED_REVIEW_UNAVAILABLE',
): never {
  const message = errorMessage(error);
  const known: Array<[string, string, 403 | 404 | 409 | 400 | 503]> = [
    ['OWNER_REQUIRED', 'OWNER_REQUIRED', 403],
    ['NOT_FOUND', 'NOT_FOUND', 404],
    ['REQUEST_ID_CONFLICT', 'REQUEST_ID_CONFLICT', 409],
    ['SHARED_REVIEW_LIMIT_REACHED', 'SHARED_REVIEW_LIMIT_REACHED', 409],
    ['SHARED_REVIEW_ID_CONFLICT', 'REQUEST_ID_CONFLICT', 409],
    ['ROUND_NOT_SUBMITTED', 'ROUND_NOT_SUBMITTED', 409],
    ['ROUND_CONFLICT', 'ROUND_CONFLICT', 409],
    ['RESOURCE_NOT_EDITABLE', 'RESOURCE_NOT_EDITABLE', 409],
    ['INVALID_TIMESTAMP', 'INVALID_INPUT', 400],
    ['INVALID_SHARED_REVIEW', 'INVALID_INPUT', 400],
    ['INVALID_SHARED_REVIEW_MEMBER', 'INVALID_INPUT', 400],
    ['INVALID_SHARED_REVIEW_MEMBERS', 'INVALID_INPUT', 400],
  ];
  for (const [needle, code, status] of known) {
    if (message.includes(needle)) throw new WorkspaceFailure(code, status);
  }
  throw new WorkspaceFailure(fallback, 503);
}
function guestSqlFailure(
  error: unknown,
  fallback = 'SHARED_SELECTION_UNAVAILABLE',
): never {
  const message = errorMessage(error);
  if (message.includes('GUEST_ACCESS_REQUIRED')) throw new GuestAccessDenied();
  const known: Array<[string, string, 400 | 409 | 422]> = [
    ['REQUEST_ID_CONFLICT', 'REQUEST_ID_CONFLICT', 409],
    ['SELECTION_REVISION_CONFLICT', 'SELECTION_REVISION_CONFLICT', 409],
    ['SHARED_ROUND_CONFLICT', 'ROUND_CONFLICT', 409],
    ['SELECTION_LIMIT_REACHED', 'SELECTION_LIMIT_REACHED', 409],
    ['SELECTION_MINIMUM_NOT_MET', 'SELECTION_MINIMUM_NOT_MET', 409],
    ['SHARED_SELECTION_LOCKED', 'SELECTION_ALREADY_SUBMITTED', 409],
    ['INVALID_INPUT', 'INVALID_INPUT', 400],
    ['INVALID_TIMESTAMP', 'INVALID_INPUT', 400],
    ['EMPTY_SELECTION', 'EMPTY_SELECTION', 422],
  ];
  for (const [needle, code, status] of known) {
    if (message.includes(needle)) throw new WorkspaceFailure(code, status);
  }
  throw new WorkspaceFailure(fallback, 503);
}
function parseJson<T extends z.ZodTypeAny>(
  schema: T,
  raw: string,
  code: string,
): z.infer<T> {
  try {
    return schema.parse(JSON.parse(raw) as unknown);
  } catch {
    throw new WorkspaceFailure(code, 503);
  }
}

type OwnerAlbumScope = {
  workspaceId: string;
  projectId: string;
  albumState: string;
  projectStatus: string;
};
type GuestSessionScope = {
  id: string;
  guest_id: string;
  invite_id: string;
  workspace_id: string;
  project_id: string;
};
type GuestMetadataRow = {
  id: string;
  guestId: string;
  albumId: string;
  title: string;
  roundNo: number;
  revision: number;
  status: 'open' | 'submitted';
  minimum: number;
  maximum: number | null;
  canSelect: number;
  canSubmit: number;
  canView: number;
  canSubmitNow: number;
  selectedCount: number | null;
  submittedAt: string | null;
};
function guestMetadata(row: GuestMetadataRow) {
  return guestSharedReviewMetadataSchema.parse({
    id: row.id,
    guestId: row.guestId,
    albumId: row.albumId,
    title: row.title,
    roundNo: row.roundNo,
    revision: row.revision,
    status: row.status,
    minimum: row.minimum,
    maximum: row.maximum,
    canSelect: row.canSelect === 1,
    canSubmit: row.canSubmit === 1,
    canView: row.canView === 1,
    canSubmitNow: row.canSubmitNow === 1,
    selectedCount: row.selectedCount,
    submittedAt: row.submittedAt,
  });
}

export class D1OwnerSharedReviews {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}

  private async authorizeAlbum(albumId: string): Promise<OwnerAlbumScope> {
    const album = z.uuid().parse(albumId);
    const current = await this.db
      .prepare(
        `SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
       WHERE o.user_id=? AND o.enabled=1 AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000`,
      )
      .bind(this.actor, this.session)
      .first();
    if (!current) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    const scope = await this.db
      .prepare(
        `SELECT a.workspace_id AS workspaceId,a.project_id AS projectId,
         a.state AS albumState,p.status AS projectStatus
       FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
       JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?
       WHERE a.id=?`,
      )
      .bind(this.actor, album)
      .first<OwnerAlbumScope>();
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);
    return scope;
  }

  private async hasLegacyOwnerConflict(requestId: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `WITH k(actor_id,request_id) AS (VALUES(?,?))
       SELECT EXISTS(SELECT 1 FROM request_commands c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM upload_requests c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM upload_workflow_requests c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM processing_review_commands c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM invite_revocation_commands c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM invite_creation_commands c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM selection_policy_commands c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c,k WHERE c.actor_id=k.actor_id AND c.request_id=k.request_id)
         OR EXISTS(SELECT 1 FROM audit_events e,k WHERE e.actor_type='user' AND e.action='selection.reopened'
           AND e.actor_id=k.actor_id AND e.request_id=k.request_id) AS conflict FROM k`,
      )
      .bind(this.actor, requestId)
      .first<{ conflict: number }>();
    return row?.conflict === 1;
  }

  private async existingOwnerResult(
    requestId: string,
    action: 'create' | 'reopen',
    albumId: string,
    payloadJson: string,
  ) {
    const row = await this.db
      .prepare(
        `SELECT c.action,c.session_id AS sessionId,c.album_id AS albumId,c.payload_json AS payloadJson,r.result_json AS resultJson
       FROM shared_review_owner_commands c JOIN shared_review_owner_results r ON r.command_id=c.id
       JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
       JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id
       JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id
       JOIN albums a ON a.id=c.album_id AND a.workspace_id=w.id AND a.project_id=p.id
       WHERE c.actor_id=? AND c.request_id=?`,
      )
      .bind(this.session, this.actor, requestId)
      .first<{
        action: string;
        sessionId: string;
        albumId: string;
        payloadJson: string;
        resultJson: string;
      }>();
    if (!row) return null;
    if (
      row.action !== action ||
      row.sessionId !== this.session ||
      row.albumId !== albumId ||
      row.payloadJson !== payloadJson
    ) {
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    }
    return parseJson(
      sharedReviewOwnerResultSchema,
      row.resultJson,
      'SHARED_REVIEW_UNAVAILABLE',
    );
  }

  private async readOwnerResult(requestId: string) {
    const row = await this.db
      .prepare(
        `SELECT r.result_json AS resultJson FROM shared_review_owner_commands c
       JOIN shared_review_owner_results r ON r.command_id=c.id
       JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
       JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id
       JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id
       JOIN albums a ON a.id=c.album_id AND a.workspace_id=w.id AND a.project_id=p.id
       WHERE c.actor_id=? AND c.session_id=? AND c.request_id=?`,
      )
      .bind(this.session, this.actor, this.session, requestId)
      .first<{ resultJson: string }>();
    if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    return parseJson(
      sharedReviewOwnerResultSchema,
      row.resultJson,
      'SHARED_REVIEW_UNAVAILABLE',
    );
  }

  async list(albumId: string) {
    const album = z.uuid().parse(albumId);
    await this.authorizeAlbum(album);
    const rows = await this.db
      .prepare(
        `WITH access AS (
         SELECT a.id AS albumId,w.id AS workspaceId,p.id AS projectId
         FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
         JOIN workspaces w ON w.owner_user_id=o.user_id
         JOIN projects p ON p.workspace_id=w.id
         JOIN albums a ON a.id=? AND a.project_id=p.id AND a.workspace_id=w.id
         WHERE o.user_id=? AND o.enabled=1
       ), reviews AS (
         SELECT r.id,r.album_id AS albumId,r.title,r.created_at_ms AS createdAtMs,
           strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch') AS createdAt,
           (SELECT json_group_array(invite_id) FROM (SELECT invite_id FROM shared_review_invites m WHERE m.review_id=r.id ORDER BY invite_id)) AS inviteIdsJson,
           rd.round_no AS roundNo,rd.revision,rd.status,rd.minimum,rd.maximum,rd.submitted_at_ms AS submittedAtMs,
           CASE WHEN rd.submitted_at_ms IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',rd.submitted_at_ms/1000.0,'unixepoch') END AS submittedAt,
           (SELECT count(*) FROM shared_review_state st WHERE st.review_id=r.id AND st.selected=1) AS selectedCount
         FROM shared_reviews r JOIN access x ON x.albumId=r.album_id AND x.workspaceId=r.workspace_id AND x.projectId=r.project_id
         JOIN shared_review_rounds rd ON rd.review_id=r.id AND rd.round_no=(SELECT max(y.round_no) FROM shared_review_rounds y WHERE y.review_id=r.id)
         ORDER BY r.created_at_ms DESC,r.id DESC LIMIT 20
       )
       SELECT access.albumId,access.workspaceId,access.projectId,reviews.id,reviews.title,reviews.inviteIdsJson,
         reviews.roundNo,reviews.revision,reviews.status,reviews.minimum,reviews.maximum,reviews.selectedCount,
         reviews.createdAt,reviews.submittedAt
       FROM access LEFT JOIN reviews ON 1=1 ORDER BY reviews.createdAtMs DESC,reviews.id DESC`,
      )
      .bind(this.session, album, this.actor)
      .all<{
        albumId: string;
        workspaceId: string;
        projectId: string;
        id: string | null;
        title: string | null;
        inviteIdsJson: string | null;
        roundNo: number | null;
        revision: number | null;
        status: 'open' | 'submitted' | null;
        minimum: number | null;
        maximum: number | null;
        selectedCount: number | null;
        createdAt: string | null;
        submittedAt: string | null;
      }>();
    if (!rows.results.length) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    const reviews = rows.results
      .filter((row) => row.id !== null)
      .map((row) =>
        sharedReviewSummarySchema.parse({
          id: row.id,
          albumId: row.albumId,
          title: row.title,
          inviteIds: JSON.parse(row.inviteIdsJson ?? '[]') as unknown,
          roundNo: row.roundNo,
          revision: row.revision,
          status: row.status,
          minimum: row.minimum,
          maximum: row.maximum,
          selectedCount: row.selectedCount,
          createdAt: row.createdAt,
          submittedAt: row.submittedAt,
        }),
      );
    return ownerSharedReviewListSchema.parse({ reviews });
  }

  async create(albumId: string, input: unknown) {
    const album = z.uuid().parse(albumId);
    const request = createSharedReviewSchema.parse(input);
    const scope = await this.authorizeAlbum(album);
    const inviteIds = [...request.inviteIds].sort();
    const payloadJson = JSON.stringify({
      requestId: request.requestId,
      albumId: album,
      title: request.title,
      inviteIds,
      minimum: request.minimum,
      maximum: request.maximum,
      confirmShared: true,
    });
    if (await this.hasLegacyOwnerConflict(request.requestId))
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    const prior = await this.existingOwnerResult(
      request.requestId,
      'create',
      album,
      payloadJson,
    );
    if (prior) return prior;
    if (
      ['archived', 'deleting', 'deleted'].includes(scope.albumState) ||
      ['archived', 'deleting', 'deleted'].includes(scope.projectStatus)
    )
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    try {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO shared_review_owner_commands(
          id,actor_id,session_id,request_id,workspace_id,project_id,album_id,action,review_id,title,
          invite_ids_json,expected_round_no,minimum,maximum,payload_json,created_at_ms
        ) VALUES(?,?,?,?,?,?,?,'create',?,?,?,NULL,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          this.actor,
          this.session,
          request.requestId,
          scope.workspaceId,
          scope.projectId,
          album,
          crypto.randomUUID(),
          request.title,
          JSON.stringify(inviteIds),
          request.minimum,
          request.maximum,
          payloadJson,
          Date.now(),
        )
        .run();
    } catch (error) {
      ownerSqlFailure(error);
    }
    return this.readOwnerResult(request.requestId);
  }

  async reopen(albumId: string, reviewId: string, input: unknown) {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    const request = reopenSharedReviewSchema.parse(input);
    const scope = await this.authorizeAlbum(album);
    const payloadJson = JSON.stringify({
      requestId: request.requestId,
      albumId: album,
      reviewId: review,
      expectedRoundNo: request.expectedRoundNo,
      minimum: request.minimum,
      maximum: request.maximum,
      confirmShared: true,
    });
    if (await this.hasLegacyOwnerConflict(request.requestId))
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    const prior = await this.existingOwnerResult(
      request.requestId,
      'reopen',
      album,
      payloadJson,
    );
    if (prior) return prior;
    if (
      ['archived', 'deleting', 'deleted'].includes(scope.albumState) ||
      ['archived', 'deleting', 'deleted'].includes(scope.projectStatus)
    )
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    try {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO shared_review_owner_commands(
          id,actor_id,session_id,request_id,workspace_id,project_id,album_id,action,review_id,title,
          invite_ids_json,expected_round_no,minimum,maximum,payload_json,created_at_ms
        ) VALUES(?,?,?,?,?,?,?,'reopen',?,NULL,'[]',?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          this.actor,
          this.session,
          request.requestId,
          scope.workspaceId,
          scope.projectId,
          album,
          review,
          request.expectedRoundNo,
          request.minimum,
          request.maximum,
          payloadJson,
          Date.now(),
        )
        .run();
    } catch (error) {
      ownerSqlFailure(error);
    }
    return this.readOwnerResult(request.requestId);
  }
  private async authorizeReview(albumId: string, reviewId: string) {
    const scope = await this.authorizeAlbum(albumId);
    const row = await this.db
      .prepare(
        `SELECT 1 FROM shared_reviews r
       JOIN owners o ON o.user_id=? AND o.enabled=1
       JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=r.workspace_id AND w.owner_user_id=o.user_id
       JOIN projects p ON p.id=r.project_id AND p.workspace_id=w.id
       JOIN albums a ON a.id=r.album_id AND a.workspace_id=w.id AND a.project_id=p.id
       WHERE r.id=? AND r.album_id=? AND r.workspace_id=? AND r.project_id=?`,
      )
      .bind(
        this.actor,
        this.session,
        reviewId,
        albumId,
        scope.workspaceId,
        scope.projectId,
      )
      .first();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return scope;
  }

  async submissions(albumId: string, reviewId: string, beforeRoundNo?: string) {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    let before: number | null = null;
    if (beforeRoundNo !== undefined) {
      const parsed = z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .safeParse(beforeRoundNo);
      const value = parsed.success ? Number(parsed.data) : NaN;
      if (!Number.isSafeInteger(value) || value < 1)
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      before = value;
    }
    const scope = await this.authorizeReview(album, review);
    const rows = await this.db
      .prepare(
        `SELECT sub.id,sub.review_id AS reviewId,sub.round_no AS roundNo,sub.revision,
         seal.item_count AS selectedCount,
         strftime('%Y-%m-%dT%H:%M:%fZ',sub.created_at_ms/1000.0,'unixepoch') AS submittedAt,
         sub.submitted_by_guest_id AS submittedByGuestId
       FROM shared_review_submissions sub JOIN shared_review_submission_seals seal ON seal.submission_id=sub.id
       JOIN shared_reviews r ON r.id=sub.review_id AND r.workspace_id=sub.workspace_id
         AND r.project_id=sub.project_id AND r.album_id=sub.album_id
       JOIN owners o ON o.user_id=? AND o.enabled=1
       JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=sub.workspace_id AND w.owner_user_id=o.user_id
       JOIN projects p ON p.id=sub.project_id AND p.workspace_id=w.id
       JOIN albums a ON a.id=sub.album_id AND a.workspace_id=w.id AND a.project_id=p.id
       WHERE sub.review_id=? AND sub.album_id=? AND sub.workspace_id=? AND sub.project_id=?
         AND (? IS NULL OR sub.round_no<?)
       ORDER BY sub.round_no DESC LIMIT 25`,
      )
      .bind(
        this.actor,
        this.session,
        review,
        album,
        scope.workspaceId,
        scope.projectId,
        before,
        before,
      )
      .all<{
        id: string;
        reviewId: string;
        roundNo: number;
        revision: number;
        selectedCount: number;
        submittedAt: string;
        submittedByGuestId: string;
      }>();
    if (!rows.results.length) await this.authorizeReview(album, review);
    const submissions = rows.results.slice(0, 24).map((row) => ({
      id: row.id,
      reviewId: row.reviewId,
      roundNo: row.roundNo,
      revision: row.revision,
      selectedCount: row.selectedCount,
      submittedAt: row.submittedAt,
      submittedByGuestId: row.submittedByGuestId,
    }));
    return sharedReviewSubmissionPageSchema.parse({
      submissions,
      nextBeforeRoundNo:
        rows.results.length > 24 ? (submissions.at(-1)?.roundNo ?? null) : null,
    });
  }

  async detail(
    albumId: string,
    reviewId: string,
    submissionId: string,
    cursorInput?: string,
  ) {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    const submission = z.uuid().parse(submissionId);
    const cursor = decodeCursor(detailCursorSchema, cursorInput);
    if (
      cursor &&
      (cursor.reviewId !== review || cursor.submissionId !== submission)
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const scope = await this.authorizeReview(album, review);
    const header = await this.db
      .prepare(
        `SELECT sub.id,sub.review_id AS reviewId,sub.round_no AS roundNo,sub.revision,
         seal.item_count AS selectedCount,
         strftime('%Y-%m-%dT%H:%M:%fZ',sub.created_at_ms/1000.0,'unixepoch') AS submittedAt,
         sub.submitted_by_guest_id AS submittedByGuestId
       FROM shared_review_submissions sub JOIN shared_review_submission_seals seal ON seal.submission_id=sub.id
       JOIN shared_reviews r ON r.id=sub.review_id AND r.workspace_id=sub.workspace_id
         AND r.project_id=sub.project_id AND r.album_id=sub.album_id
       JOIN owners o ON o.user_id=? AND o.enabled=1
       JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=sub.workspace_id AND w.owner_user_id=o.user_id
       JOIN projects p ON p.id=sub.project_id AND p.workspace_id=w.id
       JOIN albums a ON a.id=sub.album_id AND a.workspace_id=w.id AND a.project_id=p.id
       WHERE sub.id=? AND sub.review_id=? AND sub.album_id=?
         AND sub.workspace_id=? AND sub.project_id=?`,
      )
      .bind(
        this.actor,
        this.session,
        submission,
        review,
        album,
        scope.workspaceId,
        scope.projectId,
      )
      .first<{
        id: string;
        reviewId: string;
        roundNo: number;
        revision: number;
        selectedCount: number;
        submittedAt: string;
        submittedByGuestId: string;
      }>();
    if (!header) throw new WorkspaceFailure('NOT_FOUND', 404);
    const rows = await this.db
      .prepare(
        `SELECT i.photo_id AS photoId,i.version_id AS versionId,
         strftime('%Y-%m-%dT%H:%M:%fZ',i.selected_at_ms/1000.0,'unixepoch') AS selectedAt,
         i.filename,i.version_no AS versionNo,i.selected_at_ms AS selectedAtMs
       FROM shared_review_submission_items i
       JOIN shared_review_submissions sub ON sub.id=i.submission_id AND sub.review_id=i.review_id
         AND sub.workspace_id=i.workspace_id AND sub.project_id=i.project_id AND sub.album_id=i.album_id
       JOIN shared_review_submission_seals seal ON seal.submission_id=sub.id
       JOIN owners o ON o.user_id=? AND o.enabled=1
       JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=o.user_id
       WHERE i.submission_id=? AND i.review_id=? AND i.workspace_id=? AND i.project_id=? AND i.album_id=?
         AND (? IS NULL OR (i.selected_at_ms,i.photo_id)>(?,?))
       ORDER BY i.selected_at_ms,i.photo_id LIMIT 25`,
      )
      .bind(
        this.actor,
        this.session,
        submission,
        review,
        scope.workspaceId,
        scope.projectId,
        album,
        cursor?.selectedAtMs ?? null,
        cursor?.selectedAtMs ?? null,
        cursor?.photoId ?? null,
      )
      .all<{
        photoId: string;
        versionId: string;
        selectedAt: string;
        filename: string;
        versionNo: number;
        selectedAtMs: number;
      }>();
    const items = rows.results
      .slice(0, 24)
      .map(({ photoId, versionId, selectedAt, filename, versionNo }) => ({
        photoId,
        versionId,
        selectedAt,
        filename,
        versionNo,
      }));
    const last = rows.results[23];
    return sharedReviewSubmissionDetailSchema.parse({
      submission: {
        id: header.id,
        reviewId: header.reviewId,
        roundNo: header.roundNo,
        revision: header.revision,
        selectedCount: header.selectedCount,
        submittedAt: header.submittedAt,
        submittedByGuestId: header.submittedByGuestId,
      },
      items,
      nextCursor:
        rows.results.length > 24 && last
          ? encodeCursor(detailCursorSchema, {
              reviewId: review,
              submissionId: submission,
              selectedAtMs: last.selectedAtMs,
              photoId: last.photoId,
            })
          : null,
    });
  }

  private async appendDownloadAudit(
    albumId: string,
    reviewId: string,
    submissionId: string,
    format: 'csv' | 'txt' | 'json',
    selectedCount: number,
    action: 'download.requested' | 'download.generated',
    requestId: string,
  ) {
    const eventId = crypto.randomUUID();
    const afterJson = JSON.stringify({
      reviewId,
      submissionId,
      format,
      selectedCount,
    });
    const result = await this.db
      .prepare(
        `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,after_json,request_id)
       SELECT ?, 'user',o.user_id,s.id,w.id,p.id,a.id,?,?,?
       FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?
         AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=? AND w.owner_user_id=o.user_id
       JOIN projects p ON p.id=? AND p.workspace_id=w.id
       JOIN albums a ON a.id=? AND a.project_id=p.id AND a.workspace_id=w.id
       JOIN shared_reviews r ON r.id=? AND r.album_id=a.id AND r.workspace_id=w.id AND r.project_id=p.id
       JOIN shared_review_submissions sub ON sub.id=? AND sub.review_id=r.id
         AND sub.workspace_id=w.id AND sub.project_id=p.id AND sub.album_id=a.id
       JOIN shared_review_submission_seals seal ON seal.submission_id=sub.id
       WHERE o.user_id=? AND o.enabled=1`,
      )
      .bind(
        eventId,
        action,
        afterJson,
        requestId,
        this.session,
        (await this.authorizeAlbum(albumId)).workspaceId,
        (await this.authorizeAlbum(albumId)).projectId,
        albumId,
        reviewId,
        submissionId,
        this.actor,
      )
      .run();
    if (result.meta.changes !== 1)
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  async download(
    albumId: string,
    reviewId: string,
    submissionId: string,
    formatInput?: string,
  ): Promise<Response> {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    const submission = z.uuid().parse(submissionId);
    const format = z.enum(['csv', 'txt', 'json']).parse(formatInput ?? 'csv');
    const scope = await this.authorizeReview(album, review);
    const header = await this.db
      .prepare(
        `SELECT sub.id,sub.review_id AS reviewId,sub.round_no AS roundNo,sub.revision,
         seal.item_count AS selectedCount,
         strftime('%Y-%m-%dT%H:%M:%fZ',sub.created_at_ms/1000.0,'unixepoch') AS submittedAt,
         sub.submitted_by_guest_id AS submittedByGuestId
       FROM shared_review_submissions sub JOIN shared_review_submission_seals seal ON seal.submission_id=sub.id
       JOIN owners o ON o.user_id=? AND o.enabled=1
       JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
       JOIN workspaces w ON w.id=sub.workspace_id AND w.owner_user_id=o.user_id
       JOIN projects p ON p.id=sub.project_id AND p.workspace_id=w.id
       JOIN albums a ON a.id=sub.album_id AND a.workspace_id=w.id AND a.project_id=p.id
       WHERE sub.id=? AND sub.review_id=? AND sub.album_id=? AND sub.workspace_id=? AND sub.project_id=?`,
      )
      .bind(
        this.actor,
        this.session,
        submission,
        review,
        album,
        scope.workspaceId,
        scope.projectId,
      )
      .first<{
        id: string;
        reviewId: string;
        roundNo: number;
        revision: number;
        selectedCount: number;
        submittedAt: string;
        submittedByGuestId: string;
      }>();
    if (!header) throw new WorkspaceFailure('NOT_FOUND', 404);
    const submitted = {
      id: header.id,
      reviewId: header.reviewId,
      roundNo: header.roundNo,
      revision: header.revision,
      selectedCount: header.selectedCount,
      submittedAt: header.submittedAt,
      submittedByGuestId: header.submittedByGuestId,
    };
    const downloadRequestId = crypto.randomUUID();
    await this.appendDownloadAudit(
      album,
      review,
      submission,
      format,
      header.selectedCount,
      'download.requested',
      downloadRequestId,
    );

    const encoder = new TextEncoder();
    const formulaSafe = (value: string) =>
      /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value)
        ? `'${value}`
        : value;
    const csvCell = (value: string) =>
      `"${formulaSafe(value).replace(/"/g, '""')}"`;
    let after: { selectedAtMs: number; photoId: string } | null = null;
    let emitted = false;
    let completedCount = 0;
    const db = this.db;
    const owner = this.actor;
    const session = this.session;
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          if (!emitted) {
            emitted = true;
            if (format === 'csv')
              controller.enqueue(
                encoder.encode(
                  'photo_id,filename,version_no,version_id,selected_at\r\n',
                ),
              );
            if (format === 'json')
              controller.enqueue(
                encoder.encode(
                  `{"submission":${JSON.stringify(submitted)},"items":[`,
                ),
              );
          }
          if (completedCount < header.selectedCount) {
            const rows = await db
              .prepare(
                `SELECT i.photo_id AS photoId,i.version_id AS versionId,i.selected_at_ms AS selectedAtMs,
                 strftime('%Y-%m-%dT%H:%M:%fZ',i.selected_at_ms/1000.0,'unixepoch') AS selectedAt,
                 i.filename,i.version_no AS versionNo
               FROM shared_review_submission_items i JOIN shared_review_submission_seals seal ON seal.submission_id=i.submission_id
               JOIN owners o ON o.user_id=? AND o.enabled=1
               JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
               JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=o.user_id
               WHERE i.submission_id=? AND i.review_id=? AND i.workspace_id=? AND i.project_id=? AND i.album_id=?
                 AND (? IS NULL OR (i.selected_at_ms,i.photo_id)>(?,?))
               ORDER BY i.selected_at_ms,i.photo_id LIMIT 24`,
              )
              .bind(
                owner,
                session,
                submission,
                review,
                scope.workspaceId,
                scope.projectId,
                album,
                after?.selectedAtMs ?? null,
                after?.selectedAtMs ?? null,
                after?.photoId ?? null,
              )
              .all<{
                photoId: string;
                versionId: string;
                selectedAtMs: number;
                selectedAt: string;
                filename: string;
                versionNo: number;
              }>();
            if (!rows.results.length)
              throw new Error('SHARED_REVIEW_DOWNLOAD_INCOMPLETE');
            const chunks: string[] = [];
            for (const row of rows.results) {
              const item = {
                photoId: row.photoId,
                versionId: row.versionId,
                selectedAt: row.selectedAt,
                filename: row.filename,
                versionNo: row.versionNo,
              };
              if (format === 'csv')
                chunks.push(
                  `${csvCell(row.photoId)},${csvCell(row.filename)},${row.versionNo},${csvCell(row.versionId)},${csvCell(row.selectedAt)}\r\n`,
                );
              else if (format === 'txt') chunks.push(row.filename + '\n');
              else
                chunks.push(
                  `${completedCount > 0 ? ',' : ''}${JSON.stringify(item)}`,
                );
              completedCount += 1;
              after = { selectedAtMs: row.selectedAtMs, photoId: row.photoId };
            }
            controller.enqueue(encoder.encode(chunks.join('')));
            return;
          }
          await this.appendDownloadAudit(
            album,
            review,
            submission,
            format,
            header.selectedCount,
            'download.generated',
            downloadRequestId,
          );
          if (format === 'json') controller.enqueue(encoder.encode(']}'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type':
          format === 'json'
            ? 'application/json; charset=utf-8'
            : format === 'csv'
              ? 'text/csv; charset=utf-8'
              : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="shared-selection-${album}-round-${header.roundNo}.${format}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}

async function resolveGuestSession(db: D1Database, secret: string | null) {
  if (!secret) throw new GuestAccessDenied();
  let secretHash: string;
  try {
    secretHash = await hashGuestSessionSecret(secret);
  } catch {
    throw new GuestAccessDenied();
  }
  const session = await db
    .prepare(
      `SELECT s.id,s.guest_id,s.invite_id,i.workspace_id,i.project_id
     FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id
     WHERE s.secret_hash=?`,
    )
    .bind(secretHash)
    .first<GuestSessionScope>();
  if (!session) throw new GuestAccessDenied();
  return { session, secretHash };
}

export class D1GuestSharedReviews {
  constructor(private db: D1Database) {}

  async discover(secret: string | null, albumId: string) {
    const album = z.uuid().parse(albumId);
    const { secretHash } = await resolveGuestSession(this.db, secret);
    const rows = await this.db
      .prepare(
        `WITH current_scope AS (
         SELECT s.id AS sessionId,g.id AS guestId,i.id AS inviteId,i.workspace_id AS workspaceId,
           i.project_id AS projectId,ia.album_id AS albumId,i.permissions_mask AS permissionsMask
         FROM guest_sessions s JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
         JOIN guest_invites i ON i.id=s.invite_id JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
         JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
           AND ia.project_id=i.project_id AND ia.album_id=?
         JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
           AND a.project_id=i.project_id AND a.state='active'
         JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
           AND p.status NOT IN('archived','deleting','deleted')
         JOIN workspaces w ON w.id=i.workspace_id
         JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
         WHERE s.secret_hash=? AND s.expires_at_ms>unixepoch('subsec')*1000
           AND i.expires_at_ms>unixepoch('subsec')*1000
           AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
           AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
       ), eligible AS (
         SELECT r.id,r.album_id AS albumId,r.title,gs.guestId AS guestId,r.created_at_ms AS createdAtMs,
           rd.round_no AS roundNo,rd.revision,rd.status,rd.minimum,rd.maximum,
           CASE WHEN rd.submitted_at_ms IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',rd.submitted_at_ms/1000.0,'unixepoch') END AS submittedAt,
           (gs.permissionsMask & 8)=8 AS canSelect,(gs.permissionsMask & 512)=512 AS canSubmit,
           (gs.permissionsMask & ?)<>0 AS canView,
           (SELECT count(*) FROM shared_review_state st WHERE st.review_id=r.id AND st.selected=1) AS rawSelectedCount
         FROM current_scope gs JOIN shared_review_invites member ON member.invite_id=gs.inviteId
           AND member.album_id=gs.albumId AND member.workspace_id=gs.workspaceId AND member.project_id=gs.projectId
         JOIN shared_reviews r ON r.id=member.review_id AND r.workspace_id=member.workspace_id
           AND r.project_id=member.project_id AND r.album_id=member.album_id
         JOIN shared_review_seals seal ON seal.review_id=r.id AND seal.workspace_id=r.workspace_id
           AND seal.project_id=r.project_id AND seal.album_id=r.album_id
         JOIN shared_review_rounds rd ON rd.review_id=r.id
           AND rd.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=r.id)
         WHERE (gs.permissionsMask & 520)<>0
         ORDER BY r.created_at_ms DESC,r.id DESC LIMIT 20
       )
       SELECT eligible.id,eligible.guestId,eligible.albumId,eligible.title,eligible.roundNo,eligible.revision,eligible.status,
         eligible.minimum,eligible.maximum,eligible.canSelect,eligible.canSubmit,eligible.canView,
         CASE WHEN eligible.canSubmit=1 AND eligible.status='open'
           AND eligible.rawSelectedCount>=eligible.minimum
           AND (eligible.maximum IS NULL OR eligible.rawSelectedCount<=eligible.maximum) THEN 1 ELSE 0 END AS canSubmitNow,
         CASE WHEN eligible.canSelect=1 THEN eligible.rawSelectedCount ELSE NULL END AS selectedCount,
         eligible.submittedAt
       FROM current_scope gs LEFT JOIN eligible ON 1=1
       ORDER BY eligible.createdAtMs DESC,eligible.id DESC`,
      )
      .bind(album, secretHash, canViewBit)
      .all<GuestMetadataRow>();
    if (!rows.results.length) throw new GuestAccessDenied();
    const reviews = rows.results
      .filter((row) => row.id !== null)
      .map(guestMetadata);
    return guestSharedReviewListSchema.parse({ reviews });
  }

  async metadata(secret: string | null, albumId: string, reviewId: string) {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    const { secretHash } = await resolveGuestSession(this.db, secret);
    const row = await this.db
      .prepare(
        `SELECT r.id,g.id AS guestId,r.album_id AS albumId,r.title,rd.round_no AS roundNo,rd.revision,rd.status,
         rd.minimum,rd.maximum,(i.permissions_mask & 8)=8 AS canSelect,
         (i.permissions_mask & 512)=512 AS canSubmit,(i.permissions_mask & ? )<>0 AS canView,
         CASE WHEN (i.permissions_mask & 512)=512 AND rd.status='open'
           AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=r.id AND st.selected=1)>=rd.minimum
           AND (rd.maximum IS NULL OR (SELECT count(*) FROM shared_review_state st WHERE st.review_id=r.id AND st.selected=1)<=rd.maximum)
           THEN 1 ELSE 0 END AS canSubmitNow,
         CASE WHEN (i.permissions_mask & 8)=8
           THEN (SELECT count(*) FROM shared_review_state st WHERE st.review_id=r.id AND st.selected=1)
           ELSE NULL END AS selectedCount,
         CASE WHEN rd.submitted_at_ms IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',rd.submitted_at_ms/1000.0,'unixepoch') END AS submittedAt
       FROM guest_sessions s JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
       JOIN guest_invites i ON i.id=s.invite_id JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
       JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
         AND ia.project_id=i.project_id AND ia.album_id=?
       JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
       JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
       JOIN workspaces w ON w.id=i.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
       JOIN shared_reviews r ON r.id=? AND r.workspace_id=i.workspace_id AND r.project_id=i.project_id AND r.album_id=a.id
       JOIN shared_review_invites member ON member.review_id=r.id AND member.invite_id=i.id
         AND member.workspace_id=i.workspace_id AND member.project_id=i.project_id AND member.album_id=a.id
       JOIN shared_review_seals seal ON seal.review_id=r.id AND seal.workspace_id=r.workspace_id
         AND seal.project_id=r.project_id AND seal.album_id=r.album_id
       JOIN shared_review_rounds rd ON rd.review_id=r.id
         AND rd.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=r.id)
       WHERE s.secret_hash=? AND (i.permissions_mask & 520)<>0
         AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
         AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
         AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)`,
      )
      .bind(canViewBit, album, review, secretHash)
      .first<GuestMetadataRow>();
    if (!row) throw new GuestAccessDenied();
    return guestMetadata(row);
  }

  async selection(
    secret: string | null,
    albumId: string,
    reviewId: string,
    cursorInput?: string,
  ) {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    const cursor = decodeCursor(selectionCursorSchema, cursorInput);
    if (cursor && cursor.reviewId !== review)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const { secretHash } = await resolveGuestSession(this.db, secret);
    const rows = await this.db
      .prepare(
        `WITH current_scope AS (
         SELECT s.id AS sessionId,g.id AS guestId,i.id AS inviteId,i.workspace_id AS workspaceId,
           i.project_id AS projectId,ia.album_id AS albumId,i.permissions_mask AS permissionsMask,
           r.id AS reviewId,r.title,r.created_at_ms,
           rd.round_no AS roundNo,rd.revision,rd.status,rd.minimum,rd.maximum,rd.submitted_at_ms AS submittedAtMs
         FROM guest_sessions s JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
         JOIN guest_invites i ON i.id=s.invite_id JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
         JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
           AND ia.project_id=i.project_id AND ia.album_id=?
         JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
         JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
         JOIN workspaces w ON w.id=i.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
         JOIN shared_reviews r ON r.id=? AND r.workspace_id=i.workspace_id AND r.project_id=i.project_id AND r.album_id=a.id
         JOIN shared_review_invites member ON member.review_id=r.id AND member.invite_id=i.id
           AND member.workspace_id=i.workspace_id AND member.project_id=i.project_id AND member.album_id=a.id
         JOIN shared_review_seals seal ON seal.review_id=r.id AND seal.workspace_id=r.workspace_id
           AND seal.project_id=r.project_id AND seal.album_id=r.album_id
         JOIN shared_review_rounds rd ON rd.review_id=r.id
           AND rd.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=r.id)
         WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?
           AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
           AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
           AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
       ), meta AS (
         SELECT current_scope.*,(current_scope.permissionsMask & 512)=512 AS canSubmit,
           (current_scope.permissionsMask & ? )<>0 AS canView,
           (SELECT count(*) FROM shared_review_state st WHERE st.review_id=current_scope.reviewId AND st.selected=1) AS selectedCount
         FROM current_scope
       ), page AS (
         SELECT st.photo_id AS photoId,st.version_id AS versionId,st.selected_at_ms AS selectedAtMs,
           strftime('%Y-%m-%dT%H:%M:%fZ',st.selected_at_ms/1000.0,'unixepoch') AS selectedAt
         FROM meta JOIN shared_review_state st ON st.review_id=meta.reviewId AND st.selected=1
         WHERE (? IS NULL OR (st.selected_at_ms,st.photo_id)<(?,?))
         ORDER BY st.selected_at_ms DESC,st.photo_id DESC LIMIT 25
       )
       SELECT meta.reviewId AS id,meta.guestId,meta.albumId,meta.title,meta.roundNo,meta.revision,meta.status,
         meta.minimum,meta.maximum,1 AS canSelect,meta.canSubmit,meta.canView,
         CASE WHEN meta.canSubmit=1 AND meta.status='open' AND meta.selectedCount>=meta.minimum
           AND (meta.maximum IS NULL OR meta.selectedCount<=meta.maximum) THEN 1 ELSE 0 END AS canSubmitNow,
         meta.selectedCount,
         CASE WHEN meta.submittedAtMs IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',meta.submittedAtMs/1000.0,'unixepoch') END AS submittedAt,
         page.photoId,page.versionId,page.selectedAt,page.selectedAtMs
       FROM meta LEFT JOIN page ON 1=1 ORDER BY page.selectedAtMs DESC,page.photoId DESC`,
      )
      .bind(
        album,
        review,
        secretHash,
        canSelectBit,
        canSelectBit,
        canViewBit,
        cursor?.selectedAtMs ?? null,
        cursor?.selectedAtMs ?? null,
        cursor?.photoId ?? null,
      )
      .all<
        GuestMetadataRow & {
          photoId: string | null;
          versionId: string | null;
          selectedAt: string | null;
          selectedAtMs: number | null;
        }
      >();
    if (!rows.results.length) throw new GuestAccessDenied();
    const first = rows.results[0];
    if (!first) throw new GuestAccessDenied();
    if (
      cursor &&
      (cursor.roundNo !== first.roundNo || cursor.revision !== first.revision)
    )
      throw new WorkspaceFailure('SELECTION_CHANGED', 409);
    const items = rows.results
      .filter((row) => row.photoId !== null)
      .slice(0, 24)
      .map((row) => ({
        photoId: row.photoId as string,
        versionId: row.versionId as string,
        selectedAt: row.selectedAt as string,
      }));
    const last = rows.results.filter((row) => row.photoId !== null)[23];
    return sharedReviewSelectionPageSchema.parse({
      review: guestMetadata(first),
      items,
      nextCursor:
        rows.results.filter((row) => row.photoId !== null).length > 24 &&
        last?.photoId &&
        last.selectedAtMs !== null
          ? encodeCursor(selectionCursorSchema, {
              reviewId: review,
              roundNo: first.roundNo,
              revision: first.revision,
              selectedAtMs: last.selectedAtMs,
              photoId: last.photoId,
            })
          : null,
    });
  }
  async set(
    secret: string | null,
    albumId: string,
    reviewId: string,
    photoId: string,
    input: unknown,
  ) {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    const photo = z.uuid().parse(photoId);
    const request = setSharedReviewSelectionSchema.parse(input);
    const { session, secretHash } = await resolveGuestSession(this.db, secret);
    if (request.expectedGuestId !== session.guest_id)
      throw new GuestAccessDenied();
    const payloadJson = JSON.stringify({
      requestId: request.requestId,
      albumId: album,
      reviewId: review,
      expectedGuestId: request.expectedGuestId,
      roundNo: request.roundNo,
      photoId: photo,
      versionId: request.versionId,
      selected: request.selected,
    });
    try {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO shared_review_guest_commands(
          id,action,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,
          review_id,round_no,photo_id,version_id,selected,expected_revision,payload_json,created_at_ms
        ) VALUES(?,'set',?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          session.guest_id,
          request.expectedGuestId,
          session.invite_id,
          session.id,
          secretHash,
          request.requestId,
          session.workspace_id,
          session.project_id,
          album,
          review,
          request.roundNo,
          photo,
          request.versionId,
          request.selected ? 1 : 0,
          payloadJson,
          Date.now(),
        )
        .run();
    } catch (error) {
      guestSqlFailure(error);
    }
    const result = await this.db
      .prepare(
        `SELECT r.result_json AS resultJson
       FROM shared_review_guest_commands c JOIN shared_review_guest_results r ON r.command_id=c.id
       JOIN guest_sessions s ON s.id=? AND s.guest_id=c.guest_id AND s.invite_id=c.invite_id AND s.secret_hash=?
       JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
       JOIN guest_invites i ON i.id=c.invite_id AND i.workspace_id=c.workspace_id AND i.project_id=c.project_id
       JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
       JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=c.workspace_id
         AND ia.project_id=c.project_id AND ia.album_id=c.album_id
       JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id AND a.project_id=c.project_id AND a.state='active'
       JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id AND p.status NOT IN('archived','deleting','deleted')
       JOIN workspaces w ON w.id=c.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
       JOIN shared_review_invites member ON member.review_id=c.review_id AND member.invite_id=i.id
         AND member.workspace_id=c.workspace_id AND member.project_id=c.project_id AND member.album_id=c.album_id
       JOIN shared_review_seals seal ON seal.review_id=c.review_id AND seal.workspace_id=c.workspace_id
         AND seal.project_id=c.project_id AND seal.album_id=c.album_id
       WHERE c.action='set' AND c.guest_id=? AND c.session_id=s.id AND c.request_id=?
         AND (i.permissions_mask & ?)=? AND s.expires_at_ms>unixepoch('subsec')*1000
         AND i.expires_at_ms>unixepoch('subsec')*1000
         AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
         AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)`,
      )
      .bind(
        session.id,
        secretHash,
        session.guest_id,
        request.requestId,
        canSelectBit,
        canSelectBit,
      )
      .first<{ resultJson: string }>();
    if (!result) throw new GuestAccessDenied();
    return parseJson(
      sharedReviewSelectionResultSchema,
      result.resultJson,
      'SHARED_SELECTION_UNAVAILABLE',
    );
  }

  async submit(
    secret: string | null,
    albumId: string,
    reviewId: string,
    input: unknown,
  ) {
    const album = z.uuid().parse(albumId);
    const review = z.uuid().parse(reviewId);
    const request = submitSharedReviewSchema.parse(input);
    const { session, secretHash } = await resolveGuestSession(this.db, secret);
    if (request.expectedGuestId !== session.guest_id)
      throw new GuestAccessDenied();
    const payloadJson = JSON.stringify({
      requestId: request.requestId,
      albumId: album,
      reviewId: review,
      expectedGuestId: request.expectedGuestId,
      roundNo: request.roundNo,
      expectedRevision: request.expectedRevision,
    });
    try {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO shared_review_guest_commands(
          id,action,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,
          review_id,round_no,photo_id,version_id,selected,expected_revision,payload_json,created_at_ms
        ) VALUES(?,'submit',?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          session.guest_id,
          request.expectedGuestId,
          session.invite_id,
          session.id,
          secretHash,
          request.requestId,
          session.workspace_id,
          session.project_id,
          album,
          review,
          request.roundNo,
          request.expectedRevision,
          payloadJson,
          Date.now(),
        )
        .run();
    } catch (error) {
      guestSqlFailure(error, 'SHARED_SUBMISSION_UNAVAILABLE');
    }
    const result = await this.db
      .prepare(
        `SELECT r.result_json AS resultJson
       FROM shared_review_guest_commands c JOIN shared_review_guest_results r ON r.command_id=c.id
       JOIN guest_sessions s ON s.id=? AND s.guest_id=c.guest_id AND s.invite_id=c.invite_id AND s.secret_hash=?
       JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
       JOIN guest_invites i ON i.id=c.invite_id AND i.workspace_id=c.workspace_id AND i.project_id=c.project_id
       JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
       JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=c.workspace_id
         AND ia.project_id=c.project_id AND ia.album_id=c.album_id
       JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id AND a.project_id=c.project_id AND a.state='active'
       JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id AND p.status NOT IN('archived','deleting','deleted')
       JOIN workspaces w ON w.id=c.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
       JOIN shared_review_invites member ON member.review_id=c.review_id AND member.invite_id=i.id
         AND member.workspace_id=c.workspace_id AND member.project_id=c.project_id AND member.album_id=c.album_id
       JOIN shared_review_seals seal ON seal.review_id=c.review_id AND seal.workspace_id=c.workspace_id
         AND seal.project_id=c.project_id AND seal.album_id=c.album_id
       WHERE c.action='submit' AND c.guest_id=? AND c.session_id=s.id AND c.request_id=?
         AND (i.permissions_mask & ?)=? AND s.expires_at_ms>unixepoch('subsec')*1000
         AND i.expires_at_ms>unixepoch('subsec')*1000
         AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
         AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)`,
      )
      .bind(
        session.id,
        secretHash,
        session.guest_id,
        request.requestId,
        canSubmitBit,
        canSubmitBit,
      )
      .first<{ resultJson: string }>();
    if (!result) throw new GuestAccessDenied();
    return parseJson(
      sharedReviewSubmitResultSchema,
      result.resultJson,
      'SHARED_SUBMISSION_UNAVAILABLE',
    );
  }
}
