import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import {
  annotationGeometrySchema,
  type AnnotationGeometry,
} from '../../../packages/contracts/src/annotation-geometry';
import {
  annotationStyleSchema,
  guestAnnotationItemSchema,
  guestAnnotationReadQuerySchema,
  guestAnnotationsPageSchema,
  type GuestAnnotationItem,
  type GuestAnnotationsPage,
} from '../../../packages/contracts/src/guest-annotations';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import {
  annotationReadWatermarksMatch,
  AnnotationClientUpgradeRequiredError,
  decideAnnotationReadCompatibility,
  preflightFreehandAnnotationRead,
  supportsFreehandAnnotationRead,
} from './freehand-read-compat';
import { WorkspaceFailure } from './workspaces';

const canAnnotateBit = guestPermissionBit('can_annotate');
const guestAnnotationCursorSchema = z
  .object({
    schemaVersion: z.literal(1),
    scopeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    watermark: z.number().int().nonnegative().safe(),
    afterCreatedAtMs: z.number().int().nonnegative().safe(),
    afterAnnotationId: z
      .uuid()
      .refine((value) => value === value.toLowerCase()),
  })
  .strict();

type GuestAnnotationCursor = z.infer<typeof guestAnnotationCursorSchema>;

type GuestAnnotationReadRow = {
  sessionId: string;
  guestId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  authorizedAlbumId: string;
  authorizedPhotoId: string;
  authorizedVersionId: string;
  watermark: number;
  annotationId: string | null;
  photoId: string | null;
  versionId: string | null;
  revision: number | null;
  geometryJson: string | null;
  styleJson: string | null;
  commentId: string | null;
  state: 'open' | 'resolved' | 'deleted' | null;
  authorLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdAtMs: number | null;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('GUEST_ANNOTATIONS_UNAVAILABLE', 503);
}

function parseUuid(value: string): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) invalidInput();
  return result.data;
}

function encodeCursor(cursor: GuestAnnotationCursor): string {
  try {
    const value = guestAnnotationCursorSchema.parse(cursor);
    return Buffer.from(
      JSON.stringify({
        schemaVersion: value.schemaVersion,
        scopeDigest: value.scopeDigest,
        watermark: value.watermark,
        afterCreatedAtMs: value.afterCreatedAtMs,
        afterAnnotationId: value.afterAnnotationId,
      }),
      'utf8',
    ).toString('base64url');
  } catch {
    return unavailable();
  }
}

function decodeCursor(token: string | undefined): GuestAnnotationCursor | null {
  if (token === undefined) return null;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  ) {
    invalidInput();
  }

  try {
    const bytes = Buffer.from(token, 'base64url');
    if (
      bytes.length === 0 ||
      bytes.length > 768 ||
      bytes.toString('base64url') !== token
    ) {
      invalidInput();
    }

    const json = bytes.toString('utf8');
    const parsed = guestAnnotationCursorSchema.safeParse(
      JSON.parse(json) as unknown,
    );
    if (!parsed.success) invalidInput();

    const canonical = JSON.stringify({
      schemaVersion: parsed.data.schemaVersion,
      scopeDigest: parsed.data.scopeDigest,
      watermark: parsed.data.watermark,
      afterCreatedAtMs: parsed.data.afterCreatedAtMs,
      afterAnnotationId: parsed.data.afterAnnotationId,
    });
    if (canonical !== json) invalidInput();
    return parsed.data;
  } catch {
    invalidInput();
  }
}

type AnnotationScope = {
  sessionId: string;
  guestId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  versionId: string;
};

