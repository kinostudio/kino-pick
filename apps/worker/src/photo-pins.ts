import { z } from 'zod';
import {
  setPhotoPinResultSchema,
  setPhotoPinSchema,
  type SetPhotoPinResult,
} from '../../../packages/contracts/src/photo-pins';
import { WorkspaceFailure } from './workspaces';

const uuidSchema = z.uuid();
const sessionIdSchema = z.string().min(1).max(512);
const REQUIRED_TRIGGERS = [
  'photo_pin_command_guard',
  'photo_pin_command_apply',
  'photo_pin_commands_no_update',
  'photo_pin_commands_no_delete',
  'photo_pin_commands_no_replace',
  'photo_pin_state_insert_guard',
  'photo_pin_state_update_guard',
  'photo_pin_state_no_delete',
  'photo_pin_results_insert_guard',
  'photo_pin_results_no_update',
  'photo_pin_results_no_delete',
  'photo_pin_results_no_replace',
  'photo_pin_audit_insert_guard',
  'photo_pin_audit_namespace',
] as const;

type PhotoScope = {
  workspaceId: string;
  projectId: string;
  albumId: string;
};
type PriorRow = PhotoScope & {
  photoId: string;
  expectedRevision: number;
  isPinnedValue: number;
  beforeJson: string;
  afterJson: string;
  changedValue: number;
  eventId: string | null;
};

function fail(code: string, status: 400 | 403 | 404 | 409 | 503): never {
  throw new WorkspaceFailure(code, status);
}
function invalid(): never {
  return fail('INVALID_INPUT', 400);
}
function unavailable(): never {
  return fail('PHOTO_PINS_UNAVAILABLE', 503);
}
function uuid(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data.toLowerCase();
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toUpperCase() : '';
}
function translate(error: unknown): never {
  if (error instanceof WorkspaceFailure) throw error;
  const message = errorMessage(error);
  if (message.includes('OWNER_REQUIRED')) fail('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND')) fail('NOT_FOUND', 404);
  if (message.includes('RESOURCE_NOT_EDITABLE'))
    fail('RESOURCE_NOT_EDITABLE', 409);
  if (message.includes('REQUEST_ID_CONFLICT')) fail('REQUEST_ID_CONFLICT', 409);
  if (message.includes('PHOTO_PIN_REVISION_CONFLICT'))
    fail('PHOTO_PIN_REVISION_CONFLICT', 409);
  if (message.includes('INVALID_INPUT')) fail('INVALID_INPUT', 400);
  if (message.includes('FOREIGN KEY')) fail('NOT_FOUND', 404);
  unavailable();
}

/** Owner-authorized writer for the append-only logical-photo pin ledger. */
export class D1PhotoPinsRepository {
  private schemaProbe: Promise<boolean> | null = null;
  private readonly actorId: string;
  private readonly sessionId: string;

  constructor(
    private readonly db: D1Database,
    actorId: string,
    sessionId: string,
  ) {
    const actor = uuidSchema.safeParse(actorId);
    const session = sessionIdSchema.safeParse(sessionId);
    if (!actor.success || !session.success) invalid();
    this.actorId = actor.data.toLowerCase();
    this.sessionId = session.data;
  }

