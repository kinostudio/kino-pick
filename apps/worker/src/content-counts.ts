import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';

// Card counts for the Owner lists, kept out of the shared project/album
// contracts. Ownership and a live Owner session are checked in SQL.

const OWNER_SESSION = `JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000`;

export async function projectAlbumCounts(
  db: D1Database,
  ownerId: string,
  sessionId: string,
  workspaceId: string,
) {
  const id = z.uuid().safeParse(workspaceId);
  if (!id.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const owned = await db
    .prepare(
      `SELECT 1 FROM workspaces w ${OWNER_SESSION} WHERE w.id=? AND w.owner_user_id=?`,
    )
    .bind(sessionId, id.data, ownerId)
    .first();
  if (!owned) throw new WorkspaceFailure('NOT_FOUND', 404);
  const rows = await db
    .prepare(
      `SELECT a.project_id AS id,count(*) AS albums FROM albums a
       WHERE a.workspace_id=? AND a.state NOT IN('deleting','deleted')
       GROUP BY a.project_id`,
    )
    .bind(id.data)
    .all<{ id: string; albums: number }>();
  return { counts: rows.results };
}

export async function albumPhotoCounts(
  db: D1Database,
  ownerId: string,
  sessionId: string,
  projectId: string,
) {
  const id = z.uuid().safeParse(projectId);
  if (!id.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const project = await db
    .prepare(
      `SELECT p.workspace_id AS workspaceId FROM projects p JOIN workspaces w ON w.id=p.workspace_id ${OWNER_SESSION}
       WHERE p.id=? AND w.owner_user_id=?`,
    )
    .bind(sessionId, id.data, ownerId)
    .first<{ workspaceId: string }>();
  if (!project) throw new WorkspaceFailure('NOT_FOUND', 404);
  // A photo counts once it has a current version (upload completed).
  const rows = await db
    .prepare(
      `SELECT h.album_id AS id,count(*) AS photos FROM photo_version_heads h
       WHERE h.workspace_id=? AND h.project_id=?
       GROUP BY h.album_id`,
    )
    .bind(project.workspaceId, id.data)
    .all<{ id: string; photos: number }>();
  return { counts: rows.results };
}
