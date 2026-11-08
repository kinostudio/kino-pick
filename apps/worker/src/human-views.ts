import { z } from 'zod';
import {
  humanViewRequestSchema,
  humanViewResultSchema,
  type HumanViewRequest,
  type HumanViewResult,
} from '../../../packages/contracts/src/human-views';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { WorkspaceFailure } from './workspaces';

const uuidSchema = z.uuid();
const ownerSessionSchema = z.string().min(1).max(512);
const canViewBit = guestPermissionBit('can_view');
const canCompareBit = guestPermissionBit('can_compare_versions');
const DEDUPE_MS = 300_000;

type ViewStatusRow = {
  actorId: string;
  authorizationSessionId: string;
  databaseNowMs: number;
  lastViewedAtMs: number | null;
};
type InsertedViewRow = { eventId: string; viewedAtMs: number };
type ViewIdentityBase = {
  albumId: string;
  photoId: string;
  versionId: string;
  visibleForMs: number;
  expectedActorId: string;
  actorId: string;
  eventId: string;
  requestId: string;
};
type ViewIdentity = Readonly<
  ViewIdentityBase &
    (
      | { kind: 'owner'; authorizationSessionId: string; secretHash?: never }
      | { kind: 'guest'; secretHash: string; authorizationSessionId?: never }
    )
>;

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}
function parseUuid(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data.toLowerCase();
}
function unavailable(phase: string, requestId: string, error?: unknown): never {
  console.error('human_photo_view_unavailable', {
    phase,
    requestId,
    ...(error instanceof Error ? { message: error.message } : {}),
  });
  throw new WorkspaceFailure('HUMAN_PHOTO_VIEWS_UNAVAILABLE', 503);
}
function ownerDenied(): never {
  throw new WorkspaceFailure('NOT_FOUND', 404);
}
function actorChanged(): never {
  throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
}
function guestDenied(): never {
  throw new GuestAccessDenied();
}
function parseRequest(input: HumanViewRequest): HumanViewRequest {
  const parsed = humanViewRequestSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  return {
    ...parsed.data,
    photoId: parsed.data.photoId.toLowerCase(),
    versionId: parsed.data.versionId.toLowerCase(),
    expectedActorId: parsed.data.expectedActorId.toLowerCase(),
  };
}
function canonicalUuid(): string {
  return crypto.randomUUID().toLowerCase();
}
function validatedResult(
  recorded: boolean,
  nextAllowedAtMs: number,
  requestId: string,
): HumanViewResult {
  if (!Number.isSafeInteger(nextAllowedAtMs) || nextAllowedAtMs < 0)
    return unavailable('result_timestamp', requestId);
  const date = new Date(nextAllowedAtMs);
  if (!Number.isFinite(date.getTime()))
    return unavailable('result_timestamp', requestId);
  const parsed = humanViewResultSchema.safeParse({
    recorded,
    nextAllowedAt: date.toISOString(),
  });
  if (!parsed.success) return unavailable('result_schema', requestId);
  return parsed.data;
}

const ownerScopeSql = `
  SELECT 'user' AS actorType,o.user_id AS actorId,s.id AS authorizationSessionId,
    w.owner_user_id AS ownerUserId,w.id AS workspaceId,project.id AS projectId,
    album.id AS albumId,1 AS canCompare
  FROM owners o
  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2
    AND s.expiresAt>unixepoch('subsec')*1000
  JOIN workspaces w ON w.owner_user_id=o.user_id
  JOIN projects project ON project.workspace_id=w.id
    AND project.status NOT IN('archived','deleting','deleted')
  JOIN albums album ON album.project_id=project.id AND album.workspace_id=w.id
    AND album.id=?3 AND album.state='active'
  WHERE o.user_id=?1 AND o.enabled=1
`;

