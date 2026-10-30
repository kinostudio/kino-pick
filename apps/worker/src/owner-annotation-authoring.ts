import { z } from 'zod';
import type { AnnotationGeometry } from '../../../packages/contracts/src/annotation-geometry';
import {
  ownerAnnotationCommandSchema,
  ownerAnnotationResultSchema,
  type OwnerAnnotationCommand,
  type OwnerAnnotationResult,
} from '../../../packages/contracts/src/owner-annotation-authoring';
import { canonicalAnnotationGeometry } from './freehand-canonical';
import { WorkspaceFailure } from './workspaces';

export const ownerAnnotationScopeSql = [
  'WITH authorized AS (',
  ' SELECT o.user_id AS actor_id,w.id AS workspace_id,pr.id AS project_id,',
  ' a.id AS album_id,i.id AS invite_id,p.id AS photo_id,v.id AS version_id',
  ' FROM (SELECT ? AS actor_id,? AS session_id,? AS album_id,',
  '   ? AS invite_id,? AS photo_id,? AS version_id) req',
  ' JOIN owners o ON o.user_id=req.actor_id AND o.enabled=1',
  ' JOIN owner_sessions s ON s.id=req.session_id AND s.userId=o.user_id',
  "   AND s.expiresAt>unixepoch('subsec')*1000",
  ' JOIN workspaces w ON w.owner_user_id=o.user_id',
  ' JOIN albums a ON a.id=req.album_id AND a.workspace_id=w.id',
  "   AND a.state='active'",
  ' JOIN projects pr ON pr.id=a.project_id AND pr.workspace_id=w.id',
  "   AND pr.status NOT IN('archived','deleting','deleted')",
  ' JOIN guest_invites i ON i.id=req.invite_id AND i.workspace_id=w.id',
  '   AND i.project_id=pr.id AND i.created_by=o.user_id',
  ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
  ' JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.album_id=a.id',
  '   AND ia.workspace_id=w.id AND ia.project_id=pr.id',
  ' JOIN photos p ON p.id=req.photo_id AND p.workspace_id=w.id',
  '   AND p.project_id=pr.id AND p.album_id=a.id',
  ' JOIN photo_versions v ON v.id=req.version_id AND v.photo_id=p.id',
  '   AND v.workspace_id=w.id',
  ')',
].join('\n');

function fail(code: string, status: 400 | 403 | 404 | 409 | 503): never {
  throw new WorkspaceFailure(code, status);
}
export function ownerAnnotationUnavailable(): never {
  return fail('OWNER_ANNOTATION_AUTHORING_UNAVAILABLE', 503);
}
export function ownerAnnotationUuid(input: unknown): string {
  const parsed = z.uuid().safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT', 400);
  return parsed.data;
}
export function ownerAnnotationSession(input: unknown): string {
  const parsed = z.string().min(1).max(512).safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT', 400);
  return parsed.data;
}
export async function assertCurrentAnnotationOwner(
  db: D1Database,
  actorId: string,
  sessionId: string,
): Promise<void> {
  let row: { authorized: number } | null;
  try {
    row = await db
      .prepare(
        [
          'SELECT 1 AS authorized FROM owners o',
          'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
          " AND s.expiresAt>unixepoch('subsec')*1000",
          'WHERE o.enabled=1 AND o.user_id=?',
        ].join(' '),
      )
      .bind(sessionId, actorId)
      .first<{ authorized: number }>();
  } catch {
    return ownerAnnotationUnavailable();
  }
  if (!row) return fail('OWNER_REQUIRED', 403);
}
function canonicalGeometry(value: AnnotationGeometry): AnnotationGeometry {
  return canonicalAnnotationGeometry(value);
}
function hasFreehandGeometry(command: OwnerAnnotationCommand): boolean {
  return (
    (command.operation === 'create' || command.operation === 'update') &&
    command.geometry.type === 'freehand'
  );
}
export function canonicalOwnerAnnotationCommand(
  command: OwnerAnnotationCommand,
): string {
  const base = {
    requestId: command.requestId,
    expectedOwnerId: command.expectedOwnerId,
    operation: command.operation,
    inviteId: command.inviteId,
    photoId: command.photoId,
    versionId: command.versionId,
  };
  if (command.operation === 'create')
    return JSON.stringify({
      ...base,
      geometry: canonicalGeometry(command.geometry),
      style: { color: command.style.color },
      commentId: command.commentId,
    });
  if (command.operation === 'update')
    return JSON.stringify({
      ...base,
      annotationId: command.annotationId,
      expectedRevision: command.expectedRevision,
      geometry: canonicalGeometry(command.geometry),
      style: { color: command.style.color },
      commentId: command.commentId,
    });
  return JSON.stringify({
    ...base,
    annotationId: command.annotationId,
    expectedRevision: command.expectedRevision,
  });
}
function mapWriteFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  for (const code of [
    'REQUEST_ID_CONFLICT',
    'ANNOTATION_REVISION_CONFLICT',
    'ANNOTATION_LIMIT_REACHED',
    'ANNOTATION_REVISION_EXHAUSTED',
    'ANNOTATION_COMMENT_UNAVAILABLE',
    'ANNOTATION_ID_CONFLICT',
    'ANNOTATION_ID_COLLISION',
    'RESOURCE_NOT_EDITABLE',
    'OWNER_IDENTITY_CHANGED',
  ]) {
    if (message.includes(code)) return fail(code, 409);
  }
  if (message.includes('OWNER_REQUIRED')) return fail('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND')) return fail('NOT_FOUND', 404);
  if (message.includes('INVALID_INPUT')) return fail('INVALID_INPUT', 400);
  return ownerAnnotationUnavailable();
}

