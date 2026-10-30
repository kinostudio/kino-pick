-- Busy guards supplement current authorization and idempotency; they must not
-- expose foreign resource state or reject a historical successful replay.
DROP TRIGGER content_archive_upload_guard;
DROP TRIGGER content_archive_processing_guard;
CREATE TRIGGER content_archive_upload_guard BEFORE INSERT ON request_commands
WHEN NEW.operation IN('project.archived','album.archived')
  AND NOT EXISTS(SELECT 1 FROM request_commands r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_workflow_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM upload_sessions u JOIN workspaces w ON w.id=u.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE w.owner_user_id=NEW.actor_id AND u.status='reserved'
      AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id)
      AND ((NEW.operation='project.archived' AND u.project_id=NEW.resource_id) OR (NEW.operation='album.archived' AND u.album_id=NEW.resource_id))
  ) THEN RAISE(ABORT,'UPLOADS_IN_PROGRESS') END;
END;
CREATE TRIGGER content_archive_processing_guard BEFORE INSERT ON request_commands
WHEN NEW.operation IN('project.archived','album.archived')
  AND NOT EXISTS(SELECT 1 FROM request_commands r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_workflow_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN photos p ON p.id=a.photo_id
    JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE w.owner_user_id=NEW.actor_id AND j.status IN('queued','running','retryable','needs_review')
      AND ((NEW.operation='project.archived' AND p.project_id=NEW.resource_id) OR (NEW.operation='album.archived' AND p.album_id=NEW.resource_id))
  ) THEN RAISE(ABORT,'PROCESSING_IN_PROGRESS') END;
END;
