import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';

// Owner-chosen covers. A null choice means automatic: album covers fall back to
// first pinned > first photographer recommendation > first photo (client side,
// from the authorized gallery page); project covers fall back to the first
// album. Every change is revision-checked and audited in the same D1 batch.

const uuid = z.uuid();
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const albumCoverChangeSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: revision,
    photoId: z.uuid().nullable(),
  })
  .strict();
export const projectCoverChangeSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: revision,
    albumId: z.uuid().nullable(),
  })
  .strict();

export type AlbumCover = {
  albumId: string;
  photoId: string | null;
  thumbnailUrl: string | null;
  revision: number;
};
export type ProjectCover = {
  projectId: string;
  albumId: string | null;
  revision: number;
};

type AlbumRow = {
  album_id: string;
  workspace_id: string;
  project_id: string;
  photo_id: string | null;
  revision: number | null;
  last_request_id: string | null;
  version_id: string | null;
};
type ProjectRow = {
  project_id: string;
  workspace_id: string;
  album_id: string | null;
  revision: number | null;
  last_request_id: string | null;
};

function parseId(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  return parsed.data;
}

// The chosen photo is shown only while it is still live and processed; its
// current version supplies the private thumbnail path used by the gallery.
const ALBUM_SQL = `SELECT a.id AS album_id,a.workspace_id,a.project_id,
    s.photo_id,s.revision,s.last_request_id,
    CASE WHEN EXISTS(SELECT 1 FROM photo_assets o JOIN image_processing_jobs j ON j.id=o.id
        WHERE o.version_id=head.version_id AND o.asset_kind='original' AND j.status='succeeded')
      THEN head.version_id END AS version_id
  FROM albums a JOIN workspaces w ON w.id=a.workspace_id
  LEFT JOIN album_cover_settings s ON s.album_id=a.id
  LEFT JOIN photo_version_heads head ON head.photo_id=s.photo_id AND head.album_id=a.id AND head.workspace_id=a.workspace_id
  WHERE a.id=? AND w.owner_user_id=? AND a.state NOT IN('deleting','deleted')`;

function projectAlbum(row: AlbumRow): AlbumCover {
  const ready = row.photo_id !== null && row.version_id !== null;
  return {
    albumId: row.album_id,
    photoId: row.photo_id,
    thumbnailUrl: ready
      ? `/api/v1/photos/${row.photo_id}/versions/${row.version_id}/assets/thumbnail`
      : null,
    revision: row.revision ?? 0,
  };
}

async function ownedAlbum(db: D1Database, ownerId: string, albumId: string) {
  const row = await db
    .prepare(ALBUM_SQL)
    .bind(parseId(albumId), ownerId)
    .first<AlbumRow>();
  if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
  return row;
}

export async function readAlbumCover(
  db: D1Database,
  ownerId: string,
  albumId: string,
): Promise<AlbumCover> {
  return projectAlbum(await ownedAlbum(db, ownerId, albumId));
}

async function ownedProject(
  db: D1Database,
  ownerId: string,
  projectId: string,
) {
  const row = await db
    .prepare(
      `SELECT p.id AS project_id,p.workspace_id,
         CASE WHEN EXISTS(SELECT 1 FROM albums a WHERE a.id=s.album_id AND a.state NOT IN('deleting','deleted')) THEN s.album_id END AS album_id,
         s.revision,s.last_request_id
       FROM projects p JOIN workspaces w ON w.id=p.workspace_id
       LEFT JOIN project_cover_settings s ON s.project_id=p.id
       WHERE p.id=? AND w.owner_user_id=?
         AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.project_id=p.id AND e.action='project.deleted')`,
    )
    .bind(parseId(projectId), ownerId)
    .first<ProjectRow>();
  if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
  return row;
}

export async function readProjectCover(
  db: D1Database,
  ownerId: string,
  projectId: string,
): Promise<ProjectCover> {
  const row = await ownedProject(db, ownerId, projectId);
  return {
    projectId: row.project_id,
    albumId: row.album_id,
    revision: row.revision ?? 0,
  };
}

function conflict(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (/SCOPE_MISMATCH/.test(message))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (/REVISION_CONFLICT|UNIQUE constraint/.test(message))
    throw new WorkspaceFailure('COVER_SETTINGS_REVISION_CONFLICT', 409);
  throw error;
}

