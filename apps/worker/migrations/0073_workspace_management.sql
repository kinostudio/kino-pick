-- Workspace names and tombstones are additive; historical rows and audit remain.
PRAGMA foreign_keys=ON;

ALTER TABLE workspaces ADD COLUMN deleted_at_ms INTEGER
  CHECK(deleted_at_ms IS NULL OR (typeof(deleted_at_ms)='integer' AND deleted_at_ms>0));

CREATE TABLE workspace_management_commands(
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('workspace.renamed','workspace.deleted')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms>0),
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  PRIMARY KEY(actor_id,request_id)
) WITHOUT ROWID;

CREATE TRIGGER workspace_management_command_guard
BEFORE INSERT ON workspace_management_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.operation='workspace.renamed' AND (
      (SELECT count(*) FROM json_each(NEW.payload_json))<>2
      OR json_type(NEW.payload_json,'$.name') IS NOT 'text'
      OR json_type(NEW.payload_json,'$.expectedName') IS NOT 'text'
      OR length(trim(json_extract(NEW.payload_json,'$.name'))) NOT BETWEEN 1 AND 120
      OR length(trim(json_extract(NEW.payload_json,'$.expectedName'))) NOT BETWEEN 1 AND 120
    ) OR NEW.operation='workspace.deleted' AND (
      (SELECT count(*) FROM json_each(NEW.payload_json))<>1
      OR json_type(NEW.payload_json,'$.expectedName') IS NOT 'text'
      OR length(trim(json_extract(NEW.payload_json,'$.expectedName'))) NOT BETWEEN 1 AND 120
    ) THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM workspace_management_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM workspace_management_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM request_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) OR EXISTS(
    SELECT 1 FROM upload_requests c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) OR EXISTS(
    SELECT 1 FROM workspace_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM workspaces w
    WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
      AND w.deleted_at_ms IS NULL
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN json_extract(NEW.payload_json,'$.expectedName')<>
    (SELECT name FROM workspaces WHERE id=NEW.workspace_id)
    THEN RAISE(ABORT,'CONCURRENT_MODIFICATION') END;
  SELECT CASE WHEN NEW.operation='workspace.renamed' AND EXISTS(
    SELECT 1 FROM workspaces w
    WHERE w.owner_user_id=NEW.actor_id AND w.id<>NEW.workspace_id
      AND w.deleted_at_ms IS NULL AND w.name=json_extract(NEW.payload_json,'$.name')
  ) THEN RAISE(ABORT,'WORKSPACE_NAME_CONFLICT') END;
  SELECT CASE WHEN NEW.operation='workspace.deleted' AND (
    EXISTS(SELECT 1 FROM projects p WHERE p.workspace_id=NEW.workspace_id
      AND (p.status<>'archived' OR NOT EXISTS(SELECT 1 FROM audit_events e
        WHERE e.project_id=p.id AND e.workspace_id=NEW.workspace_id
          AND e.action='project.deleted')))
    OR EXISTS(SELECT 1 FROM pending_upload_storage_reservations r
      WHERE r.workspace_id=NEW.workspace_id)
    OR EXISTS(SELECT 1 FROM upload_sessions u
      JOIN upload_authorizations g ON g.upload_session_id=u.id
      WHERE u.workspace_id=NEW.workspace_id AND g.expires_at_ms>NEW.created_at_ms)
    OR EXISTS(SELECT 1 FROM image_processing_jobs j
      JOIN photo_assets a ON a.id=j.id
      WHERE a.workspace_id=NEW.workspace_id
        AND (j.status IN('queued','running','retryable','needs_review')
          OR j.reserved_bytes<>0))
    OR EXISTS(SELECT 1 FROM workspace_storage_usage u
      WHERE u.workspace_id=NEW.workspace_id
        AND (u.used_bytes<>0 OR u.reserved_bytes<>0))
  ) THEN RAISE(ABORT,'WORKSPACE_NOT_EMPTY') END;
END;

CREATE TRIGGER workspace_management_command_apply
AFTER INSERT ON workspace_management_commands BEGIN
  UPDATE workspaces SET
    name=CASE WHEN NEW.operation='workspace.renamed'
      THEN json_extract(NEW.payload_json,'$.name') ELSE name END,
    deleted_at_ms=CASE WHEN NEW.operation='workspace.deleted'
      THEN NEW.created_at_ms ELSE deleted_at_ms END
  WHERE id=NEW.workspace_id;
  UPDATE workspace_management_commands SET
    before_json=(SELECT json_object(
      'id',w.id,'name',json_extract(NEW.payload_json,'$.expectedName'),
      'ownerUserId',w.owner_user_id,'role','workspace_owner',
      'createdAt',w.created_at,'quotaBytes',w.quota_bytes,
      'deletedAtMs',NULL
    ) FROM workspaces w WHERE w.id=NEW.workspace_id),
    result_json=CASE WHEN NEW.operation='workspace.renamed' THEN (
      SELECT json_object('id',w.id,'name',w.name,'ownerUserId',w.owner_user_id,
        'role','workspace_owner','createdAt',w.created_at,'quotaBytes',w.quota_bytes)
      FROM workspaces w WHERE w.id=NEW.workspace_id
    ) ELSE (
      SELECT json_object('id',w.id,'name',w.name,'deletedAtMs',w.deleted_at_ms)
      FROM workspaces w WHERE w.id=NEW.workspace_id
    ) END
  WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id;
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,action,
    before_json,after_json,request_id
  )
  SELECT 'workspace-management:'||c.actor_id||':'||c.request_id,
    'user',c.actor_id,c.session_id,c.workspace_id,c.operation,
    c.before_json,c.result_json,c.request_id
  FROM workspace_management_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id;
