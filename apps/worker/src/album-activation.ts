import { z } from 'zod';
import {
  activateAlbumSchema,
  type ActivateAlbumInput,
} from '../../../packages/contracts/src/album-activation';
import {
  albumSchema,
  type Album,
} from '../../../packages/contracts/src/projects';
import { WorkspaceFailure } from './workspaces';

const actorIdSchema = z.uuid().transform((value) => value.toLowerCase());
const sessionIdSchema = z.string().min(1).max(512);

type AlbumRow = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  state: string;
  isPinnedValue: number;
  legalHoldValue: number;
  revision: number;
  createdAt: string;
  projectStatus: string;
};

type ActivationCommandRow = {
  request_id: string;
  album_id: string;
  expected_revision: number;
  confirm_activate: number;
  after_json: string | null;
};

const OWNED_ALBUM_SELECT =
  'SELECT a.id,a.workspace_id AS workspaceId,a.project_id AS projectId,' +
  'a.name,a.state,a.is_pinned AS isPinnedValue,a.legal_hold AS legalHoldValue,' +
  'a.revision,a.created_at AS createdAt,p.status AS projectStatus ' +
  'FROM owners o ' +
  'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
  "AND s.expiresAt>unixepoch('subsec')*1000 " +
  'JOIN workspaces w ON w.owner_user_id=o.user_id ' +
  'JOIN albums a ON a.workspace_id=w.id ' +
  'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id ' +
  'WHERE o.user_id=? AND o.enabled=1 AND a.id=?';

const CURRENT_OWNER_SQL =
  'SELECT 1 FROM owners o ' +
  'JOIN owner_sessions s ON s.userId=o.user_id ' +
  "AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 " +
  'WHERE o.user_id=? AND o.enabled=1';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function parseAlbum(row: AlbumRow): Album {
  return albumSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    state: row.state,
    isPinned: row.isPinnedValue === 1,
    legalHold: row.legalHoldValue === 1,
    revision: row.revision,
    createdAt: row.createdAt,
  });
}

function activationFailure(error: unknown): never {
  if (error instanceof WorkspaceFailure) throw error;
  const message = messageOf(error);
  const known: Array<[string, string, 400 | 403 | 404 | 409]> = [
    ['OWNER_REQUIRED', 'OWNER_REQUIRED', 403],
    ['NOT_FOUND', 'NOT_FOUND', 404],
    ['REQUEST_ID_CONFLICT', 'REQUEST_ID_CONFLICT', 409],
    ['CONCURRENT_MODIFICATION', 'CONCURRENT_MODIFICATION', 409],
    ['RESOURCE_NOT_EDITABLE', 'RESOURCE_NOT_EDITABLE', 409],
    ['INVALID_STATE_TRANSITION', 'INVALID_STATE_TRANSITION', 409],
    [
      'ACTIVATION_CONFIRMATION_REQUIRED',
      'ACTIVATION_CONFIRMATION_REQUIRED',
      400,
    ],
  ];
  for (const [needle, code, status] of known) {
    if (message.includes(needle)) throw new WorkspaceFailure(code, status);
  }
  throw new WorkspaceFailure('ALBUM_ACTIVATION_UNAVAILABLE', 503);
}

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function parseInput(input: unknown): ActivateAlbumInput {
  const result = activateAlbumSchema.safeParse(input);
  if (!result.success) invalidInput();
  return result.data;
}

function parseAlbumId(input: string): string {
  const result = z
    .uuid()
    .transform((value) => value.toLowerCase())
    .safeParse(input);
  if (!result.success) invalidInput();
  return result.data;
}

function parseContext(actorId: string, sessionId: string) {
  const actor = actorIdSchema.safeParse(actorId);
  const session = sessionIdSchema.safeParse(sessionId);
  if (!actor.success || !session.success) invalidInput();
  return { actorId: actor.data, sessionId: session.data };
}

function assertEditableScope(row: AlbumRow): void {
  if (
    ['archived', 'deleting', 'deleted'].includes(row.projectStatus) ||
    ['archived', 'deleting', 'deleted'].includes(row.state)
  ) {
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
  }
}

function receiptFromCommand(
  command: ActivationCommandRow,
  albumId: string,
  input: ActivateAlbumInput,
): Album {
  if (
    command.request_id !== input.requestId ||
    command.album_id !== albumId ||
    command.expected_revision !== input.expectedRevision ||
    command.confirm_activate !== 1
  ) {
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  }
  if (command.after_json === null)
    throw new WorkspaceFailure('ALBUM_ACTIVATION_UNAVAILABLE', 503);
  try {
    return albumSchema.parse(JSON.parse(command.after_json));
  } catch {
    throw new WorkspaceFailure('ALBUM_ACTIVATION_UNAVAILABLE', 503);
  }
}

