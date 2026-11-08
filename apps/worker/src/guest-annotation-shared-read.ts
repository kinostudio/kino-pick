import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import {
  annotationGeometrySchema,
  type AnnotationGeometry,
} from '../../../packages/contracts/src/annotation-geometry';
import {
  annotationProcessingSnapshotSchema,
  type AnnotationProcessingSnapshot,
} from '../../../packages/contracts/src/annotation-processing';
import {
  annotationStyleSchema,
  guestAnnotationReadQuerySchema,
} from '../../../packages/contracts/src/guest-annotations';
import {
  guestSharedAnnotationItemSchema,
  guestSharedAnnotationsPageSchema,
  type GuestSharedAnnotationItem,
  type GuestSharedAnnotationsPage,
} from '../../../packages/contracts/src/annotation-threads';
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
const canCommentBit = guestPermissionBit('can_comment');

const sharedAnnotationCursorSchema = z
  .object({
    schemaVersion: z.literal(3),
    scopeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    guestWatermark: z.number().int().nonnegative().safe(),
    ownerWatermark: z.number().int().nonnegative().safe(),
    processingWatermark: z.number().int().nonnegative().safe(),
    afterCreatedAtMs: z.number().int().nonnegative().safe(),
    afterAnnotationId: z
      .uuid()
      .refine((value) => value === value.toLowerCase()),
  })
  .strict();

type SharedAnnotationCursor = z.infer<typeof sharedAnnotationCursorSchema>;

type SharedAnnotationReadRow = {
  sessionId: string;
  guestId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  authorizedAlbumId: string;
  authorizedPhotoId: string;
  authorizedVersionId: string;
  permissionsMask: number;
  guestWatermark: number;
  ownerWatermark: number;
  processingWatermark: number;
  authorType: 'guest' | 'owner' | null;
  annotationId: string | null;
  photoId: string | null;
  versionId: string | null;
  authorGuestId: string | null;
  revision: number | null;
  geometryJson: string | null;
  styleJson: string | null;
  commentId: string | null;
  state: 'open' | 'resolved' | 'deleted' | null;
  authorLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdAtMs: number | null;
  processingState: 'open' | 'in_progress' | 'resolved' | null;
  processingRevision: number | null;
  processingAnnotationRevision: number | null;
  processingContentRevision: number | null;
  processingUpdatedAtMs: number | null;
  processingStale: number | null;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('GUEST_ANNOTATIONS_UNAVAILABLE', 503);
}

function parseUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function decodeCursor(
  token: string | undefined,
): SharedAnnotationCursor | null {
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
    const parsed = sharedAnnotationCursorSchema.safeParse(
      JSON.parse(json) as unknown,
    );
    if (!parsed.success) invalidInput();

    const canonical = JSON.stringify({
      schemaVersion: parsed.data.schemaVersion,
      scopeDigest: parsed.data.scopeDigest,
      guestWatermark: parsed.data.guestWatermark,
      ownerWatermark: parsed.data.ownerWatermark,
      processingWatermark: parsed.data.processingWatermark,
      afterCreatedAtMs: parsed.data.afterCreatedAtMs,
      afterAnnotationId: parsed.data.afterAnnotationId,
    });
    if (canonical !== json) invalidInput();
    return parsed.data;
  } catch {
    invalidInput();
  }
}

function encodeCursor(cursor: SharedAnnotationCursor): string {
  try {
    return Buffer.from(
      JSON.stringify(sharedAnnotationCursorSchema.parse(cursor)),
      'utf8',
    ).toString('base64url');
  } catch {
    return unavailable();
  }
}

type SharedAnnotationScope = {
  sessionId: string;
  guestId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  versionId: string;
};

