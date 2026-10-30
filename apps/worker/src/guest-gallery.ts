import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import {
  galleryPageSchema,
  galleryPhotoSchema,
} from '../../../packages/contracts/src/gallery';
import { guestPhotoVersionsPageSchema } from '../../../packages/contracts/src/guest-versions';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from '../../../packages/db/src/workspace-cursor';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const canViewBit = guestPermissionBit('can_view');
const canCompareBit = guestPermissionBit('can_compare_versions');
const canViewAndCompareBits = canViewBit | canCompareBit;
const guestVersionCreatedByLabel = '攝影師' as const;
const guestVersionLabelsSchema = z
  .array(
    z.string().superRefine((label, ctx) => {
      if (
        label !== label.normalize('NFC').trim() ||
        Array.from(label).length < 1 ||
        Array.from(label).length > 40 ||
        /[\p{Cc}\p{Cf}]/u.test(label)
      ) {
        ctx.addIssue({ code: 'custom', message: 'Invalid version label' });
      }
    }),
  )
  .max(16)
  .superRefine((labels, ctx) => {
    const seen = new Set<string>();
    labels.forEach((label, index) => {
      if (seen.has(label)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Version labels must be unique',
          path: [index],
        });
      }
      seen.add(label);
    });
  });

const currentGuestScopeSql =
  'SELECT i.workspace_id,i.project_id,ia.album_id,i.permissions_mask ' +
  'FROM guest_sessions s ' +
  'JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id ' +
  'JOIN guest_invites i ON i.id=s.invite_id ' +
  'JOIN guest_invite_seals sealed ON sealed.invite_id=i.id ' +
  'JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id ' +
  'JOIN albums al ON al.id=ia.album_id AND al.workspace_id=i.workspace_id AND al.project_id=i.project_id ' +
  'JOIN projects pr ON pr.id=i.project_id AND pr.workspace_id=i.workspace_id ' +
  'JOIN workspaces w ON w.id=i.workspace_id ' +
  'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 ' +
  'WHERE s.secret_hash=? AND (i.permissions_mask & ?)=? ' +
  "AND s.expires_at_ms>unixepoch('subsec')*1000 " +
  "AND i.expires_at_ms>unixepoch('subsec')*1000 " +
  'AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id) ' +
  'AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id) ' +
  "AND al.state='active' AND pr.status NOT IN('archived','deleting','deleted')";

// A version can be published by being the current head, being the baseline V1,
// or by an immutable head-change result recording that it was once current.
const guestPublishedVersionEligibilitySql =
  '(v.id=head.version_id OR v.version_no=1 OR EXISTS (' +
  'SELECT 1 FROM photo_version_head_commands c ' +
  'JOIN photo_version_head_results r ON r.command_id=c.id ' +
  'WHERE c.photo_id=p.id AND c.workspace_id=p.workspace_id ' +
  'AND c.project_id=p.project_id AND c.album_id=p.album_id ' +
  'AND c.version_id=v.id ' +
  "AND json_extract(r.result_json,'$.changed')=1))";

// Init and completion have different request IDs; their immutable upload session
// and exact actor/photo/tenant scope link the captured version metadata.
// Keep the derivative readiness definition identical for history and direct
// asset requests. Both outputs must be real private slots from a succeeded job.
const guestReadyVersionsSql =
  'SELECT v.id AS versionId,v.photo_id AS photoId,v.workspace_id AS workspaceId,' +
  'p.project_id AS projectId,p.album_id AS albumId,' +
  "CASE WHEN vc.upload_session_id IS NULL THEN '[]' ELSE t.labels_json END AS labelsJson " +
  'FROM photo_versions v ' +
  'JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id ' +
  "JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=p.id AND original.workspace_id=p.workspace_id AND original.asset_kind='original' AND original.state='private' AND original.byte_size=v.byte_size AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256 " +
  "JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded' " +
  "JOIN image_processing_outputs thumb_slot ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail' " +
  "JOIN photo_assets thumb ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key AND thumb.version_id=v.id AND thumb.photo_id=p.id AND thumb.workspace_id=p.workspace_id AND thumb.asset_kind='thumbnail' AND thumb.state='private' AND thumb.mime='image/jpeg' " +
  "JOIN image_processing_outputs preview_slot ON preview_slot.job_id=j.id AND preview_slot.kind='preview' " +
  "JOIN photo_assets preview ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id AND preview.photo_id=p.id AND preview.workspace_id=p.workspace_id AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg' " +
  'LEFT JOIN upload_version_completions vc ON vc.version_id=v.id AND vc.photo_id=p.id AND vc.workspace_id=p.workspace_id AND vc.project_id=p.project_id AND vc.album_id=p.album_id ' +
  'LEFT JOIN upload_version_targets t ON t.upload_session_id=vc.upload_session_id AND t.actor_id=vc.actor_id AND t.photo_id=vc.photo_id AND t.workspace_id=vc.workspace_id AND t.project_id=vc.project_id AND t.album_id=vc.album_id AND json(t.labels_json)=json(vc.labels_json)';