  async capability(): Promise<boolean> {
    if (!this.schemaProbe) {
      this.schemaProbe = (async () => {
        try {
          await this.db
            .prepare('SELECT 1 FROM photo_pin_commands LIMIT 0')
            .first();
          await this.db
            .prepare('SELECT 1 FROM photo_pin_states LIMIT 0')
            .first();
          await this.db
            .prepare('SELECT 1 FROM photo_pin_results LIMIT 0')
            .first();
          const rows = await this.db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type='trigger'
                AND name IN (${REQUIRED_TRIGGERS.map(() => '?').join(',')})`,
            )
            .bind(...REQUIRED_TRIGGERS)
            .all<{ name: string }>();
          const present = new Set(rows.results.map((row) => row.name));
          return REQUIRED_TRIGGERS.every((name) => present.has(name));
        } catch {
          return false;
        }
      })();
    }
    return this.schemaProbe;
  }

  async set(photoIdInput: string, input: unknown): Promise<SetPhotoPinResult> {
    if (!(await this.capability())) unavailable();
    const photoId = uuid(photoIdInput);
    const parsed = setPhotoPinSchema.safeParse(input);
    if (!parsed.success) invalid();
    const value = parsed.data;
    const scope = await this.loadPhotoScope(photoId);
    const prior = await this.findPrior(value.requestId);
    if (prior) return this.prior(prior, photoId, scope, value);

    const commandId = crypto.randomUUID().toLowerCase();
    try {
      await this.db
        .prepare(
          `INSERT INTO photo_pin_commands(
            id,actor_id,session_id,request_id,workspace_id,project_id,album_id,
            photo_id,expected_revision,is_pinned,created_at_ms
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          commandId,
          this.actorId,
          this.sessionId,
          value.requestId,
          scope.workspaceId,
          scope.projectId,
          scope.albumId,
          photoId,
          value.expectedRevision,
          value.isPinned ? 1 : 0,
          Date.now(),
        )
        .run();
    } catch (error) {
      // A parallel exact request may have committed between preflight and insert.
      const raced = await this.findPrior(value.requestId);
      if (raced) return this.prior(raced, photoId, scope, value);
      translate(error);
    }

    const result = await this.findPrior(value.requestId);
    if (!result) unavailable();
    return this.prior(result, photoId, scope, value);
  }

  private async assertCurrentOwner(): Promise<void> {
    try {
      const row = await this.db
        .prepare(
          `SELECT 1 AS authorized FROM owners o
            JOIN owner_sessions s ON s.userId=o.user_id
              AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
            WHERE o.user_id=? AND o.enabled=1`,
        )
        .bind(this.sessionId, this.actorId)
        .first();
      if (!row) fail('OWNER_REQUIRED', 403);
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      unavailable();
    }
  }

  private async loadPhotoScope(photoId: string): Promise<PhotoScope> {
    try {
      const row = await this.db
        .prepare(
          `SELECT ph.workspace_id AS workspaceId,ph.project_id AS projectId,
              ph.album_id AS albumId
            FROM photos ph
            JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=?
            JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
            JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
              AND a.workspace_id=ph.workspace_id
            JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
            JOIN owner_sessions s ON s.userId=o.user_id
              AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
            JOIN photo_version_heads h ON h.photo_id=ph.id
              AND h.workspace_id=ph.workspace_id AND h.project_id=ph.project_id
              AND h.album_id=ph.album_id
            WHERE ph.id=? AND a.state NOT IN('archived','deleting','deleted')
              AND p.status NOT IN('archived','deleting','deleted')`,
        )
        .bind(this.actorId, this.sessionId, photoId)
        .first<PhotoScope>();
      if (row) return row;
      await this.assertCurrentOwner();
      const state = await this.db
        .prepare(
          `SELECT a.state AS albumState,p.status AS projectStatus
            FROM photos ph JOIN projects p ON p.id=ph.project_id
              AND p.workspace_id=ph.workspace_id
            JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
              AND a.workspace_id=ph.workspace_id
            JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=?
            WHERE ph.id=?`,
        )
        .bind(this.actorId, photoId)
        .first<{ albumState: string; projectStatus: string }>();
      if (
        state &&
        ['archived', 'deleting', 'deleted'].some(
          (status) =>
            status === state.albumState || status === state.projectStatus,
        )
      )
        fail('RESOURCE_NOT_EDITABLE', 409);
      fail('NOT_FOUND', 404);
    } catch (error) {
      translate(error);
    }
  }

  private async findPrior(requestId: string): Promise<PriorRow | null> {
    try {
      return await this.db
        .prepare(
          `SELECT c.photo_id AS photoId,c.workspace_id AS workspaceId,
              c.project_id AS projectId,c.album_id AS albumId,
              c.expected_revision AS expectedRevision,c.is_pinned AS isPinnedValue,
              r.before_json AS beforeJson,r.after_json AS afterJson,
              r.changed AS changedValue,r.event_id AS eventId
            FROM photo_pin_commands c
            JOIN photo_pin_results r ON r.command_id=c.id
            WHERE c.actor_id=? AND lower(c.request_id)=lower(?)`,
        )
        .bind(this.actorId, requestId)
        .first<PriorRow>();
    } catch {
      unavailable();
    }
  }

  private prior(
    row: PriorRow,
    photoId: string,
    scope: PhotoScope,
    input: z.infer<typeof setPhotoPinSchema>,
  ): SetPhotoPinResult {
    if (
      row.photoId !== photoId ||
      row.workspaceId !== scope.workspaceId ||
      row.projectId !== scope.projectId ||
      row.albumId !== scope.albumId ||
      Number(row.expectedRevision) !== input.expectedRevision ||
      Number(row.isPinnedValue) !== (input.isPinned ? 1 : 0)
    )
      fail('REQUEST_ID_CONFLICT', 409);
    let after: unknown;
    try {
      after = JSON.parse(row.afterJson) as unknown;
    } catch {
      unavailable();
    }
    const result = setPhotoPinResultSchema.safeParse({
      photo: after,
      changed: Number(row.changedValue) === 1,
      eventId: row.eventId,
    });
    if (!result.success) unavailable();
    return result.data;
  }
}
