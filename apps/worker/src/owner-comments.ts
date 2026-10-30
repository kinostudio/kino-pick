import {
  commentProcessingSnapshotSql,
  decodeCommentProcessingSnapshot,
} from './comment-processing-read';
import { z } from 'zod';
import {
  ownerCommentCommandSchema,
  ownerCommentResultSchema,
  ownerCommentThreadItemSchema,
  ownerCommentThreadPageSchema,
  ownerCommentReadQuerySchema,
  type OwnerCommentCommand,
  type OwnerCommentReadQuery,
  type OwnerCommentResult,
  type OwnerCommentThreadItem,
  type OwnerCommentThreadPage,
} from '../../../packages/contracts/src/owner-comments';
import { WorkspaceFailure } from './workspaces';

const ownerCommentCursorSchema = z
  .object({
    schemaVersion: z.literal(2),
    scopeDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    watermark: z.number().int().nonnegative().safe(),
    afterCreatedAtMs: z.number().int().nonnegative().safe(),
    afterCommentId: z.uuid(),
  })
  .strict();

type OwnerCommentCursor = z.infer<typeof ownerCommentCursorSchema>;

type OwnerCommentScope = {
  actorId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  parentCommentId?: string;
};

type OwnerCommentReadRow = {
  actorId: string;
  inviteId: string;
  watermark: number;
  commentId: string | null;
  photoId: string | null;
  versionId: string | null;
  revision: number | null;
  body: string | null;
  state: 'open' | 'resolved' | 'deleted' | null;
  authorType: 'guest' | 'owner' | null;
  parentCommentId: string | null;
  processingJson: string | null;
  authorLabel: string | null;
  canEdit: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdAtMs: number | null;
};

type OwnerCommentScopeRow = {
  actorId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  parentCommentId?: string;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('OWNER_COMMENTS_UNAVAILABLE', 503);
}

function notFound(): never {
  throw new WorkspaceFailure('NOT_FOUND', 404);
}

function parseUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function parseCommand(input: unknown): OwnerCommentCommand {
  const parsed = ownerCommentCommandSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function parseReadQuery(input: unknown): OwnerCommentReadQuery {
  const parsed = ownerCommentReadQuerySchema.safeParse(input);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function canonicalCommandJson(command: OwnerCommentCommand): string {
  switch (command.operation) {
    case 'reply':
      return JSON.stringify({
        requestId: command.requestId,
        operation: command.operation,
        inviteId: command.inviteId,
        photoId: command.photoId,
        versionId: command.versionId,
        parentCommentId: command.parentCommentId,
        expectedParentRevision: command.expectedParentRevision,
        body: command.body,
      });
    case 'edit_reply':
      return JSON.stringify({
        requestId: command.requestId,
        operation: command.operation,
        replyId: command.replyId,
        expectedRevision: command.expectedRevision,
        body: command.body,
      });
    case 'delete_reply':
      return JSON.stringify({
        requestId: command.requestId,
        operation: command.operation,
        replyId: command.replyId,
        expectedRevision: command.expectedRevision,
      });
  }
}

function decodeCursor(token: string | undefined): OwnerCommentCursor | null {
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
    const parsed = ownerCommentCursorSchema.safeParse(
      JSON.parse(json) as unknown,
    );
    if (!parsed.success) invalidInput();

    const canonical = JSON.stringify({
      schemaVersion: parsed.data.schemaVersion,
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

function encodeCursor(cursor: OwnerCommentCursor): string {
  return Buffer.from(
    JSON.stringify(ownerCommentCursorSchema.parse(cursor)),
    'utf8',
  ).toString('base64url');
}

async function cursorScopeDigest(
  actorId: string,
  inviteId: string,
  albumId: string,
  photoId: string,
  versionId: string,
): Promise<string> {
  const value = [
    'kino-pic:owner-comments-cursor:v2',
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

function authorizedScopeSql(): string {
  return [
    'SELECT o.user_id AS actorId,w.id AS workspaceId,',
    '  pr.id AS projectId,a.id AS albumId,i.id AS inviteId,',
    '  p.id AS photoId,ev.version_id AS versionId',
    'FROM (SELECT ? AS actorId,? AS sessionId,? AS albumId,',
    '    ? AS photoId,? AS inviteId,? AS versionId) req',
    'JOIN owners o ON o.user_id=req.actorId AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=req.sessionId',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'JOIN workspaces w ON w.owner_user_id=o.user_id',
    'JOIN albums a ON a.id=req.albumId AND a.workspace_id=w.id',
    "  AND a.state='active'",
    'JOIN projects pr ON pr.id=a.project_id AND pr.workspace_id=w.id',
    "  AND pr.status NOT IN('archived','deleting','deleted')",
    'JOIN photos p ON p.id=req.photoId AND p.workspace_id=w.id',
    '  AND p.project_id=pr.id AND p.album_id=a.id',
    'JOIN guest_invites i ON i.id=req.inviteId AND i.workspace_id=w.id',
    '  AND i.project_id=pr.id AND i.created_by=o.user_id',
    'JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    'JOIN guest_invite_albums ia ON ia.invite_id=i.id',
    '  AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id',
    '  AND ia.album_id=a.id',
    'JOIN guest_comment_eligible_versions ev ON ev.version_id=req.versionId',
    '  AND ev.photo_id=p.id AND ev.workspace_id=p.workspace_id',
    '  AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
  ].join('\n');
}

function parentScopeSql(): string {
  return [
    'WITH authorized AS (',
    authorizedScopeSql(),
    ')',
    'SELECT auth.actorId,auth.workspaceId,auth.projectId,auth.albumId,',
    '  auth.inviteId,auth.photoId,auth.versionId,c.id AS parentCommentId',
    'FROM authorized auth',
    'JOIN guest_comments c ON c.id=? AND c.invite_id=auth.inviteId',
    '  AND c.album_id=auth.albumId AND c.photo_id=auth.photoId',
    '  AND c.version_id=auth.versionId',
  ].join('\n');
}

function ownerReplyScopeSql(): string {
  return [
    'WITH req AS (',
    '  SELECT ? AS actorId,? AS sessionId,? AS albumId,? AS replyId',
    '), authorized AS (',
    '  SELECT o.user_id AS actorId,w.id AS workspaceId,pr.id AS projectId,',
    '    a.id AS albumId,i.id AS inviteId,p.id AS photoId,',
    '    ev.version_id AS versionId,r.parent_comment_id AS parentCommentId',
    '  FROM req',
    '  JOIN owners o ON o.user_id=req.actorId AND o.enabled=1',
    '  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=req.sessionId',
    "    AND s.expiresAt>unixepoch('subsec')*1000",
    '  JOIN workspaces w ON w.owner_user_id=o.user_id',
    '  JOIN albums a ON a.id=req.albumId AND a.workspace_id=w.id',
    "    AND a.state='active'",
    '  JOIN projects pr ON pr.id=a.project_id AND pr.workspace_id=w.id',
    "    AND pr.status NOT IN('archived','deleting','deleted')",
    '  JOIN owner_comment_replies r ON r.id=req.replyId',
    '    AND r.author_user_id=o.user_id AND r.workspace_id=w.id',
    '    AND r.project_id=pr.id AND r.album_id=a.id',
    '  JOIN guest_invites i ON i.id=r.invite_id AND i.workspace_id=w.id',
    '    AND i.project_id=pr.id AND i.created_by=o.user_id',
    '  JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    '  JOIN guest_invite_albums ia ON ia.invite_id=i.id',
    '    AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id',
    '    AND ia.album_id=a.id',
    '  JOIN photos p ON p.id=r.photo_id AND p.workspace_id=w.id',
    '    AND p.project_id=pr.id AND p.album_id=a.id',
    '  JOIN guest_comment_eligible_versions ev ON ev.version_id=r.version_id',
    '    AND ev.photo_id=p.id AND ev.workspace_id=p.workspace_id',
    '    AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
    '  JOIN guest_comments parent ON parent.id=r.parent_comment_id',
    '    AND parent.invite_id=i.id AND parent.album_id=a.id',
    '    AND parent.photo_id=p.id AND parent.version_id=ev.version_id',
    ')',
    'SELECT * FROM authorized',
  ].join('\n');
}

function commentThreadPageSql(): string {
  return [
    'WITH authorized AS (',
    authorizedScopeSql(),
    '), page_rows AS (',
    '  SELECT c.id AS commentId,c.photo_id AS photoId,',
    '    c.version_id AS versionId,c.revision,c.body,c.state,',
    "    'guest' AS authorType,NULL AS parentCommentId,",
    '    c.author_label AS authorLabel,0 AS canEdit,',
    commentProcessingSnapshotSql('ps') + ' AS processingJson,',
    "    strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch') AS createdAt,",
    "    strftime('%Y-%m-%dT%H:%M:%fZ',c.updated_at_ms/1000.0,'unixepoch') AS updatedAt,",
    '    c.created_at_ms AS createdAtMs',
    '  FROM authorized auth',
    '  JOIN guest_comments c ON c.invite_id=auth.inviteId',
    '    AND c.album_id=auth.albumId AND c.photo_id=auth.photoId',
    '    AND c.version_id=auth.versionId',
    '  JOIN comment_processing_snapshots ps ON ps.comment_id=c.id',
    '    AND ps.workspace_id=c.workspace_id AND ps.project_id=c.project_id',
    '    AND ps.album_id=c.album_id AND ps.invite_id=c.invite_id',
    '    AND ps.photo_id=c.photo_id AND ps.version_id=c.version_id',
    '  WHERE (? IS NULL OR c.created_at_ms>? OR',
    '      (c.created_at_ms=? AND c.id>?))',
    '    AND (? IS NULL OR c.id=?)',
    '  UNION ALL',
    '  SELECT r.id AS commentId,r.photo_id AS photoId,',
    '    r.version_id AS versionId,r.revision,r.body,r.state,',
    "    'owner' AS authorType,r.parent_comment_id AS parentCommentId,",
    "    '攝影師' AS authorLabel,",
    "    (r.state<>'deleted' AND r.author_user_id=auth.actorId) AS canEdit,",
    '    NULL AS processingJson,',
    "    strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch') AS createdAt,",
    "    strftime('%Y-%m-%dT%H:%M:%fZ',r.updated_at_ms/1000.0,'unixepoch') AS updatedAt,",
    '    r.created_at_ms AS createdAtMs',
    '  FROM authorized auth',
    '  JOIN owner_comment_replies r ON r.invite_id=auth.inviteId',
    '    AND r.album_id=auth.albumId AND r.photo_id=auth.photoId',
    '    AND r.version_id=auth.versionId',
    '  WHERE (? IS NULL OR r.created_at_ms>? OR',
    '      (r.created_at_ms=? AND r.id>?))',
    '    AND (? IS NULL OR r.id=?)',
    '  ORDER BY createdAtMs,commentId',
    '  LIMIT 25',
    ')',
    'SELECT auth.actorId,auth.inviteId,',
    '  COALESCE((SELECT MAX(ch.seq) FROM comment_thread_changes ch',
    '    WHERE ch.invite_id=auth.inviteId',
    '      AND ch.workspace_id=auth.workspaceId',
    '      AND ch.project_id=auth.projectId',
    '      AND ch.album_id=auth.albumId AND ch.photo_id=auth.photoId',
    '      AND ch.version_id=auth.versionId),0) AS watermark,',
    '  c.commentId,c.photoId,c.versionId,c.revision,c.body,c.state,',
    '  c.authorType,c.parentCommentId,c.authorLabel,c.canEdit,c.processingJson,',
    '  c.createdAt,c.updatedAt,c.createdAtMs',
    'FROM authorized auth LEFT JOIN page_rows c ON 1=1',
    'ORDER BY c.createdAtMs,c.commentId',
  ].join('\n');
}

function commandResultSql(): string {
  return [
    'WITH authorized AS (',
    authorizedScopeSql(),
    ')',
    'SELECT r.result_json',
    'FROM owner_comment_commands c',
    'JOIN owner_comment_results r ON r.command_id=c.id',
    'JOIN authorized auth ON auth.actorId=c.actor_id',
    '  AND auth.workspaceId=c.workspace_id AND auth.projectId=c.project_id',
    '  AND auth.albumId=c.album_id AND auth.inviteId=c.invite_id',
    '  AND auth.photoId=c.photo_id AND auth.versionId=c.version_id',
    'WHERE c.actor_id=? AND c.request_id=? AND c.operation=?',
    '  AND c.request_json=? AND c.workspace_id=? AND c.project_id=?',
    '  AND c.album_id=? AND c.invite_id=? AND c.photo_id=? AND c.version_id=?',
  ].join('\n');
}

function mapWriteFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('OWNER_REQUIRED'))
    throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND'))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (message.includes('RESOURCE_NOT_EDITABLE'))
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (message.includes('COMMENT_REVISION_CONFLICT'))
    throw new WorkspaceFailure('COMMENT_REVISION_CONFLICT', 409);
  if (message.includes('COMMENT_LIMIT_REACHED'))
    throw new WorkspaceFailure('COMMENT_LIMIT_REACHED', 409);
  if (message.includes('COMMENT_REVISION_EXHAUSTED'))
    throw new WorkspaceFailure('COMMENT_REVISION_EXHAUSTED', 409);
  if (
    message.includes('INVALID_INPUT') ||
    message.includes('INVALID_TIMESTAMP')
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return unavailable();
}

function safeThreadItem(row: OwnerCommentReadRow): OwnerCommentThreadItem {
  if (
    row.commentId === null ||
    row.photoId === null ||
    row.versionId === null ||
    row.revision === null ||
    row.state === null ||
    row.authorType === null ||
    row.authorLabel === null ||
    row.canEdit === null ||
    row.createdAt === null ||
    row.updatedAt === null
  )
    return unavailable();

  const parsed = ownerCommentThreadItemSchema.safeParse({
    commentId: row.commentId,
    photoId: row.photoId,
    versionId: row.versionId,
    revision: row.revision,
    body: row.body,
    state: row.state,
    authorType: row.authorType,
    parentCommentId: row.parentCommentId,
    processing: decodeCommentProcessingSnapshot(
      row.processingJson,
      row.authorType,
    ),
    authorLabel: row.authorLabel,
    canEdit: row.canEdit === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!parsed.success) return unavailable();
  return parsed.data;
}

function scopeBindings(
  actorId: string,
  sessionId: string,
  albumId: string,
  photoId: string,
  inviteId: string,
  versionId: string,
): [string, string, string, string, string, string] {
  return [actorId, sessionId, albumId, photoId, inviteId, versionId];
}

export class D1OwnerCommentsRepository {
  constructor(private db: D1Database) {}

  async read(
    actorIdInput: string,
    sessionIdInput: string,
    albumIdInput: string,
    photoIdInput: string,
    versionIdInput: string,
    queryInput: unknown,
  ): Promise<OwnerCommentThreadPage> {
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

    let rows: D1Result<OwnerCommentReadRow>;
    try {
      rows = await this.db
        .prepare(commentThreadPageSql())
        .bind(
          ...scopeBindings(
            actorId,
            sessionId,
            albumId,
            photoId,
            query.inviteId,
            versionId,
          ),
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCommentId ?? null,
          query.commentId ?? null,
          query.commentId ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCreatedAtMs ?? null,
          cursor?.afterCommentId ?? null,
          query.commentId ?? null,
          query.commentId ?? null,
        )
        .all<OwnerCommentReadRow>();
    } catch {
      return unavailable();
    }

    const first = rows.results[0];
    if (!first) return notFound();
    if (
      !z.uuid().safeParse(first.actorId).success ||
      !z.uuid().safeParse(first.inviteId).success
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
    if (cursor && cursor.watermark !== first.watermark)
      throw new WorkspaceFailure('COMMENT_HISTORY_CHANGED', 409);
    if (!Number.isSafeInteger(first.watermark) || first.watermark < 0)
      return unavailable();

    const itemRows = rows.results.filter((row) => row.commentId !== null);
    if (query.commentId !== undefined && itemRows.length > 1)
      return unavailable();
    const items = itemRows.map(safeThreadItem);
    const nextItem = items.length > 24 ? items[23] : undefined;
    const pageItems = items.slice(0, 24);

    let nextCursor: string | null = null;
    if (nextItem) {
      const lastRow = itemRows[23];
      if (
        !lastRow ||
        lastRow.createdAtMs === null ||
        !Number.isSafeInteger(lastRow.createdAtMs) ||
        lastRow.createdAtMs < 0
      )
        return unavailable();
      nextCursor = encodeCursor({
        schemaVersion: 2,
        scopeDigest: expectedDigest,
        watermark: first.watermark,
        afterCreatedAtMs: lastRow.createdAtMs,
        afterCommentId: nextItem.commentId,
      });
    }

    const page = ownerCommentThreadPageSchema.safeParse({
      inviteId: first.inviteId,
      photoId,
      versionId,
      items: pageItems,
      nextCursor,
    });
    if (!page.success) return unavailable();
    return page.data;
  }

  async command(
    actorIdInput: string,
    sessionIdInput: string,
    albumIdInput: string,
    input: unknown,
  ): Promise<OwnerCommentResult> {
    const actorId = parseUuid(actorIdInput);
    const sessionId = sessionIdInput;
    const albumId = parseUuid(albumIdInput);
    const command = parseCommand(input);

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

    let scopeRow: OwnerCommentScopeRow | null;
    try {
      if (command.operation === 'reply') {
        scopeRow = await this.db
          .prepare(parentScopeSql())
          .bind(
            ...scopeBindings(
              actorId,
              sessionId,
              albumId,
              command.photoId,
              command.inviteId,
              command.versionId,
            ),
            command.parentCommentId,
          )
          .first<OwnerCommentScopeRow>();
      } else {
        scopeRow = await this.db
          .prepare(ownerReplyScopeSql())
          .bind(actorId, sessionId, albumId, command.replyId)
          .first<OwnerCommentScopeRow>();
      }
    } catch {
      return unavailable();
    }
    if (!scopeRow) return notFound();

    const scope: OwnerCommentScope = {
      actorId: scopeRow.actorId,
      workspaceId: scopeRow.workspaceId,
      projectId: scopeRow.projectId,
      albumId: scopeRow.albumId,
      inviteId: scopeRow.inviteId,
      photoId: scopeRow.photoId,
      versionId: scopeRow.versionId,
      ...(scopeRow.parentCommentId === undefined
        ? {}
        : { parentCommentId: scopeRow.parentCommentId }),
    };
    const requestJson = canonicalCommandJson(command);
    const generatedReplyId =
      command.operation === 'reply' ? crypto.randomUUID() : command.replyId;
    const operation = command.operation;
    const parentCommentId =
      command.operation === 'reply'
        ? command.parentCommentId
        : scope.parentCommentId;

    if (!parentCommentId) return unavailable();

    try {
      await this.db
        .prepare(
          [
            'INSERT INTO owner_comment_commands(',
            'id,actor_id,session_id,request_id,workspace_id,project_id,album_id,',
            'invite_id,photo_id,version_id,parent_comment_id,reply_id,operation,',
            'request_json',
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,COALESCE((',
            '  SELECT old.reply_id FROM owner_comment_commands old',
            '  WHERE old.actor_id=? AND old.request_id=?',
            '),?),?,?)',
            'ON CONFLICT(actor_id,request_id) DO NOTHING',
          ].join('\n'),
        )
        .bind(
          crypto.randomUUID(),
          actorId,
          sessionId,
          command.requestId,
          scope.workspaceId,
          scope.projectId,
          scope.albumId,
          scope.inviteId,
          scope.photoId,
          scope.versionId,
          parentCommentId,
          actorId,
          command.requestId,
          generatedReplyId,
          operation,
          requestJson,
        )
        .run();
    } catch (error) {
      mapWriteFailure(error);
    }

    let resultRow: { result_json: string } | null;
    try {
      resultRow = await this.db
        .prepare(commandResultSql())
        .bind(
          ...scopeBindings(
            actorId,
            sessionId,
            scope.albumId,
            scope.photoId,
            scope.inviteId,
            scope.versionId,
          ),
          actorId,
          command.requestId,
          operation,
          requestJson,
          scope.workspaceId,
          scope.projectId,
          scope.albumId,
          scope.inviteId,
          scope.photoId,
          scope.versionId,
        )
        .first<{ result_json: string }>();
    } catch {
      return unavailable();
    }

    if (!resultRow) {
      let currentOwner: { authorized: number } | null;
      try {
        currentOwner = await this.db
          .prepare(currentOwnerCheckSql())
          .bind(sessionId, actorId)
          .first<{ authorized: number }>();
      } catch {
        return unavailable();
      }
      if (!currentOwner) throw new WorkspaceFailure('OWNER_REQUIRED', 403);

      let currentScope: OwnerCommentScopeRow | null;
      try {
        currentScope = await this.db
          .prepare(authorizedScopeSql())
          .bind(
            ...scopeBindings(
              actorId,
              sessionId,
              scope.albumId,
              scope.photoId,
              scope.inviteId,
              scope.versionId,
            ),
          )
          .first<OwnerCommentScopeRow>();
      } catch {
        return unavailable();
      }
      if (!currentScope) return notFound();
      return unavailable();
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(resultRow.result_json) as unknown;
    } catch {
      return unavailable();
    }
    const parsed = ownerCommentResultSchema.safeParse(decoded);
    if (
      !parsed.success ||
      parsed.data.requestId !== command.requestId ||
      parsed.data.operation !== operation ||
      parsed.data.item.photoId !== scope.photoId ||
      parsed.data.item.versionId !== scope.versionId ||
      parsed.data.item.parentCommentId !== parentCommentId ||
      (operation !== 'reply' && parsed.data.item.commentId !== command.replyId)
    )
      return unavailable();
    return parsed.data;
  }
}
