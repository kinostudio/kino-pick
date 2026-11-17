import { z } from 'zod';
import {
  albumOwnerFeedbackCommandSchema,
  albumOwnerFeedbackItemSchema,
  albumOwnerFeedbackPageSchema,
  albumOwnerFeedbackResultSchema,
  type AlbumOwnerFeedbackCommand,
  type AlbumOwnerFeedbackItem,
  type AlbumOwnerFeedbackPage,
  type AlbumOwnerFeedbackResult,
} from '../../../packages/contracts/src/album-owner-feedback';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import { canonicalAnnotationGeometry } from './freehand-canonical';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const pageSize = 24;
const canViewBit = guestPermissionBit('can_view');
const canCompareBit = guestPermissionBit('can_compare_versions');

type TargetRow = {
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  versionId: string;
};
type FeedbackRow = {
  id: string | null;
  itemJson: string | null;
  createdAtMs: number | null;
};
type ReceiptRow = {
  requestJson: string;
  resultJson: string;
  albumId: string;
  photoId: string;
  versionId: string;
};
type Cursor = {
  albumId: string;
  photoId: string;
  versionId: string;
  afterCreatedAtMs: number;
  afterId: string;
};

const cursorSchema = z
  .object({
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    afterCreatedAtMs: z.number().int().nonnegative().safe(),
    afterId: z.uuid(),
  })
  .strict();

