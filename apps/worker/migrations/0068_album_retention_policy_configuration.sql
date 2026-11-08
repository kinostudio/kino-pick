-- Per-album retention preferences are owner-configurable; execution remains globally disabled.
PRAGMA foreign_keys=ON;

CREATE TABLE album_retention_policy_commands(
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  expected_owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision BETWEEN 0 AND 2147483647),
  inactive_days INTEGER NOT NULL CHECK(typeof(inactive_days)='integer' AND inactive_days BETWEEN 1 AND 36500),
  cleanup_allowed INTEGER NOT NULL CHECK(typeof(cleanup_allowed)='integer' AND cleanup_allowed IN(0,1)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(album_id,project_id,workspace_id) REFERENCES albums(id,project_id,workspace_id),
  CHECK(expected_owner_id=actor_id),
  CHECK(payload_json=json_object(
    'requestId',request_id,'expectedOwnerId',expected_owner_id,
    'expectedRevision',expected_revision,
    'cleanupAllowed',json(CASE WHEN cleanup_allowed=1 THEN 'true' ELSE 'false' END),
    'inactiveDays',inactive_days))
);

CREATE TABLE album_retention_policy_results(
  command_id TEXT PRIMARY KEY REFERENCES album_retention_policy_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE album_retention_policy_configurations(
  album_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  inactive_days INTEGER NOT NULL DEFAULT 90 CHECK(typeof(inactive_days)='integer' AND inactive_days BETWEEN 1 AND 36500),
  cleanup_allowed INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cleanup_allowed)='integer' AND cleanup_allowed IN(0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 2147483647),
  last_command_id TEXT UNIQUE REFERENCES album_retention_policy_commands(id),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  FOREIGN KEY(album_id,project_id,workspace_id) REFERENCES albums(id,project_id,workspace_id),
  CHECK((revision=0 AND last_command_id IS NULL) OR (revision>0 AND last_command_id IS NOT NULL))
);

INSERT INTO album_retention_policy_configurations(album_id,workspace_id,project_id,updated_at_ms)
SELECT id,workspace_id,project_id,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM albums;

CREATE INDEX album_retention_policy_configurations_workspace
  ON album_retention_policy_configurations(workspace_id,project_id,album_id);

CREATE TRIGGER album_retention_policy_configurations_no_delete
BEFORE DELETE ON album_retention_policy_configurations BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_RETENTION_POLICY_CONFIGURATION');
END;
CREATE TRIGGER album_retention_policy_commands_no_update
BEFORE UPDATE ON album_retention_policy_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_RETENTION_POLICY_COMMAND');
END;
CREATE TRIGGER album_retention_policy_commands_no_delete
BEFORE DELETE ON album_retention_policy_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_RETENTION_POLICY_COMMAND');
END;
CREATE TRIGGER album_retention_policy_results_no_update
BEFORE UPDATE ON album_retention_policy_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_RETENTION_POLICY_RESULT');
END;
CREATE TRIGGER album_retention_policy_results_no_delete
BEFORE DELETE ON album_retention_policy_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_RETENTION_POLICY_RESULT');
END;

CREATE TRIGGER album_retention_policy_configuration_insert_guard
BEFORE INSERT ON album_retention_policy_configurations BEGIN
  SELECT CASE WHEN NEW.revision<>0 OR NEW.last_command_id IS NOT NULL
    OR NEW.inactive_days<>90 OR NEW.cleanup_allowed<>0
    OR NOT EXISTS(SELECT 1 FROM albums a WHERE a.id=NEW.album_id
      AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id)
    THEN RAISE(ABORT,'INVALID_ALBUM_RETENTION_POLICY_DEFAULT') END;
