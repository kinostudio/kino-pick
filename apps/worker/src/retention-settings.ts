import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';

// G2-01: per-album retention intent. Automatic deletion stays OFF globally;
// these settings only drive the Owner's dry-run preview.
// G2-02: invite expiry mode. "inherit" links follow album retention (with the
// global 365-day hard cap); "custom" (and any legacy invite without a row)
// keeps the album out of cleanup candidates while unexpired.
export const DEFAULT_ALBUM_INACTIVE_DAYS = 90;

const uuid = z.uuid();
export const retentionSettingsChangeSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    inactiveDays: z.number().int().min(7).max(3650),
    cleanupEnabled: z.boolean(),
  })
  .strict();
export const inviteExpiryModeSchema = z
  .object({ mode: z.enum(['custom', 'inherit']) })
  .strict();

type SettingsRow = {
  album_id: string;
  workspace_id: string;
  project_id: string;
  inactive_days: number | null;
  cleanup_enabled: number | null;
  revision: number | null;
  last_request_id: string | null;
};

export type AlbumRetentionSettings = {
  albumId: string;
  inactiveDays: number;
  cleanupEnabled: boolean;
  revision: number;
  source: 'default' | 'album';
  automaticDeletion: 'off';
};

function project(row: SettingsRow): AlbumRetentionSettings {
  return {
    albumId: row.album_id,
    inactiveDays: row.inactive_days ?? DEFAULT_ALBUM_INACTIVE_DAYS,
    cleanupEnabled: row.cleanup_enabled === 1,
    revision: row.revision ?? 0,
    source: row.revision === null ? 'default' : 'album',
    automaticDeletion: 'off',
  };
}