function fail(code: string, status: 400 | 401 | 403 | 404 | 409 | 503): never {
  throw new WorkspaceFailure(code, status);
}
function invalidInput(): never {
  return fail('INVALID_INPUT', 400);
}
function unavailable(): never {
  return fail('ALBUM_OWNER_FEEDBACK_UNAVAILABLE', 503);
}
function parseUuid(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) return invalidInput();
  return parsed.data.toLowerCase();
}
function parseSession(value: unknown): string {
  const parsed = z.string().min(1).max(512).safeParse(value);
  if (!parsed.success) return invalidInput();
  return parsed.data;
}
function decodeCursor(
  token: string | undefined,
  scope: Omit<Cursor, 'afterCreatedAtMs' | 'afterId'>,
): Cursor | null {
  if (token === undefined) return null;
  if (
    token.length === 0 ||
    token.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  )
    return invalidInput();
  let cursor: Cursor;
  try {
    const decoded = atob(token.replaceAll('-', '+').replaceAll('_', '/'));
    const padded = btoa(decoded)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    if (padded !== token) return invalidInput();
    cursor = cursorSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    return invalidInput();
  }
  if (
    cursor.albumId !== scope.albumId ||
    cursor.photoId !== scope.photoId ||
    cursor.versionId !== scope.versionId
  )
    return invalidInput();
  return cursor;
}
function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
function ownerScopeSql(requireCurrent = false): string {
  return [
    'SELECT w.id AS workspaceId,p.id AS projectId,a.id AS albumId,',
    ' ph.id AS photoId,v.id AS versionId',
    'FROM owners o',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    " AND s.expiresAt>unixepoch('subsec')*1000",
    'JOIN workspaces w ON w.owner_user_id=o.user_id',
    'JOIN projects p ON p.workspace_id=w.id AND p.id=?',
    " AND p.status NOT IN('archived','deleting','deleted')",
    'JOIN albums a ON a.id=? AND a.workspace_id=w.id AND a.project_id=p.id',
    " AND a.state IN('draft','active')",
    'JOIN photos ph ON ph.id=? AND ph.workspace_id=w.id',
    ' AND ph.project_id=p.id AND ph.album_id=a.id',
    'JOIN photo_versions v ON v.id=? AND v.workspace_id=w.id AND v.photo_id=ph.id',
    ...(requireCurrent
      ? [
          'JOIN photo_version_heads h ON h.photo_id=ph.id AND h.workspace_id=w.id',
          ' AND h.project_id=p.id AND h.album_id=a.id AND h.version_id=v.id',
        ]
      : []),
    'JOIN guest_comment_eligible_versions ev ON ev.version_id=v.id',
    ' AND ev.photo_id=ph.id AND ev.workspace_id=w.id AND ev.project_id=p.id AND ev.album_id=a.id',
    'WHERE o.user_id=? AND o.enabled=1',
  ].join('\n');
}
function ownerHeadSql(): string {
  return [
    'SELECT h.version_id AS currentVersionId',
    'FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    " AND s.expiresAt>unixepoch('subsec')*1000",
    'JOIN workspaces w ON w.owner_user_id=o.user_id',
    'JOIN projects p ON p.workspace_id=w.id AND p.id=?',
    " AND p.status NOT IN('archived','deleting','deleted')",
    'JOIN albums a ON a.id=? AND a.workspace_id=w.id AND a.project_id=p.id',
    " AND a.state IN('draft','active')",
    'JOIN photos ph ON ph.id=? AND ph.workspace_id=w.id AND ph.project_id=p.id AND ph.album_id=a.id',
    'JOIN photo_version_heads h ON h.photo_id=ph.id AND h.workspace_id=w.id',
    ' AND h.project_id=p.id AND h.album_id=a.id',
    'JOIN photo_versions v ON v.id=? AND v.workspace_id=w.id AND v.photo_id=ph.id',
    'WHERE o.user_id=? AND o.enabled=1',
  ].join('\n');
}
function ownerTargetBindings(
  sessionId: string,
  projectId: string,
  albumId: string,
  photoId: string,
  versionId: string,
  actorId: string,
) {
  return [sessionId, projectId, albumId, photoId, versionId, actorId];
}
function itemJsonSql(alias: string): string {
  return [
    'CASE ' + alias + '.kind',
    " WHEN 'comment' THEN json_object(",
    "  'id'," +
      alias +
      ".id,'kind','comment','scope',json_object('kind','album'),",
    "  'albumId'," + alias + ".album_id,'photoId'," + alias + '.photo_id,',
    "  'versionId'," +
      alias +
      ".version_id,'revision'," +
      alias +
      ".revision,'state'," +
      alias +
      '.state,',
    "  'authorType','owner','authorLabel'," +
      alias +
      ".author_label,'body'," +
      alias +
      '.body,',
    "  'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ'," +
      alias +
      ".created_at_ms/1000.0,'unixepoch'),",
    "  'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ'," +
      alias +
      ".updated_at_ms/1000.0,'unixepoch'))",
    ' ELSE json_object(',
    "  'id'," +
      alias +
      ".id,'kind','annotation','scope',json_object('kind','album'),",
    "  'albumId'," + alias + ".album_id,'photoId'," + alias + '.photo_id,',
    "  'versionId'," +
      alias +
      ".version_id,'revision'," +
      alias +
      ".revision,'state'," +
      alias +
      '.state,',
    "  'authorType','owner','authorLabel'," +
      alias +
      ".author_label,'geometry',json(" +
      alias +
      '.geometry_json),',
    "  'style',json(" + alias + '.style_json),',
    "  'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ'," +
      alias +
      ".created_at_ms/1000.0,'unixepoch'),",
    "  'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ'," +
      alias +
      ".updated_at_ms/1000.0,'unixepoch'))",
    ' END',
  ].join('\n');
}
function ownerPageSql(): string {
  return [
    'WITH authorized AS (',
    ownerScopeSql(),
    '), page_rows AS (',
    ' SELECT f.id,f.created_at_ms,' + itemJsonSql('f') + ' AS itemJson',
    ' FROM authorized a JOIN album_owner_feedback f ON f.album_id=a.albumId',
    '  AND f.photo_id=a.photoId AND f.version_id=a.versionId',
    ' WHERE (? IS NULL OR f.created_at_ms>? OR (f.created_at_ms=? AND f.id>?))',
    ' ORDER BY f.created_at_ms,f.id LIMIT 25',
    ')',
    'SELECT a.workspaceId,a.projectId,a.albumId,a.photoId,a.versionId,',
    ' r.id,r.created_at_ms AS createdAtMs,r.itemJson',
    'FROM authorized a LEFT JOIN page_rows r ON 1=1',
    'ORDER BY r.created_at_ms,r.id',
  ].join('\n');
}
function guestPageSql(): string {
  return [
    'WITH authorized AS (',
    ' SELECT s.id AS sessionId,g.id AS guestId,i.id AS inviteId,',
    '  i.workspace_id AS workspaceId,i.project_id AS projectId,ia.album_id AS albumId,',
    '  i.permissions_mask AS permissionsMask',
    ' FROM guest_sessions s',
    ' JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
    ' JOIN guest_invites i ON i.id=s.invite_id',
    ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    ' JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id',
    '  AND ia.project_id=i.project_id AND ia.album_id=?',
    ' JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id',
    "  AND a.project_id=i.project_id AND a.state='active'",
    ' JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
    "  AND p.status NOT IN('archived','deleting','deleted')",
    ' JOIN workspaces w ON w.id=i.workspace_id',
    ' JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
    ' WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
    "  AND s.expires_at_ms>unixepoch('subsec')*1000",
    "  AND i.expires_at_ms>unixepoch('subsec')*1000",
    '  AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)',
    '  AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)',
    '), authorized_version AS (',
    ' SELECT gs.sessionId,gs.guestId,gs.inviteId,gs.workspaceId,gs.projectId,gs.albumId,',
    '  p.id AS photoId,v.id AS versionId',
    ' FROM authorized gs JOIN photos p ON p.id=? AND p.workspace_id=gs.workspaceId',
    '  AND p.project_id=gs.projectId AND p.album_id=gs.albumId',
    ' JOIN photo_version_heads h ON h.photo_id=p.id AND h.workspace_id=p.workspace_id',
    '  AND h.project_id=p.project_id AND h.album_id=p.album_id',
    ' JOIN photo_versions v ON v.id=? AND v.workspace_id=p.workspace_id AND v.photo_id=p.id',
    ' JOIN guest_comment_eligible_versions ev ON ev.version_id=v.id',
    '  AND ev.workspace_id=p.workspace_id AND ev.project_id=p.project_id',
    '  AND ev.album_id=p.album_id AND ev.photo_id=p.id',
    ' WHERE (v.id=h.version_id OR ((gs.permissionsMask & ?)=? AND (',
    '  v.version_no=1 OR EXISTS(SELECT 1 FROM photo_version_head_commands c',
    '   JOIN photo_version_head_results r ON r.command_id=c.id',
    '   WHERE c.photo_id=p.id AND c.workspace_id=p.workspace_id',
    '    AND c.project_id=p.project_id AND c.album_id=p.album_id',
    "    AND c.version_id=v.id AND json_extract(r.result_json,'$.changed')=1))))",
    '), page_rows AS (',
    ' SELECT f.id,f.created_at_ms,' + itemJsonSql('f') + ' AS itemJson',
    ' FROM authorized_version av JOIN album_owner_feedback f ON f.album_id=av.albumId',
    '  AND f.photo_id=av.photoId AND f.version_id=av.versionId',
    ' WHERE (? IS NULL OR f.created_at_ms>? OR (f.created_at_ms=? AND f.id>?))',
    ' ORDER BY f.created_at_ms,f.id LIMIT 25',
    ')',
    'SELECT av.albumId,av.photoId,av.versionId,r.id,r.created_at_ms AS createdAtMs,r.itemJson',
    'FROM authorized_version av LEFT JOIN page_rows r ON 1=1',
    'ORDER BY r.created_at_ms,r.id',
  ].join('\n');
}
function encodeRequest(
  albumId: string,
  command: AlbumOwnerFeedbackCommand,
): string {
  const base = {
    requestId: command.requestId,
    operation: command.operation,
    albumId,
    photoId: command.photoId,
    versionId: command.versionId,
  };
  if (command.operation === 'create_comment')
    return JSON.stringify({ ...base, body: command.body });
  if (command.operation === 'update_comment')
    return JSON.stringify({
      ...base,
      feedbackId: command.feedbackId,
      expectedRevision: command.expectedRevision,
      body: command.body,
    });
  if (
    command.operation === 'delete_comment' ||
    command.operation === 'delete_annotation'
  )
    return JSON.stringify({
      ...base,
      feedbackId: command.feedbackId,
      expectedRevision: command.expectedRevision,
    });
  const geometry = canonicalAnnotationGeometry(command.geometry);
  if (command.operation === 'create_annotation')
    return JSON.stringify({ ...base, geometry, style: command.style });
  return JSON.stringify({
    ...base,
    feedbackId: command.feedbackId,
    expectedRevision: command.expectedRevision,
    geometry,
    style: command.style,
  });
}
function parseItem(value: unknown): AlbumOwnerFeedbackItem {
  const parsed = albumOwnerFeedbackItemSchema.safeParse(value);
  if (!parsed.success) return unavailable();
  return parsed.data;
}
function parseResult(value: unknown): AlbumOwnerFeedbackResult {
  const parsed = albumOwnerFeedbackResultSchema.safeParse(value);
  if (!parsed.success) return unavailable();
  return parsed.data;
}
function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return unavailable();
  }
}
function readErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  for (const code of [
    'OWNER_REQUIRED',
    'REQUEST_ID_CONFLICT',
    'CURRENT_VERSION_CHANGED',
    'FEEDBACK_REVISION_CONFLICT',
    'RESOURCE_NOT_EDITABLE',
    'NOT_FOUND',
    'INVALID_INPUT',
    'INVALID_TIMESTAMP',
  ])
    if (message.includes(code)) return code;
  return '';
}
function throwMapped(error: unknown): never {
  switch (readErrorCode(error)) {
    case 'OWNER_REQUIRED':
      return fail('OWNER_REQUIRED', 403);
    case 'REQUEST_ID_CONFLICT':
      return fail('REQUEST_ID_CONFLICT', 409);
    case 'CURRENT_VERSION_CHANGED':
      return fail('CURRENT_VERSION_CHANGED', 409);
    case 'FEEDBACK_REVISION_CONFLICT':
      return fail('FEEDBACK_REVISION_CONFLICT', 409);
    case 'RESOURCE_NOT_EDITABLE':
      return fail('RESOURCE_NOT_EDITABLE', 409);
    case 'NOT_FOUND':
      return fail('NOT_FOUND', 404);
    case 'INVALID_INPUT':
      return fail('INVALID_INPUT', 400);
    case 'INVALID_TIMESTAMP':
      return unavailable();
    default:
      throw error;
  }
}
function safeResult(resultJson: string): AlbumOwnerFeedbackResult {
  return parseResult(parseStoredJson(resultJson));
}
function checkResultScope(
  result: AlbumOwnerFeedbackResult,
  albumId: string,
  photoId: string,
  versionId: string,
  command: AlbumOwnerFeedbackCommand,
) {
  const expectedKind = command.operation.endsWith('_comment')
    ? 'comment'
    : 'annotation';
  if (
    result.requestId !== command.requestId ||
    result.operation !== command.operation ||
    result.item.kind !== expectedKind ||
    result.item.scope.kind !== 'album' ||
    result.item.albumId !== albumId ||
    result.item.photoId !== photoId ||
    result.item.versionId !== versionId ||
    result.item.authorType !== 'owner' ||
    result.item.revision !==
      ('expectedRevision' in command ? command.expectedRevision + 1 : 1) ||
    ('feedbackId' in command && result.item.id !== command.feedbackId)
  )
    return unavailable();
}
async function assertCurrentOwner(
  db: D1Database,
  actorId: string,
  sessionId: string,
) {
  try {
    const row = await db
      .prepare(
        'SELECT 1 AS authorized FROM owners o JOIN owner_sessions s ON s.userId=o.user_id ' +
          "AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE o.user_id=? AND o.enabled=1",
      )
      .bind(sessionId, actorId)
      .first<{ authorized: number }>();
    if (!row) fail('OWNER_REQUIRED', 403);
  } catch (error) {
    if (error instanceof WorkspaceFailure) throw error;
    throwMapped(error);
  }
}