type ReceiptRow = {
  resultJson: string;
  annotationId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
};
export class D1OwnerAnnotationAuthoringRepository {
  private readonly db: D1Database;
  private readonly freehandWriteEnabled: boolean;
  constructor(db: D1Database, freehandWriteEnabled = false) {
    this.db = db;
    this.freehandWriteEnabled = freehandWriteEnabled;
  }

  /**
   * Keep new strokes closed by default. With the gate closed, an existing
   * request ID can still recover its immutable result through the D1 guard.
   */
  private async hasAuthorizedFreehandReplayCandidate(
    scope: string[],
    actorId: string,
    requestId: string,
  ): Promise<boolean | null> {
    let row: { scopeAuthorized: number; hasRequestId: number } | null;
    try {
      row = await this.db
        .prepare(
          [
            ownerAnnotationScopeSql,
            'SELECT EXISTS(SELECT 1 FROM authorized) AS scopeAuthorized,',
            ' EXISTS(',
            '  SELECT 1 FROM owner_annotation_commands prior',
            '  WHERE prior.actor_id=? AND prior.request_id=?',
            ' ) AS hasRequestId',
          ].join('\n'),
        )
        .bind(...scope, actorId, requestId)
        .first<{ scopeAuthorized: number; hasRequestId: number }>();
    } catch {
      return ownerAnnotationUnavailable();
    }
    if (!row || row.scopeAuthorized !== 1) return null;
    return row.hasRequestId === 1;
  }

