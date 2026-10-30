import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import type { AnnotationGeometry } from '../../../packages/contracts/src/annotation-geometry';
import {
  guestAnnotationCommandSchema,
  guestAnnotationResultSchema,
  type AnnotationStyle,
  type GuestAnnotationCommand,
  type GuestAnnotationResult,
} from '../../../packages/contracts/src/guest-annotations';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { canonicalAnnotationGeometry } from './freehand-canonical';
import { WorkspaceFailure } from './workspaces';

const canAnnotateBit = guestPermissionBit('can_annotate');

const authorizedCteSql = [
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
  ')',
].join('\n');

type GuestAnnotationResultRow = {
  resultJson: string;
  annotationId: string;
  photoId: string;
  versionId: string;
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

function parseCommand(input: unknown): GuestAnnotationCommand {
  const result = guestAnnotationCommandSchema.safeParse(input);
  if (!result.success) invalidInput();
  return result.data;
}

function canonicalGeometry(geometry: AnnotationGeometry): AnnotationGeometry {
  return canonicalAnnotationGeometry(geometry);
}

function hasFreehandGeometry(command: GuestAnnotationCommand): boolean {
  return (
    (command.operation === 'create' || command.operation === 'update') &&
    command.geometry.type === 'freehand'
  );
}

function canonicalStyle(style: AnnotationStyle): AnnotationStyle {
  return { color: style.color };
}

function canonicalCommandJson(command: GuestAnnotationCommand): string {
  switch (command.operation) {
    case 'create':
      return JSON.stringify({
        requestId: command.requestId,
        expectedGuestId: command.expectedGuestId,
        operation: command.operation,
        photoId: command.photoId,
        versionId: command.versionId,
        geometry: canonicalGeometry(command.geometry),
        style: canonicalStyle(command.style),
        commentId: command.commentId,
      });
    case 'update':
      return JSON.stringify({
        requestId: command.requestId,
        expectedGuestId: command.expectedGuestId,
        operation: command.operation,
        annotationId: command.annotationId,
        expectedRevision: command.expectedRevision,
        geometry: canonicalGeometry(command.geometry),
        style: canonicalStyle(command.style),
        commentId: command.commentId,
      });
    case 'delete':
    case 'resolve':
    case 'reopen':
      return JSON.stringify({
        requestId: command.requestId,
        expectedGuestId: command.expectedGuestId,
        operation: command.operation,
        annotationId: command.annotationId,
        expectedRevision: command.expectedRevision,
      });
  }
}

function commandGeometryJson(command: GuestAnnotationCommand): string | null {
  if (command.operation === 'create' || command.operation === 'update')
    return JSON.stringify(canonicalGeometry(command.geometry));
  return null;
}

function commandStyleJson(command: GuestAnnotationCommand): string | null {
  if (command.operation === 'create' || command.operation === 'update')
    return JSON.stringify(canonicalStyle(command.style));
  return null;
}

function commandCommentId(command: GuestAnnotationCommand): string | null {
  if (command.operation === 'create' || command.operation === 'update')
    return command.commentId;
  return null;
}

function commandExpectedRevision(
  command: GuestAnnotationCommand,
): number | null {
  return command.operation === 'create' ? null : command.expectedRevision;
}

function mapWriteFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('GUEST_ACCESS_REQUIRED')) throw new GuestAccessDenied();
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (message.includes('ANNOTATION_REVISION_CONFLICT'))
    throw new WorkspaceFailure('ANNOTATION_REVISION_CONFLICT', 409);
  if (message.includes('ANNOTATION_LIMIT_REACHED'))
    throw new WorkspaceFailure('ANNOTATION_LIMIT_REACHED', 409);
  if (message.includes('ANNOTATION_REVISION_EXHAUSTED'))
    throw new WorkspaceFailure('ANNOTATION_REVISION_EXHAUSTED', 409);
  if (message.includes('INVALID_INPUT'))
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return unavailable();
}

export class D1GuestAnnotationsRepository {
  private readonly db: D1Database;
  private readonly freehandWriteEnabled: boolean;

  constructor(db: D1Database, freehandWriteEnabled = false) {
    this.db = db;
    this.freehandWriteEnabled = freehandWriteEnabled;
  }