export class D1AlbumOwnerFeedbackRepository {
  constructor(
    private readonly db: D1Database,
    private readonly freehandWriteEnabled = false,
  ) {}

  private async target(
    actorId: string,
    sessionId: string,
    albumId: string,
    photoId: string,
    versionId: string,
    requireCurrent = false,
  ): Promise<TargetRow> {
    const project = await this.db
      .prepare(
        'SELECT a.project_id AS projectId FROM albums a JOIN workspaces w ON w.id=a.workspace_id ' +
          'WHERE a.id=? AND w.owner_user_id=?',
      )
      .bind(albumId, actorId)
      .first<{ projectId: string }>();
    if (!project) return fail('NOT_FOUND', 404);
    let row: TargetRow | null;
    try {
      row = await this.db
        .prepare(ownerScopeSql(requireCurrent))
        .bind(
          sessionId,
          project.projectId,
          albumId,
          photoId,
          versionId,
          actorId,
        )
        .first<TargetRow>();
    } catch (error) {
      throwMapped(error);
    }
    if (row) return row;
    if (!requireCurrent) return fail('NOT_FOUND', 404);
    const head = await this.db
      .prepare(ownerHeadSql())
      .bind(sessionId, project.projectId, albumId, photoId, versionId, actorId)
      .first<{ currentVersionId: string }>();
    if (head && head.currentVersionId.toLowerCase() !== versionId)
      return fail('CURRENT_VERSION_CHANGED', 409);
    return fail('NOT_FOUND', 404);
  }

