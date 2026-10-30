import { z } from 'zod';
import {
  ownerPhotoVersionsPageSchema,
  photoVersionItemSchema,
  setCurrentPhotoVersionResultSchema,
  setCurrentPhotoVersionSchema,
} from '../../../packages/contracts/src/photo-versions';
import { WorkspaceFailure } from './workspaces';

const photoVersionCursorPositionSchema = z
  .object({ photoId: z.uuid(), versionNo: z.number().int().positive().safe() })
  .strict();

const photoVersionCursorSchema = z
  .object({
    photoId: z.uuid(),
    versionNo: z.number().int().positive().safe(),
    currentVersionId: z.uuid(),
    revision: z.number().int().nonnegative().safe(),
  })
  .strict();

type PhotoVersionCursor =
  | z.infer<typeof photoVersionCursorPositionSchema>
  | z.infer<typeof photoVersionCursorSchema>;

type PhotoVersionRow = {
  photoId: string | null;
  currentVersionId: string | null;
  currentRevision: number | null;
  currentVersionMetadataId: string | null;
  currentVersionNo: number | null;
  currentVersionCreatedAt: string | null;
  currentVersionWidth: number | null;
  currentVersionHeight: number | null;
  currentVersionProcessing: string | null;
  currentThumbnailAvailable: number | null;
  currentPreviewAvailable: number | null;
  id: string | null;
  versionNo: number | null;
  createdAt: string | null;
  width: number | null;
  height: number | null;
  processing: string | null;
  authorizedMarker: number;
};

type PhotoVersionScope = {
  workspace_id: string;
  project_id: string;
  album_id: string;
  current_version_id: string | null;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('PHOTO_VERSION_UNAVAILABLE', 503);
}

function decodePhotoVersionCursor(
  token: string | undefined,
  photoId: string,
): PhotoVersionCursor | null {
  if (token === undefined) return null;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 256 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  )
    invalidInput();

  let cursor: PhotoVersionCursor;
  try {
    const bytes = Buffer.from(token, 'base64url');
    if (
      bytes.length === 0 ||
      bytes.length > 160 ||
      bytes.toString('base64url') !== token
    )
      invalidInput();
    const decoded: unknown = JSON.parse(bytes.toString('utf8')) as unknown;
    const pinned = photoVersionCursorSchema.safeParse(decoded);
    if (pinned.success) cursor = pinned.data;
    else {
      const legacy = photoVersionCursorPositionSchema.safeParse(decoded);
      if (!legacy.success) invalidInput();
      cursor = legacy.data;
    }
  } catch {
    invalidInput();
  }

  if (cursor.photoId !== photoId) invalidInput();
  return cursor;
}

function encodePhotoVersionCursor(
  cursor: z.infer<typeof photoVersionCursorSchema>,
): string {
  return Buffer.from(
    JSON.stringify(photoVersionCursorSchema.parse(cursor)),
    'utf8',
  ).toString('base64url');
}

function translatePhotoVersionError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('OWNER_REQUIRED'))
    throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND'))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (message.includes('RESOURCE_NOT_EDITABLE'))
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (message.includes('PHOTO_VERSION_REVISION_CONFLICT'))
    throw new WorkspaceFailure('PHOTO_VERSION_REVISION_CONFLICT', 409);
  if (message.includes('PHOTO_VERSION_REVISION_EXHAUSTED'))
    throw new WorkspaceFailure('PHOTO_VERSION_REVISION_EXHAUSTED', 409);
  if (message.includes('PHOTO_VERSION_NOT_READY'))
    throw new WorkspaceFailure('PHOTO_VERSION_NOT_READY', 409);
  if (message.includes('INVALID_INPUT'))
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (
    message.includes('PHOTO_VERSION_HEAD') ||
    message.includes('INVALID_TIMESTAMP')
  )
    throw new WorkspaceFailure('PHOTO_VERSION_UNAVAILABLE', 503);
  throw error;
}