export const guestScopeSql = `
  SELECT 'guest' AS actorType,guest.id AS actorId,
    guest_session.id AS authorizationSessionId,w.owner_user_id AS ownerUserId,
    w.id AS workspaceId,project.id AS projectId,album.id AS albumId,
    CASE WHEN (invite.permissions_mask & ${canCompareBit})=${canCompareBit}
      THEN 1 ELSE 0 END AS canCompare
  FROM guest_sessions guest_session
  JOIN guest_identities guest ON guest.id=guest_session.guest_id
    AND guest.invite_id=guest_session.invite_id
  JOIN guest_invites invite ON invite.id=guest_session.invite_id
  JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
  JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
    AND invite_album.workspace_id=invite.workspace_id
    AND invite_album.project_id=invite.project_id AND invite_album.album_id=?3
  JOIN workspaces w ON w.id=invite.workspace_id
  JOIN owners owner ON owner.user_id=w.owner_user_id AND owner.enabled=1
    AND invite.created_by=owner.user_id
  JOIN projects project ON project.id=invite.project_id
    AND project.workspace_id=invite.workspace_id
    AND project.status NOT IN('archived','deleting','deleted')
  JOIN albums album ON album.id=invite_album.album_id
    AND album.workspace_id=invite.workspace_id AND album.project_id=invite.project_id
    AND album.state='active'
  WHERE guest_session.secret_hash=?1 AND guest.id=?2
    AND (invite.permissions_mask & ${canViewBit})=${canViewBit}
    AND guest_session.expires_at_ms>unixepoch('subsec')*1000
    AND ${guestInviteAlbumExpiryCondition('invite', 'invite_album.album_id')}
    AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r
      WHERE r.invite_id=invite.id)
    AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r
      WHERE r.session_id=guest_session.id)
`;

const versionPublicationPredicate = `
  (version.version_no=1 OR EXISTS(
    SELECT 1 FROM photo_version_head_commands c
    JOIN photo_version_head_results r ON r.command_id=c.id
    WHERE c.photo_id=photo.id AND c.workspace_id=photo.workspace_id
      AND c.project_id=photo.project_id AND c.album_id=photo.album_id
      AND c.version_id=version.id
      AND json_extract(r.result_json,'$.changed')=1))
`;

export function readyCtes(scopeSql: string): string {
  return `
    WITH authorized AS (${scopeSql}), ready AS (
      SELECT auth.actorType,auth.actorId,auth.authorizationSessionId,
        auth.ownerUserId,auth.workspaceId,auth.projectId,auth.albumId,
        auth.canCompare,photo.id AS photoId,head.version_id AS headVersionId,
        version.id AS versionId
      FROM authorized auth
      JOIN photos photo ON photo.workspace_id=auth.workspaceId
        AND photo.project_id=auth.projectId AND photo.album_id=auth.albumId
      JOIN photo_version_heads head ON head.photo_id=photo.id
        AND head.workspace_id=photo.workspace_id
        AND head.project_id=photo.project_id AND head.album_id=photo.album_id
      JOIN photo_versions version ON version.id=?5
        AND version.workspace_id=photo.workspace_id AND version.photo_id=photo.id
      JOIN photo_assets original ON original.version_id=version.id
        AND original.photo_id=photo.id AND original.workspace_id=photo.workspace_id
        AND original.asset_kind='original' AND original.state='private'
        AND original.byte_size=version.byte_size AND original.mime=version.mime
        AND original.checksum_sha256=version.source_hash_sha256
      LEFT JOIN upload_completions sourceV1 ON sourceV1.asset_id=original.id
        AND sourceV1.photo_id=photo.id AND sourceV1.version_id=version.id
        AND sourceV1.workspace_id=photo.workspace_id
        AND sourceV1.project_id=photo.project_id AND sourceV1.album_id=photo.album_id
        AND sourceV1.actor_id=auth.ownerUserId
      LEFT JOIN upload_version_completions sourceV2 ON sourceV2.asset_id=original.id
        AND sourceV2.photo_id=photo.id AND sourceV2.version_id=version.id
        AND sourceV2.workspace_id=photo.workspace_id
        AND sourceV2.project_id=photo.project_id AND sourceV2.album_id=photo.album_id
        AND sourceV2.actor_id=auth.ownerUserId
      JOIN upload_sessions sourceUpload
        ON sourceUpload.id=COALESCE(sourceV1.upload_session_id,sourceV2.upload_session_id)
        AND sourceUpload.workspace_id=photo.workspace_id
        AND sourceUpload.project_id=photo.project_id
        AND sourceUpload.album_id=photo.album_id
        AND sourceUpload.actor_id=auth.ownerUserId
        AND sourceUpload.object_key=original.object_key
      JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
      JOIN image_processing_outputs thumbnailSlot
        ON thumbnailSlot.job_id=job.id AND thumbnailSlot.kind='thumbnail'
      JOIN photo_assets thumbnail ON thumbnail.id=thumbnailSlot.asset_id
        AND thumbnail.object_key=thumbnailSlot.object_key
        AND thumbnail.version_id=version.id AND thumbnail.photo_id=photo.id
        AND thumbnail.workspace_id=photo.workspace_id
        AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private'
        AND thumbnail.mime='image/jpeg'
      JOIN image_processing_outputs previewSlot
        ON previewSlot.job_id=job.id AND previewSlot.kind='preview'
      JOIN photo_assets preview ON preview.id=previewSlot.asset_id
        AND preview.object_key=previewSlot.object_key
        AND preview.version_id=version.id AND preview.photo_id=photo.id
        AND preview.workspace_id=photo.workspace_id
        AND preview.asset_kind='preview' AND preview.state='private'
        AND preview.mime='image/jpeg'
      WHERE photo.id=?4 AND version.id=?5
        AND ((sourceV1.upload_session_id IS NOT NULL AND sourceV2.upload_session_id IS NULL)
          OR (sourceV2.upload_session_id IS NOT NULL AND sourceV1.upload_session_id IS NULL))
        AND (auth.actorType='user' OR version.id=head.version_id OR (
          auth.canCompare=1 AND ${versionPublicationPredicate}
        ))
    )
  `;
}