async function ownedAlbum(
  db: D1Database,
  ownerId: string,
  albumId: string,
): Promise<SettingsRow> {
  const parsed = uuid.safeParse(albumId);
  if (!parsed.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const row = await db
    .prepare(
      `SELECT a.id AS album_id,a.workspace_id,a.project_id,
         s.inactive_days,s.cleanup_enabled,s.revision,s.last_request_id
       FROM albums a JOIN workspaces w ON w.id=a.workspace_id
       LEFT JOIN album_retention_settings s ON s.album_id=a.id
       WHERE a.id=? AND w.owner_user_id=? AND a.state<>'deleted'`,
    )
    .bind(parsed.data, ownerId)
    .first<SettingsRow>();
  if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
  return row;
}

export async function readAlbumRetentionSettings(
  db: D1Database,
  ownerId: string,
  albumId: string,
): Promise<AlbumRetentionSettings> {
  return project(await ownedAlbum(db, ownerId, albumId));
}

export async function changeAlbumRetentionSettings(
  db: D1Database,
  ownerId: string,
  sessionId: string,
  albumId: string,
  input: unknown,
): Promise<AlbumRetentionSettings> {
  const parsed = retentionSettingsChangeSchema.safeParse(input);
  if (!parsed.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const body = parsed.data;
  const current = await ownedAlbum(db, ownerId, albumId);
  const currentRevision = current.revision ?? 0;
  if (current.last_request_id === body.requestId) {
    if (
      current.inactive_days === body.inactiveDays &&
      (current.cleanup_enabled === 1) === body.cleanupEnabled
    )
      return project(current);
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  }
  if (body.expectedRevision !== currentRevision)
    throw new WorkspaceFailure('RETENTION_SETTINGS_REVISION_CONFLICT', 409);

  const next = currentRevision + 1;
  const now = Date.now();
  const before = project(current);
  const after = {
    inactiveDays: body.inactiveDays,
    cleanupEnabled: body.cleanupEnabled,
    revision: next,
  };
  const write =
    currentRevision === 0
      ? db
          .prepare(
            `INSERT INTO album_retention_settings(album_id,workspace_id,project_id,inactive_days,cleanup_enabled,revision,updated_at_ms,updated_by,last_request_id)
             SELECT a.id,a.workspace_id,a.project_id,?,?,1,?,?,?
             FROM albums a JOIN workspaces w ON w.id=a.workspace_id
             WHERE a.id=? AND w.owner_user_id=?
               AND NOT EXISTS(SELECT 1 FROM album_retention_settings s WHERE s.album_id=a.id)`,
          )
          .bind(
            body.inactiveDays,
            body.cleanupEnabled ? 1 : 0,
            now,
            ownerId,
            body.requestId,
            current.album_id,
            ownerId,
          )
      : db
          .prepare(
            `UPDATE album_retention_settings SET inactive_days=?,cleanup_enabled=?,revision=?,updated_at_ms=?,updated_by=?,last_request_id=?
             WHERE album_id=? AND revision=?`,
          )
          .bind(
            body.inactiveDays,
            body.cleanupEnabled ? 1 : 0,
            next,
            now,
            ownerId,
            body.requestId,
            current.album_id,
            currentRevision,
          );
  // The audit row is written only if this exact revision landed.
  const audit = db
    .prepare(
      `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id)
       SELECT ?,'user',?,?,?,?,?,'album.retention_settings_changed',?,?,?
       WHERE EXISTS(SELECT 1 FROM album_retention_settings s WHERE s.album_id=? AND s.revision=? AND s.last_request_id=?)`,
    )
    .bind(
      'album-retention:' + current.album_id + ':' + next,
      ownerId,
      sessionId,
      current.workspace_id,
      current.project_id,
      current.album_id,
      JSON.stringify({
        inactiveDays: before.inactiveDays,
        cleanupEnabled: before.cleanupEnabled,
        revision: before.revision,
      }),
      JSON.stringify(after),
      body.requestId,
      current.album_id,
      next,
      body.requestId,
    );
  let results: D1Result[];
  try {
    results = await db.batch([write, audit]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/REVISION_CONFLICT|UNIQUE constraint/.test(message))
      throw new WorkspaceFailure('RETENTION_SETTINGS_REVISION_CONFLICT', 409);
    throw error;
  }
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
    throw new WorkspaceFailure('RETENTION_SETTINGS_REVISION_CONFLICT', 409);
  return {
    albumId: current.album_id,
    inactiveDays: body.inactiveDays,
    cleanupEnabled: body.cleanupEnabled,
    revision: next,
    source: 'album',
    automaticDeletion: 'off',
  };
}

export async function recordInviteExpiryMode(
  db: D1Database,
  ownerId: string,
  sessionId: string,
  inviteId: string,
  input: unknown,
): Promise<{ inviteId: string; mode: 'custom' | 'inherit' }> {
  const id = uuid.safeParse(inviteId);
  const body = inviteExpiryModeSchema.safeParse(input);
  if (!id.success || !body.success)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  const invite = await db
    .prepare(
      `SELECT i.id,i.workspace_id,i.project_id,m.mode
       FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
       LEFT JOIN invite_expiry_modes m ON m.invite_id=i.id
       WHERE i.id=? AND w.owner_user_id=?`,
    )
    .bind(id.data, ownerId)
    .first<{
      id: string;
      workspace_id: string;
      project_id: string;
      mode: 'custom' | 'inherit' | null;
    }>();
  if (!invite) throw new WorkspaceFailure('NOT_FOUND', 404);
  if (invite.mode !== null) {
    if (invite.mode === body.data.mode)
      return { inviteId: invite.id, mode: invite.mode };
    throw new WorkspaceFailure('INVITE_EXPIRY_MODE_FIXED', 409);
  }
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO invite_expiry_modes(invite_id,mode,created_at_ms,created_by) VALUES(?,?,?,?)`,
      )
      .bind(invite.id, body.data.mode, now, ownerId),
    db
      .prepare(
        `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,action,after_json,request_id)
         VALUES(?,'user',?,?,?,?,'invite.expiry_mode_recorded',?,?)`,
      )
      .bind(
        'invite-expiry-mode:' + invite.id,
        ownerId,
        sessionId,
        invite.workspace_id,
        invite.project_id,
        JSON.stringify({ inviteId: invite.id, mode: body.data.mode }),
        crypto.randomUUID(),
      ),
  ]);
  return { inviteId: invite.id, mode: body.data.mode };
}
