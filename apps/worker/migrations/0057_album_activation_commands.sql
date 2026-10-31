-- Owner-confirmed draft-to-active transitions use a dedicated append-only ledger.
-- This leaves the historical request_commands operation CHECK untouched.
CREATE TABLE album_activation_commands (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL CHECK(request_id=lower(request_id)),
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision BETWEEN 1 AND 2147483646),
  confirm_activate INTEGER NOT NULL CHECK(confirm_activate IN (0,1)),
  created_at_ms INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  PRIMARY KEY(actor_id,request_id)
);

CREATE TRIGGER album_activation_command_guard
BEFORE INSERT ON album_activation_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Reject every duplicate, including identical REPLACE attempts. API replay is
  -- returned by the service before it reaches INSERT.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM album_activation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN NEW.request_id<>lower(NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_NOT_NORMALIZED') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM version_approval_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id AND lower(f.request_id)=lower(NEW.request_id))
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN NEW.confirm_activate<>1
    THEN RAISE(ABORT,'ACTIVATION_CONFIRMATION_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    JOIN workspaces w ON w.id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    JOIN workspaces w ON w.id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND w.owner_user_id=NEW.actor_id
      AND (a.state<>'draft' OR p.status IN('archived','deleting','deleted'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    JOIN workspaces w ON w.id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND w.owner_user_id=NEW.actor_id
      AND a.revision<>NEW.expected_revision
  ) THEN RAISE(ABORT,'CONCURRENT_MODIFICATION') END;
END;

CREATE TRIGGER album_activation_apply
AFTER INSERT ON album_activation_commands
BEGIN
  UPDATE albums SET state='active',revision=revision+1
  WHERE id=NEW.album_id AND workspace_id=NEW.workspace_id
    AND project_id=NEW.project_id AND state='draft'
    AND revision=NEW.expected_revision;
  SELECT CASE WHEN changes()<>1
    THEN RAISE(ABORT,'CONCURRENT_MODIFICATION') END;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    action,before_json,after_json,request_id
  )
  SELECT
    'album-activation:'||NEW.actor_id||':'||NEW.request_id,
    'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    'album.activated',
    json_object(
      'id',a.id,'workspaceId',a.workspace_id,'projectId',a.project_id,
      'name',a.name,'state','draft',
      'isPinned',json(CASE WHEN a.is_pinned=1 THEN 'true' ELSE 'false' END),
      'legalHold',json(CASE WHEN a.legal_hold=1 THEN 'true' ELSE 'false' END),
      'revision',NEW.expected_revision,'createdAt',a.created_at
    ),
    json_object(
      'id',a.id,'workspaceId',a.workspace_id,'projectId',a.project_id,
      'name',a.name,'state',a.state,
      'isPinned',json(CASE WHEN a.is_pinned=1 THEN 'true' ELSE 'false' END),
      'legalHold',json(CASE WHEN a.legal_hold=1 THEN 'true' ELSE 'false' END),
      'revision',a.revision,'createdAt',a.created_at
    ),
    NEW.request_id
  FROM albums a
  WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
    AND a.project_id=NEW.project_id;
END;

CREATE TRIGGER album_activation_state_guard
BEFORE UPDATE OF state ON albums
WHEN OLD.state='draft' AND NEW.state='active'
BEGIN
  SELECT CASE WHEN
    NEW.revision<>OLD.revision+1
    OR NEW.workspace_id<>OLD.workspace_id
    OR NEW.project_id<>OLD.project_id
    OR NEW.name<>OLD.name
    OR NEW.is_pinned<>OLD.is_pinned
    OR NEW.legal_hold<>OLD.legal_hold
    OR NEW.created_at<>OLD.created_at
    OR NEW.archived_from_state IS NOT OLD.archived_from_state
    OR NOT EXISTS (
      SELECT 1 FROM album_activation_commands c
      WHERE c.album_id=OLD.id AND c.workspace_id=OLD.workspace_id
        AND c.project_id=OLD.project_id AND c.expected_revision=OLD.revision
        AND c.confirm_activate=1
        AND NOT EXISTS (
          SELECT 1 FROM audit_events e
          WHERE e.event_id='album-activation:'||c.actor_id||':'||c.request_id
        )
    )
  THEN RAISE(ABORT,'ALBUM_ACTIVATION_COMMAND_REQUIRED') END;
END;

CREATE TRIGGER album_activation_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action='album.activated'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM album_activation_commands c
    JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id
      AND a.project_id=c.project_id
    WHERE NEW.event_id='album-activation:'||c.actor_id||':'||c.request_id
      AND NEW.actor_type='user' AND NEW.actor_id=c.actor_id
      AND NEW.session_id=c.session_id AND NEW.workspace_id=c.workspace_id
      AND NEW.project_id=c.project_id AND NEW.album_id=c.album_id
      AND NEW.request_id=c.request_id
      AND json_valid(NEW.before_json) AND json_valid(NEW.after_json)
      AND json_extract(NEW.before_json,'$.id')=a.id
      AND json_extract(NEW.before_json,'$.workspaceId')=a.workspace_id
      AND json_extract(NEW.before_json,'$.projectId')=a.project_id
      AND json_extract(NEW.before_json,'$.name')=a.name
      AND json_extract(NEW.before_json,'$.state')='draft'
      AND json_extract(NEW.before_json,'$.isPinned')=a.is_pinned
      AND json_extract(NEW.before_json,'$.legalHold')=a.legal_hold
      AND json_extract(NEW.before_json,'$.revision')=c.expected_revision
      AND json_extract(NEW.before_json,'$.createdAt')=a.created_at
      AND json_extract(NEW.after_json,'$.id')=a.id
      AND json_extract(NEW.after_json,'$.workspaceId')=a.workspace_id
      AND json_extract(NEW.after_json,'$.projectId')=a.project_id
      AND json_extract(NEW.after_json,'$.name')=a.name
      AND json_extract(NEW.after_json,'$.state')='active'
      AND json_extract(NEW.after_json,'$.isPinned')=a.is_pinned
      AND json_extract(NEW.after_json,'$.legalHold')=a.legal_hold
      AND json_extract(NEW.after_json,'$.revision')=c.expected_revision+1
      AND json_extract(NEW.after_json,'$.createdAt')=a.created_at
      AND a.state='active' AND a.revision=c.expected_revision+1
  ) THEN RAISE(ABORT,'ALBUM_ACTIVATION_AUDIT_INVALID') END;
END;

CREATE TRIGGER album_activation_commands_no_update
BEFORE UPDATE ON album_activation_commands
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_ACTIVATION_COMMAND'); END;

CREATE TRIGGER album_activation_commands_no_delete
BEFORE DELETE ON album_activation_commands
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_ACTIVATION_COMMAND'); END;

-- Reciprocal case-folded Owner request namespace, following migration 0056.
CREATE TRIGGER album_activation_workspace_commands_namespace
BEFORE INSERT ON workspace_commands
WHEN NOT EXISTS (SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_request_commands_namespace
BEFORE INSERT ON request_commands
WHEN NOT EXISTS (SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_upload_requests_namespace
BEFORE INSERT ON upload_requests
WHEN NOT EXISTS (SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_upload_workflow_requests_namespace
BEFORE INSERT ON upload_workflow_requests
WHEN NOT EXISTS (SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_processing_review_commands_namespace
BEFORE INSERT ON processing_review_commands
WHEN NOT EXISTS (SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_invite_revocation_commands_namespace
BEFORE INSERT ON invite_revocation_commands
WHEN NOT EXISTS (SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_invite_creation_commands_namespace
BEFORE INSERT ON invite_creation_commands
WHEN NOT EXISTS (SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_selection_policy_commands_namespace
BEFORE INSERT ON selection_policy_commands
WHEN NOT EXISTS (SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_selection_policy_configuration_commands_namespace
BEFORE INSERT ON selection_policy_configuration_commands
WHEN NOT EXISTS (SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_shared_review_owner_commands_namespace
BEFORE INSERT ON shared_review_owner_commands
WHEN NOT EXISTS (SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_photo_version_head_commands_namespace
BEFORE INSERT ON photo_version_head_commands
WHEN NOT EXISTS (SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_project_versioning_commands_namespace
BEFORE INSERT ON project_versioning_commands
WHEN NOT EXISTS (SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_owner_comment_commands_namespace
BEFORE INSERT ON owner_comment_commands
WHEN NOT EXISTS (SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_owner_comment_processing_commands_namespace
BEFORE INSERT ON owner_comment_processing_commands
WHEN NOT EXISTS (SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_owner_external_intents_namespace
BEFORE INSERT ON owner_external_intents
WHEN NOT EXISTS (SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_owner_annotation_processing_commands_namespace
BEFORE INSERT ON owner_annotation_processing_commands
WHEN NOT EXISTS (SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_owner_annotation_commands_namespace
BEFORE INSERT ON owner_annotation_commands
WHEN NOT EXISTS (SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_project_matching_rule_commands_namespace
BEFORE INSERT ON project_matching_rule_commands
WHEN NOT EXISTS (SELECT 1 FROM project_matching_rule_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_version_approval_owner_commands_namespace
BEFORE INSERT ON version_approval_owner_commands
WHEN NOT EXISTS (SELECT 1 FROM version_approval_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_workspace_image_processing_policy_commands_namespace
BEFORE INSERT ON workspace_image_processing_policy_commands
WHEN NOT EXISTS (SELECT 1 FROM workspace_image_processing_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER album_activation_upload_key_fences_namespace
BEFORE INSERT ON upload_key_fences
WHEN NEW.actor_type='user' AND NOT EXISTS (SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
AND EXISTS (SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
