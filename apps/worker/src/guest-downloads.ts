import { z } from 'zod';
import {
  guestDownloadFilename,
  guestDownloadKindSchema,
  guestDownloadPhotoSchema,
  guestDownloadsPageSchema,
  guestDownloadsQuerySchema,
  guestMediaDownloadAuditSchema,
  type GuestDownloadKind,
  type GuestDownloadsPage,
  type GuestDownloadsQuery,
} from '../../../packages/contracts/src/guest-downloads';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { WorkspaceFailure } from './workspaces';

const uuidSchema = z.uuid();
const canViewBit = guestPermissionBit('can_view');
const canDownloadPreviewBit = guestPermissionBit('can_download_preview');
const canDownloadOriginalBit = guestPermissionBit('can_download_original');
const maxDownloadBytes = 5_363_466_240;

const internalContextSchema = z
  .object({
    requestId: z.uuid(),
    guestId: z.uuid(),
    guestSessionId: z.uuid(),
    inviteId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    assetKind: guestDownloadKindSchema,
    assetId: z.uuid(),
    filename: z.string().min(1).max(255),
    byteSize: z.number().int().positive().safe().max(maxDownloadBytes),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    checksumSha256: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/u),
    objectKey: z.string().min(1).max(1024),
    storageNodeId: z.string().min(1).max(128),
  })
  .strict();

export type GuestMediaDownloadContext = z.infer<typeof internalContextSchema>;

type DownloadPageRow = {
  guestId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  expiresAt: string;
  permissionsMask: number;
  photoId: string | null;
  versionId: string | null;
  versionNo: number | null;
  filename: string | null;
  previewByteSize: number | null;
  previewMime: string | null;
  originalByteSize: number | null;
  originalMime: string | null;
  scopeMarker: number;
};

type AuditInsertRow = { requestId: string; afterJson: string };

