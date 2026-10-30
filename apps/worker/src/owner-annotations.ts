import { z } from 'zod';
import { annotationGeometrySchema } from '../../../packages/contracts/src/annotation-geometry';
import {
  annotationProcessingSnapshotSchema,
  type AnnotationProcessingSnapshot,
} from '../../../packages/contracts/src/annotation-processing';
import { annotationStyleSchema } from '../../../packages/contracts/src/guest-annotations';
import {
  ownerAnnotationItemSchema,
  ownerAnnotationReadQuerySchema,
  ownerAnnotationsPageSchema,
  type OwnerAnnotationItem,
  type OwnerAnnotationReadQuery,
  type OwnerAnnotationsPage,
} from '../../../packages/contracts/src/owner-annotations';
import { WorkspaceFailure } from './workspaces';
import {
  annotationReadWatermarksMatch,
  AnnotationClientUpgradeRequiredError,
  decideAnnotationReadCompatibility,
  preflightFreehandAnnotationRead,
  supportsFreehandAnnotationRead,
} from './freehand-read-compat';

const ownerAnnotationCursorSchema = z
  .object({
    schemaVersion: z.literal(2),
    scopeDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    guestWatermark: z.number().int().nonnegative().safe(),
    processingWatermark: z.number().int().nonnegative().safe(),
    afterCreatedAtMs: z.number().int().nonnegative().safe(),
    afterAnnotationId: z
      .uuid()
      .refine((value) => value === value.toLowerCase()),
  })
  .strict();

type OwnerAnnotationCursor = z.infer<typeof ownerAnnotationCursorSchema>;

type OwnerAnnotationReadRow = {
  actorId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  inviteId: string;
  authorizedPhotoId: string;
  authorizedVersionId: string;
  guestWatermark: number;
  processingWatermark: number;
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
  throw new WorkspaceFailure('OWNER_ANNOTATIONS_UNAVAILABLE', 503);
}

function notFound(): never {
  throw new WorkspaceFailure('NOT_FOUND', 404);
}

function parseUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function parseReadQuery(input: unknown): OwnerAnnotationReadQuery {
  const parsed = ownerAnnotationReadQuerySchema.safeParse(input);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function decodeCursor(token: string | undefined): OwnerAnnotationCursor | null {
  if (token === undefined) return null;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  )
    invalidInput();

  try {
    const bytes = Buffer.from(token, 'base64url');
    if (
      bytes.length === 0 ||
      bytes.length > 768 ||
      bytes.toString('base64url') !== token
    )
      invalidInput();

    const json = bytes.toString('utf8');
    const parsed = ownerAnnotationCursorSchema.safeParse(
      JSON.parse(json) as unknown,
    );
    if (!parsed.success) invalidInput();

    const canonical = JSON.stringify({
      schemaVersion: parsed.data.schemaVersion,
      scopeDigest: parsed.data.scopeDigest,
      guestWatermark: parsed.data.guestWatermark,
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

function encodeCursor(cursor: OwnerAnnotationCursor): string {
  try {
    return Buffer.from(
      JSON.stringify(ownerAnnotationCursorSchema.parse(cursor)),
      'utf8',
    ).toString('base64url');
  } catch {
    return unavailable();
  }
}

async function cursorScopeDigest(
  actorId: string,
  inviteId: string,
  albumId: string,
  photoId: string,
  versionId: string,
): Promise<string> {
  const value = [
    'kino-pic:owner-annotations:v2',
    actorId,
    inviteId,
    albumId,
    photoId,
    versionId,
  ].join(':');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function currentOwnerCheckSql(): string {
  return [
    'SELECT 1 AS authorized',
    'FROM owners o',
    'JOIN owner_sessions s ON s.userId=o.user_id',
    "  AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
    'WHERE o.user_id=? AND o.enabled=1',
  ].join(' ');
}

function authorizedPageSql(): string {
  return [
    'WITH authorized AS (',
    '  SELECT o.user_id AS actorId,w.id AS workspaceId,',
    '    pr.id AS projectId,a.id AS albumId,i.id AS inviteId,',
    '    p.id AS authorizedPhotoId,v.id AS authorizedVersionId',
    '  FROM (SELECT ? AS actorId,? AS sessionId,? AS albumId,',
    '      ? AS photoId,? AS inviteId,? AS versionId) req',
    '  JOIN owners o ON o.user_id=req.actorId AND o.enabled=1',
    '  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=req.sessionId',
    "    AND s.expiresAt>unixepoch('subsec')*1000",
    '  JOIN workspaces w ON w.owner_user_id=o.user_id',
    '  JOIN albums a ON a.id=req.albumId AND a.workspace_id=w.id',
    "    AND a.state='active'",
    '  JOIN projects pr ON pr.id=a.project_id AND pr.workspace_id=w.id',
    "    AND pr.status NOT IN('archived','deleting','deleted')",
    '  JOIN photos p ON p.id=req.photoId AND p.workspace_id=w.id',
    '    AND p.project_id=pr.id AND p.album_id=a.id',
    '  JOIN guest_invites i ON i.id=req.inviteId AND i.workspace_id=w.id',
    '    AND i.project_id=pr.id AND i.created_by=o.user_id',
    '  JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    '  JOIN guest_invite_albums ia ON ia.invite_id=i.id',
    '    AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id',
    '    AND ia.album_id=a.id',
    '  JOIN photo_versions v ON v.id=req.versionId AND v.workspace_id=p.workspace_id',
    '    AND v.photo_id=p.id',

    '), page_rows AS (',
    "  SELECT x.*,COALESCE(ps.state,'open') AS processingState,",
    '    COALESCE(ps.revision,0) AS processingRevision,',
    '    ps.annotation_revision AS processingAnnotationRevision,',
    '    ps.content_revision AS processingContentRevision,',
    '    ps.updated_at_ms AS processingUpdatedAtMs,',
    '    CASE WHEN ps.annotation_id IS NULL THEN 0',
    '      WHEN ps.content_revision<>COALESCE((SELECT MAX(ch.revision)',
    '        FROM guest_annotation_changes ch WHERE ch.annotation_id=x.id',
    "        AND ch.operation IN('create','update')),0) THEN 1 ELSE 0 END AS processingStale",
    '  FROM authorized auth',
    '  JOIN guest_annotations x ON x.invite_id=auth.inviteId',
    '    AND x.workspace_id=auth.workspaceId AND x.project_id=auth.projectId',
    '    AND x.album_id=auth.albumId AND x.photo_id=auth.authorizedPhotoId',
    '    AND x.version_id=auth.authorizedVersionId',
    '  LEFT JOIN owner_annotation_processing_states ps',
    '    ON ps.annotation_id=x.id AND ps.invite_id=x.invite_id',
    '    AND ps.workspace_id=x.workspace_id AND ps.project_id=x.project_id',
    '    AND ps.album_id=x.album_id AND ps.photo_id=x.photo_id',
    '    AND ps.version_id=x.version_id',
    '  WHERE (? IS NULL OR x.id=?)',
    '    AND (? IS NULL OR x.created_at_ms>? OR',
    '      (x.created_at_ms=? AND x.id>?))',
    '  ORDER BY x.created_at_ms,x.id LIMIT 25',
    ')',
    'SELECT auth.actorId,auth.workspaceId,auth.projectId,auth.albumId,',
    '  auth.inviteId,auth.authorizedPhotoId,auth.authorizedVersionId,',
    '  COALESCE((SELECT MAX(ch.seq) FROM guest_annotation_changes ch',
    '    WHERE ch.invite_id=auth.inviteId AND ch.workspace_id=auth.workspaceId',
    '      AND ch.project_id=auth.projectId AND ch.album_id=auth.albumId',
    '      AND ch.photo_id=auth.authorizedPhotoId',
    '      AND ch.version_id=auth.authorizedVersionId),0) AS guestWatermark,',
    '  COALESCE((SELECT MAX(ch.seq) FROM owner_annotation_processing_changes ch',
    '    WHERE ch.invite_id=auth.inviteId AND ch.workspace_id=auth.workspaceId',
    '      AND ch.project_id=auth.projectId AND ch.album_id=auth.albumId',
    '      AND ch.photo_id=auth.authorizedPhotoId',
    '      AND ch.version_id=auth.authorizedVersionId),0) AS processingWatermark,',
    '  x.id AS annotationId,x.photo_id AS photoId,x.version_id AS versionId,',
    '  x.author_guest_id AS authorGuestId,x.revision,',
    '  x.geometry_json AS geometryJson,x.style_json AS styleJson,',
    '  x.linked_comment_id AS commentId,x.state,x.author_label AS authorLabel,',
    "  CASE WHEN x.id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',x.created_at_ms/1000.0,'unixepoch') END AS createdAt,",
    "  CASE WHEN x.id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',x.updated_at_ms/1000.0,'unixepoch') END AS updatedAt,",
    '  x.created_at_ms AS createdAtMs,',
    '  x.processingState,x.processingRevision,x.processingAnnotationRevision,',
    '  x.processingContentRevision,x.processingUpdatedAtMs,x.processingStale',
    'FROM authorized auth LEFT JOIN page_rows x ON 1=1',
    'ORDER BY x.created_at_ms,x.id',
  ].join('\n');
}

function safeItem(row: OwnerAnnotationReadRow): OwnerAnnotationItem {
  if (
    row.annotationId === null ||
    row.photoId === null ||
    row.versionId === null ||
    row.authorGuestId === null ||
    row.revision === null ||
    row.state === null ||
    row.authorLabel === null ||
    row.createdAt === null ||
    row.updatedAt === null
  )
    return unavailable();

  let geometry: z.infer<typeof annotationGeometrySchema> | null = null;
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

  const processing = readProcessingSnapshot(row);

  const parsed = ownerAnnotationItemSchema.safeParse({
    annotationId: row.annotationId,
    photoId: row.photoId,
    versionId: row.versionId,
    authorGuestId: row.authorGuestId,
    revision: row.revision,
    geometry,
    style,
    commentId: row.commentId,
    state: row.state,
    authorLabel: row.authorLabel,
    canEdit: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    processing,
  });
  if (!parsed.success) return unavailable();
  return parsed.data;
}

function readProcessingSnapshot(
  row: OwnerAnnotationReadRow,
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

export class D1OwnerAnnotationsRepository {
  constructor(private db: D1Database) {}

  async read(
    actorIdInput: string,
    sessionIdInput: string,
    albumIdInput: string,
    photoIdInput: string,
    versionIdInput: string,
    queryInput: unknown,
    annotationReadCapabilitiesHeader?: string,
  ): Promise<OwnerAnnotationsPage> {
    const actorId = parseUuid(actorIdInput);
    const sessionId = sessionIdInput;
    const albumId = parseUuid(albumIdInput);
    const photoId = parseUuid(photoIdInput);
    const versionId = parseUuid(versionIdInput);
    const query = parseReadQuery(queryInput);
    const cursor = decodeCursor(query.cursor);

    let owner: { authorized: number } | null;
    try {
      owner = await this.db
        .prepare(currentOwnerCheckSql())
        .bind(sessionId, actorId)
        .first<{ authorized: number }>();
    } catch {
      return unavailable();
    }
    if (!owner) throw new WorkspaceFailure('OWNER_REQUIRED', 403);

    const compatibilityPreflight = await preflightFreehandAnnotationRead(
      this.db,
      {
        kind: 'owner-guest-list',
        ownerId: actorId,
        sessionId,
        inviteId: query.inviteId,
        albumId,
        photoId,
        versionId,
      },
    ).catch(() => unavailable());
    let rows: D1Result<OwnerAnnotationReadRow>;
    try {
      rows = await this.db
        .prepare(authorizedPageSql())
        .bind(
          actorId,
          sessionId,
          albumId,
          photoId,
          query.inviteId,
          versionId,
          query.annotationId ?? null,
          query.annotationId ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterAnnotationId ?? null,
        )
        .all<OwnerAnnotationReadRow>();
    } catch {
      return unavailable();
    }

    const first = rows.results[0];
    if (!first) return notFound();

    const scopeValues = [
      first.actorId,
      first.workspaceId,
      first.projectId,
      first.albumId,
      first.inviteId,
      first.authorizedPhotoId,
      first.authorizedVersionId,
    ];
    if (
      scopeValues.some((value) => !z.uuid().safeParse(value).success) ||
      first.actorId !== actorId ||
      first.albumId !== albumId ||
      first.inviteId !== query.inviteId ||
      first.authorizedPhotoId !== photoId ||
      first.authorizedVersionId !== versionId ||
      !Number.isSafeInteger(first.guestWatermark) ||
      first.guestWatermark < 0 ||
      !Number.isSafeInteger(first.processingWatermark) ||
      first.processingWatermark < 0
    )
      return unavailable();

    let expectedDigest: string;
    try {
      expectedDigest = await cursorScopeDigest(
        actorId,
        first.inviteId,
        albumId,
        photoId,
        versionId,
      );
    } catch {
      return unavailable();
    }
    if (cursor && cursor.scopeDigest !== expectedDigest) invalidInput();
    const cursorWatermarksMatch =
      cursor === null ||
      (cursor.guestWatermark === first.guestWatermark &&
        cursor.processingWatermark === first.processingWatermark);
    if (compatibilityPreflight.kind === 'denied') return unavailable();
    if (
      compatibilityPreflight.kind === 'authorized' &&
      !annotationReadWatermarksMatch(
        compatibilityPreflight,
        'owner-guest-list',
        {
          guest: first.guestWatermark,
          processing: first.processingWatermark,
        },
      )
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
    if (query.annotationId !== undefined && itemRows.length > 1)
      return unavailable();
    const items = itemRows.map(safeItem);
    const hasMore = items.length > 24;
    const pageItems = items.slice(0, 24);

    let nextCursor: string | null = null;
    if (hasMore) {
      const boundaryItem = pageItems[23];
      const boundaryRow = itemRows[23];
      if (
        !boundaryItem ||
        !boundaryRow ||
        boundaryRow.createdAtMs === null ||
        !Number.isSafeInteger(boundaryRow.createdAtMs) ||
        boundaryRow.createdAtMs < 0
      )
        return unavailable();
      nextCursor = encodeCursor({
        schemaVersion: 2,
        scopeDigest: expectedDigest,
        guestWatermark: first.guestWatermark,
        processingWatermark: first.processingWatermark,
        afterCreatedAtMs: boundaryRow.createdAtMs,
        afterAnnotationId: boundaryItem.annotationId,
      });
    }

    const page = ownerAnnotationsPageSchema.safeParse({
      inviteId: first.inviteId,
      photoId,
      versionId,
      items: pageItems,
      nextCursor,
    });
    if (!page.success) return unavailable();
    return page.data;
  }
}