async function cursorScopeDigest(
  scope: SharedAnnotationScope,
): Promise<string> {
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
      'kino-pic:guest-annotations-shared:v3:' + canonicalScope,
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function authorizedPageSql(): string {
  return [
    'WITH authorized AS (',
    ' SELECT s.id AS sessionId,g.id AS guestId,i.id AS inviteId,',
    '   i.workspace_id AS workspaceId,i.project_id AS projectId,',
    '   ia.album_id AS albumId,i.permissions_mask AS permissionsMask',
    ' FROM guest_sessions s',
    ' JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
    ' JOIN guest_invites i ON i.id=s.invite_id',
    ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    ' JOIN guest_invite_albums ia ON ia.invite_id=i.id',
    '   AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id',
    '   AND ia.album_id=?',
    ' JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id',
    "   AND a.project_id=i.project_id AND a.state='active'",
    ' JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
    "   AND p.status NOT IN('archived','deleting','deleted')",
    ' JOIN workspaces w ON w.id=i.workspace_id',
    ' JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    '   AND i.created_by=o.user_id',
    ' WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
    "   AND s.expires_at_ms>unixepoch('subsec')*1000",
    `   AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}`,
    '   AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r',
    '     WHERE r.invite_id=i.id)',
    '   AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r',
    '     WHERE r.session_id=s.id)',
    '), authorized_version AS (',
    ' SELECT au.sessionId,au.guestId,au.inviteId,au.workspaceId,au.projectId,',
    '   au.albumId,au.permissionsMask,p.id AS photoId,ev.version_id AS versionId',
    ' FROM authorized au',
    ' JOIN photos p ON p.id=? AND p.workspace_id=au.workspaceId',
    '   AND p.project_id=au.projectId AND p.album_id=au.albumId',
    ' JOIN guest_annotation_eligible_versions ev ON ev.photo_id=p.id',
    '   AND ev.version_id=? AND ev.workspace_id=p.workspace_id',
    '   AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
    '), page_candidates AS (',
    " SELECT 'guest' AS authorType,x.id AS annotationId,",
    '   x.photo_id AS photoId,x.version_id AS versionId,',
    '   x.author_guest_id AS authorGuestId,x.revision,',
    '   x.geometry_json AS geometryJson,x.style_json AS styleJson,',
    '   x.linked_comment_id AS commentId,x.state,',
    '   x.author_label AS authorLabel,x.created_at_ms AS createdAtMs,',
    "   strftime('%Y-%m-%dT%H:%M:%fZ',x.created_at_ms/1000.0,'unixepoch') AS createdAt,",
    "   strftime('%Y-%m-%dT%H:%M:%fZ',x.updated_at_ms/1000.0,'unixepoch') AS updatedAt",
    ' FROM authorized_version av',
    ' JOIN guest_annotations x ON x.invite_id=av.inviteId',
    '   AND x.workspace_id=av.workspaceId AND x.project_id=av.projectId',
    '   AND x.album_id=av.albumId AND x.photo_id=av.photoId',
    '   AND x.version_id=av.versionId',
    ' UNION ALL',
    " SELECT 'owner' AS authorType,x.id AS annotationId,",
    '   x.photo_id AS photoId,x.version_id AS versionId,',
    '   NULL AS authorGuestId,x.revision,',
    '   x.geometry_json AS geometryJson,x.style_json AS styleJson,',
    '   x.linked_comment_id AS commentId,x.state,',
    '   x.author_label AS authorLabel,x.created_at_ms AS createdAtMs,',
    "   strftime('%Y-%m-%dT%H:%M:%fZ',x.created_at_ms/1000.0,'unixepoch') AS createdAt,",
    "   strftime('%Y-%m-%dT%H:%M:%fZ',x.updated_at_ms/1000.0,'unixepoch') AS updatedAt",
    ' FROM authorized_version av',
    ' JOIN owner_annotations x ON x.invite_id=av.inviteId',
    '   AND x.workspace_id=av.workspaceId AND x.project_id=av.projectId',
    '   AND x.album_id=av.albumId AND x.photo_id=av.photoId',
    '   AND x.version_id=av.versionId',
    '), page_rows AS (',
    " SELECT x.*,CASE WHEN x.authorType='guest' THEN COALESCE(ps.state,'open') ELSE NULL END AS processingState,",
    "   CASE WHEN x.authorType='guest' THEN COALESCE(ps.revision,0) ELSE NULL END AS processingRevision,",
    '   ps.annotation_revision AS processingAnnotationRevision,',
    '   ps.content_revision AS processingContentRevision,',
    '   ps.updated_at_ms AS processingUpdatedAtMs,',
    "   CASE WHEN x.authorType<>'guest' THEN NULL WHEN ps.annotation_id IS NULL THEN 0",
    '     WHEN ps.content_revision<>COALESCE((SELECT MAX(ch.revision)',
    '       FROM guest_annotation_changes ch WHERE ch.annotation_id=x.annotationId',
    "       AND ch.operation IN('create','update')),0) THEN 1 ELSE 0 END AS processingStale",
    ' FROM page_candidates x',
    ' JOIN authorized_version av ON x.photoId=av.photoId',
    '   AND x.versionId=av.versionId',
    ' LEFT JOIN owner_annotation_processing_states ps',
    "   ON x.authorType='guest' AND ps.annotation_id=x.annotationId",
    '   AND ps.invite_id=av.inviteId AND ps.workspace_id=av.workspaceId',
    '   AND ps.project_id=av.projectId AND ps.album_id=av.albumId',
    '   AND ps.photo_id=av.photoId AND ps.version_id=av.versionId',
    ' WHERE (? IS NULL OR x.annotationId=?)',
    '   AND (? IS NULL OR x.createdAtMs>? OR',
    '     (x.createdAtMs=? AND x.annotationId>?))',
    ' ORDER BY x.createdAtMs,x.annotationId LIMIT 25',
    ')',
    'SELECT av.sessionId,av.guestId,av.inviteId,av.workspaceId,av.projectId,',
    ' av.albumId AS authorizedAlbumId,av.photoId AS authorizedPhotoId,',
    ' av.versionId AS authorizedVersionId,av.permissionsMask,',
    ' COALESCE((SELECT MAX(ch.seq) FROM guest_annotation_changes ch',
    '   WHERE ch.invite_id=av.inviteId AND ch.workspace_id=av.workspaceId',
    '     AND ch.project_id=av.projectId AND ch.album_id=av.albumId',
    '     AND ch.photo_id=av.photoId AND ch.version_id=av.versionId),0) AS guestWatermark,',
    ' COALESCE((SELECT MAX(ch.seq) FROM owner_annotation_changes ch',
    '   WHERE ch.invite_id=av.inviteId AND ch.workspace_id=av.workspaceId',
    '     AND ch.project_id=av.projectId AND ch.album_id=av.albumId',
    '     AND ch.photo_id=av.photoId AND ch.version_id=av.versionId),0) AS ownerWatermark,',
    ' COALESCE((SELECT MAX(ch.seq) FROM owner_annotation_processing_changes ch',
    '   WHERE ch.invite_id=av.inviteId AND ch.workspace_id=av.workspaceId',
    '     AND ch.project_id=av.projectId AND ch.album_id=av.albumId',
    '     AND ch.photo_id=av.photoId AND ch.version_id=av.versionId),0) AS processingWatermark,',
    ' x.authorType,x.annotationId,x.photoId,x.versionId,x.authorGuestId,x.revision,',
    ' x.geometryJson,x.styleJson,x.commentId,x.state,x.authorLabel,',
    ' x.createdAt,x.updatedAt,x.createdAtMs,',
    ' x.processingState,x.processingRevision,x.processingAnnotationRevision,',
    ' x.processingContentRevision,x.processingUpdatedAtMs,x.processingStale',
    ' FROM authorized_version av LEFT JOIN page_rows x ON 1=1',
    ' ORDER BY x.createdAtMs,x.annotationId',
  ].join('\n');
}

function safeItem(
  row: SharedAnnotationReadRow,
  viewerGuestId: string,
  canComment: boolean,
): GuestSharedAnnotationItem {
  if (
    (row.authorType !== 'guest' && row.authorType !== 'owner') ||
    row.annotationId === null ||
    row.photoId === null ||
    row.versionId === null ||
    (row.authorType === 'guest' &&
      (row.authorGuestId === null ||
        !z.uuid().safeParse(row.authorGuestId).success)) ||
    (row.authorType === 'owner' &&
      (row.authorGuestId !== null || row.authorLabel !== '攝影師')) ||
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

  const isMine =
    row.authorType === 'guest' && row.authorGuestId === viewerGuestId;
  const processing =
    row.authorType === 'guest'
      ? readProcessingSnapshot(row)
      : ownerProcessingMustBeAbsent(row);
  const parsed = guestSharedAnnotationItemSchema.safeParse({
    annotationId: row.annotationId,
    photoId: row.photoId,
    versionId: row.versionId,
    revision: row.revision,
    geometry,
    style,
    commentId: isMine || canComment ? row.commentId : null,
    state: row.state,
    authorLabel: row.authorLabel,
    isMine,
    authorType: row.authorType,
    processing,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!parsed.success) return unavailable();
  return parsed.data;
}

function ownerProcessingMustBeAbsent(row: SharedAnnotationReadRow): null {
  if (
    row.processingState !== null ||
    row.processingRevision !== null ||
    row.processingAnnotationRevision !== null ||
    row.processingContentRevision !== null ||
    row.processingUpdatedAtMs !== null ||
    row.processingStale !== null
  )
    return unavailable();
  return null;
}

function readProcessingSnapshot(
  row: SharedAnnotationReadRow,
): AnnotationProcessingSnapshot {
  const { processingRevision } = row;
  if (processingRevision === null || processingRevision === 0) {
    if (
      (row.processingState !== null && row.processingState !== 'open') ||
      (row.processingAnnotationRevision !== null &&
        row.processingAnnotationRevision !== 0) ||
      (row.processingContentRevision !== null &&
        row.processingContentRevision !== 0) ||
      (row.processingUpdatedAtMs !== null && row.processingUpdatedAtMs !== 0) ||
      (row.processingStale !== null && row.processingStale !== 0)
    )
      return unavailable();
    return {
      state: 'open',
      revision: 0,
      annotationRevision: null,
      contentRevision: null,
      updatedAt: null,
      stale: false,
    };
  }

  if (
    !Number.isSafeInteger(processingRevision) ||
    processingRevision < 1 ||
    (row.processingState !== 'open' &&
      row.processingState !== 'in_progress' &&
      row.processingState !== 'resolved') ||
    row.processingAnnotationRevision === null ||
    !Number.isSafeInteger(row.processingAnnotationRevision) ||
    row.processingAnnotationRevision < 1 ||
    row.processingAnnotationRevision > (row.revision ?? 0) ||
    row.processingContentRevision === null ||
    !Number.isSafeInteger(row.processingContentRevision) ||
    row.processingContentRevision < 1 ||
    row.processingContentRevision > row.processingAnnotationRevision ||
    row.processingUpdatedAtMs === null ||
    !Number.isSafeInteger(row.processingUpdatedAtMs) ||
    row.processingUpdatedAtMs < 1 ||
    (row.processingStale !== 0 && row.processingStale !== 1)
  )
    return unavailable();

  let updatedAt: string;
  try {
    updatedAt = new Date(row.processingUpdatedAtMs).toISOString();
  } catch {
    return unavailable();
  }
  const parsed = annotationProcessingSnapshotSchema.safeParse({
    state: row.processingState,
    revision: processingRevision,
    annotationRevision: row.processingAnnotationRevision,
    contentRevision: row.processingContentRevision,
    updatedAt,
    stale: row.processingStale === 1,
  });
  if (!parsed.success) return unavailable();
  return parsed.data;
}

export class D1GuestSharedAnnotationReader {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async readShared(
    secret: string | null,
    albumIdInput: string,
    photoIdInput: string,
    versionIdInput: string,
    queryInput: unknown,
    annotationReadCapabilitiesHeader?: string,
  ): Promise<GuestSharedAnnotationsPage> {
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
        kind: 'guest-shared',
        secretHash,
        albumId,
        photoId,
        versionId,
      },
    ).catch(() => unavailable());
    let rows: D1Result<SharedAnnotationReadRow>;
    try {
      rows = await this.db
        .prepare(authorizedPageSql())
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
        .all<SharedAnnotationReadRow>();
    } catch {
      return unavailable();
    }

    const first = rows.results[0];
    if (!first) throw new GuestAccessDenied();

    const scope: SharedAnnotationScope = {
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
      scope.albumId !== albumId ||
      scope.photoId !== photoId ||
      scope.versionId !== versionId ||
      !Number.isSafeInteger(first.permissionsMask) ||
      first.permissionsMask < 0 ||
      !Number.isSafeInteger(first.guestWatermark) ||
      first.guestWatermark < 0 ||
      !Number.isSafeInteger(first.ownerWatermark) ||
      first.ownerWatermark < 0 ||
      !Number.isSafeInteger(first.processingWatermark) ||
      first.processingWatermark < 0
    ) {
      return unavailable();
    }

    let expectedScopeDigest: string;
    try {
      expectedScopeDigest = await cursorScopeDigest(scope);
    } catch {
      return unavailable();
    }
    if (cursor && cursor.scopeDigest !== expectedScopeDigest) invalidInput();
    const cursorWatermarksMatch =
      cursor === null ||
      (cursor.guestWatermark === first.guestWatermark &&
        cursor.ownerWatermark === first.ownerWatermark &&
        cursor.processingWatermark === first.processingWatermark);
    if (compatibilityPreflight.kind === 'denied') return unavailable();
    if (
      compatibilityPreflight.kind === 'authorized' &&
      !annotationReadWatermarksMatch(compatibilityPreflight, 'guest-shared', {
        guest: first.guestWatermark,
        owner: first.ownerWatermark,
        processing: first.processingWatermark,
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
    if (!cursorWatermarksMatch)
      throw new WorkspaceFailure('ANNOTATION_HISTORY_CHANGED', 409);
    const itemRows = rows.results.filter((row) => row.annotationId !== null);
    if (annotationId !== undefined && itemRows.length > 1) return unavailable();

    const canComment =
      (first.permissionsMask & canCommentBit) === canCommentBit;
    const items = itemRows.map((row) =>
      safeItem(row, scope.guestId, canComment),
    );
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
        schemaVersion: 3,
        scopeDigest: expectedScopeDigest,
        guestWatermark: first.guestWatermark,
        ownerWatermark: first.ownerWatermark,
        processingWatermark: first.processingWatermark,
        afterCreatedAtMs: boundaryRow.createdAtMs,
        afterAnnotationId: boundaryItem.annotationId,
      });
    }

    const page = guestSharedAnnotationsPageSchema.safeParse({
      guestId: scope.guestId,
      photoId,
      versionId,
      items: publicItems,
      nextCursor,
    });
    if (!page.success) return unavailable();
    return page.data;
  }
}