export async function changeAlbumCover(
  db: D1Database,
  ownerId: string,
  sessionId: string,
  albumId: string,
  input: unknown,
): Promise<AlbumCover> {
  const parsed = albumCoverChangeSchema.safeParse(input);
  if (!parsed.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const body = parsed.data;
  const current = await ownedAlbum(db, ownerId, albumId);
  const currentRevision = current.revision ?? 0;
  if (current.last_request_id === body.requestId) {
    if (current.photo_id === body.photoId) return projectAlbum(current);
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  }
  if (body.expectedRevision !== currentRevision)
    throw new WorkspaceFailure('COVER_SETTINGS_REVISION_CONFLICT', 409);
  if (body.photoId !== null) {
    const photo = await db
      .prepare(
        `SELECT 1 AS ok FROM photos p
         WHERE p.id=? AND p.album_id=? AND p.workspace_id=?
           AND EXISTS(SELECT 1 FROM photo_version_heads h WHERE h.photo_id=p.id AND h.album_id=p.album_id)`,
      )
      .bind(body.photoId, current.album_id, current.workspace_id)
      .first();
    if (!photo) throw new WorkspaceFailure('NOT_FOUND', 404);
  }
  const next = currentRevision + 1;
  const now = Date.now();
  const write =
    currentRevision === 0
      ? db
          .prepare(
            `INSERT INTO album_cover_settings(album_id,workspace_id,project_id,photo_id,revision,updated_at_ms,updated_by,last_request_id)
             SELECT a.id,a.workspace_id,a.project_id,?,1,?,?,?
             FROM albums a JOIN workspaces w ON w.id=a.workspace_id
             WHERE a.id=? AND w.owner_user_id=?
               AND NOT EXISTS(SELECT 1 FROM album_cover_settings s WHERE s.album_id=a.id)`,
          )
          .bind(
            body.photoId,
            now,
            ownerId,
            body.requestId,
            current.album_id,
            ownerId,
          )
      : db
          .prepare(
            `UPDATE album_cover_settings SET photo_id=?,revision=?,updated_at_ms=?,updated_by=?,last_request_id=?
             WHERE album_id=? AND revision=?`,
          )
          .bind(
            body.photoId,
            next,
            now,
            ownerId,
            body.requestId,
            current.album_id,
            currentRevision,
          );
  const audit = db
    .prepare(
      `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,action,before_json,after_json,request_id)
       SELECT ?,'user',?,?,?,?,?,?,'album.cover_changed',?,?,?
       WHERE EXISTS(SELECT 1 FROM album_cover_settings s WHERE s.album_id=? AND s.revision=? AND s.last_request_id=?)`,
    )
    .bind(
      'album-cover:' + current.album_id + ':' + next,
      ownerId,
      sessionId,
      current.workspace_id,
      current.project_id,
      current.album_id,
      body.photoId,
      JSON.stringify({ photoId: current.photo_id, revision: currentRevision }),
      JSON.stringify({ photoId: body.photoId, revision: next }),
      body.requestId,
      current.album_id,
      next,
      body.requestId,
    );
  let results: D1Result[];
  try {
    results = await db.batch([write, audit]);
  } catch (error) {
    conflict(error);
  }
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
    throw new WorkspaceFailure('COVER_SETTINGS_REVISION_CONFLICT', 409);
  return readAlbumCover(db, ownerId, current.album_id);
}

export async function changeProjectCover(
  db: D1Database,
  ownerId: string,
  sessionId: string,
  projectId: string,
  input: unknown,
): Promise<ProjectCover> {
  const parsed = projectCoverChangeSchema.safeParse(input);
  if (!parsed.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const body = parsed.data;
  const current = await ownedProject(db, ownerId, projectId);
  const currentRevision = current.revision ?? 0;
  if (current.last_request_id === body.requestId) {
    if (current.album_id === body.albumId)
      return {
        projectId: current.project_id,
        albumId: current.album_id,
        revision: currentRevision,
      };
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  }
  if (body.expectedRevision !== currentRevision)
    throw new WorkspaceFailure('COVER_SETTINGS_REVISION_CONFLICT', 409);
  if (body.albumId !== null) {
    const album = await db
      .prepare(
        `SELECT 1 AS ok FROM albums a
         WHERE a.id=? AND a.project_id=? AND a.workspace_id=? AND a.state NOT IN('deleting','deleted')`,
      )
      .bind(body.albumId, current.project_id, current.workspace_id)
      .first();
    if (!album) throw new WorkspaceFailure('NOT_FOUND', 404);
  }
  const next = currentRevision + 1;
  const now = Date.now();
  const write =
    currentRevision === 0
      ? db
          .prepare(
            `INSERT INTO project_cover_settings(project_id,workspace_id,album_id,revision,updated_at_ms,updated_by,last_request_id)
             SELECT p.id,p.workspace_id,?,1,?,?,?
             FROM projects p JOIN workspaces w ON w.id=p.workspace_id
             WHERE p.id=? AND w.owner_user_id=?
               AND NOT EXISTS(SELECT 1 FROM project_cover_settings s WHERE s.project_id=p.id)`,
          )
          .bind(
            body.albumId,
            now,
            ownerId,
            body.requestId,
            current.project_id,
            ownerId,
          )
      : db
          .prepare(
            `UPDATE project_cover_settings SET album_id=?,revision=?,updated_at_ms=?,updated_by=?,last_request_id=?
             WHERE project_id=? AND revision=?`,
          )
          .bind(
            body.albumId,
            next,
            now,
            ownerId,
            body.requestId,
            current.project_id,
            currentRevision,
          );
  const audit = db
    .prepare(
      `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id)
       SELECT ?,'user',?,?,?,?,?,'project.cover_changed',?,?,?
       WHERE EXISTS(SELECT 1 FROM project_cover_settings s WHERE s.project_id=? AND s.revision=? AND s.last_request_id=?)`,
    )
    .bind(
      'project-cover:' + current.project_id + ':' + next,
      ownerId,
      sessionId,
      current.workspace_id,
      current.project_id,
      body.albumId,
      JSON.stringify({ albumId: current.album_id, revision: currentRevision }),
      JSON.stringify({ albumId: body.albumId, revision: next }),
      body.requestId,
      current.project_id,
      next,
      body.requestId,
    );
  let results: D1Result[];
  try {
    results = await db.batch([write, audit]);
  } catch (error) {
    conflict(error);
  }
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
    throw new WorkspaceFailure('COVER_SETTINGS_REVISION_CONFLICT', 409);
  return {
    projectId: current.project_id,
    albumId: body.albumId,
    revision: next,
  };
}
