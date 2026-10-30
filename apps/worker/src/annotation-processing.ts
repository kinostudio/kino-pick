import {
  ownerAnnotationProcessingCommandSchema,
  ownerAnnotationProcessingResultSchema,
  type OwnerAnnotationProcessingCommand,
  type OwnerAnnotationProcessingResult,
} from '../../../packages/contracts/src/annotation-processing';
import {
  ownerAnnotationScopeSql,
  ownerAnnotationUuid,
  ownerAnnotationSession,
  assertCurrentAnnotationOwner,
} from './owner-annotation-authoring';
import { WorkspaceFailure } from './workspaces';

function fail(code: string, status: 400 | 403 | 404 | 409 | 503): never {
  throw new WorkspaceFailure(code, status);
}
function unavailable(): never {
  return fail('ANNOTATION_PROCESSING_UNAVAILABLE', 503);
}
export function canonicalAnnotationProcessingCommand(
  command: OwnerAnnotationProcessingCommand,
): string {
  return JSON.stringify({
    requestId: command.requestId,
    expectedOwnerId: command.expectedOwnerId,
    operation: command.operation,
    inviteId: command.inviteId,
    photoId: command.photoId,
    versionId: command.versionId,
    annotationId: command.annotationId,
    expectedAnnotationRevision: command.expectedAnnotationRevision,
    expectedProcessingRevision: command.expectedProcessingRevision,
    state: command.state,
  });
}
const targetScopeSql = [
  ownerAnnotationScopeSql,
  ', target AS (',
  ' SELECT a.*,g.id AS annotation_id FROM authorized a',
  ' JOIN guest_annotations g ON g.id=? AND g.invite_id=a.invite_id',
  ' AND g.workspace_id=a.workspace_id AND g.project_id=a.project_id',
  ' AND g.album_id=a.album_id AND g.photo_id=a.photo_id AND g.version_id=a.version_id',
  ')',
].join('\n');
function writeFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  for (const code of [
    'OWNER_IDENTITY_CHANGED',
    'REQUEST_ID_CONFLICT',
    'ANNOTATION_PROCESSING_REVISION_CONFLICT',
    'ANNOTATION_REVISION_CONFLICT',
    'PROCESSING_REVISION_EXHAUSTED',
    'ANNOTATION_NOT_EDITABLE',
    'RESOURCE_NOT_EDITABLE',
  ])
    if (message.includes(code)) return fail(code, 409);
  if (message.includes('OWNER_REQUIRED')) return fail('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND')) return fail('NOT_FOUND', 404);
  if (message.includes('INVALID_INPUT')) return fail('INVALID_INPUT', 400);
  return unavailable();
}
export class D1OwnerAnnotationProcessingRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async command(
    actorInput: string,
    sessionInput: string,
    albumInput: string,
    input: unknown,
  ): Promise<OwnerAnnotationProcessingResult> {
    const actorId = ownerAnnotationUuid(actorInput);
    const sessionId = ownerAnnotationSession(sessionInput);
    const albumId = ownerAnnotationUuid(albumInput);
    const parsed = ownerAnnotationProcessingCommandSchema.safeParse(input);
    if (!parsed.success) return fail('INVALID_INPUT', 400);
    const command = parsed.data;
    if (command.expectedOwnerId !== actorId)
      return fail('OWNER_IDENTITY_CHANGED', 409);
    const scope = [
      actorId,
      sessionId,
      albumId,
      command.inviteId,
      command.photoId,
      command.versionId,
      command.annotationId,
    ];
    const requestJson = canonicalAnnotationProcessingCommand(command);
    try {
      await this.db
        .prepare(
          [
            targetScopeSql,
            'INSERT INTO owner_annotation_processing_commands(',
            ' id,actor_id,expected_owner_id,session_id,request_id,',
            ' workspace_id,project_id,album_id,invite_id,photo_id,version_id,annotation_id,',
            ' operation,expected_annotation_revision,expected_processing_revision,content_revision,state,request_json',
            ') SELECT ?,t.actor_id,?,?,?,t.workspace_id,t.project_id,t.album_id,t.invite_id,t.photo_id,t.version_id,t.annotation_id,',
            " 'set_processing_state',?,?,COALESCE((",
            ' SELECT old.content_revision FROM owner_annotation_processing_commands old',
            ' WHERE old.actor_id=t.actor_id AND old.request_id=? AND old.request_json=?',
            ' ),(SELECT MAX(ch.revision) FROM guest_annotation_changes ch',
            " WHERE ch.annotation_id=t.annotation_id AND ch.revision<=? AND ch.operation IN('create','update'))),?,?",
            ' FROM target t WHERE 1=1 ON CONFLICT(actor_id,request_id) DO NOTHING',
          ].join('\n'),
        )
        .bind(
          ...scope,
          crypto.randomUUID(),
          command.expectedOwnerId,
          sessionId,
          command.requestId,
          command.expectedAnnotationRevision,
          command.expectedProcessingRevision,
          command.requestId,
          requestJson,
          command.expectedAnnotationRevision,
          command.state,
          requestJson,
        )
        .run();
    } catch (error) {
      return writeFailure(error);
    }
    let row: { resultJson: string; contentRevision: number } | null;
    try {
      row = await this.db
        .prepare(
          [
            targetScopeSql,
            'SELECT r.result_json AS resultJson,c.content_revision AS contentRevision',
            ' FROM target t JOIN owner_annotation_processing_commands c ON c.actor_id=t.actor_id',
            ' AND c.workspace_id=t.workspace_id AND c.project_id=t.project_id AND c.album_id=t.album_id',
            ' AND c.invite_id=t.invite_id AND c.photo_id=t.photo_id AND c.version_id=t.version_id AND c.annotation_id=t.annotation_id',
            ' JOIN owner_annotation_processing_results r ON r.command_id=c.id AND r.actor_id=c.actor_id AND r.request_id=c.request_id',
            ' WHERE c.request_id=? AND c.request_json=? AND c.expected_owner_id=?',
            " AND c.operation='set_processing_state' AND c.expected_annotation_revision=? AND c.expected_processing_revision=? AND c.state=?",
          ].join('\n'),
        )
        .bind(
          ...scope,
          command.requestId,
          requestJson,
          actorId,
          command.expectedAnnotationRevision,
          command.expectedProcessingRevision,
          command.state,
        )
        .first<{ resultJson: string; contentRevision: number }>();
    } catch {
      return unavailable();
    }
    if (!row) {
      try {
        await assertCurrentAnnotationOwner(this.db, actorId, sessionId);
      } catch (error) {
        if (
          error instanceof WorkspaceFailure &&
          error.code === 'OWNER_REQUIRED'
        )
          throw error;
        return unavailable();
      }
      return fail('NOT_FOUND', 404);
    }
    let result: OwnerAnnotationProcessingResult;
    try {
      result = ownerAnnotationProcessingResultSchema.parse(
        JSON.parse(row.resultJson) as unknown,
      );
    } catch {
      return unavailable();
    }
    if (
      result.ownerId !== actorId ||
      result.requestId !== command.requestId ||
      result.operation !== command.operation ||
      result.inviteId !== command.inviteId ||
      result.photoId !== command.photoId ||
      result.versionId !== command.versionId ||
      result.annotationId !== command.annotationId ||
      result.processing.state !== command.state ||
      result.processing.revision !== command.expectedProcessingRevision + 1 ||
      result.processing.annotationRevision !==
        command.expectedAnnotationRevision ||
      result.processing.contentRevision !== row.contentRevision ||
      !Number.isSafeInteger(row.contentRevision) ||
      row.contentRevision < 1 ||
      row.contentRevision > command.expectedAnnotationRevision
    )
      return unavailable();
    return result;
  }
}