  async readOwner(
    actorInput: string,
    sessionInput: string,
    albumInput: string,
    photoInput: string,
    versionInput: string,
    cursorInput?: string,
  ): Promise<AlbumOwnerFeedbackPage> {
    const actorId = parseUuid(actorInput);
    const sessionId = parseSession(sessionInput);
    const albumId = parseUuid(albumInput);
    const photoId = parseUuid(photoInput);
    const versionId = parseUuid(versionInput);
    const cursor = decodeCursor(cursorInput, { albumId, photoId, versionId });
    await assertCurrentOwner(this.db, actorId, sessionId);
    const target = await this.target(
      actorId,
      sessionId,
      albumId,
      photoId,
      versionId,
    );
    let rows: D1Result<FeedbackRow & TargetRow>;
    try {
      rows = await this.db
        .prepare(ownerPageSql())
        .bind(
          ...ownerTargetBindings(
            sessionId,
            target.projectId,
            albumId,
            photoId,
            versionId,
            actorId,
          ),
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterId ?? null,
        )
        .all<FeedbackRow & TargetRow>();
    } catch (error) {
      throwMapped(error);
    }
    const first = rows.results[0];
    if (!first) return unavailable();
    const itemRows = rows.results.filter((row) => row.itemJson !== null);
    const items = itemRows
      .slice(0, pageSize)
      .map((row) => parseItem(parseStoredJson(row.itemJson!)));
    const hasMore = itemRows.length > pageSize;
    const boundary = itemRows[pageSize - 1];
    const nextCursor =
      hasMore && boundary && typeof boundary.createdAtMs === 'number'
        ? encodeCursor({
            albumId,
            photoId,
            versionId,
            afterCreatedAtMs: boundary.createdAtMs,
            afterId: boundary.id!,
          })
        : null;
    const parsed = albumOwnerFeedbackPageSchema.safeParse({
      albumId,
      photoId,
      versionId,
      items,
      nextCursor,
    });
    if (!parsed.success) return unavailable();
    return parsed.data;
  }

