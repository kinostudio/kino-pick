import {
  commentProcessingSnapshotSql,
  decodeCommentProcessingSnapshot,
} from './comment-processing-read';
import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import {
  guestCommentCommandSchema,
  guestCommentItemSchema,
  guestCommentResultSchema,
  guestCommentsPageSchema,
  type GuestCommentCommand,
  type GuestCommentItem,
  type GuestCommentResult,
  type GuestCommentsPage,
} from '../../../packages/contracts/src/guest-comments';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const canCommentBit = guestPermissionBit('can_comment');
const guestCommentCursorSchema = z
  .object({
    schemaVersion: z.literal(2),
    scopeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    watermark: z.number().int().nonnegative().safe(),
    afterCreatedAtMs: z.number().int().nonnegative().safe(),
    afterCommentId: z.uuid(),
  })
  .strict();
type GuestCommentCursor = z.infer<typeof guestCommentCursorSchema>;

type GuestCommentSessionRow = {
  id: string;
  guest_id: string;
  invite_id: string;
  workspace_id: string;
  project_id: string;
};

type GuestCommentReadRow = {
  guestId: string;
  inviteId: string;
  watermark: number;
  commentId: string | null;
  photoId: string | null;
  versionId: string | null;
  revision: number | null;
  body: string | null;
  state: 'open' | 'resolved' | 'deleted' | null;
  authorLabel: string | null;
  isMine: number | null;
  authorType: 'guest' | 'owner' | null;
  parentCommentId: string | null;
  processingJson: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdAtMs: number | null;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('GUEST_COMMENTS_UNAVAILABLE', 503);
}

function parseUuid(value: string): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) invalidInput();
  return result.data;
}

function parseCommand(input: unknown): GuestCommentCommand {
  const result = guestCommentCommandSchema.safeParse(input);
  if (!result.success) invalidInput();
  return result.data;
}

function canonicalCommandJson(command: GuestCommentCommand): string {
  switch (command.operation) {
    case 'create':
      return JSON.stringify({
        requestId: command.requestId,
        expectedGuestId: command.expectedGuestId,
        operation: command.operation,
        targets: command.targets.map(({ photoId, versionId }) => ({
          photoId,
          versionId,
        })),
        body: command.body,
      });
    case 'edit':
      return JSON.stringify({
        requestId: command.requestId,
        expectedGuestId: command.expectedGuestId,
        commentId: command.commentId,
        expectedRevision: command.expectedRevision,
        operation: command.operation,
        body: command.body,
      });
    case 'delete':
    case 'resolve':
    case 'reopen':
      return JSON.stringify({
        requestId: command.requestId,
        expectedGuestId: command.expectedGuestId,
        commentId: command.commentId,
        expectedRevision: command.expectedRevision,
        operation: command.operation,
      });
  }
}