function insertSql(scopeSql: string): string {
  return `${readyCtes(scopeSql)}
    INSERT INTO human_photo_views(
      event_id,request_id,actor_type,actor_id,authorization_session_id,
      workspace_id,project_id,album_id,photo_id,version_id,viewed_at_ms,visible_for_ms
    )
    SELECT ?6,?7,ready.actorType,ready.actorId,ready.authorizationSessionId,
      ready.workspaceId,ready.projectId,ready.albumId,ready.photoId,ready.versionId,
      CAST(unixepoch('subsec')*1000 AS INTEGER),?8
    FROM ready
    WHERE NOT EXISTS(SELECT 1 FROM human_photo_views prior
      WHERE prior.authorization_session_id=ready.authorizationSessionId
        AND prior.actor_type=ready.actorType AND prior.actor_id=ready.actorId
        AND prior.album_id=ready.albumId
        AND prior.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)-${DEDUPE_MS})
    RETURNING event_id AS eventId,viewed_at_ms AS viewedAtMs
  `;
}

function statusSql(scopeSql: string): string {
  return `${readyCtes(scopeSql)}
    SELECT ready.actorId AS actorId,
      ready.authorizationSessionId AS authorizationSessionId,
      CAST(unixepoch('subsec')*1000 AS INTEGER) AS databaseNowMs,
      (SELECT prior.viewed_at_ms FROM human_photo_views prior
        WHERE prior.authorization_session_id=ready.authorizationSessionId
          AND prior.actor_type=ready.actorType AND prior.actor_id=ready.actorId
          AND prior.album_id=ready.albumId
        ORDER BY prior.viewed_at_ms DESC,prior.event_id DESC LIMIT 1) AS lastViewedAtMs
    FROM ready LIMIT 1
  `;
}

async function guestSecretHash(secret: string | null): Promise<string> {
  if (!secret) guestDenied();
  try {
    return await hashGuestSessionSecret(secret);
  } catch {
    guestDenied();
  }
}

export class D1HumanViewsRepository {
  constructor(private readonly db: D1Database) {}

  async owner(
    ownerIdInput: string,
    sessionIdInput: string,
    albumIdInput: string,
    input: HumanViewRequest,
  ): Promise<HumanViewResult> {
    const ownerId = parseUuid(ownerIdInput);
    const sessionParsed = ownerSessionSchema.safeParse(sessionIdInput);
    if (!sessionParsed.success) invalidInput();
    const albumId = parseUuid(albumIdInput);
    const request = parseRequest(input);
    if (request.expectedActorId !== ownerId) actorChanged();
    return this.record({
      kind: 'owner',
      albumId,
      photoId: request.photoId,
      versionId: request.versionId,
      visibleForMs: request.visibleForMs,
      expectedActorId: request.expectedActorId,
      actorId: ownerId,
      authorizationSessionId: sessionParsed.data,
      eventId: canonicalUuid(),
      requestId: canonicalUuid(),
    });
  }