function photoVersionPageSql() {
  return [
    'WITH authorized AS (',
    '  SELECT p.id AS photoId,p.workspace_id AS workspaceId,',
    '    p.project_id AS projectId,p.album_id AS albumId,',
    '    h.version_id AS currentVersionId,h.revision AS currentRevision',
    '  FROM photos p',
    '  JOIN photo_version_heads h',
    '    ON h.photo_id=p.id AND h.workspace_id=p.workspace_id',
    '      AND h.project_id=p.project_id AND h.album_id=p.album_id',
    '  JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    '  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    '  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "    AND s.expiresAt>unixepoch('subsec')*1000",
    '  JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id',
    '  JOIN albums al ON al.id=p.album_id AND al.workspace_id=p.workspace_id',
    '    AND al.project_id=p.project_id',
    "  WHERE p.id=? AND pr.status NOT IN('deleting','deleted')",
    "    AND al.state NOT IN('deleting','deleted')",
    '), current_version AS (',
    '  SELECT auth.photoId,v.id AS currentVersionMetadataId,',
    '    v.version_no AS currentVersionNo,v.created_at AS currentVersionCreatedAt,',
    '    v.width AS currentVersionWidth,v.height AS currentVersionHeight,',
    '    CASE',
    "      WHEN j.status='succeeded'",
    "        AND original.id IS NOT NULL AND original.state='private'",
    '        AND original.byte_size=v.byte_size AND original.mime=v.mime',
    '        AND original.checksum_sha256=v.source_hash_sha256',
    '        AND thumb.id IS NOT NULL AND preview.id IS NOT NULL',
    "      THEN 'succeeded'",
    "      WHEN j.status='succeeded' THEN 'unavailable'",
    "      ELSE COALESCE(j.status,'unavailable')",
    '    END AS currentVersionProcessing,',
    '    CASE',
    "      WHEN original.id IS NOT NULL AND original.state='private'",
    '        AND original.byte_size=v.byte_size AND original.mime=v.mime',
    '        AND original.checksum_sha256=v.source_hash_sha256',
    '        AND thumb.id IS NOT NULL THEN 1',
    '      ELSE 0',
    '    END AS currentThumbnailAvailable,',
    '    CASE',
    "      WHEN original.id IS NOT NULL AND original.state='private'",
    '        AND original.byte_size=v.byte_size AND original.mime=v.mime',
    '        AND original.checksum_sha256=v.source_hash_sha256',
    '        AND preview.id IS NOT NULL THEN 1',
    '      ELSE 0',
    '    END AS currentPreviewAvailable',
    '  FROM authorized auth',
    '  JOIN photos p ON p.id=auth.photoId AND p.workspace_id=auth.workspaceId',
    '    AND p.project_id=auth.projectId AND p.album_id=auth.albumId',
    '  JOIN photo_versions v ON v.id=auth.currentVersionId',
    '    AND v.photo_id=auth.photoId AND v.workspace_id=auth.workspaceId',
    '  LEFT JOIN photo_assets original',
    '    ON original.version_id=v.id AND original.photo_id=auth.photoId',
    '      AND original.workspace_id=auth.workspaceId',
    "      AND original.asset_kind='original'",
    '  LEFT JOIN image_processing_jobs j ON j.id=original.id',
    '  LEFT JOIN image_processing_outputs thumb_slot',
    "    ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'",
    '  LEFT JOIN photo_assets thumb',
    '    ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key',
    '      AND thumb.version_id=v.id AND thumb.photo_id=auth.photoId',
    '      AND thumb.workspace_id=auth.workspaceId',
    "      AND thumb.asset_kind='thumbnail' AND thumb.state='private'",
    "      AND thumb.mime='image/jpeg'",
    '  LEFT JOIN image_processing_outputs preview_slot',
    "    ON preview_slot.job_id=j.id AND preview_slot.kind='preview'",
    '  LEFT JOIN photo_assets preview',
    '    ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key',
    '      AND preview.version_id=v.id AND preview.photo_id=auth.photoId',
    '      AND preview.workspace_id=auth.workspaceId',
    "      AND preview.asset_kind='preview' AND preview.state='private'",
    "      AND preview.mime='image/jpeg'",
    '), page_rows AS (',
    '  SELECT auth.photoId,auth.currentVersionId,auth.currentRevision,',
    '    cv.currentVersionMetadataId,cv.currentVersionNo,',
    '    cv.currentVersionCreatedAt,cv.currentVersionWidth,cv.currentVersionHeight,',
    '    cv.currentVersionProcessing,cv.currentThumbnailAvailable,',
    '    cv.currentPreviewAvailable,',
    '    v.id,v.version_no AS versionNo,v.created_at AS createdAt,v.width,v.height,',
    '    CASE',
    "      WHEN j.status='succeeded'",
    "        AND original.id IS NOT NULL AND original.state='private'",
    '        AND original.byte_size=v.byte_size AND original.mime=v.mime',
    '        AND original.checksum_sha256=v.source_hash_sha256',
    '        AND thumb.id IS NOT NULL AND preview.id IS NOT NULL',
    "      THEN 'succeeded'",
    "      WHEN j.status='succeeded' THEN 'unavailable'",
    "      ELSE COALESCE(j.status,'unavailable')",
    '    END AS processing,',
    '    0 AS authorizedMarker',
    '  FROM authorized auth',
    '  JOIN current_version cv ON cv.photoId=auth.photoId',
    '  JOIN photo_versions v',
    '    ON v.photo_id=auth.photoId AND v.workspace_id=auth.workspaceId',
    '  LEFT JOIN photo_assets original',
    '    ON original.version_id=v.id AND original.photo_id=auth.photoId',
    '      AND original.workspace_id=auth.workspaceId',
    "      AND original.asset_kind='original'",
    '  LEFT JOIN image_processing_jobs j ON j.id=original.id',
    '  LEFT JOIN image_processing_outputs thumb_slot',
    "    ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'",
    '  LEFT JOIN photo_assets thumb',
    '    ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key',
    '      AND thumb.version_id=v.id AND thumb.photo_id=auth.photoId',
    '      AND thumb.workspace_id=auth.workspaceId',
    "      AND thumb.asset_kind='thumbnail' AND thumb.state='private'",
    "      AND thumb.mime='image/jpeg'",
    '  LEFT JOIN image_processing_outputs preview_slot',
    "    ON preview_slot.job_id=j.id AND preview_slot.kind='preview'",
    '  LEFT JOIN photo_assets preview',
    '    ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key',
    '      AND preview.version_id=v.id AND preview.photo_id=auth.photoId',
    '      AND preview.workspace_id=auth.workspaceId',
    "      AND preview.asset_kind='preview' AND preview.state='private'",
    "      AND preview.mime='image/jpeg'",
    '  WHERE (? IS NULL OR v.version_no<?)',
    '  ORDER BY v.version_no DESC',
    '  LIMIT 25',
    ')',
    'SELECT photoId,currentVersionId,currentRevision,currentVersionMetadataId,',
    '  currentVersionNo,currentVersionCreatedAt,currentVersionWidth,',
    '  currentVersionHeight,currentVersionProcessing,currentThumbnailAvailable,',
    '  currentPreviewAvailable,id,versionNo,createdAt,width,height,processing,',
    '  authorizedMarker',
    'FROM page_rows',
    'UNION ALL',
    'SELECT auth.photoId,auth.currentVersionId,auth.currentRevision,',
    '  cv.currentVersionMetadataId,cv.currentVersionNo,cv.currentVersionCreatedAt,',
    '  cv.currentVersionWidth,cv.currentVersionHeight,cv.currentVersionProcessing,',
    '  cv.currentThumbnailAvailable,cv.currentPreviewAvailable,',
    "  NULL,NULL,NULL,NULL,NULL,'unavailable',1",
    'FROM authorized auth',
    'LEFT JOIN current_version cv ON cv.photoId=auth.photoId',
    'WHERE NOT EXISTS(SELECT 1 FROM page_rows)',
    'ORDER BY versionNo DESC',
  ].join('\n');
}