async function annotationScopeDigest(scope: AnnotationScope): Promise<string> {
  const canonicalScope = JSON.stringify({
    sessionId: scope.sessionId,
    guestId: scope.guestId,
    inviteId: scope.inviteId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    albumId: scope.albumId,
    photoId: scope.photoId,
    versionId: scope.versionId,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      'kino-pic:guest-annotations-own:v1:' + canonicalScope,
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function safeItem(row: GuestAnnotationReadRow): GuestAnnotationItem {
  if (
    row.annotationId === null ||
    row.photoId === null ||
    row.versionId === null ||
    row.revision === null ||
    row.state === null ||
    row.authorLabel === null ||
    row.createdAt === null ||
    row.updatedAt === null
  ) {
    return unavailable();
  }

  let geometry: AnnotationGeometry | null = null;
  if (row.geometryJson !== null) {
    let value: unknown;
    try {
      value = JSON.parse(row.geometryJson) as unknown;
    } catch {
      return unavailable();
    }
    const parsed = annotationGeometrySchema.safeParse(value);
    if (!parsed.success) return unavailable();
    geometry = parsed.data;
  }

  let style: ReturnType<typeof annotationStyleSchema.parse> | null = null;
  if (row.styleJson !== null) {
    let value: unknown;
    try {
      value = JSON.parse(row.styleJson) as unknown;
    } catch {
      return unavailable();
    }
    const parsed = annotationStyleSchema.safeParse(value);
    if (!parsed.success) return unavailable();
    style = parsed.data;
  }

  const parsed = guestAnnotationItemSchema.safeParse({
    annotationId: row.annotationId,
    photoId: row.photoId,
    versionId: row.versionId,
    revision: row.revision,
    geometry,
    style,
    commentId: row.commentId,
    state: row.state,
    authorLabel: row.authorLabel,
    isMine: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!parsed.success) return unavailable();
  return parsed.data;
}

export class D1GuestAnnotationReader {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async readOwn(
    secret: string | null,
    albumIdInput: string,
    photoIdInput: string,
    versionIdInput: string,
    queryInput: unknown,
    annotationReadCapabilitiesHeader?: string,
  ): Promise<GuestAnnotationsPage> {
    const albumId = parseUuid(albumIdInput);
    const photoId = parseUuid(photoIdInput);
    const versionId = parseUuid(versionIdInput);
    const query = guestAnnotationReadQuerySchema.safeParse(queryInput);
    if (!query.success) invalidInput();

    const cursor = decodeCursor(query.data.cursor);
    const annotationId =
      query.data.annotationId === undefined
        ? undefined
        : parseUuid(query.data.annotationId);
    if (cursor && annotationId !== undefined) invalidInput();
    if (!secret) throw new GuestAccessDenied();

    let secretHash: string;
    try {
      secretHash = await hashGuestSessionSecret(secret);
    } catch {
      throw new GuestAccessDenied();
    }

    const compatibilityPreflight = await preflightFreehandAnnotationRead(
      this.db,
      {
        kind: 'guest-own',
        secretHash,
        albumId,
        photoId,
        versionId,
      },
    ).catch(() => unavailable());
    let rows: D1Result<GuestAnnotationReadRow>;
    try {
      rows = await this.db
        .prepare(
          [
            'WITH authorized AS (',
            ' SELECT s.id AS session_id,g.id AS guest_id,i.id AS invite_id,',
            '   i.workspace_id AS workspace_id,i.project_id AS project_id,ia.album_id AS album_id',
            ' FROM guest_sessions s',
            ' JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
            ' JOIN guest_invites i ON i.id=s.invite_id',
            ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
            ' JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id',
            '   AND ia.project_id=i.project_id AND ia.album_id=?',
            ' JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id',
            "   AND a.project_id=i.project_id AND a.state='active'",
            ' JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
            "   AND p.status NOT IN('archived','deleting','deleted')",
            ' JOIN workspaces w ON w.id=i.workspace_id',
            ' JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
            ' WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
            "   AND s.expires_at_ms>unixepoch('subsec')*1000",
            `   AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}`,
            '   AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)',
            '   AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)',
            '), authorized_version AS (',
            ' SELECT gs.session_id AS sessionId,gs.guest_id AS guestId,gs.invite_id AS inviteId,',
            '   gs.workspace_id AS workspaceId,gs.project_id AS projectId,gs.album_id AS authorizedAlbumId,',
            '   p.id AS authorizedPhotoId,ev.version_id AS authorizedVersionId',
            ' FROM authorized gs',
            ' JOIN photos p ON p.id=? AND p.workspace_id=gs.workspace_id',
            '   AND p.project_id=gs.project_id AND p.album_id=gs.album_id',
            ' JOIN guest_comment_eligible_versions ev ON ev.photo_id=p.id',
            '   AND ev.version_id=? AND ev.workspace_id=p.workspace_id',
            '   AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
            '), page_rows AS (',
            ' SELECT a.* FROM authorized_version av',
            ' JOIN guest_annotations a ON a.invite_id=av.inviteId',
            '   AND a.workspace_id=av.workspaceId AND a.project_id=av.projectId',
            '   AND a.album_id=av.authorizedAlbumId AND a.photo_id=av.authorizedPhotoId',
            '   AND a.version_id=av.authorizedVersionId AND a.author_guest_id=av.guestId',
            ' WHERE (? IS NULL OR a.id=?)',
            '   AND (? IS NULL OR a.created_at_ms>? OR (a.created_at_ms=? AND a.id>?))',
            ' ORDER BY a.created_at_ms,a.id LIMIT 25',
            ')',
            'SELECT av.sessionId,av.guestId,av.inviteId,av.workspaceId,av.projectId,',
            ' av.authorizedAlbumId,av.authorizedPhotoId,av.authorizedVersionId,',
            ' COALESCE((SELECT MAX(ch.seq) FROM guest_annotation_changes ch',
            '   WHERE ch.guest_id=av.guestId AND ch.invite_id=av.inviteId',
            '     AND ch.workspace_id=av.workspaceId AND ch.project_id=av.projectId',
            '     AND ch.album_id=av.authorizedAlbumId AND ch.photo_id=av.authorizedPhotoId',
            '     AND ch.version_id=av.authorizedVersionId),0) AS watermark,',
            ' r.id AS annotationId,r.photo_id AS photoId,r.version_id AS versionId,',
            ' r.revision AS revision,r.geometry_json AS geometryJson,r.style_json AS styleJson,',
            ' r.linked_comment_id AS commentId,r.state AS state,r.author_label AS authorLabel,',
            " CASE WHEN r.id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch') END AS createdAt,",
            " CASE WHEN r.id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',r.updated_at_ms/1000.0,'unixepoch') END AS updatedAt,",
            ' r.created_at_ms AS createdAtMs',
            ' FROM authorized_version av LEFT JOIN page_rows r ON 1=1',
            ' ORDER BY r.created_at_ms,r.id',
          ].join('\n'),
        )
        .bind(
          albumId,
          secretHash,
          canAnnotateBit,
          canAnnotateBit,
          photoId,
          versionId,
          annotationId ?? null,
          annotationId ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterAnnotationId ?? null,
        )
        .all<GuestAnnotationReadRow>();
    } catch {
      return unavailable();
    }

    const first = rows.results[0];
    if (!first) throw new GuestAccessDenied();

    const scope = {
      sessionId: first.sessionId,
      guestId: first.guestId,
      inviteId: first.inviteId,
      workspaceId: first.workspaceId,
      projectId: first.projectId,
      albumId: first.authorizedAlbumId,
      photoId: first.authorizedPhotoId,
      versionId: first.authorizedVersionId,
    };
    if (
      Object.values(scope).some(
        (value) => !z.uuid().safeParse(value).success,
      ) ||
      !Number.isSafeInteger(first.watermark) ||
      first.watermark < 0
    ) {
      return unavailable();
    }

    let expectedScopeDigest: string;
    try {
      expectedScopeDigest = await annotationScopeDigest(scope);
    } catch {
      return unavailable();
    }
    if (cursor && cursor.scopeDigest !== expectedScopeDigest) invalidInput();
    const cursorWatermarkMatches =
      cursor === null || cursor.watermark === first.watermark;
    if (compatibilityPreflight.kind === 'denied') return unavailable();
    if (
      compatibilityPreflight.kind === 'authorized' &&
      !annotationReadWatermarksMatch(compatibilityPreflight, 'guest-own', {
        guest: first.watermark,
      })
    )
      throw new WorkspaceFailure('ANNOTATION_HISTORY_CHANGED', 409);
    if (
      decideAnnotationReadCompatibility(
        supportsFreehandAnnotationRead(annotationReadCapabilitiesHeader),
        compatibilityPreflight,
      ).kind === 'upgrade-required'
    )
      throw new AnnotationClientUpgradeRequiredError();
    if (!cursorWatermarkMatches)
      throw new WorkspaceFailure('ANNOTATION_HISTORY_CHANGED', 409);
    const itemRows = rows.results.filter((row) => row.annotationId !== null);
    const items = itemRows.map(safeItem);
    const hasMore = items.length > 24;
    const publicItems = items.slice(0, 24);
    let nextCursor: string | null = null;
    if (hasMore) {
      const boundaryItem = publicItems[23];
      const boundaryRow = itemRows[23];
      if (
        !boundaryItem ||
        !boundaryRow ||
        boundaryRow.createdAtMs === null ||
        !Number.isSafeInteger(boundaryRow.createdAtMs) ||
        boundaryRow.createdAtMs < 0
      ) {
        return unavailable();
      }
      nextCursor = encodeCursor({
        schemaVersion: 1,
        scopeDigest: expectedScopeDigest,
        watermark: first.watermark,
        afterCreatedAtMs: boundaryRow.createdAtMs,
        afterAnnotationId: boundaryItem.annotationId,
      });
    }

    const page = guestAnnotationsPageSchema.safeParse({
      guestId: first.guestId,
      photoId,
      versionId,
      items: publicItems,
      nextCursor,
    });
    if (!page.success) return unavailable();
    return page.data;
  }
}