const guestVersionCursorSchema = z
  .object({
    photoId: z.uuid(),
    headVersionId: z.uuid(),
    headRevision: z.number().int().nonnegative().safe(),
    lastVersionNo: z.number().int().positive().safe(),
  })
  .strict();

type GuestVersionCursor = z.infer<typeof guestVersionCursorSchema>;

type AssetRow = {
  object_key: string;
  byte_size: number;
  checksum_sha256: string;
  album_id: string;
  workspace_id: string;
  project_id: string;
};

type GuestVersionHistoryRow = {
  albumId: string | null;
  photoId: string | null;
  headVersionId: string | null;
  headRevision: number | null;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  currentWidth: number | null;
  currentHeight: number | null;
  currentCreatedAt: string | null;
  currentLabelsJson: string | null;
  versionId: string | null;
  versionNo: number | null;
  width: number | null;
  height: number | null;
  createdAt: string | null;
  labelsJson: string | null;
  authorizedMarker: number;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function parseGuestVersionLabels(labelsJson: string | null): string[] {
  if (labelsJson === null)
    throw new WorkspaceFailure('GUEST_VERSION_HISTORY_UNAVAILABLE', 503);

  let decoded: unknown;
  try {
    decoded = JSON.parse(labelsJson) as unknown;
  } catch {
    throw new WorkspaceFailure('GUEST_VERSION_HISTORY_UNAVAILABLE', 503);
  }
  const labels = guestVersionLabelsSchema.safeParse(decoded);
  if (!labels.success)
    throw new WorkspaceFailure('GUEST_VERSION_HISTORY_UNAVAILABLE', 503);
  return labels.data;
}

function decodeGuestVersionCursor(
  token: string | undefined,
  photoId: string,
): GuestVersionCursor | null {
  if (token === undefined) return null;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 512 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  )
    invalidInput();

  let cursor: GuestVersionCursor;
  try {
    const bytes = Buffer.from(token, 'base64url');
    if (
      bytes.length === 0 ||
      bytes.length > 384 ||
      bytes.toString('base64url') !== token
    )
      invalidInput();

    const json = bytes.toString('utf8');
    const parsed: unknown = JSON.parse(json);
    const result = guestVersionCursorSchema.safeParse(parsed);
    if (!result.success) invalidInput();
    const canonicalJson = JSON.stringify({
      photoId: result.data.photoId,
      headVersionId: result.data.headVersionId,
      headRevision: result.data.headRevision,
      lastVersionNo: result.data.lastVersionNo,
    });
    if (canonicalJson !== json) invalidInput();
    cursor = result.data;
  } catch {
    invalidInput();
  }

  if (cursor.photoId !== photoId) invalidInput();
  return cursor;
}

function encodeGuestVersionCursor(cursor: GuestVersionCursor): string {
  return Buffer.from(
    JSON.stringify(guestVersionCursorSchema.parse(cursor)),
    'utf8',
  ).toString('base64url');
}

type VersionHistoryAnchor = Pick<
  GuestVersionHistoryRow,
  | 'currentVersionId'
  | 'currentVersionNo'
  | 'currentWidth'
  | 'currentHeight'
  | 'currentCreatedAt'
  | 'currentLabelsJson'