  async readGuest(
    secretInput: string | null,
    albumInput: string,
    photoInput: string,
    versionInput: string,
    cursorInput?: string,
  ): Promise<AlbumOwnerFeedbackPage> {
    const albumId = parseUuid(albumInput);
    const photoId = parseUuid(photoInput);
    const versionId = parseUuid(versionInput);
    const cursor = decodeCursor(cursorInput, { albumId, photoId, versionId });
    if (!secretInput) throw new GuestAccessDenied();
    let secretHash: string;
    try {
      secretHash = await hashGuestSessionSecret(secretInput);
    } catch {
      throw new GuestAccessDenied();
    }
    let rows: D1Result<FeedbackRow & TargetRow>;
    try {
      rows = await this.db
        .prepare(guestPageSql())
        .bind(
          albumId,
          secretHash,
          canViewBit,
          canViewBit,
          photoId,
          versionId,
          canCompareBit,
          canCompareBit,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterId ?? null,
        )
        .all<FeedbackRow & TargetRow>();
    } catch (error) {
      throwMapped(error);
    }
    const first = rows.results[0];
    if (!first) throw new GuestAccessDenied();
    if (
      first.albumId !== albumId ||
      first.photoId !== photoId ||
      first.versionId !== versionId
    )
      return unavailable();
    const itemRows = rows.results.filter((row) => row.itemJson !== null);
    const items = itemRows
      .slice(0, pageSize)
      .map((row) => parseItem(parseStoredJson(row.itemJson!)));
    const hasMore = itemRows.length > pageSize;
    const boundary = itemRows[pageSize - 1];
    const nextCursor =
      hasMore && boundary && typeof boundary.createdAtMs === 'number'
        ? encodeCursor({
            albumId,
            photoId,
            versionId,
            afterCreatedAtMs: boundary.createdAtMs,
            afterId: boundary.id!,
          })
        : null;
    const parsed = albumOwnerFeedbackPageSchema.safeParse({
      albumId,
      photoId,
      versionId,
      items,
      nextCursor,
    });
    if (!parsed.success) return unavailable();
    return parsed.data;
  }