export class D1AlbumActivationRepository {
  private readonly actorId: string;
  private readonly sessionId: string;

  constructor(
    private readonly db: D1Database,
    actorId: string,
    sessionId: string,
  ) {
    const context = parseContext(actorId, sessionId);
    this.actorId = context.actorId;
    this.sessionId = context.sessionId;
  }

  private async assertCurrentOwner(): Promise<void> {
    const current = await this.db
      .prepare(CURRENT_OWNER_SQL)
      .bind(this.sessionId, this.actorId)
      .first();
    if (!current) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  private async loadOwnedAlbum(
    albumId: string,
    requireEditableScope: boolean,
  ): Promise<AlbumRow> {
    try {
      const row = await this.db
        .prepare(OWNED_ALBUM_SELECT)
        .bind(this.sessionId, this.actorId, albumId)
        .first<AlbumRow>();
      if (!row) {
        await this.assertCurrentOwner();
        throw new WorkspaceFailure('NOT_FOUND', 404);
      }
      if (requireEditableScope) assertEditableScope(row);
      return row;
    } catch (error) {
      return activationFailure(error);
    }
  }

  async get(albumId: string): Promise<Album> {
    const normalizedAlbumId = parseAlbumId(albumId);
    const row = await this.loadOwnedAlbum(normalizedAlbumId, true);
    try {
      return parseAlbum(row);
    } catch {
      throw new WorkspaceFailure('ALBUM_ACTIVATION_UNAVAILABLE', 503);
    }
  }

  private async findCommand(
    requestId: string,
  ): Promise<ActivationCommandRow | null> {
    try {
      return await this.db
        .prepare(
          'SELECT c.request_id,c.album_id,c.expected_revision,c.confirm_activate,' +
            'e.after_json FROM album_activation_commands c ' +
            'LEFT JOIN audit_events e ON e.event_id=' +
            "'album-activation:'||c.actor_id||':'||c.request_id " +
            'WHERE c.actor_id=? AND lower(c.request_id)=lower(?)',
        )
        .bind(this.actorId, requestId)
        .first<ActivationCommandRow>();
    } catch (error) {
      return activationFailure(error);
    }
  }

  private async findReceipt(
    albumId: string,
    requestId: string,
  ): Promise<Album> {
    try {
      const row = await this.db
        .prepare(
          'SELECT e.after_json FROM album_activation_commands c ' +
            'JOIN audit_events e ON e.event_id=' +
            "'album-activation:'||c.actor_id||':'||c.request_id " +
            'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 ' +
            'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
            "AND s.expiresAt>unixepoch('subsec')*1000 " +
            'JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id ' +
            'JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id ' +
            'JOIN albums a ON a.id=c.album_id AND a.workspace_id=w.id ' +
            'AND a.project_id=p.id ' +
            'WHERE c.actor_id=? AND c.request_id=? AND c.album_id=?',
        )
        .bind(this.sessionId, this.actorId, requestId, albumId)
        .first<{ after_json: string }>();
      if (!row) {
        await this.assertCurrentOwner();
        throw new WorkspaceFailure('ALBUM_ACTIVATION_UNAVAILABLE', 503);
      }
      return albumSchema.parse(JSON.parse(row.after_json));
    } catch (error) {
      return activationFailure(error);
    }
  }

  async activate(albumId: string, input: unknown): Promise<Album> {
    const normalizedAlbumId = parseAlbumId(albumId);
    const value = parseInput(input);
    const album = await this.loadOwnedAlbum(normalizedAlbumId, false);
    const prior = await this.findCommand(value.requestId);
    if (prior) return receiptFromCommand(prior, normalizedAlbumId, value);

    assertEditableScope(album);
    if (album.state !== 'draft')
      throw new WorkspaceFailure('INVALID_STATE_TRANSITION', 409);
    if (album.revision !== value.expectedRevision)
      throw new WorkspaceFailure('CONCURRENT_MODIFICATION', 409);

    try {
      await this.db
        .prepare(
          'INSERT INTO album_activation_commands(' +
            'actor_id,request_id,session_id,workspace_id,project_id,album_id,' +
            'expected_revision,confirm_activate' +
            ') VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          this.actorId,
          value.requestId,
          this.sessionId,
          album.workspaceId,
          album.projectId,
          album.id,
          value.expectedRevision,
          value.confirmActivate ? 1 : 0,
        )
        .run();
    } catch (error) {
      // An exact replay may commit concurrently. Reauthorize and compare it.
      await this.loadOwnedAlbum(normalizedAlbumId, false);
      const committed = await this.findCommand(value.requestId);
      if (committed)
        return receiptFromCommand(committed, normalizedAlbumId, value);
      return activationFailure(error);
    }

    return this.findReceipt(album.id, value.requestId);
  }
}