> & {
  albumId: string;
  photoId: string;
  headVersionId: string;
  headRevision: number;
};

function anchorFromRow(row: GuestVersionHistoryRow): VersionHistoryAnchor {
  if (
    typeof row.albumId !== 'string' ||
    typeof row.photoId !== 'string' ||
    typeof row.headVersionId !== 'string' ||
    typeof row.headRevision !== 'number' ||
    !Number.isSafeInteger(row.headRevision) ||
    row.headRevision < 0
  )
    throw new WorkspaceFailure('GUEST_VERSION_HISTORY_UNAVAILABLE', 503);
  return {
    albumId: row.albumId,
    photoId: row.photoId,
    headVersionId: row.headVersionId,
    headRevision: row.headRevision,
    currentVersionId: row.currentVersionId,
    currentVersionNo: row.currentVersionNo,
    currentWidth: row.currentWidth,
    currentHeight: row.currentHeight,
    currentCreatedAt: row.currentCreatedAt,
    currentLabelsJson: row.currentLabelsJson,
  };
}

function currentVersionFromAnchor(anchor: VersionHistoryAnchor): {
  versionId: string;
  versionNo: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  createdByLabel: typeof guestVersionCreatedByLabel;
  labels: string[];
  isCurrent: true;
  thumbnailUrl: string;
  previewUrl: string;
} | null {
  const fields = [
    anchor.currentVersionId,
    anchor.currentVersionNo,
    anchor.currentWidth,
    anchor.currentHeight,
    anchor.currentCreatedAt,
    anchor.currentLabelsJson,
  ];
  if (
    anchor.currentVersionId === null &&
    anchor.currentVersionNo === null &&
    anchor.currentWidth === null &&
    anchor.currentHeight === null &&
    anchor.currentCreatedAt === null &&
    anchor.currentLabelsJson === null
  )
    return null;
  if (
    anchor.currentVersionId === null ||
    anchor.currentVersionNo === null ||
    anchor.currentCreatedAt === null ||
    anchor.currentLabelsJson === null ||
    fields.some((value) => value === undefined)
  )
    throw new WorkspaceFailure('GUEST_VERSION_HISTORY_UNAVAILABLE', 503);

  const base =
    '/api/guest/photos/' +
    anchor.photoId +
    '/versions/' +
    anchor.currentVersionId +
    '/assets/';
  return {
    versionId: anchor.currentVersionId,
    versionNo: anchor.currentVersionNo,
    width: anchor.currentWidth,
    height: anchor.currentHeight,
    createdAt: anchor.currentCreatedAt,
    createdByLabel: guestVersionCreatedByLabel,
    labels: parseGuestVersionLabels(anchor.currentLabelsJson),
    isCurrent: true,
    thumbnailUrl: base + 'thumbnail',
    previewUrl: base + 'preview',
  };
}

export class D1GuestGalleryRepository {
  constructor(private db: D1Database) {}

  private async secretHash(secret: string | null) {
    if (!secret) throw new GuestAccessDenied();
    return hashGuestSessionSecret(secret);
  }

