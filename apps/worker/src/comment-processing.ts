import { z } from 'zod';
import {
  ownerCommentProcessingCommandSchema,
  ownerCommentProcessingResultSchema,
  type OwnerCommentProcessingCommand,
  type OwnerCommentProcessingResult,
} from '../../../packages/contracts/src/comment-processing';
import { WorkspaceFailure } from './workspaces';

type ProcessingScopeRow = {
  actorId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  commentId: string;
  commentRevision: number;
  commentState: 'open' | 'resolved' | 'deleted';
  contentRevision: number | null;
  projectStatus: string;
  albumState: string;
};

type ProcessingScope = Omit<
  ProcessingScopeRow,
  'contentRevision' | 'projectStatus' | 'albumState'
> & { contentRevision: number };

function fail(code: string, status: 400 | 403 | 404 | 409 | 503): never {
  throw new WorkspaceFailure(code, status);
}

function invalidInput(): never {
  return fail('INVALID_INPUT', 400);
}

function unavailable(): never {
  return fail('COMMENT_PROCESSING_UNAVAILABLE', 503);
}

function parseActorId(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function parseCommand(input: unknown): OwnerCommentProcessingCommand {
  const parsed = ownerCommentProcessingCommandSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function canonicalRequestJson(command: OwnerCommentProcessingCommand): string {
  // Keep this insertion order in sync with the DB trigger's canonical JSON.
  return JSON.stringify({
    requestId: command.requestId,
    operation: command.operation,
    inviteId: command.inviteId,
    photoId: command.photoId,
    versionId: command.versionId,
    commentId: command.commentId,
    expectedCommentRevision: command.expectedCommentRevision,
    expectedProcessingRevision: command.expectedProcessingRevision,
    state: command.state,
  });
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

function processingScopeSql(): string {
  return [
    'SELECT o.user_id AS actorId,w.id AS workspaceId,pr.id AS projectId,',
    '  a.id AS albumId,i.id AS inviteId,p.id AS photoId,ev.version_id AS versionId,',
    '  c.id AS commentId,c.revision AS commentRevision,c.state AS commentState,',
    '  COALESCE((',
    '    SELECT old.content_revision FROM owner_comment_processing_commands old',
    '    WHERE old.actor_id=o.user_id AND old.request_id=?',
    '  ),(',
    '    SELECT MAX(ch.revision) FROM guest_comment_changes ch',
    "    WHERE ch.comment_id=c.id AND ch.operation IN('create','edit')",
    '  )) AS contentRevision,',
    '  pr.status AS projectStatus,a.state AS albumState',
    'FROM (SELECT ? AS actorId,? AS sessionId,? AS albumId,? AS inviteId,',
    '    ? AS photoId,? AS versionId,? AS commentId) req',
    'JOIN owners o ON o.user_id=req.actorId AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=req.sessionId',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'JOIN workspaces w ON w.owner_user_id=o.user_id',
    'JOIN projects pr ON pr.workspace_id=w.id',
    'JOIN albums a ON a.id=req.albumId AND a.workspace_id=w.id',
    '  AND a.project_id=pr.id',
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
    'JOIN guest_comments c ON c.id=req.commentId AND c.invite_id=i.id',
    '  AND c.album_id=a.id AND c.photo_id=p.id AND c.version_id=ev.version_id',
  ].join('\n');
}

function processingResultSql(): string {
  return [
    'SELECT r.result_json AS resultJson',
    'FROM owner_comment_processing_commands cmd',
    'JOIN owner_comment_processing_results r ON r.command_id=cmd.id',
    '  AND r.actor_id=cmd.actor_id AND r.request_id=cmd.request_id',
    'JOIN owners o ON o.user_id=cmd.actor_id AND o.user_id=? AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'JOIN workspaces w ON w.id=cmd.workspace_id AND w.owner_user_id=o.user_id',
    'JOIN projects pr ON pr.id=cmd.project_id AND pr.workspace_id=w.id',
    "  AND pr.status NOT IN('archived','deleting','deleted')",
    "JOIN albums a ON a.id=cmd.album_id AND a.workspace_id=w.id AND a.project_id=pr.id AND a.state='active'",
    'JOIN guest_invites i ON i.id=cmd.invite_id AND i.workspace_id=w.id',
    '  AND i.project_id=pr.id AND i.created_by=o.user_id',
    'JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    'JOIN guest_invite_albums ia ON ia.invite_id=i.id',
    '  AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id',
    '  AND ia.album_id=a.id',
    'JOIN guest_comment_eligible_versions ev ON ev.version_id=cmd.version_id',
    '  AND ev.photo_id=cmd.photo_id AND ev.workspace_id=cmd.workspace_id',
    '  AND ev.project_id=cmd.project_id AND ev.album_id=cmd.album_id',
    'JOIN guest_comments c ON c.id=cmd.comment_id AND c.invite_id=i.id',
    '  AND c.workspace_id=w.id AND c.project_id=pr.id AND c.album_id=a.id',
    '  AND c.photo_id=cmd.photo_id AND c.version_id=cmd.version_id',
    "WHERE cmd.actor_id=? AND cmd.request_id=? AND cmd.operation='set_processing_state'",
    '  AND cmd.request_json=? AND cmd.workspace_id=? AND cmd.project_id=?',
    '  AND cmd.album_id=? AND cmd.invite_id=? AND cmd.photo_id=?',
    '  AND cmd.version_id=? AND cmd.comment_id=?',
  ].join('\n');
}

async function requireCurrentOwner(
  db: D1Database,
  actorId: string,
  sessionId: string,
): Promise<void> {
  let owner: { authorized: number } | null;
  try {
    owner = await db
      .prepare(currentOwnerCheckSql())
      .bind(sessionId, actorId)
      .first<{ authorized: number }>();
  } catch {
    return unavailable();
  }
  if (!owner) fail('OWNER_REQUIRED', 403);
}

async function loadScope(
  db: D1Database,
  actorId: string,
  sessionId: string,
  albumId: string,
  command: OwnerCommentProcessingCommand,
): Promise<ProcessingScope> {
  let row: ProcessingScopeRow | null;
  try {
    row = await db
      .prepare(processingScopeSql())
      .bind(
        command.requestId,
        actorId,
        sessionId,
        albumId,
        command.inviteId,
        command.photoId,
        command.versionId,
        command.commentId,
      )
      .first<ProcessingScopeRow>();
  } catch {
    return unavailable();
  }
  if (!row) {
    await requireCurrentOwner(db, actorId, sessionId);
    fail('NOT_FOUND', 404);
  }
  if (
    row.projectStatus === 'archived' ||
    row.projectStatus === 'deleting' ||
    row.projectStatus === 'deleted' ||
    row.albumState !== 'active'
  )
    fail('RESOURCE_NOT_EDITABLE', 409);
  if (
    !z.uuid().safeParse(row.actorId).success ||
    !z.uuid().safeParse(row.workspaceId).success ||
    !z.uuid().safeParse(row.projectId).success ||
    !z.uuid().safeParse(row.albumId).success ||
    !z.uuid().safeParse(row.inviteId).success ||
    !z.uuid().safeParse(row.photoId).success ||
    !z.uuid().safeParse(row.versionId).success ||
    !z.uuid().safeParse(row.commentId).success ||
    !Number.isSafeInteger(row.commentRevision) ||
    row.commentRevision < 1 ||
    !Number.isSafeInteger(row.contentRevision) ||
    (row.contentRevision ?? 0) < 1
  )
    return unavailable();
  return {
    actorId: row.actorId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    albumId: row.albumId,
    inviteId: row.inviteId,
    photoId: row.photoId,
    versionId: row.versionId,
    commentId: row.commentId,
    commentRevision: row.commentRevision,
    commentState: row.commentState,
    contentRevision: row.contentRevision as number,
  };
}

function mapWriteFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const known: Array<[string, string, 400 | 403 | 404 | 409]> = [
    ['OWNER_REQUIRED', 'OWNER_REQUIRED', 403],
    ['NOT_FOUND', 'NOT_FOUND', 404],
    ['RESOURCE_NOT_EDITABLE', 'RESOURCE_NOT_EDITABLE', 409],
    ['REQUEST_ID_CONFLICT', 'REQUEST_ID_CONFLICT', 409],
    ['COMMENT_REVISION_CONFLICT', 'COMMENT_REVISION_CONFLICT', 409],
    [
      'COMMENT_PROCESSING_REVISION_CONFLICT',
      'COMMENT_PROCESSING_REVISION_CONFLICT',
      409,
    ],
    [
      'COMMENT_PROCESSING_REVISION_EXHAUSTED',
      'COMMENT_PROCESSING_REVISION_EXHAUSTED',
      409,
    ],
    ['INVALID_INPUT', 'INVALID_INPUT', 400],
  ];
  for (const [fragment, code, status] of known)
    if (message.includes(fragment)) fail(code, status);
  return unavailable();
}

function parseReceipt(
  json: string,
  command: OwnerCommentProcessingCommand,
  scope: ProcessingScope,
): OwnerCommentProcessingResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch {
    return unavailable();
  }
  const parsed = ownerCommentProcessingResultSchema.safeParse(decoded);
  if (!parsed.success) return unavailable();
  const receipt = parsed.data;
  if (
    receipt.requestId !== command.requestId ||
    receipt.operation !== command.operation ||
    receipt.commentId !== command.commentId ||
    receipt.photoId !== scope.photoId ||
    receipt.versionId !== scope.versionId ||
    receipt.processing.state !== command.state ||
    receipt.processing.revision !== command.expectedProcessingRevision + 1 ||
    receipt.processing.commentRevision !== command.expectedCommentRevision ||
    receipt.processing.contentRevision !== scope.contentRevision ||
    receipt.processing.stale !== false ||
    receipt.processing.updatedAt !== receipt.occurredAt
  )
    return unavailable();
  return receipt;
}

export class D1OwnerCommentProcessingRepository {
  constructor(private db: D1Database) {}

  async command(
    actorIdInput: string,
    sessionId: string,
    albumIdInput: string,
    input: unknown,
  ): Promise<OwnerCommentProcessingResult> {
    const actorId = parseActorId(actorIdInput);
    const albumId = parseActorId(albumIdInput);
    const command = parseCommand(input);

    await requireCurrentOwner(this.db, actorId, sessionId);
    const scope = await loadScope(
      this.db,
      actorId,
      sessionId,
      albumId,
      command,
    );
    const requestJson = canonicalRequestJson(command);

    try {
      await this.db
        .prepare(
          [
            'INSERT INTO owner_comment_processing_commands(',
            'id,actor_id,session_id,request_id,workspace_id,project_id,album_id,',
            'invite_id,photo_id,version_id,comment_id,operation,target_state,',
            'expected_comment_revision,expected_processing_revision,content_revision,request_json',
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
          scope.commentId,
          command.operation,
          command.state,
          command.expectedCommentRevision,
          command.expectedProcessingRevision,
          scope.contentRevision,
          requestJson,
        )
        .run();
    } catch (error) {
      mapWriteFailure(error);
    }

    let result: { resultJson: string } | null;
    try {
      result = await this.db
        .prepare(processingResultSql())
        .bind(
          actorId,
          sessionId,
          actorId,
          command.requestId,
          requestJson,
          scope.workspaceId,
          scope.projectId,
          scope.albumId,
          scope.inviteId,
          scope.photoId,
          scope.versionId,
          scope.commentId,
        )
        .first<{ resultJson: string }>();
    } catch {
      return unavailable();
    }

    if (!result) {
      await requireCurrentOwner(this.db, actorId, sessionId);
      await loadScope(this.db, actorId, sessionId, albumId, command);
      return unavailable();
    }
    return parseReceipt(result.resultJson, command, scope);
  }
}
