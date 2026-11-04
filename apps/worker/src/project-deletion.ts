import { z } from 'zod';
import { contentDeleteSchema } from '../../../packages/contracts/src/projects';
import { WorkspaceFailure } from './workspaces';

// Parent records remain tombstones; albums must reclaim their payloads first.
export async function deleteEmptyProject(
  db: D1Database,
  actorId: string,
  sessionId: string,
  resourceId: string,
  input: unknown,
) {
  const id = z.uuid().parse(resourceId),
    body = contentDeleteSchema.parse(input);
  const identity =
    "EXISTS(SELECT 1 FROM workspaces w JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE w.id=p.workspace_id AND w.owner_user_id=?)";
  const target = await db
    .prepare(`SELECT p.* FROM projects p WHERE p.id=? AND ${identity}`)
    .bind(id, sessionId, actorId)
    .first<Record<string, unknown>>();
  if (!target) throw new WorkspaceFailure('NOT_FOUND', 404);
  const replay = async () => {
    const row = await db
      .prepare(
        "SELECT actor_id,project_id,after_json FROM audit_events WHERE action='project.deleted' AND request_id=?",
      )
      .bind(body.requestId)
      .first<{ actor_id: string; project_id: string; after_json: string }>();
    if (!row) return null;
    const after = JSON.parse(row.after_json) as Record<string, unknown>;
    if (
      row.actor_id !== actorId ||
      row.project_id !== id ||
      after.confirmationName !== body.confirmationName ||
      after.expectedRevision !== body.expectedRevision
    )
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    return { deleted: true as const, id };
  };
  const previous = await replay();
  if (previous) return previous;
  if (target.name !== body.confirmationName)
    throw new WorkspaceFailure('DELETE_CONFIRMATION_REQUIRED', 409);
  if (target.revision !== body.expectedRevision)
    throw new WorkspaceFailure('CONCURRENT_MODIFICATION', 409);
  if (body.expectedRevision === 2147483647)
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
  const eventId = crypto.randomUUID();
  const idle = `p.status IN('draft','archived','delivered')
    AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.project_id=p.id AND e.action='project.deleted')
    AND NOT EXISTS(SELECT 1 FROM albums a WHERE a.project_id=p.id AND a.state<>'deleted')
    AND NOT EXISTS(SELECT 1 FROM photos photo JOIN photo_assets a ON a.photo_id=photo.id LEFT JOIN manual_album_deletion_items i ON i.asset_id=a.id AND i.status='reclaimed' WHERE photo.project_id=p.id AND i.asset_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u JOIN storage_reservations r ON r.id=u.id WHERE u.project_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u JOIN upload_authorizations g ON g.upload_session_id=u.id WHERE u.project_id=p.id AND g.expires_at_ms>unixepoch('subsec')*1000)`;
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,action,before_json,after_json,request_id) SELECT ?,'user',?,?,p.workspace_id,p.id,'project.deleted',json_object('name',p.name,'revision',p.revision,'status',p.status),?,? FROM projects p WHERE p.id=? AND p.name=? AND p.revision=? AND ${identity} AND ${idle}`,
        )
        .bind(
          eventId,
          actorId,
          sessionId,
          JSON.stringify({
            deleted: true,
            confirmationName: body.confirmationName,
            expectedRevision: body.expectedRevision,
            revision: body.expectedRevision + 1,
          }),
          body.requestId,
          id,
          body.confirmationName,
          body.expectedRevision,
          sessionId,
          actorId,
        ),
      db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status=NULL,revision=revision+1 WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM audit_events WHERE event_id=?)",
        )
        .bind(id, body.expectedRevision, eventId),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
      throw new WorkspaceFailure('CONTENT_NOT_EMPTY_OR_IDLE', 409);
  } catch (error) {
    const concurrent = await replay();
    if (concurrent) return concurrent;
    throw error;
  }
  return { deleted: true as const, id };
}