  async list(secret: string | null, albumId: string, cursor?: string) {
    const album = z.uuid().parse(albumId);
    const after = decodeWorkspaceCursor(cursor);
    const hash = await this.secretHash(secret);
    const rows = await this.db
      .prepare(
        'WITH guest_scope AS (' +
          currentGuestScopeSql +
          '), page_rows AS (' +
          "SELECT p.id,v.id AS versionId,p.original_filename AS filename,v.width,v.height,p.created_at AS createdAt,COALESCE(j.status,'unavailable') AS processing " +
          'FROM guest_scope gs ' +
          'JOIN photos p ON p.workspace_id=gs.workspace_id AND p.project_id=gs.project_id AND p.album_id=gs.album_id ' +
          'JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id ' +
          'JOIN photo_versions v ON v.id=head.version_id AND v.photo_id=p.id AND v.workspace_id=p.workspace_id ' +
          "JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=p.id AND original.workspace_id=p.workspace_id AND original.asset_kind='original' " +
          'LEFT JOIN image_processing_jobs j ON j.id=original.id ' +
          'WHERE gs.album_id=? AND (? IS NULL OR(p.created_at,p.id)<(?,?)) ' +
          'ORDER BY p.created_at DESC,p.id DESC LIMIT 25) ' +
          'SELECT id,versionId,filename,width,height,createdAt,processing,0 AS guestScopeMarker FROM page_rows ' +
          'UNION ALL ' +
          "SELECT NULL,NULL,NULL,NULL,NULL,NULL,'unavailable',1 FROM guest_scope WHERE album_id=? AND NOT EXISTS(SELECT 1 FROM page_rows)",
      )
      .bind(
        hash,
        canViewBit,
        canViewBit,
        album,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
        album,
      )
      .all<Record<string, unknown>>();
    if (!rows.results.length) throw new GuestAccessDenied();
    const pageRows = rows.results.filter((row) => row.guestScopeMarker === 0);
    const photos = pageRows.slice(0, 24).map((row) => {
      const base =
        '/api/guest/photos/' +
        String(row.id) +
        '/versions/' +
        String(row.versionId) +
        '/assets/';
      return galleryPhotoSchema.parse({
        id: row.id,
        versionId: row.versionId,
        filename: row.filename,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt,
        processing: row.processing,
        thumbnailUrl:
          row.processing === 'succeeded' ? base + 'thumbnail' : null,
        previewUrl: row.processing === 'succeeded' ? base + 'preview' : null,
      });
    });
    const last = photos.at(-1);
    return galleryPageSchema.parse({
      photos,
      nextCursor:
        pageRows.length > 24 && last
          ? encodeWorkspaceCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    });
  }