  /**
   * When the gate closes, only an existing request ID may reach the immutable
   * command guard. A new freehand request is rejected before serialization.
   * The query uses the current Guest session and target authorization; the D1
   * command guard still validates the exact request body and session replay.
   */
  private async hasAuthorizedFreehandReplayCandidate(
    albumId: string,
    secretHash: string,
    command: GuestAnnotationCommand,
  ): Promise<boolean | null> {
    if (command.operation !== 'create' && command.operation !== 'update')
      return null;

    const targetSql =
      command.operation === 'create'
        ? [
            'JOIN photos p ON p.id=? AND p.workspace_id=a.workspace_id',
            ' AND p.project_id=a.project_id AND p.album_id=a.album_id',
            'JOIN guest_annotation_eligible_versions ev ON ev.photo_id=p.id',
            ' AND ev.version_id=? AND ev.workspace_id=p.workspace_id',
            ' AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
          ]
        : [
            'JOIN guest_annotations target ON target.id=?',
            ' AND target.author_guest_id=a.guest_id AND target.invite_id=a.invite_id',
            ' AND target.workspace_id=a.workspace_id AND target.project_id=a.project_id',
            ' AND target.album_id=a.album_id',
          ];
    const targetBinds =
      command.operation === 'create'
        ? [command.photoId, command.versionId]
        : [command.annotationId];

    let row: { hasRequestId: number } | null;
    try {
      row = await this.db
        .prepare(
          [
            authorizedCteSql,
            'SELECT EXISTS(',
            ' SELECT 1 FROM guest_annotation_commands prior',
            ' WHERE prior.guest_id=a.guest_id AND lower(prior.request_id)=?',
            ') AS hasRequestId',
            'FROM authorized a',
            ...targetSql,
            'WHERE a.guest_id=?',
          ].join('\n'),
        )
        .bind(
          albumId,
          secretHash,
          canAnnotateBit,
          canAnnotateBit,
          command.requestId,
          ...targetBinds,
          command.expectedGuestId,
        )
        .first<{ hasRequestId: number }>();
    } catch {
      return unavailable();
    }
    return row ? row.hasRequestId === 1 : null;
  }