type DownloadCandidateRow = {
  guestId: string;
  guestSessionId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  versionId: string;
  assetKind: GuestDownloadKind;
  assetId: string;
  filename: string;
  byteSize: number;
  mime: string;
  checksumSha256: string;
  objectKey: string;
  storageNodeId: string;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(code = 'GUEST_DOWNLOADS_UNAVAILABLE'): never {
  throw new WorkspaceFailure(code, 503);
}

function auditUnavailable(): never {
  return unavailable('DOWNLOAD_AUDIT_UNAVAILABLE');
}

function parseUuid(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

async function hashSecret(secret: string | null): Promise<string> {
  if (!secret) throw new GuestAccessDenied();
  try {
    return await hashGuestSessionSecret(secret);
  } catch {
    throw new GuestAccessDenied();
  }
}

function guestScopeSelect(
  requiredBit: number | 'anyDownload' | null,
  albumScoped = true,
): string {
  const permissionPredicate =
    requiredBit === null
      ? ''
      : requiredBit === 'anyDownload'
        ? `AND (i.permissions_mask & ${canDownloadPreviewBit | canDownloadOriginalBit})<>0`
        : `AND (i.permissions_mask & ${requiredBit})=${requiredBit}`;
  const albumPredicate = albumScoped ? 'AND ia.album_id=?' : '';
  return `
    SELECT s.id AS guestSessionId,g.id AS guestId,i.id AS inviteId,
      i.workspace_id AS workspaceId,i.project_id AS projectId,
      ia.album_id AS albumId,w.owner_user_id AS ownerUserId,
      i.permissions_mask AS permissionsMask,
      strftime('%Y-%m-%dT%H:%M:%fZ',
        min(s.expires_at_ms,COALESCE(effective_expiry.expires_at_ms,s.expires_at_ms))/1000.0,'unixepoch') AS expiresAt
    FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals sealed ON sealed.invite_id=i.id
    JOIN guest_invite_albums ia
      ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id
    JOIN effective_guest_invite_album_expiry effective_expiry
      ON effective_expiry.invite_id=i.id
      AND effective_expiry.workspace_id=i.workspace_id
      AND effective_expiry.project_id=i.project_id
      AND effective_expiry.album_id=ia.album_id AND effective_expiry.expiry_valid=1
    JOIN albums al
      ON al.id=ia.album_id AND al.workspace_id=i.workspace_id
      AND al.project_id=i.project_id AND al.state='active'
    JOIN projects pr
      ON pr.id=i.project_id AND pr.workspace_id=i.workspace_id
      AND pr.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o
      ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    WHERE s.secret_hash=? ${albumPredicate}
      ${permissionPredicate}
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  `;
}

const readyCurrentVersionJoinsSql = `
  JOIN photos p
    ON p.workspace_id=gs.workspaceId AND p.project_id=gs.projectId
    AND p.album_id=gs.albumId
  JOIN photo_version_heads head
    ON head.photo_id=p.id AND head.workspace_id=p.workspace_id
    AND head.project_id=p.project_id AND head.album_id=p.album_id
  JOIN photo_versions v
    ON v.id=head.version_id AND v.photo_id=p.id
    AND v.workspace_id=p.workspace_id
  JOIN photo_assets original
    ON original.version_id=v.id AND original.photo_id=p.id
    AND original.workspace_id=p.workspace_id AND original.asset_kind='original'
    AND original.state='private' AND original.byte_size=v.byte_size
    AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
  LEFT JOIN upload_completions sourceV1
    ON sourceV1.asset_id=original.id AND sourceV1.photo_id=p.id
    AND sourceV1.version_id=v.id AND sourceV1.workspace_id=p.workspace_id
    AND sourceV1.project_id=p.project_id AND sourceV1.album_id=p.album_id
    AND sourceV1.actor_id=gs.ownerUserId
  LEFT JOIN upload_version_completions sourceV2
    ON sourceV2.asset_id=original.id AND sourceV2.photo_id=p.id
    AND sourceV2.version_id=v.id AND sourceV2.workspace_id=p.workspace_id
    AND sourceV2.project_id=p.project_id AND sourceV2.album_id=p.album_id
    AND sourceV2.actor_id=gs.ownerUserId
  JOIN upload_sessions sourceUpload
    ON sourceUpload.id=COALESCE(sourceV1.upload_session_id,sourceV2.upload_session_id)
    AND sourceUpload.workspace_id=p.workspace_id
    AND sourceUpload.project_id=p.project_id AND sourceUpload.album_id=p.album_id
    AND sourceUpload.actor_id=gs.ownerUserId
    AND sourceUpload.object_key=original.object_key
  JOIN image_processing_jobs job
    ON job.id=original.id AND job.status='succeeded'
  JOIN image_processing_outputs thumbnail_slot
    ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
  JOIN photo_assets thumbnail
    ON thumbnail.id=thumbnail_slot.asset_id
    AND thumbnail.object_key=thumbnail_slot.object_key
    AND thumbnail.version_id=v.id AND thumbnail.photo_id=p.id
    AND thumbnail.workspace_id=p.workspace_id
    AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private'
    AND thumbnail.mime='image/jpeg'
  JOIN image_processing_outputs preview_slot
    ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
  JOIN photo_assets preview
    ON preview.id=preview_slot.asset_id
    AND preview.object_key=preview_slot.object_key
    AND preview.version_id=v.id AND preview.photo_id=p.id
    AND preview.workspace_id=p.workspace_id
    AND preview.asset_kind='preview' AND preview.state='private'
    AND preview.mime='image/jpeg'
`;

const sourceCompletionWitnessSql = `
  AND ((sourceV1.upload_session_id IS NOT NULL AND sourceV2.upload_session_id IS NULL)
    OR (sourceV2.upload_session_id IS NOT NULL AND sourceV1.upload_session_id IS NULL))
`;

const pageSql = `
  WITH guest_scope AS (${guestScopeSelect('anyDownload')}),
  page_rows AS (
    SELECT gs.guestId,gs.inviteId,gs.workspaceId,gs.projectId,gs.albumId,
      gs.expiresAt,gs.permissionsMask,
      p.id AS photoId,v.id AS versionId,v.version_no AS versionNo,
      sourceUpload.original_filename AS filename,
      CASE WHEN (gs.permissionsMask & ${canDownloadPreviewBit})=${canDownloadPreviewBit}
        THEN preview.byte_size END AS previewByteSize,
      CASE WHEN (gs.permissionsMask & ${canDownloadPreviewBit})=${canDownloadPreviewBit}
        THEN preview.mime END AS previewMime,
      CASE WHEN (gs.permissionsMask & ${canDownloadOriginalBit})=${canDownloadOriginalBit}
        THEN original.byte_size END AS originalByteSize,
      CASE WHEN (gs.permissionsMask & ${canDownloadOriginalBit})=${canDownloadOriginalBit}
        THEN original.mime END AS originalMime,
      0 AS scopeMarker
    FROM guest_scope gs
    ${readyCurrentVersionJoinsSql}
    WHERE p.id COLLATE BINARY > ? COLLATE BINARY
    ${sourceCompletionWitnessSql}
    ORDER BY p.id COLLATE BINARY
    LIMIT 25
  )
  SELECT guestId,inviteId,workspaceId,projectId,albumId,expiresAt,
    permissionsMask,photoId,versionId,versionNo,filename,
    previewByteSize,previewMime,originalByteSize,originalMime,scopeMarker
  FROM page_rows
  UNION ALL
  SELECT gs.guestId,gs.inviteId,gs.workspaceId,gs.projectId,gs.albumId,
    gs.expiresAt,gs.permissionsMask,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1
  FROM guest_scope gs
  WHERE NOT EXISTS(SELECT 1 FROM page_rows)
  ORDER BY scopeMarker,photoId COLLATE BINARY
`;

const requestInsertSql = (requiredBit: number) => `
  WITH guest_scope AS (${guestScopeSelect(requiredBit, false)}),
  wanted AS (SELECT ? AS assetKind,? AS photoId,? AS versionId),
  candidate AS (
    SELECT gs.guestSessionId,gs.guestId,gs.inviteId,gs.workspaceId,
      gs.projectId,gs.albumId,p.id AS photoId,v.id AS versionId,
      sourceUpload.original_filename AS filename,
      wanted.assetKind AS assetKind,
      CASE WHEN wanted.assetKind='preview' THEN preview.id ELSE original.id END AS assetId,
      CASE WHEN wanted.assetKind='preview' THEN preview.byte_size ELSE original.byte_size END AS byteSize,
      CASE WHEN wanted.assetKind='preview' THEN preview.mime ELSE original.mime END AS mime
    FROM guest_scope gs CROSS JOIN wanted
    ${readyCurrentVersionJoinsSql}
    WHERE p.id=wanted.photoId AND v.id=wanted.versionId
      ${sourceCompletionWitnessSql}
      AND ((wanted.assetKind='preview' AND
          (gs.permissionsMask & ${canDownloadPreviewBit})=${canDownloadPreviewBit})
        OR (wanted.assetKind='original' AND
          (gs.permissionsMask & ${canDownloadOriginalBit})=${canDownloadOriginalBit}))
  )
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,workspace_id,
    project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id
  )
  SELECT ?,'guest',candidate.guestId,candidate.guestSessionId,NULL,
    candidate.workspaceId,candidate.projectId,candidate.albumId,
    candidate.photoId,candidate.versionId,'download.requested',NULL,
    json_object('assetKind',candidate.assetKind,'assetId',candidate.assetId,
      'filename',candidate.filename,'byteSize',candidate.byteSize,
      'mime',candidate.mime),?
  FROM candidate
  RETURNING request_id AS requestId,after_json AS afterJson
`;

const currentRequestCandidateSql = `
  WITH guest_scope AS (${guestScopeSelect(null, false)}),
  wanted AS (
    SELECT ? AS assetKind,? AS requestId,? AS afterJson,
      ? AS photoId,? AS versionId
  ),
  candidate AS (
    SELECT gs.guestSessionId,gs.guestId,gs.inviteId,gs.workspaceId,
      gs.projectId,gs.albumId,p.id AS photoId,v.id AS versionId,
      wanted.assetKind AS assetKind,
      CASE WHEN wanted.assetKind='preview' THEN preview.id ELSE original.id END AS assetId,
      sourceUpload.original_filename AS filename,
      CASE WHEN wanted.assetKind='preview' THEN preview.byte_size ELSE original.byte_size END AS byteSize,
      CASE WHEN wanted.assetKind='preview' THEN preview.mime ELSE original.mime END AS mime,
      CASE WHEN wanted.assetKind='preview' THEN preview.checksum_sha256 ELSE original.checksum_sha256 END AS checksumSha256,
      CASE WHEN wanted.assetKind='preview' THEN preview.object_key ELSE original.object_key END AS objectKey,
      CASE WHEN wanted.assetKind='preview' THEN preview.storage_node_id ELSE original.storage_node_id END AS storageNodeId
    FROM guest_scope gs CROSS JOIN wanted
    ${readyCurrentVersionJoinsSql}
    JOIN audit_events requested
      ON requested.action='download.requested'
      AND requested.request_id=wanted.requestId
      AND requested.actor_type='guest' AND requested.actor_id=gs.guestId
      AND requested.guest_session_id=gs.guestSessionId
      AND requested.session_id IS NULL
      AND requested.workspace_id=gs.workspaceId
      AND requested.project_id=gs.projectId
      AND requested.album_id=gs.albumId
      AND requested.photo_id=p.id AND requested.version_id=v.id
      AND requested.before_json IS NULL
      AND requested.after_json=wanted.afterJson
    WHERE p.id=wanted.photoId AND v.id=wanted.versionId
      ${sourceCompletionWitnessSql}
      AND ((wanted.assetKind='preview' AND
          (gs.permissionsMask & ${canDownloadPreviewBit})=${canDownloadPreviewBit})
        OR (wanted.assetKind='original' AND
          (gs.permissionsMask & ${canDownloadOriginalBit})=${canDownloadOriginalBit}))
      AND wanted.afterJson=json_object(
        'assetKind',wanted.assetKind,
        'assetId',CASE WHEN wanted.assetKind='preview' THEN preview.id ELSE original.id END,
        'filename',sourceUpload.original_filename,
        'byteSize',CASE WHEN wanted.assetKind='preview' THEN preview.byte_size ELSE original.byte_size END,
        'mime',CASE WHEN wanted.assetKind='preview' THEN preview.mime ELSE original.mime END
      )
  )
  SELECT * FROM candidate LIMIT 1
`;

const generatedInsertSql = `
  WITH guest_scope AS (${guestScopeSelect(null, false)}),
  wanted AS (
    SELECT ? AS requestId,? AS afterJson,? AS guestId,? AS guestSessionId,
      ? AS inviteId,? AS workspaceId,? AS projectId,? AS albumId,
      ? AS photoId,? AS versionId,? AS assetKind,? AS assetId,
      ? AS filename,? AS byteSize,? AS mime,? AS checksumSha256,
      ? AS objectKey,? AS storageNodeId
  ),
  candidate AS (
    SELECT gs.guestSessionId,gs.guestId,gs.inviteId,gs.workspaceId,
      gs.projectId,gs.albumId,p.id AS photoId,v.id AS versionId,
      wanted.assetKind AS assetKind,
      CASE WHEN wanted.assetKind='preview' THEN preview.id ELSE original.id END AS assetId,
      sourceUpload.original_filename AS filename,
      CASE WHEN wanted.assetKind='preview' THEN preview.byte_size ELSE original.byte_size END AS byteSize,
      CASE WHEN wanted.assetKind='preview' THEN preview.mime ELSE original.mime END AS mime,
      CASE WHEN wanted.assetKind='preview' THEN preview.checksum_sha256 ELSE original.checksum_sha256 END AS checksumSha256,
      CASE WHEN wanted.assetKind='preview' THEN preview.object_key ELSE original.object_key END AS objectKey,
      CASE WHEN wanted.assetKind='preview' THEN preview.storage_node_id ELSE original.storage_node_id END AS storageNodeId,
      wanted.requestId AS requestId,wanted.afterJson AS afterJson
    FROM guest_scope gs CROSS JOIN wanted
    ${readyCurrentVersionJoinsSql}
    JOIN audit_events requested
      ON requested.action='download.requested'
      AND requested.request_id=wanted.requestId
      AND requested.actor_type='guest' AND requested.actor_id=gs.guestId
      AND requested.guest_session_id=gs.guestSessionId
      AND requested.session_id IS NULL
      AND requested.workspace_id=gs.workspaceId
      AND requested.project_id=gs.projectId
      AND requested.album_id=gs.albumId
      AND requested.photo_id=p.id AND requested.version_id=v.id
      AND requested.before_json IS NULL
      AND requested.after_json=wanted.afterJson
    WHERE gs.guestId=wanted.guestId
      AND gs.guestSessionId=wanted.guestSessionId AND gs.inviteId=wanted.inviteId
      AND gs.workspaceId=wanted.workspaceId AND gs.projectId=wanted.projectId
      AND gs.albumId=wanted.albumId AND p.id=wanted.photoId
      AND v.id=wanted.versionId AND wanted.assetKind IN('preview','original')
      ${sourceCompletionWitnessSql}
      AND ((wanted.assetKind='preview' AND
          (gs.permissionsMask & ${canDownloadPreviewBit})=${canDownloadPreviewBit})
        OR (wanted.assetKind='original' AND
          (gs.permissionsMask & ${canDownloadOriginalBit})=${canDownloadOriginalBit}))
      AND wanted.afterJson=json_object(
        'assetKind',wanted.assetKind,
        'assetId',CASE WHEN wanted.assetKind='preview' THEN preview.id ELSE original.id END,
        'filename',sourceUpload.original_filename,
        'byteSize',CASE WHEN wanted.assetKind='preview' THEN preview.byte_size ELSE original.byte_size END,
        'mime',CASE WHEN wanted.assetKind='preview' THEN preview.mime ELSE original.mime END
      )
      AND wanted.assetId=CASE WHEN wanted.assetKind='preview' THEN preview.id ELSE original.id END
      AND wanted.filename=sourceUpload.original_filename
      AND wanted.byteSize=CASE WHEN wanted.assetKind='preview' THEN preview.byte_size ELSE original.byte_size END
      AND wanted.mime=CASE WHEN wanted.assetKind='preview' THEN preview.mime ELSE original.mime END
      AND wanted.checksumSha256=CASE WHEN wanted.assetKind='preview' THEN preview.checksum_sha256 ELSE original.checksum_sha256 END
      AND wanted.objectKey=CASE WHEN wanted.assetKind='preview' THEN preview.object_key ELSE original.object_key END
      AND wanted.storageNodeId=CASE WHEN wanted.assetKind='preview' THEN preview.storage_node_id ELSE original.storage_node_id END
  )
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,workspace_id,
    project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id
  )
  SELECT ?,'guest',candidate.guestId,candidate.guestSessionId,NULL,
    candidate.workspaceId,candidate.projectId,candidate.albumId,
    candidate.photoId,candidate.versionId,'download.generated',NULL,
    candidate.afterJson,candidate.requestId
  FROM candidate
  RETURNING event_id AS eventId
`;

export class D1GuestDownloadsRepository {
  constructor(private readonly db: D1Database) {}

  async page(
    secret: string | null,
    albumIdInput: string,
    queryInput: GuestDownloadsQuery,
  ): Promise<GuestDownloadsPage> {
    const albumId = parseUuid(albumIdInput);
    const parsedQuery = guestDownloadsQuerySchema.safeParse(queryInput);
    if (!parsedQuery.success) invalidInput();
    const afterPhotoId = (parsedQuery.data.cursor ?? '').toLowerCase();
    const hash = await hashSecret(secret);

    let result: D1Result<DownloadPageRow>;
    try {
      result = await this.db
        .prepare(pageSql)
        .bind(hash, albumId, afterPhotoId)
        .all<DownloadPageRow>();
    } catch {
      return unavailable();
    }
    if (result.results.length === 0) throw new GuestAccessDenied();
    const pageRows = result.results.filter((row) => row.scopeMarker === 0);
    const anchor = result.results[0];
    if (!anchor) throw new GuestAccessDenied();

    const permissions = {
      can_view: (anchor.permissionsMask & canViewBit) !== 0,
      can_download_preview:
        (anchor.permissionsMask & canDownloadPreviewBit) !== 0,
      can_download_original:
        (anchor.permissionsMask & canDownloadOriginalBit) !== 0,
    };
    const photos = pageRows.slice(0, 24).map((row) => {
      if (
        row.photoId === null ||
        row.versionId === null ||
        row.versionNo === null ||
        row.filename === null
      )
        return unavailable();
      const preview =
        permissions.can_download_preview &&
        row.previewByteSize !== null &&
        row.previewMime !== null
          ? {
              filename: guestDownloadFilename(row.filename, 'preview'),
              byteSize: row.previewByteSize,
              mime: row.previewMime,
            }
          : null;
      const original =
        permissions.can_download_original &&
        row.originalByteSize !== null &&
        row.originalMime !== null
          ? {
              filename: row.filename,
              byteSize: row.originalByteSize,
              mime: row.originalMime,
            }
          : null;
      const parsed = guestDownloadPhotoSchema.safeParse({
        photoId: row.photoId,
        versionId: row.versionId,
        versionNo: row.versionNo,
        filename: row.filename,
        preview,
        original,
      });
      if (!parsed.success) return unavailable();
      return parsed.data;
    });
    const last = photos.at(-1);
    const page = guestDownloadsPageSchema.safeParse({
      access: {
        guestId: anchor.guestId,
        inviteId: anchor.inviteId,
        workspaceId: anchor.workspaceId,
        projectId: anchor.projectId,
        albumId: anchor.albumId,
        expiresAt: anchor.expiresAt,
        permissions,
      },
      photos,
      nextCursor: pageRows.length > 24 && last ? last.photoId : null,
    });
    if (!page.success) return unavailable();
    return page.data;
  }

  async request(
    secret: string | null,
    photoIdInput: string,
    versionIdInput: string,
    kindInput: GuestDownloadKind,
  ): Promise<GuestMediaDownloadContext> {
    const photoId = parseUuid(photoIdInput);
    const versionId = parseUuid(versionIdInput);
    const parsedKind = guestDownloadKindSchema.safeParse(kindInput);
    if (!parsedKind.success) invalidInput();
    const kind = parsedKind.data;
    const requiredBit =
      kind === 'preview' ? canDownloadPreviewBit : canDownloadOriginalBit;
    const hash = await hashSecret(secret);
    const requestId = crypto.randomUUID();
    const eventId = crypto.randomUUID();

    let inserted: D1Result<AuditInsertRow>;
    try {
      inserted = await this.db
        .prepare(requestInsertSql(requiredBit))
        .bind(hash, kind, photoId, versionId, eventId, requestId)
        .all<AuditInsertRow>();
    } catch (error) {
      console.error('guest_download_audit_failed', {
        phase: 'request',
        requestId,
        message: error instanceof Error ? error.message : 'unknown',
      });
      return auditUnavailable();
    }
    if (inserted.results.length === 0) throw new GuestAccessDenied();
    if (inserted.meta.changes !== 1 || inserted.results.length !== 1) {
      console.error('guest_download_audit_result_unexpected', {
        phase: 'request',
        requestId,
        changes: inserted.meta.changes,
        resultCount: inserted.results.length,
      });
      return auditUnavailable();
    }
    const audit = inserted.results[0];
    if (!audit || audit.requestId !== requestId) {
      console.error('guest_download_audit_result_unexpected', {
        phase: 'request',
        requestId,
        changes: inserted.meta.changes,
        resultCount: inserted.results.length,
      });
      return auditUnavailable();
    }

    const after = parseAuditPayload(audit.afterJson, kind);
    let row: DownloadCandidateRow | null;
    try {
      row = await this.db
        .prepare(currentRequestCandidateSql)
        .bind(hash, kind, requestId, audit.afterJson, photoId, versionId)
        .first<DownloadCandidateRow>();
    } catch {
      return unavailable();
    }
    if (!row) throw new GuestAccessDenied();
    const context = internalContextSchema.safeParse({
      requestId,
      ...row,
    });
    if (!context.success) return unavailable();
    if (
      context.data.assetId !== after.assetId ||
      context.data.assetKind !== after.assetKind ||
      context.data.filename !== after.filename ||
      context.data.byteSize !== after.byteSize ||
      context.data.mime !== after.mime
    )
      return unavailable();
    return context.data;
  }

  async generated(
    secret: string | null,
    contextInput: GuestMediaDownloadContext,
  ): Promise<void> {
    const parsedContext = internalContextSchema.safeParse(contextInput);
    if (!parsedContext.success) return auditUnavailable();
    const context = parsedContext.data;
    const hash = await hashSecret(secret);
    const payload = guestMediaDownloadAuditSchema.parse({
      assetKind: context.assetKind,
      assetId: context.assetId,
      filename: context.filename,
      byteSize: context.byteSize,
      mime: context.mime,
    });
    const afterJson = JSON.stringify({
      assetKind: payload.assetKind,
      assetId: payload.assetId,
      filename: payload.filename,
      byteSize: payload.byteSize,
      mime: payload.mime,
    });
    const eventId = crypto.randomUUID();

    let inserted: D1Result<{ eventId: string }>;
    try {
      inserted = await this.db
        .prepare(generatedInsertSql)
        .bind(
          hash,
          context.requestId,
          afterJson,
          context.guestId,
          context.guestSessionId,
          context.inviteId,
          context.workspaceId,
          context.projectId,
          context.albumId,
          context.photoId,
          context.versionId,
          context.assetKind,
          context.assetId,
          context.filename,
          context.byteSize,
          context.mime,
          context.checksumSha256,
          context.objectKey,
          context.storageNodeId,
          eventId,
        )
        .all<{ eventId: string }>();
    } catch (error) {
      console.error('guest_download_audit_failed', {
        phase: 'generated',
        requestId: context.requestId,
        message: error instanceof Error ? error.message : 'unknown',
      });
      return auditUnavailable();
    }
    if (inserted.results.length === 0) throw new GuestAccessDenied();
    if (inserted.meta.changes !== 1 || inserted.results.length !== 1) {
      console.error('guest_download_audit_result_unexpected', {
        phase: 'generated',
        requestId: context.requestId,
        changes: inserted.meta.changes,
        resultCount: inserted.results.length,
      });
      return auditUnavailable();
    }
    if (inserted.results[0]?.eventId !== eventId) {
      console.error('guest_download_audit_result_unexpected', {
        phase: 'generated',
        requestId: context.requestId,
        changes: inserted.meta.changes,
        resultCount: inserted.results.length,
      });
      return auditUnavailable();
    }
  }
}

function parseAuditPayload(afterJson: string, expectedKind: GuestDownloadKind) {
  let json: unknown;
  try {
    json = JSON.parse(afterJson) as unknown;
  } catch {
    return unavailable();
  }
  const parsed = guestMediaDownloadAuditSchema.safeParse(json);
  if (!parsed.success || parsed.data.assetKind !== expectedKind)
    return unavailable();
  return parsed.data;
}