END;

CREATE TRIGGER workspace_management_command_no_update
BEFORE UPDATE ON workspace_management_commands
WHEN OLD.result_json IS NOT NULL
  OR NEW.actor_id<>OLD.actor_id OR NEW.request_id<>OLD.request_id
  OR NEW.operation<>OLD.operation OR NEW.payload_json<>OLD.payload_json
  OR NEW.session_id<>OLD.session_id OR NEW.workspace_id<>OLD.workspace_id
  OR NEW.created_at_ms<>OLD.created_at_ms
  OR (OLD.before_json IS NOT NULL AND NEW.before_json IS NOT OLD.before_json)
  OR NEW.before_json IS NULL OR NEW.result_json IS NULL
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WORKSPACE_COMMAND'); END;
CREATE TRIGGER workspace_management_command_no_delete
BEFORE DELETE ON workspace_management_commands
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WORKSPACE_COMMAND'); END;

CREATE TRIGGER workspace_management_request_namespace_commands
BEFORE INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM workspace_management_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER workspace_management_request_namespace_uploads
BEFORE INSERT ON upload_requests
WHEN EXISTS(SELECT 1 FROM workspace_management_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER workspace_management_request_namespace_legacy
BEFORE INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM workspace_management_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER workspace_management_projects_insert_guard
BEFORE INSERT ON projects
WHEN EXISTS(SELECT 1 FROM workspaces w
  WHERE w.id=NEW.workspace_id AND w.deleted_at_ms IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'NOT_FOUND'); END;
CREATE TRIGGER workspace_management_projects_update_guard
BEFORE UPDATE ON projects
WHEN EXISTS(SELECT 1 FROM workspaces w
  WHERE w.id=NEW.workspace_id AND w.deleted_at_ms IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'NOT_FOUND'); END;

CREATE TRIGGER workspace_management_tombstone_immutable
BEFORE UPDATE OF deleted_at_ms ON workspaces
WHEN OLD.deleted_at_ms IS NOT NULL AND NEW.deleted_at_ms IS NOT OLD.deleted_at_ms
BEGIN SELECT RAISE(ABORT,'WORKSPACE_DELETED'); END;
CREATE TRIGGER workspace_management_tombstone_command_required
BEFORE UPDATE OF deleted_at_ms ON workspaces
WHEN OLD.deleted_at_ms IS NULL AND NEW.deleted_at_ms IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM workspace_management_commands c
    WHERE c.workspace_id=OLD.id AND c.operation='workspace.deleted'
      AND c.created_at_ms=NEW.deleted_at_ms)
BEGIN SELECT RAISE(ABORT,'WORKSPACE_DELETE_COMMAND_REQUIRED'); END;
CREATE TRIGGER workspace_management_name_immutable
BEFORE UPDATE OF name ON workspaces
WHEN OLD.deleted_at_ms IS NOT NULL AND NEW.name<>OLD.name
BEGIN SELECT RAISE(ABORT,'WORKSPACE_DELETED'); END;
CREATE TRIGGER workspace_management_no_hard_delete
BEFORE DELETE ON workspaces
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WORKSPACE'); END;