  async command(
    actorInput: string,
    sessionInput: string,
    albumInput: string,
    input: unknown,
  ): Promise<AlbumOwnerFeedbackResult> {
    const actorId = parseUuid(actorInput);
    const sessionId = parseSession(sessionInput);
    const albumId = parseUuid(albumInput);
    const parsedCommand = albumOwnerFeedbackCommandSchema.safeParse(input);
    if (!parsedCommand.success) return invalidInput();
    const command = parsedCommand.data;
    const photoId = parseUuid(command.photoId);
    const versionId = parseUuid(command.versionId);
    const requestJson = encodeRequest(albumId, command);
    await assertCurrentOwner(this.db, actorId, sessionId);

    const prior = await this.db
      .prepare(
        'SELECT c.request_json AS requestJson,r.result_json AS resultJson,' +
          'c.album_id AS albumId,c.photo_id AS photoId,c.version_id AS versionId ' +
          'FROM album_owner_feedback_commands c JOIN album_owner_feedback_results r ON r.command_id=c.id ' +
          'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 ' +
          "JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 " +
          'WHERE c.actor_id=? AND c.request_id=?',
      )
      .bind(sessionId, actorId, command.requestId)
      .first<ReceiptRow>();
    if (prior) {
      if (
        prior.requestJson !== requestJson ||
        prior.albumId !== albumId ||
        prior.photoId !== photoId ||
        prior.versionId !== versionId
      )
        return fail('REQUEST_ID_CONFLICT', 409);
      const result = safeResult(prior.resultJson);
      checkResultScope(result, albumId, photoId, versionId, command);
      return result;
    }

    if (
      (command.operation === 'create_annotation' ||
        command.operation === 'update_annotation') &&
      command.geometry.type === 'freehand' &&
      !this.freehandWriteEnabled
    )
      return fail('FREEHAND_ANNOTATIONS_DISABLED', 409);

    const target = await this.target(
      actorId,
      sessionId,
      albumId,
      photoId,
      versionId,
      command.operation.startsWith('create_'),
    );
    const kind = command.operation.endsWith('_comment')
      ? 'comment'
      : 'annotation';
    const feedbackId =
      'feedbackId' in command
        ? command.feedbackId
        : crypto.randomUUID().toLowerCase();
    const expectedRevision =
      'expectedRevision' in command ? command.expectedRevision : null;
    const body =
      command.operation === 'create_comment' ||
      command.operation === 'update_comment'
        ? command.body
        : null;
    const geometryJson =
      command.operation === 'create_annotation' ||
      command.operation === 'update_annotation'
        ? JSON.stringify(canonicalAnnotationGeometry(command.geometry))
        : null;
    const styleJson =
      command.operation === 'create_annotation' ||
      command.operation === 'update_annotation'
        ? JSON.stringify(command.style)
        : null;

    try {
      await this.db
        .prepare(
          'INSERT INTO album_owner_feedback_commands(' +
            'id,actor_id,session_id,request_id,workspace_id,project_id,album_id,photo_id,version_id,' +
            'feedback_id,kind,operation,expected_revision,body,geometry_json,style_json,request_json' +
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID().toLowerCase(),
          actorId,
          sessionId,
          command.requestId,
          target.workspaceId,
          target.projectId,
          albumId,
          photoId,
          versionId,
          feedbackId,
          kind,
          command.operation,
          expectedRevision,
          body,
          geometryJson,
          styleJson,
          requestJson,
        )
        .run();
    } catch (error) {
      throwMapped(error);
    }

    let receipt: ReceiptRow | null;
    try {
      receipt = await this.db
        .prepare(
          'SELECT c.request_json AS requestJson,r.result_json AS resultJson,' +
            'c.album_id AS albumId,c.photo_id AS photoId,c.version_id AS versionId ' +
            'FROM album_owner_feedback_commands c JOIN album_owner_feedback_results r ON r.command_id=c.id ' +
            'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 ' +
            "JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 " +
            'WHERE c.actor_id=? AND c.request_id=?',
        )
        .bind(sessionId, actorId, command.requestId)
        .first<ReceiptRow>();
    } catch (error) {
      throwMapped(error);
    }
    if (!receipt) return unavailable();
    if (
      receipt.requestJson !== requestJson ||
      receipt.albumId !== albumId ||
      receipt.photoId !== photoId ||
      receipt.versionId !== versionId
    )
      return fail('REQUEST_ID_CONFLICT', 409);
    const result = safeResult(receipt.resultJson);
    checkResultScope(result, albumId, photoId, versionId, command);
    return result;
  }
}