  async command(
    actorInput: string,
    sessionInput: string,
    albumInput: string,
    input: unknown,
  ): Promise<OwnerAnnotationResult> {
    const actorId = ownerAnnotationUuid(actorInput);
    const sessionId = ownerAnnotationSession(sessionInput);
    const albumId = ownerAnnotationUuid(albumInput);
    const parsed = ownerAnnotationCommandSchema.safeParse(input);
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
    ];
    if (hasFreehandGeometry(command) && !this.freehandWriteEnabled) {
      const replayCandidate = await this.hasAuthorizedFreehandReplayCandidate(
        scope,
        actorId,
        command.requestId,
      );
      if (replayCandidate === false)
        return fail('FREEHAND_ANNOTATIONS_DISABLED', 409);
    }
    const requestJson = canonicalOwnerAnnotationCommand(command);
    const expectedRevision =
      command.operation === 'create' ? null : command.expectedRevision;
    const geometryJson =
      command.operation === 'create' || command.operation === 'update'
        ? JSON.stringify(canonicalGeometry(command.geometry))
        : null;
    const styleJson =
      command.operation === 'create' || command.operation === 'update'
        ? JSON.stringify({ color: command.style.color })
        : null;
    const commentId =
      command.operation === 'create' || command.operation === 'update'
        ? command.commentId
        : null;
    const annotationExpression =
      command.operation === 'create'
        ? 'COALESCE((SELECT old.annotation_id FROM owner_annotation_commands old WHERE old.actor_id=a.actor_id AND old.request_id=?),?)'
        : '?';
    const annotationBindings =
      command.operation === 'create'
        ? [command.requestId, crypto.randomUUID()]
        : [command.annotationId];
    try {
      await this.db
        .prepare(
          [
            ownerAnnotationScopeSql,
            'INSERT INTO owner_annotation_commands(',
            ' id,actor_id,expected_owner_id,session_id,request_id,',
            ' workspace_id,project_id,album_id,invite_id,photo_id,version_id,',
            ' annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json',
            ')',
            'SELECT ?,a.actor_id,?,?,?,a.workspace_id,a.project_id,a.album_id,a.invite_id,a.photo_id,a.version_id,',
            ' ' + annotationExpression + ',?,?,?,?,?,?',
            'FROM authorized a WHERE 1=1',
            'ON CONFLICT(actor_id,request_id) DO NOTHING',
          ].join('\n'),
        )
        .bind(
          ...scope,
          crypto.randomUUID(),
          command.expectedOwnerId,
          sessionId,
          command.requestId,
          ...annotationBindings,
          command.operation,
          expectedRevision,
          geometryJson,
          styleJson,
          commentId,
          requestJson,
        )
        .run();
    } catch (error) {
      return mapWriteFailure(error);
    }
    let row: ReceiptRow | null;
    try {
      row = await this.db
        .prepare(
          [
            ownerAnnotationScopeSql,
            'SELECT r.result_json AS resultJson,c.annotation_id AS annotationId,',
            ' c.invite_id AS inviteId,c.photo_id AS photoId,c.version_id AS versionId',
            'FROM authorized a JOIN owner_annotation_commands c ON c.actor_id=a.actor_id',
            ' AND c.workspace_id=a.workspace_id AND c.project_id=a.project_id AND c.album_id=a.album_id',
            ' AND c.invite_id=a.invite_id AND c.photo_id=a.photo_id AND c.version_id=a.version_id',
            'JOIN owner_annotation_results r ON r.command_id=c.id AND r.actor_id=c.actor_id AND r.request_id=c.request_id',
            'WHERE c.request_id=? AND c.request_json=? AND c.expected_owner_id=?',
            ' AND c.operation=? AND c.expected_revision IS ? AND c.geometry_json IS ?',
            ' AND c.style_json IS ? AND c.linked_comment_id IS ?',
          ].join('\n'),
        )
        .bind(
          ...scope,
          command.requestId,
          requestJson,
          actorId,
          command.operation,
          expectedRevision,
          geometryJson,
          styleJson,
          commentId,
        )
        .first<ReceiptRow>();
    } catch {
      return ownerAnnotationUnavailable();
    }
    if (!row) {
      await assertCurrentAnnotationOwner(this.db, actorId, sessionId);
      return fail('NOT_FOUND', 404);
    }
    let result: OwnerAnnotationResult;
    try {
      result = ownerAnnotationResultSchema.parse(
        JSON.parse(row.resultJson) as unknown,
      );
    } catch {
      return ownerAnnotationUnavailable();
    }
    if (
      result.ownerId !== actorId ||
      result.requestId !== command.requestId ||
      result.operation !== command.operation ||
      result.item.annotationId !== row.annotationId ||
      result.item.inviteId !== command.inviteId ||
      row.inviteId !== command.inviteId ||
      result.item.photoId !== command.photoId ||
      row.photoId !== command.photoId ||
      result.item.versionId !== command.versionId ||
      row.versionId !== command.versionId ||
      result.item.revision !==
        (command.operation === 'create' ? 1 : command.expectedRevision + 1) ||
      (command.operation !== 'create' &&
        result.item.annotationId !== command.annotationId)
    )
      return ownerAnnotationUnavailable();
    if (command.operation === 'create' || command.operation === 'update') {
      if (
        JSON.stringify(result.item.geometry) !== geometryJson ||
        JSON.stringify(result.item.style) !== styleJson ||
        result.item.commentId !== command.commentId
      )
        return ownerAnnotationUnavailable();
    }
    if (
      command.operation === 'create' &&
      result.item.createdAt !== result.item.updatedAt
    )
      return ownerAnnotationUnavailable();
    return result;
  }
}