function encodeCursor(cursor: GuestCommentCursor): string {
  return Buffer.from(
    JSON.stringify(guestCommentCursorSchema.parse(cursor)),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(token: string | undefined): GuestCommentCursor | null {
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
    const parsed = guestCommentCursorSchema.safeParse(
      JSON.parse(json) as unknown,
    );
    if (!parsed.success) invalidInput();
    const canonical = JSON.stringify({
      schemaVersion: 2,
      scopeDigest: parsed.data.scopeDigest,
      watermark: parsed.data.watermark,
      afterCreatedAtMs: parsed.data.afterCreatedAtMs,
      afterCommentId: parsed.data.afterCommentId,
    });
    if (canonical !== json) invalidInput();
    return parsed.data;
  } catch {
    invalidInput();
  }
}

async function scopeDigest(
  guestId: string,
  inviteId: string,
  albumId: string,
  photoId: string,
  versionId: string,
): Promise<string> {
  const value = [
    'kino-pic:guest-comments-cursor:v2',
    guestId,
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

function mapWriteFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('GUEST_ACCESS_REQUIRED')) throw new GuestAccessDenied();
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (message.includes('COMMENT_REVISION_CONFLICT'))
    throw new WorkspaceFailure('COMMENT_REVISION_CONFLICT', 409);
  if (message.includes('COMMENT_LIMIT_REACHED'))
    throw new WorkspaceFailure('COMMENT_LIMIT_REACHED', 409);
  if (
    message.includes('INVALID_INPUT') ||
    message.includes('INVALID_TIMESTAMP')
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return unavailable();
}

function safeItem(row: GuestCommentReadRow): GuestCommentItem {
  if (
    row.commentId === null ||
    row.photoId === null ||
    row.versionId === null ||
    row.revision === null ||
    row.state === null ||
    row.authorLabel === null ||
    row.createdAt === null ||
    row.updatedAt === null
  )
    return unavailable();
  const parsed = guestCommentItemSchema.safeParse({
    commentId: row.commentId,
    photoId: row.photoId,
    versionId: row.versionId,
    revision: row.revision,
    body: row.body,
    state: row.state,
    authorLabel: row.authorLabel,
    isMine: row.isMine === 1,
    authorType: row.authorType,
    parentCommentId: row.parentCommentId,
    processing: decodeCommentProcessingSnapshot(
      row.processingJson,
      row.authorType,
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!parsed.success) return unavailable();
  return parsed.data;
}

export class D1GuestCommentsRepository {
  constructor(private db: D1Database) {}

  async read(
    secret: string | null,
    albumIdInput: string,
    photoIdInput: string,
    versionIdInput: string,
    cursorToken?: string,
    commentIdInput?: string,
  ): Promise<GuestCommentsPage> {
    const albumId = parseUuid(albumIdInput);
    const photoId = parseUuid(photoIdInput);
    const versionId = parseUuid(versionIdInput);
    const cursor = decodeCursor(cursorToken);
    const commentId =
      commentIdInput === undefined ? undefined : parseUuid(commentIdInput);
    if (cursor && commentId) invalidInput();
    if (!secret) throw new GuestAccessDenied();

    let secretHash: string;
    try {
      secretHash = await hashGuestSessionSecret(secret);
    } catch {
      throw new GuestAccessDenied();
    }

    let rows: D1Result<GuestCommentReadRow>;
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
            "   AND i.expires_at_ms>unixepoch('subsec')*1000",
            '   AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)',
            '   AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)',
            '), authorized_version AS (',
            ' SELECT gs.guest_id,gs.invite_id,gs.workspace_id,gs.project_id,gs.album_id,',
            '   p.id AS photo_id,ev.version_id',
            ' FROM authorized gs',
            ' JOIN photos p ON p.id=? AND p.workspace_id=gs.workspace_id',
            '   AND p.project_id=gs.project_id AND p.album_id=gs.album_id',
            ' JOIN guest_comment_eligible_versions ev ON ev.photo_id=p.id',
            '   AND ev.version_id=? AND ev.workspace_id=p.workspace_id',
            '   AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
            '), thread_rows AS (',
            ' SELECT c.id,c.photo_id,c.version_id,c.revision,c.body,c.state,c.author_label,',
            '   (c.author_guest_id=av.guest_id) AS is_mine,c.created_at_ms,c.updated_at_ms,',
            "   'guest' AS author_type,NULL AS parent_comment_id,",
            commentProcessingSnapshotSql('ps') + ' AS processingJson',
            ' FROM authorized_version av',
            ' JOIN guest_comments c ON c.invite_id=av.invite_id AND c.album_id=av.album_id',
            '   AND c.photo_id=av.photo_id AND c.version_id=av.version_id',
            ' JOIN comment_processing_snapshots ps ON ps.comment_id=c.id',
            '   AND ps.workspace_id=c.workspace_id AND ps.project_id=c.project_id',
            '   AND ps.album_id=c.album_id AND ps.invite_id=c.invite_id',
            '   AND ps.photo_id=c.photo_id AND ps.version_id=c.version_id',
            ' UNION ALL',
            ' SELECT r.id,r.photo_id,r.version_id,r.revision,r.body,r.state,',
            "   '攝影師' AS author_label,0 AS is_mine,r.created_at_ms,r.updated_at_ms,",
            "   'owner' AS author_type,r.parent_comment_id,NULL AS processingJson",
            ' FROM authorized_version av',
            ' JOIN owner_comment_replies r ON r.invite_id=av.invite_id',
            '   AND r.workspace_id=av.workspace_id AND r.project_id=av.project_id',
            '   AND r.album_id=av.album_id AND r.photo_id=av.photo_id AND r.version_id=av.version_id',
            '), page_rows AS (',
            ' SELECT c.* FROM thread_rows c',
            ' WHERE (? IS NULL OR c.created_at_ms>? OR (c.created_at_ms=? AND c.id>?))',
            '   AND (? IS NULL OR c.id=?)',
            ' ORDER BY c.created_at_ms,c.id LIMIT 25',
            ')',
            'SELECT av.guest_id AS guestId,av.invite_id AS inviteId,',
            ' COALESCE((SELECT MAX(ch.seq) FROM comment_thread_changes ch',
            '   WHERE ch.invite_id=av.invite_id AND ch.album_id=av.album_id',
            '     AND ch.photo_id=av.photo_id AND ch.version_id=av.version_id),0) AS watermark,',
            ' c.id AS commentId,c.photo_id AS photoId,c.version_id AS versionId,',
            ' c.revision AS revision,c.body AS body,c.state AS state,c.author_label AS authorLabel,',
            ' c.is_mine AS isMine,c.author_type AS authorType,c.parent_comment_id AS parentCommentId,c.processingJson,',
            " CASE WHEN c.id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch') END AS createdAt,",
            " CASE WHEN c.id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',c.updated_at_ms/1000.0,'unixepoch') END AS updatedAt,",
            ' c.created_at_ms AS createdAtMs',
            'FROM authorized_version av LEFT JOIN page_rows c ON 1=1',
            'ORDER BY c.created_at_ms,c.id',
          ].join('\n'),
        )
        .bind(
          albumId,
          secretHash,
          canCommentBit,
          canCommentBit,
          photoId,
          versionId,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCommentId ?? null,
          commentId ?? null,
          commentId ?? null,
        )
        .all<GuestCommentReadRow>();
    } catch {
      return unavailable();
    }

    const first = rows.results[0];
    if (!first) throw new GuestAccessDenied();
    if (
      !z.uuid().safeParse(first.guestId).success ||
      !z.uuid().safeParse(first.inviteId).success
    )
      return unavailable();

    const expectedScope = await scopeDigest(
      first.guestId,
      first.inviteId,
      albumId,
      photoId,
      versionId,
    );
    if (cursor && cursor.scopeDigest !== expectedScope) invalidInput();
    if (cursor && cursor.watermark !== first.watermark)
      throw new WorkspaceFailure('COMMENT_HISTORY_CHANGED', 409);
    if (!Number.isSafeInteger(first.watermark) || first.watermark < 0)
      return unavailable();

    const items = rows.results
      .filter((row) => row.commentId !== null)
      .map(safeItem);
    const nextItem = items.length > 24 ? items[23] : undefined;
    const publicItems = items.slice(0, 24);
    let nextCursor: string | null = null;
    if (nextItem) {
      const createdAtMs = rows.results.find(
        (row) => row.commentId === nextItem.commentId,
      )?.createdAtMs;
      if (createdAtMs === undefined || createdAtMs === null)
        return unavailable();
      nextCursor = encodeCursor({
        schemaVersion: 2,
        scopeDigest: expectedScope,
        watermark: first.watermark,
        afterCreatedAtMs: createdAtMs,
        afterCommentId: nextItem.commentId,
      });
    }

    const page = guestCommentsPageSchema.safeParse({
      guestId: first.guestId,
      photoId,
      versionId,
      items: publicItems,
      nextCursor,
    });
    if (!page.success) return unavailable();
    return page.data;
  }

  async command(
    secret: string | null,
    albumIdInput: string,
    input: unknown,
  ): Promise<GuestCommentResult> {
    const albumId = parseUuid(albumIdInput);
    const command = parseCommand(input);
    if (!secret) throw new GuestAccessDenied();

    let secretHash: string;
    try {
      secretHash = await hashGuestSessionSecret(secret);
    } catch {
      throw new GuestAccessDenied();
    }

    let session: GuestCommentSessionRow | null;
    try {
      session = await this.db
        .prepare(
          'SELECT s.id,s.guest_id,s.invite_id,i.workspace_id,i.project_id ' +
            'FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id ' +
            'JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id ' +
            'WHERE s.secret_hash=?',
        )
        .bind(secretHash)
        .first<GuestCommentSessionRow>();
    } catch {
      return unavailable();
    }
    if (!session || session.guest_id !== command.expectedGuestId)
      throw new GuestAccessDenied();

    const requestJson = canonicalCommandJson(command);
    const targets =
      command.operation === 'create'
        ? command.targets.map((target) => ({
            commentId: crypto.randomUUID(),
            photoId: target.photoId,
            versionId: target.versionId,
          }))
        : [];
    const targetsJson = JSON.stringify(targets);
    try {
      await this.db
        .prepare(
          'INSERT INTO guest_comment_commands(' +
            'id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,' +
            'workspace_id,project_id,album_id,operation,request_json,targets_json' +
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          session.guest_id,
          session.invite_id,
          session.id,
          secretHash,
          command.expectedGuestId,
          command.requestId,
          session.workspace_id,
          session.project_id,
          albumId,
          command.operation,
          requestJson,
          targetsJson,
        )
        .run();
    } catch (error) {
      mapWriteFailure(error);
    }

    let resultRow: { result_json: string } | null;
    try {
      resultRow = await this.db
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
            " JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'",
            ' JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
            "   AND p.status NOT IN('archived','deleting','deleted')",
            ' JOIN workspaces w ON w.id=i.workspace_id',
            ' JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
            ' WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
            "   AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000",
            '   AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)',
            '   AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)',
            ')',
            'SELECT r.result_json FROM guest_comment_commands c',
            'JOIN guest_comment_results r ON r.command_id=c.id',
            'JOIN authorized a ON a.session_id=c.session_id AND a.guest_id=c.guest_id',
            ' AND a.invite_id=c.invite_id AND a.workspace_id=c.workspace_id',
            ' AND a.project_id=c.project_id AND a.album_id=c.album_id',
            'WHERE c.guest_id=? AND c.invite_id=? AND c.session_id=? AND c.secret_hash=?',
            ' AND c.expected_guest_id=? AND c.request_id=? AND c.request_json=?',
            ' AND c.workspace_id=? AND c.project_id=? AND c.album_id=?',
            ' AND c.operation=? AND (',
            "   (c.operation='create' AND NOT EXISTS(",
            '     SELECT 1 FROM json_each(c.targets_json) item WHERE NOT EXISTS(',
            '       SELECT 1 FROM guest_comment_eligible_versions ev',
            "       WHERE ev.photo_id=json_extract(item.value,'$.photoId')",
            "         AND ev.version_id=json_extract(item.value,'$.versionId')",
            '         AND ev.workspace_id=c.workspace_id AND ev.project_id=c.project_id',
            '         AND ev.album_id=c.album_id)))',
            "   OR (c.operation<>'create' AND EXISTS(",
            '     SELECT 1 FROM guest_comments cm',
            '     JOIN guest_comment_eligible_versions ev ON ev.version_id=cm.version_id',
            '       AND ev.photo_id=cm.photo_id AND ev.workspace_id=cm.workspace_id',
            '       AND ev.project_id=cm.project_id AND ev.album_id=cm.album_id',
            "     WHERE cm.id=json_extract(c.request_json,'$.commentId')",
            '       AND cm.invite_id=c.invite_id AND cm.author_guest_id=c.guest_id))',
            ' )',
          ].join('\n'),
        )
        .bind(
          albumId,
          secretHash,
          canCommentBit,
          canCommentBit,
          session.guest_id,
          session.invite_id,
          session.id,
          secretHash,
          command.expectedGuestId,
          command.requestId,
          requestJson,
          session.workspace_id,
          session.project_id,
          albumId,
          command.operation,
        )
        .first<{ result_json: string }>();
    } catch {
      return unavailable();
    }
    if (!resultRow) throw new GuestAccessDenied();
    try {
      const result = guestCommentResultSchema.safeParse(
        JSON.parse(resultRow.result_json) as unknown,
      );
      if (!result.success) return unavailable();
      return result.data;
    } catch {
      return unavailable();
    }
  }
}