  async versions(
    secret: string | null,
    albumIdInput: string,
    photoIdInput: string,
    cursorToken?: string,
  ) {
    const albumResult = z.uuid().safeParse(albumIdInput);
    const photoResult = z.uuid().safeParse(photoIdInput);
    if (!albumResult.success || !photoResult.success) invalidInput();
    const albumId = albumResult.data;
    const photoId = photoResult.data;
    const cursor = decodeGuestVersionCursor(cursorToken, photoId);
    const hash = await this.secretHash(secret);

    const rows = await this.db
      .prepare(
        'WITH guest_scope AS (' +
          currentGuestScopeSql +
          '), authorized_photo AS (' +
          'SELECT p.id AS photoId,p.workspace_id AS workspaceId,' +
          'p.project_id AS projectId,p.album_id AS albumId,' +
          'head.version_id AS headVersionId,head.revision AS headRevision ' +
          'FROM guest_scope gs ' +
          'JOIN photos p ON p.workspace_id=gs.workspace_id AND p.project_id=gs.project_id AND p.album_id=gs.album_id ' +
          'JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id ' +
          'WHERE gs.album_id=? AND p.id=?' +
          '), ready_versions AS (' +
          guestReadyVersionsSql +
          ' WHERE EXISTS(SELECT 1 FROM authorized_photo auth WHERE auth.photoId=v.photo_id AND auth.workspaceId=v.workspace_id AND auth.projectId=p.project_id AND auth.albumId=p.album_id)' +
          '), current_version AS (' +
          'SELECT auth.photoId,v.id AS currentVersionId,' +
          'v.version_no AS currentVersionNo,v.width AS currentWidth,' +
          'v.height AS currentHeight,v.created_at AS currentCreatedAt,' +
          'ready.labelsJson AS currentLabelsJson ' +
          'FROM authorized_photo auth ' +
          'JOIN photos p ON p.id=auth.photoId AND p.workspace_id=auth.workspaceId AND p.project_id=auth.projectId AND p.album_id=auth.albumId ' +
          'JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id AND head.version_id=auth.headVersionId AND head.revision=auth.headRevision ' +
          'JOIN photo_versions v ON v.id=auth.headVersionId AND v.photo_id=p.id AND v.workspace_id=p.workspace_id ' +
          'JOIN ready_versions ready ON ready.versionId=v.id AND ready.photoId=p.id AND ready.workspaceId=p.workspace_id AND ready.projectId=p.project_id AND ready.albumId=p.album_id ' +
          'WHERE ' +
          guestPublishedVersionEligibilitySql +
          '), authorized_anchor AS (' +
          'SELECT auth.albumId,auth.photoId,auth.workspaceId,auth.projectId,auth.headVersionId,auth.headRevision,' +
          'cv.currentVersionId,cv.currentVersionNo,cv.currentWidth,' +
          'cv.currentHeight,cv.currentCreatedAt,cv.currentLabelsJson ' +
          'FROM authorized_photo auth ' +
          'LEFT JOIN current_version cv ON cv.photoId=auth.photoId' +
          '), page_rows AS (' +
          'SELECT auth.albumId,auth.photoId,auth.workspaceId,auth.projectId,auth.headVersionId,auth.headRevision,' +
          'auth.currentVersionId,auth.currentVersionNo,auth.currentWidth,' +
          'auth.currentHeight,auth.currentCreatedAt,auth.currentLabelsJson,' +
          'v.id AS versionId,v.version_no AS versionNo,v.width,v.height,' +
          'v.created_at AS createdAt,ready.labelsJson AS labelsJson,0 AS authorizedMarker ' +
          'FROM authorized_anchor auth ' +
          'JOIN photos p ON p.id=auth.photoId AND p.workspace_id=auth.workspaceId AND p.project_id=auth.projectId AND p.album_id=auth.albumId ' +
          'JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id AND head.version_id=auth.headVersionId AND head.revision=auth.headRevision ' +
          'JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id ' +
          'JOIN ready_versions ready ON ready.versionId=v.id AND ready.photoId=p.id AND ready.workspaceId=p.workspace_id AND ready.projectId=p.project_id AND ready.albumId=p.album_id ' +
          'WHERE ' +
          guestPublishedVersionEligibilitySql +
          ' AND (? IS NULL OR v.version_no<?) ' +
          'ORDER BY v.version_no DESC LIMIT 25) ' +
          'SELECT albumId,photoId,headVersionId,headRevision,currentVersionId,currentVersionNo,currentWidth,currentHeight,currentCreatedAt,currentLabelsJson,versionId,versionNo,width,height,createdAt,labelsJson,authorizedMarker FROM page_rows ' +
          'UNION ALL ' +
          'SELECT auth.albumId,auth.photoId,auth.headVersionId,auth.headRevision,auth.currentVersionId,auth.currentVersionNo,auth.currentWidth,auth.currentHeight,auth.currentCreatedAt,auth.currentLabelsJson,NULL,NULL,NULL,NULL,NULL,NULL,1 FROM authorized_anchor auth WHERE NOT EXISTS(SELECT 1 FROM page_rows) ' +
          'ORDER BY versionNo DESC',
      )
      .bind(
        hash,
        canViewAndCompareBits,
        canViewAndCompareBits,
        albumId,
        photoId,
        cursor?.lastVersionNo ?? null,
        cursor?.lastVersionNo ?? null,
      )
      .all<GuestVersionHistoryRow>();

    if (!rows.results.length) throw new GuestAccessDenied();
    const first = rows.results[0];
    if (!first) throw new GuestAccessDenied();
    const anchor = anchorFromRow(first);
    if (
      cursor &&
      (cursor.headVersionId !== anchor.headVersionId ||
        cursor.headRevision !== anchor.headRevision)
    )
      throw new WorkspaceFailure('GUEST_VERSION_HISTORY_CHANGED', 409);

    const pageRows = rows.results.filter((row) => row.authorizedMarker === 0);
    const versions = pageRows.slice(0, 24).map((row) => {
      if (
        row.versionId === null ||
        row.versionNo === null ||
        row.width === undefined ||
        row.height === undefined ||
        row.createdAt === null ||
        row.labelsJson === null
      )
        throw new WorkspaceFailure('GUEST_VERSION_HISTORY_UNAVAILABLE', 503);
      const base =
        '/api/guest/photos/' +
        anchor.photoId +
        '/versions/' +
        row.versionId +
        '/assets/';
      return {
        versionId: row.versionId,
        versionNo: row.versionNo,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt,
        createdByLabel: guestVersionCreatedByLabel,
        labels: parseGuestVersionLabels(row.labelsJson),
        isCurrent: row.versionId === anchor.headVersionId,
        thumbnailUrl: base + 'thumbnail',
        previewUrl: base + 'preview',
      };
    });
    const last = versions.at(-1);

    return guestPhotoVersionsPageSchema.parse({
      albumId: anchor.albumId,
      photoId: anchor.photoId,
      head: {
        versionId: anchor.headVersionId,
        revision: anchor.headRevision,
      },
      currentVersion: currentVersionFromAnchor(anchor),
      versions,
      nextCursor:
        pageRows.length > 24 && last
          ? encodeGuestVersionCursor({
              photoId,
              headVersionId: anchor.headVersionId,
              headRevision: anchor.headRevision,
              lastVersionNo: last.versionNo,
            })
          : null,
    });
  }