  async guest(
    secret: string | null,
    albumIdInput: string,
    input: HumanViewRequest,
  ): Promise<HumanViewResult> {
    const albumId = parseUuid(albumIdInput);
    const request = parseRequest(input);
    const secretHash = await guestSecretHash(secret);
    return this.record({
      kind: 'guest',
      albumId,
      photoId: request.photoId,
      versionId: request.versionId,
      visibleForMs: request.visibleForMs,
      expectedActorId: request.expectedActorId,
      actorId: request.expectedActorId,
      secretHash,
      eventId: canonicalUuid(),
      requestId: canonicalUuid(),
    });
  }

  private async status(identity: ViewIdentity): Promise<ViewStatusRow | null> {
    const sql = statusSql(
      identity.kind === 'owner' ? ownerScopeSql : guestScopeSql,
    );
    const bindings =
      identity.kind === 'owner'
        ? [
            identity.actorId,
            identity.authorizationSessionId,
            identity.albumId,
            identity.photoId,
            identity.versionId,
          ]
        : [
            identity.secretHash,
            identity.expectedActorId,
            identity.albumId,
            identity.photoId,
            identity.versionId,
          ];
    try {
      const row = await this.db
        .prepare(sql)
        .bind(...bindings)
        .first<ViewStatusRow>();
      if (!row) return null;
      if (
        !Number.isSafeInteger(row.databaseNowMs) ||
        row.databaseNowMs < 0 ||
        (row.lastViewedAtMs !== null &&
          (!Number.isSafeInteger(row.lastViewedAtMs) || row.lastViewedAtMs < 0))
      ) {
        return unavailable('status_shape', identity.requestId);
      }
      return row;
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      return unavailable('status_query', identity.requestId, error);
    }
  }

  private async record(identity: ViewIdentity): Promise<HumanViewResult> {
    const authorizeOrDeny = async (): Promise<ViewStatusRow> => {
      const status = await this.status(identity);
      if (!status)
        return identity.kind === 'owner' ? ownerDenied() : guestDenied();
      return status;
    };
    const isRecent = (status: ViewStatusRow) =>
      status.lastViewedAtMs !== null &&
      status.lastViewedAtMs > status.databaseNowMs - DEDUPE_MS;
    const duplicateResult = (status: ViewStatusRow): HumanViewResult => {
      if (!isRecent(status) || status.lastViewedAtMs === null)
        return unavailable('dedupe_without_recent_witness', identity.requestId);
      return validatedResult(
        false,
        status.lastViewedAtMs + DEDUPE_MS,
        identity.requestId,
      );
    };

    // Current actor/session/scope and readiness are checked before the rolling dedupe.
    const before = await authorizeOrDeny();
    if (isRecent(before)) return duplicateResult(before);

    const sql = insertSql(
      identity.kind === 'owner' ? ownerScopeSql : guestScopeSql,
    );
    const bindings =
      identity.kind === 'owner'
        ? [
            identity.actorId,
            identity.authorizationSessionId,
            identity.albumId,
            identity.photoId,
            identity.versionId,
            identity.eventId,
            identity.requestId,
            identity.visibleForMs,
          ]
        : [
            identity.secretHash,
            identity.expectedActorId,
            identity.albumId,
            identity.photoId,
            identity.versionId,
            identity.eventId,
            identity.requestId,
            identity.visibleForMs,
          ];
    let inserted: InsertedViewRow | null;
    try {
      inserted = await this.db
        .prepare(sql)
        .bind(...bindings)
        .first<InsertedViewRow>();
    } catch (error) {
      const current = await authorizeOrDeny();
      if (isRecent(current)) return duplicateResult(current);
      return unavailable('view_insert', identity.requestId, error);
    }
    if (!inserted) {
      const current = await authorizeOrDeny();
      if (isRecent(current)) return duplicateResult(current);
      return unavailable('view_insert_without_witness', identity.requestId);
    }
    if (!Number.isSafeInteger(inserted.viewedAtMs) || inserted.viewedAtMs < 0)
      return unavailable('insert_return_shape', identity.requestId);
    return validatedResult(
      true,
      inserted.viewedAtMs + DEDUPE_MS,
      identity.requestId,
    );
  }
}