function currentOwnerCheckSql() {
  return [
    'SELECT 1 AS authorized',
    'FROM owners o',
    'JOIN owner_sessions s ON s.userId=o.user_id',
    "  AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
    'WHERE o.user_id=? AND o.enabled=1',
  ].join(' ');
}

function photoScopeSql() {
  return [
    'SELECT p.workspace_id,p.project_id,p.album_id,',
    '  h.version_id AS current_version_id',
    'FROM photos p',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'LEFT JOIN photo_version_heads h',
    '  ON h.photo_id=p.id AND h.workspace_id=p.workspace_id',
    '    AND h.project_id=p.project_id AND h.album_id=p.album_id',
    'WHERE p.id=?',
  ].join(' ');
}

function setResultSql() {
  return [
    'SELECT r.result_json',
    'FROM photo_version_head_commands c',
    'JOIN photo_version_head_results r ON r.command_id=c.id',
    'JOIN photos p ON p.id=c.photo_id AND p.workspace_id=c.workspace_id',
    '  AND p.project_id=c.project_id AND p.album_id=c.album_id',
    'JOIN photo_version_heads h ON h.photo_id=p.id',
    '  AND h.workspace_id=p.workspace_id AND h.project_id=p.project_id',
    '  AND h.album_id=p.album_id',
    'JOIN photo_versions expected',
    '  ON expected.id=c.expected_current_version_id',
    '  AND expected.photo_id=p.id AND expected.workspace_id=p.workspace_id',
    'JOIN photo_versions target',
    '  ON target.id=c.version_id AND target.photo_id=p.id',
    '  AND target.workspace_id=p.workspace_id',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id',
    'JOIN albums al ON al.id=p.album_id AND al.workspace_id=p.workspace_id',
    '  AND al.project_id=p.project_id',
    'WHERE c.actor_id=? AND c.request_id=? AND c.photo_id=?',
    "  AND c.payload_json=? AND pr.status NOT IN('archived','deleting','deleted')",
    "  AND al.state NOT IN('archived','deleting','deleted')",
  ].join(' ');
}