  async asset(
    secret: string | null,
    photoId: string,
    versionId: string,
    kind: string,
  ): Promise<AssetRow> {
    const photo = z.uuid().parse(photoId);
    const version = z.uuid().parse(versionId);
    const assetKind = z.enum(['thumbnail', 'preview']).parse(kind);
    const hash = await this.secretHash(secret);
    const row = await this.db
      .prepare(
        'WITH guest_scope AS (' +
          currentGuestScopeSql +
          '), authorized_photo AS (' +
          'SELECT p.id AS photoId,p.workspace_id AS workspaceId,' +
          'p.project_id AS projectId,p.album_id AS albumId,gs.permissions_mask AS permissionsMask,' +
          'head.version_id AS headVersionId,head.revision AS headRevision ' +
          'FROM guest_scope gs ' +
          'JOIN photos p ON p.workspace_id=gs.workspace_id AND p.project_id=gs.project_id AND p.album_id=gs.album_id ' +
          'JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id ' +
          'WHERE p.id=?' +
          '), ready_versions AS (' +
          guestReadyVersionsSql +
          ' WHERE v.id=? AND EXISTS(SELECT 1 FROM authorized_photo auth WHERE auth.photoId=v.photo_id AND auth.workspaceId=v.workspace_id AND auth.projectId=p.project_id AND auth.albumId=p.album_id)' +
          ') ' +
          'SELECT a.object_key,a.byte_size,a.checksum_sha256,p.album_id,p.workspace_id,p.project_id ' +
          'FROM authorized_photo auth ' +
          'JOIN photos p ON p.id=auth.photoId AND p.workspace_id=auth.workspaceId AND p.project_id=auth.projectId AND p.album_id=auth.albumId ' +
          'JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id AND head.version_id=auth.headVersionId AND head.revision=auth.headRevision ' +
          'JOIN ready_versions ready ON ready.photoId=p.id AND ready.workspaceId=p.workspace_id AND ready.projectId=p.project_id AND ready.albumId=p.album_id ' +
          'JOIN photo_versions v ON v.id=ready.versionId AND v.photo_id=p.id AND v.workspace_id=p.workspace_id ' +
          "JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=p.id AND original.workspace_id=p.workspace_id AND original.asset_kind='original' AND original.state='private' AND original.byte_size=v.byte_size AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256 " +
          "JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded' " +
          "JOIN photo_assets a ON a.photo_id=p.id AND a.workspace_id=p.workspace_id AND a.version_id=v.id AND a.asset_kind=? AND a.state='private' AND a.mime='image/jpeg' " +
          'JOIN image_processing_outputs slot ON slot.job_id=j.id AND slot.kind=a.asset_kind AND slot.asset_id=a.id AND slot.object_key=a.object_key ' +
          'WHERE ' +
          guestPublishedVersionEligibilitySql +
          ' AND (v.id=head.version_id OR (auth.permissionsMask & ?)=?) LIMIT 1',
      )
      .bind(
        hash,
        canViewBit,
        canViewBit,
        photo,
        version,
        assetKind,
        canCompareBit,
        canCompareBit,
      )
      .first<AssetRow>();
    if (!row) throw new GuestAccessDenied();
    return row;
  }
}