END;
CREATE TRIGGER album_retention_policy_configuration_update_guard
BEFORE UPDATE ON album_retention_policy_configurations BEGIN
  SELECT CASE WHEN NEW.album_id<>OLD.album_id OR NEW.workspace_id<>OLD.workspace_id
    OR NEW.project_id<>OLD.project_id
    THEN RAISE(ABORT,'IMMUTABLE_ALBUM_RETENTION_POLICY_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM album_retention_policy_commands c
    JOIN album_retention_policy_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.album_id=NEW.album_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.expected_revision=OLD.revision AND NEW.revision=OLD.revision+1
      AND c.inactive_days=NEW.inactive_days AND c.cleanup_allowed=NEW.cleanup_allowed
      AND c.created_at_ms=NEW.updated_at_ms
      AND r.before_json=json_object('inactiveDays',OLD.inactive_days,
        'cleanupAllowed',json(CASE WHEN OLD.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
        'revision',OLD.revision)
      AND r.after_json=json_object('inactiveDays',NEW.inactive_days,
        'cleanupAllowed',json(CASE WHEN NEW.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
        'revision',NEW.revision)
      AND r.event_id='album-retention-policy:'||c.id
    ) THEN RAISE(ABORT,'INVALID_ALBUM_RETENTION_POLICY_WITNESS') END;
END;

CREATE TRIGGER albums_retention_policy_default
AFTER INSERT ON albums BEGIN
  INSERT INTO album_retention_policy_configurations(
    album_id,workspace_id,project_id,inactive_days,cleanup_allowed,revision,last_command_id,updated_at_ms
  ) VALUES(NEW.id,NEW.workspace_id,NEW.project_id,90,0,0,NULL,
    CAST(unixepoch('subsec')*1000 AS INTEGER));
END;

CREATE VIEW effective_album_retention_policy AS
SELECT a.id AS album_id,a.workspace_id,a.project_id,
  COALESCE(c.inactive_days,90) AS inactive_days,
  COALESCE(c.cleanup_allowed,0) AS cleanup_allowed,
  COALESCE(c.revision,0) AS revision
FROM albums a
LEFT JOIN album_retention_policy_configurations c
  ON c.album_id=a.id AND c.workspace_id=a.workspace_id AND c.project_id=a.project_id;

CREATE TRIGGER album_retention_policy_command_guard
BEFORE INSERT ON album_retention_policy_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a JOIN workspaces w ON w.id=a.workspace_id
      JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id
      AND (a.state IN('deleting','deleted') OR p.status IN('deleting','deleted'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM album_retention_policy_configurations c
    WHERE c.album_id=NEW.album_id AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id
  ) THEN RAISE(ABORT,'ALBUM_RETENTION_POLICY_CONFIGURATION_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.expected_owner_id<>NEW.actor_id
    THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.payload_json<>NEW.payload_json
  ) OR EXISTS(
    SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='album.retention_policy_changed'
      AND e.request_id=NEW.request_id
      AND NOT EXISTS(SELECT 1 FROM album_retention_policy_commands c
        WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
          AND c.payload_json=NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.expected_revision<>COALESCE((
    SELECT revision FROM album_retention_policy_configurations WHERE album_id=NEW.album_id
  ),0) THEN RAISE(ABORT,'ALBUM_RETENTION_POLICY_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.expected_revision=2147483647 AND EXISTS(
    SELECT 1 FROM album_retention_policy_configurations c
    WHERE c.album_id=NEW.album_id
      AND (c.inactive_days<>NEW.inactive_days OR c.cleanup_allowed<>NEW.cleanup_allowed)
  ) THEN RAISE(ABORT,'ALBUM_RETENTION_POLICY_REVISION_EXHAUSTED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events e
    WHERE e.action='album.retention_policy_changed' AND e.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

CREATE TRIGGER album_retention_policy_audit_guard
BEFORE INSERT ON audit_events WHEN NEW.action='album.retention_policy_changed' BEGIN
  SELECT CASE WHEN NEW.actor_type IS NOT 'user' OR NEW.guest_session_id IS NOT NULL
    OR NEW.photo_id IS NOT NULL OR NEW.version_id IS NOT NULL
    OR NEW.before_json IS NULL OR NEW.after_json IS NULL
    OR NOT EXISTS(
      SELECT 1 FROM album_retention_policy_commands c
      JOIN album_retention_policy_results r ON r.command_id=c.id
      JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id
        AND a.project_id=c.project_id
      JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=c.actor_id
      JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=c.session_id
        AND s.expiresAt>unixepoch('subsec')*1000
      WHERE r.event_id IS NOT NULL AND r.before_json<>r.after_json
        AND r.event_id=NEW.event_id AND r.before_json=NEW.before_json
        AND r.after_json=NEW.after_json AND r.occurred_at_utc=NEW.occurred_at_utc
        AND r.event_id='album-retention-policy:'||c.id
        AND json_extract(r.after_json,'$.inactiveDays')=c.inactive_days
        AND json_extract(r.after_json,'$.cleanupAllowed')=c.cleanup_allowed
        AND json_extract(r.after_json,'$.revision')=c.expected_revision+1
        AND json_extract(r.result_json,'$.albumId')=c.album_id
        AND json_extract(r.result_json,'$.inactiveDays')=c.inactive_days
        AND json_extract(r.result_json,'$.cleanupAllowed')=c.cleanup_allowed
        AND json_extract(r.result_json,'$.revision')=c.expected_revision+1
        AND json_extract(r.result_json,'$.automaticDeletionEnabled')=0
        AND json_extract(r.result_json,'$.dryRun')=1
        AND c.actor_id=NEW.actor_id AND c.session_id=NEW.session_id
        AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
        AND c.album_id=NEW.album_id AND c.request_id=NEW.request_id
        AND NEW.action='album.retention_policy_changed'
    ) THEN RAISE(ABORT,'INVALID_ALBUM_RETENTION_POLICY_AUDIT') END;
END;

CREATE TRIGGER album_retention_policy_command_apply
AFTER INSERT ON album_retention_policy_commands BEGIN
  INSERT INTO album_retention_policy_results(
    command_id,before_json,after_json,result_json,event_id,occurred_at_utc
  )
  SELECT NEW.id,
    json_object('inactiveDays',c.inactive_days,
      'cleanupAllowed',json(CASE WHEN c.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
      'revision',c.revision),
    json_object('inactiveDays',NEW.inactive_days,
      'cleanupAllowed',json(CASE WHEN NEW.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
      'revision',c.revision+CASE WHEN c.inactive_days<>NEW.inactive_days OR c.cleanup_allowed<>NEW.cleanup_allowed THEN 1 ELSE 0 END),
    json_object('albumId',NEW.album_id,'revision',c.revision+
      CASE WHEN c.inactive_days<>NEW.inactive_days OR c.cleanup_allowed<>NEW.cleanup_allowed THEN 1 ELSE 0 END,
      'cleanupAllowed',json(CASE WHEN NEW.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
      'inactiveDays',NEW.inactive_days,'automaticDeletionEnabled',json('false'),'dryRun',json('true')),
    CASE WHEN c.inactive_days<>NEW.inactive_days OR c.cleanup_allowed<>NEW.cleanup_allowed
      THEN 'album-retention-policy:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM album_retention_policy_configurations c WHERE c.album_id=NEW.album_id;

  UPDATE album_retention_policy_configurations
  SET inactive_days=NEW.inactive_days,cleanup_allowed=NEW.cleanup_allowed,
    revision=revision+1,last_command_id=NEW.id,updated_at_ms=NEW.created_at_ms
  WHERE album_id=NEW.album_id
    AND (inactive_days<>NEW.inactive_days OR cleanup_allowed<>NEW.cleanup_allowed);

  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    'album.retention_policy_changed',r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM album_retention_policy_results r
  WHERE r.command_id=NEW.id AND r.before_json<>r.after_json;
END;

-- Keep Owner request IDs isolated across every current Owner ledger in both
-- insertion directions. The existing ledgers and their guards stay unchanged.
CREATE TRIGGER album_retention_policy_request_namespace_guard
BEFORE INSERT ON album_retention_policy_commands BEGIN
  SELECT CASE WHEN NEW.request_id<>lower(NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_NOT_NORMALIZED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.payload_json=NEW.payload_json
  ) AND (
    EXISTS(SELECT 1 FROM album_retention_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM request_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_requests c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_workflow_requests c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM processing_review_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM invite_revocation_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM invite_creation_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM selection_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM shared_review_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM photo_version_head_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM project_versioning_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_comment_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_annotation_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_comment_processing_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_external_intents c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM version_approval_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM photographer_recommendation_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM album_activation_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_review_flags c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_key_fences c
      WHERE c.actor_type='user' AND c.actor_id=NEW.actor_id
        AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM project_matching_rule_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM manual_album_deletion_jobs c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM oracle_storage_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM photo_pin_commands c
      WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM human_photo_views h
      WHERE h.actor_type='user' AND h.actor_id=NEW.actor_id
        AND lower(h.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM audit_events e
      WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
        AND lower(e.request_id)=lower(NEW.request_id))
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER workspace_commands_album_retention_policy_namespace
AFTER INSERT ON workspace_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER request_commands_album_retention_policy_namespace
AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_album_retention_policy_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_requests_album_retention_policy_namespace
AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_commands_album_retention_policy_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_commands_album_retention_policy_namespace
AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_commands_album_retention_policy_namespace
AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_commands_album_retention_policy_namespace
AFTER INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_configuration_commands_album_retention_policy_namespace
AFTER INSERT ON selection_policy_configuration_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_owner_commands_album_retention_policy_namespace
AFTER INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photo_version_head_commands_album_retention_policy_namespace
AFTER INSERT ON photo_version_head_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER project_versioning_commands_album_retention_policy_namespace
AFTER INSERT ON project_versioning_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_comment_commands_album_retention_policy_namespace
AFTER INSERT ON owner_comment_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_annotation_commands_album_retention_policy_namespace
AFTER INSERT ON owner_annotation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_comment_processing_commands_album_retention_policy_namespace
AFTER INSERT ON owner_comment_processing_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_external_intents_album_retention_policy_namespace
AFTER INSERT ON owner_external_intents BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_annotation_processing_commands_album_retention_policy_namespace
AFTER INSERT ON owner_annotation_processing_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER version_approval_owner_commands_album_retention_policy_namespace
AFTER INSERT ON version_approval_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photographer_recommendation_commands_album_retention_policy_namespace
AFTER INSERT ON photographer_recommendation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER album_activation_commands_album_retention_policy_namespace
AFTER INSERT ON album_activation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_review_flags_album_retention_policy_namespace
AFTER INSERT ON upload_review_flags BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_key_fences_album_retention_policy_namespace
AFTER INSERT ON upload_key_fences WHEN NEW.actor_type='user' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER project_matching_rule_commands_album_retention_policy_namespace
AFTER INSERT ON project_matching_rule_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER workspace_image_processing_policy_commands_album_retention_policy_namespace
AFTER INSERT ON workspace_image_processing_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER manual_album_deletion_jobs_album_retention_policy_namespace
AFTER INSERT ON manual_album_deletion_jobs BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER oracle_storage_policy_commands_album_retention_policy_namespace
AFTER INSERT ON oracle_storage_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photo_pin_commands_album_retention_policy_namespace
AFTER INSERT ON photo_pin_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER human_photo_views_album_retention_policy_namespace
AFTER INSERT ON human_photo_views WHEN NEW.actor_type='user' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER album_retention_policy_audit_namespace
BEFORE INSERT ON audit_events WHEN NEW.actor_type='user' BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM album_retention_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
      AND NOT EXISTS(
        SELECT 1 FROM album_retention_policy_results r
        WHERE r.command_id=c.id AND r.event_id IS NOT NULL
          AND r.before_json<>r.after_json
          AND r.event_id='album-retention-policy:'||c.id
          AND NEW.event_id=r.event_id
          AND NEW.action='album.retention_policy_changed'
          AND NEW.actor_id=c.actor_id AND NEW.session_id=c.session_id
          AND NEW.workspace_id=c.workspace_id AND NEW.project_id=c.project_id
          AND NEW.album_id=c.album_id AND NEW.photo_id IS NULL
          AND NEW.version_id IS NULL AND NEW.guest_session_id IS NULL
          AND NEW.request_id=c.request_id AND NEW.before_json=r.before_json
          AND NEW.after_json=r.after_json
          AND NEW.occurred_at_utc=r.occurred_at_utc
      )
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