export class D1PhotoVersionHeadsRepository {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}

  async list(photoIdInput: string, cursorToken?: string) {
    const photoResult = z.uuid().safeParse(photoIdInput);
    if (!photoResult.success) invalidInput();
    const photoId = photoResult.data;
    const cursor = decodePhotoVersionCursor(cursorToken, photoId);

    const rows = await this.db
      .prepare(photoVersionPageSql())
      .bind(
        this.actor,
        this.session,
        photoId,
        cursor?.versionNo ?? null,
        cursor?.versionNo ?? null,
      )
      .all<PhotoVersionRow>();

    if (rows.results.length === 0) throw new WorkspaceFailure('NOT_FOUND', 404);

    const first = rows.results[0];
    if (
      !first ||
      !first.photoId ||
      !first.currentVersionId ||
      first.currentRevision === null
    )
      unavailable();

    if (
      cursor !== null &&
      'revision' in cursor &&
      (cursor.currentVersionId !== first.currentVersionId ||
        cursor.revision !== first.currentRevision)
    )
      throw new WorkspaceFailure('PHOTO_VERSION_REVISION_CONFLICT', 409);

    if (
      first.currentVersionMetadataId !== first.currentVersionId ||
      first.currentVersionNo === null ||
      first.currentVersionCreatedAt === null ||
      first.currentVersionProcessing === null ||
      first.currentThumbnailAvailable === null ||
      first.currentPreviewAvailable === null ||
      ![0, 1].includes(first.currentThumbnailAvailable) ||
      ![0, 1].includes(first.currentPreviewAvailable)
    )
      unavailable();

    const currentBase =
      '/api/v1/photos/' +
      photoId +
      '/versions/' +
      first.currentVersionId +
      '/assets/';
    const currentVersion = photoVersionItemSchema.parse({
      id: first.currentVersionMetadataId,
      versionNo: first.currentVersionNo,
      createdAt: first.currentVersionCreatedAt,
      width: first.currentVersionWidth,
      height: first.currentVersionHeight,
      processing: first.currentVersionProcessing,
      thumbnailUrl:
        first.currentThumbnailAvailable === 1
          ? currentBase + 'thumbnail'
          : null,
      previewUrl:
        first.currentPreviewAvailable === 1 ? currentBase + 'preview' : null,
    });

    const pageRows = rows.results.filter((row) => row.authorizedMarker === 0);
    const versions = pageRows.slice(0, 24).map((row) => {
      if (
        row.id === null ||
        row.versionNo === null ||
        row.createdAt === null ||
        row.processing === null
      )
        unavailable();
      const base =
        '/api/v1/photos/' + photoId + '/versions/' + row.id + '/assets/';
      return photoVersionItemSchema.parse({
        id: row.id,
        versionNo: row.versionNo,
        createdAt: row.createdAt,
        width: row.width,
        height: row.height,
        processing: row.processing,
        thumbnailUrl:
          row.processing === 'succeeded' ? base + 'thumbnail' : null,
        previewUrl: row.processing === 'succeeded' ? base + 'preview' : null,
      });
    });
    const last = versions.at(-1);

    return ownerPhotoVersionsPageSchema.parse({
      photoId,
      current: {
        versionId: first.currentVersionId,
        revision: first.currentRevision,
      },
      currentVersion,
      versions,
      nextCursor:
        pageRows.length > 24 && last
          ? encodePhotoVersionCursor({
              photoId,
              versionNo: last.versionNo,
              currentVersionId: first.currentVersionId,
              revision: first.currentRevision,
            })
          : null,
    });
  }

  async setCurrent(photoIdInput: string, input: unknown) {
    const photoResult = z.uuid().safeParse(photoIdInput);
    const request = setCurrentPhotoVersionSchema.safeParse(input);
    if (!photoResult.success || !request.success) invalidInput();
    const photoId = photoResult.data;
    const value = request.data;
    const payloadJson = JSON.stringify({
      requestId: value.requestId,
      expectedRevision: value.expectedRevision,
      expectedCurrentVersionId: value.expectedCurrentVersionId,
      versionId: value.versionId,
      confirm: true,
    });

    const owner = await this.db
      .prepare(currentOwnerCheckSql())
      .bind(this.session, this.actor)
      .first<{ authorized: number }>();
    if (!owner) throw new WorkspaceFailure('OWNER_REQUIRED', 403);

    const scope = await this.db
      .prepare(photoScopeSql())
      .bind(this.actor, photoId)
      .first<PhotoVersionScope>();
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (!scope.current_version_id)
      throw new WorkspaceFailure('PHOTO_VERSION_UNAVAILABLE', 503);

    try {
      await this.db
        .prepare(
          [
            'INSERT INTO photo_version_head_commands(',
            'id,actor_id,session_id,request_id,operation,workspace_id,project_id,',
            'album_id,photo_id,expected_revision,expected_current_version_id,',
            'version_id,confirm,payload_json,created_at_ms',
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ].join(' '),
        )
        .bind(
          crypto.randomUUID(),
          this.actor,
          this.session,
          value.requestId,
          'photo.version.current.set',
          scope.workspace_id,
          scope.project_id,
          scope.album_id,
          photoId,
          value.expectedRevision,
          value.expectedCurrentVersionId,
          value.versionId,
          1,
          payloadJson,
          Date.now(),
        )
        .run();
    } catch (error) {
      translatePhotoVersionError(error);
    }

    const resultRow = await this.db
      .prepare(setResultSql())
      .bind(
        this.actor,
        this.session,
        this.actor,
        value.requestId,
        photoId,
        payloadJson,
      )
      .first<{ result_json: string }>();
    if (!resultRow) {
      const currentOwner = await this.db
        .prepare(currentOwnerCheckSql())
        .bind(this.session, this.actor)
        .first<{ authorized: number }>();
      if (!currentOwner) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(resultRow.result_json) as unknown;
    } catch {
      unavailable();
    }
    const parsed = setCurrentPhotoVersionResultSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.photoId !== photoId) unavailable();
    return parsed.data;
  }
}