  async command(
    secret: string | null,
    albumIdInput: string,
    input: unknown,
  ): Promise<GuestAnnotationResult> {
    const albumId = parseUuid(albumIdInput);
    const command = parseCommand(input);
    if (!secret) throw new GuestAccessDenied();

    let secretHash: string;
    try {
      secretHash = await hashGuestSessionSecret(secret);
    } catch {
      throw new GuestAccessDenied();
    }

    if (hasFreehandGeometry(command) && !this.freehandWriteEnabled) {
      const replayCandidate = await this.hasAuthorizedFreehandReplayCandidate(
        albumId,
        secretHash,
        command,
      );
      if (replayCandidate === false)
        throw new WorkspaceFailure('FREEHAND_ANNOTATIONS_DISABLED', 409);
    }

    const requestJson = canonicalCommandJson(command);
    const geometryJson = commandGeometryJson(command);
    const styleJson = commandStyleJson(command);
    const linkedCommentId = commandCommentId(command);
    const expectedRevision = commandExpectedRevision(command);
    const commandId = crypto.randomUUID();

    try {
      if (command.operation === 'create') {
        const generatedAnnotationId = crypto.randomUUID();
        await this.db
          .prepare(
            [
              authorizedCteSql,
              'INSERT INTO guest_annotation_commands(',
              ' id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,',
              ' workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,',
              ' expected_revision,geometry_json,style_json,linked_comment_id,request_json',
              ')',
              'SELECT ?,a.guest_id,?,a.invite_id,a.session_id,?,?,',
              ' a.workspace_id,a.project_id,a.album_id,?,?,',
              ' COALESCE((SELECT prior.annotation_id FROM guest_annotation_commands prior',
              '   WHERE prior.guest_id=a.guest_id AND lower(prior.request_id)=?),?),',
              ' ?,?,?,?,?,?',
              'FROM authorized a',
              'JOIN photos p ON p.id=? AND p.workspace_id=a.workspace_id',
              ' AND p.project_id=a.project_id AND p.album_id=a.album_id',
              'JOIN guest_annotation_eligible_versions ev ON ev.photo_id=p.id',
              ' AND ev.version_id=? AND ev.workspace_id=p.workspace_id',
              ' AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
            ].join('\n'),
          )
          .bind(
            albumId,
            secretHash,
            canAnnotateBit,
            canAnnotateBit,
            commandId,
            command.expectedGuestId,
            secretHash,
            command.requestId,
            command.photoId,
            command.versionId,
            command.requestId,
            generatedAnnotationId,
            command.operation,
            expectedRevision,
            geometryJson,
            styleJson,
            linkedCommentId,
            requestJson,
            command.photoId,
            command.versionId,
          )
          .run();
      } else {
        await this.db
          .prepare(
            [
              authorizedCteSql,
              'INSERT INTO guest_annotation_commands(',
              ' id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,',
              ' workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,',
              ' expected_revision,geometry_json,style_json,linked_comment_id,request_json',
              ')',
              'SELECT ?,a.guest_id,?,a.invite_id,a.session_id,?,?,',
              ' a.workspace_id,a.project_id,a.album_id,target.photo_id,target.version_id,',
              ' ?,?,?,?,?,?,?',
              'FROM authorized a',
              'JOIN guest_annotations target ON target.id=?',
              ' AND target.author_guest_id=a.guest_id AND target.invite_id=a.invite_id',
              ' AND target.workspace_id=a.workspace_id AND target.project_id=a.project_id',
              ' AND target.album_id=a.album_id',
            ].join('\n'),
          )
          .bind(
            albumId,
            secretHash,
            canAnnotateBit,
            canAnnotateBit,
            commandId,
            command.expectedGuestId,
            secretHash,
            command.requestId,
            command.annotationId,
            command.operation,
            expectedRevision,
            geometryJson,
            styleJson,
            linkedCommentId,
            requestJson,
            command.annotationId,
          )
          .run();
      }
    } catch (error) {
      mapWriteFailure(error);
    }

    const scopeFilter =
      command.operation === 'create'
        ? ' AND c.photo_id=? AND c.version_id=?'
        : ' AND c.annotation_id=?';
    const resultSql = [
      authorizedCteSql,
      'SELECT r.result_json AS resultJson,c.annotation_id AS annotationId,',
      ' c.photo_id AS photoId,c.version_id AS versionId',
      'FROM guest_annotation_commands c',
      'JOIN guest_annotation_results r ON r.command_id=c.id',
      ' AND r.guest_id=c.guest_id AND r.invite_id=c.invite_id AND r.request_id=c.request_id',
      'JOIN authorized a ON a.session_id=c.session_id AND a.guest_id=c.guest_id',
      ' AND a.invite_id=c.invite_id AND a.workspace_id=c.workspace_id',
      ' AND a.project_id=c.project_id AND a.album_id=c.album_id',
      'JOIN guest_annotation_eligible_versions ev ON ev.photo_id=c.photo_id',
      ' AND ev.version_id=c.version_id AND ev.workspace_id=c.workspace_id',
      ' AND ev.project_id=c.project_id AND ev.album_id=c.album_id',
      'WHERE a.guest_id=? AND c.expected_guest_id=? AND c.secret_hash=?',
      ' AND c.request_id=? AND c.request_json=? AND c.operation=?',
      ' AND c.expected_revision IS ? AND c.geometry_json IS ? AND c.style_json IS ?',
      " AND c.linked_comment_id IS ? AND c.annotation_id=json_extract(r.result_json,'$.item.annotationId')",
      " AND c.photo_id=json_extract(r.result_json,'$.item.photoId')",
      " AND c.version_id=json_extract(r.result_json,'$.item.versionId')",
      " AND c.operation=json_extract(r.result_json,'$.operation')",
      " AND c.request_id=json_extract(r.result_json,'$.requestId')",
      " AND json_extract(r.result_json,'$.item.revision')=CASE WHEN c.operation='create' THEN 1 ELSE c.expected_revision+1 END",
      " AND json_extract(r.result_json,'$.item.isMine')=1",
      scopeFilter,
    ].join('\n');

    let resultRow: GuestAnnotationResultRow | null;
    try {
      const scopeBinds =
        command.operation === 'create'
          ? [command.photoId, command.versionId]
          : [command.annotationId];
      resultRow = await this.db
        .prepare(resultSql)
        .bind(
          albumId,
          secretHash,
          canAnnotateBit,
          canAnnotateBit,
          command.expectedGuestId,
          command.expectedGuestId,
          secretHash,
          command.requestId,
          requestJson,
          command.operation,
          expectedRevision,
          geometryJson,
          styleJson,
          linkedCommentId,
          ...scopeBinds,
        )
        .first<GuestAnnotationResultRow>();
    } catch {
      return unavailable();
    }
    if (!resultRow) throw new GuestAccessDenied();

    let parsedResult: ReturnType<typeof guestAnnotationResultSchema.safeParse>;
    try {
      parsedResult = guestAnnotationResultSchema.safeParse(
        JSON.parse(resultRow.resultJson) as unknown,
      );
    } catch {
      return unavailable();
    }
    if (!parsedResult.success) return unavailable();

    const result = parsedResult.data;
    if (
      result.requestId !== command.requestId ||
      result.operation !== command.operation ||
      result.item.annotationId !== resultRow.annotationId ||
      result.item.photoId !== resultRow.photoId ||
      result.item.versionId !== resultRow.versionId ||
      result.item.isMine !== true ||
      result.item.revision !==
        (command.operation === 'create' ? 1 : command.expectedRevision + 1)
    )
      return unavailable();

    if (command.operation === 'create') {
      if (
        result.item.photoId !== command.photoId ||
        result.item.versionId !== command.versionId ||
        result.item.geometry === null ||
        JSON.stringify(result.item.geometry) !== geometryJson ||
        result.item.style === null ||
        JSON.stringify(result.item.style) !== styleJson ||
        result.item.commentId !== command.commentId ||
        result.item.createdAt !== result.item.updatedAt
      )
        return unavailable();
    } else if (command.operation === 'update') {
      if (
        result.item.annotationId !== command.annotationId ||
        result.item.geometry === null ||
        JSON.stringify(result.item.geometry) !== geometryJson ||
        result.item.style === null ||
        JSON.stringify(result.item.style) !== styleJson ||
        result.item.commentId !== command.commentId
      )
        return unavailable();
    } else if (result.item.annotationId !== command.annotationId) {
      return unavailable();
    }

    return result;
  }
}
