-- Owner-only logical-photo pin state with append-only commands and audit events.
-- Recovery: retain command/result/audit ledgers; repair forward. No guest access.
PRAGMA foreign_keys=ON;

CREATE TABLE photo_pin_commands(
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND request_id=lower(request_id)
    AND request_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
  ),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  photo_id TEXT NOT NULL REFERENCES photos(id),
  expected_revision INTEGER NOT NULL CHECK(
    typeof(expected_revision)='integer' AND expected_revision BETWEEN 0 AND 9007199254740990
  ),
  is_pinned INTEGER NOT NULL CHECK(typeof(is_pinned)='integer' AND is_pinned IN(0,1)),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'
    AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(actor_id,request_id)
);
CREATE UNIQUE INDEX photo_pin_commands_request_ci
  ON photo_pin_commands(actor_id,lower(request_id));
CREATE INDEX photo_pin_commands_photo_page
  ON photo_pin_commands(photo_id,created_at_ms DESC,id DESC);

CREATE TABLE photo_pin_states(
  photo_id TEXT PRIMARY KEY NOT NULL REFERENCES photos(id),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  is_pinned INTEGER NOT NULL CHECK(typeof(is_pinned)='integer' AND is_pinned IN(0,1)),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer'
    AND revision BETWEEN 1 AND 9007199254740991),
  last_command_id TEXT NOT NULL UNIQUE REFERENCES photo_pin_commands(id)
);
CREATE INDEX photo_pin_states_album_order
  ON photo_pin_states(album_id,is_pinned,photo_id);

CREATE TABLE photo_pin_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES photo_pin_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'),
  after_json TEXT NOT NULL CHECK(json_valid(after_json) AND json_type(after_json)='object'),
  changed INTEGER NOT NULL CHECK(typeof(changed)='integer' AND changed IN(0,1)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL,
  CHECK((changed=1 AND event_id=command_id) OR (changed=0 AND event_id IS NULL))
);

CREATE TRIGGER photo_pin_command_guard
BEFORE INSERT ON photo_pin_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.id<>lower(NEW.id) OR NEW.request_id<>lower(NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_NOT_NORMALIZED') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM version_approval_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM photographer_recommendation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_review_flags c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM upload_key_fences c WHERE c.actor_type='user' AND c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)) OR
    EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id AND lower(e.request_id)=lower(NEW.request_id))
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photos ph
    JOIN photo_version_heads h ON h.photo_id=ph.id AND h.workspace_id=ph.workspace_id
      AND h.project_id=ph.project_id AND h.album_id=ph.album_id
    JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
    JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
      AND a.workspace_id=ph.workspace_id
    WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
      AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photos ph JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
    JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id AND a.workspace_id=ph.workspace_id
    WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
      AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id
      AND (p.status IN('archived','deleting','deleted') OR a.state IN('archived','deleting','deleted'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
  SELECT CASE WHEN COALESCE((SELECT revision FROM photo_pin_states WHERE photo_id=NEW.photo_id),0)<>NEW.expected_revision
    THEN RAISE(ABORT,'PHOTO_PIN_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

CREATE TRIGGER photo_pin_command_apply
AFTER INSERT ON photo_pin_commands BEGIN
  INSERT INTO photo_pin_results(command_id,before_json,after_json,changed,event_id,occurred_at_utc)
  SELECT c.id,
    json_object('photoId',c.photo_id,'albumId',c.album_id,
      'isPinned',json(CASE WHEN COALESCE(s.is_pinned,0)=1 THEN 'true' ELSE 'false' END),
      'revision',COALESCE(s.revision,0)),
    json_object('photoId',c.photo_id,'albumId',c.album_id,
      'isPinned',json(CASE WHEN c.is_pinned=1 THEN 'true' ELSE 'false' END),
      'revision',c.expected_revision+CASE WHEN c.is_pinned<>COALESCE(s.is_pinned,0) THEN 1 ELSE 0 END),
    CASE WHEN c.is_pinned<>COALESCE(s.is_pinned,0) THEN 1 ELSE 0 END,
    CASE WHEN c.is_pinned<>COALESCE(s.is_pinned,0) THEN c.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
  FROM photo_pin_commands c LEFT JOIN photo_pin_states s ON s.photo_id=c.photo_id
  WHERE c.id=NEW.id;

  INSERT INTO photo_pin_states(photo_id,workspace_id,project_id,album_id,is_pinned,revision,last_command_id)
  SELECT c.photo_id,c.workspace_id,c.project_id,c.album_id,c.is_pinned,c.expected_revision+1,c.id
  FROM photo_pin_commands c JOIN photo_pin_results r ON r.command_id=c.id
  LEFT JOIN photo_pin_states s ON s.photo_id=c.photo_id
  WHERE c.id=NEW.id AND r.changed=1
  ON CONFLICT(photo_id) DO UPDATE SET
    workspace_id=excluded.workspace_id,project_id=excluded.project_id,album_id=excluded.album_id,
    is_pinned=excluded.is_pinned,revision=excluded.revision,last_command_id=excluded.last_command_id
  WHERE photo_pin_states.revision=excluded.revision-1;
  SELECT CASE WHEN (SELECT changed FROM photo_pin_results WHERE command_id=NEW.id)=1 AND changes()<>1
    THEN RAISE(ABORT,'PHOTO_PIN_REVISION_CONFLICT') END;

  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,
    action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'user',c.actor_id,c.session_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,
    CASE WHEN c.is_pinned=1 THEN 'photo.pinned' ELSE 'photo.unpinned' END,
    r.before_json,r.after_json,c.request_id,r.occurred_at_utc
  FROM photo_pin_commands c JOIN photo_pin_results r ON r.command_id=c.id
  WHERE c.id=NEW.id AND r.changed=1;
END;

CREATE TRIGGER photo_pin_commands_no_replace
BEFORE INSERT ON photo_pin_commands WHEN EXISTS(
  SELECT 1 FROM photo_pin_commands c WHERE c.id=NEW.id
) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_COMMAND'); END;

-- Keep Owner request IDs unique across existing command/event ledgers in both
-- insertion directions. Existing ledgers remain otherwise unchanged.
CREATE TRIGGER workspace_commands_photo_pin_namespace
AFTER INSERT ON workspace_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER request_commands_photo_pin_namespace
AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_photo_pin_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_requests_photo_pin_namespace
AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_commands_photo_pin_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_commands_photo_pin_namespace
AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_commands_photo_pin_namespace
AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_commands_photo_pin_namespace
AFTER INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_configuration_commands_photo_pin_namespace
AFTER INSERT ON selection_policy_configuration_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_owner_commands_photo_pin_namespace
AFTER INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photo_version_head_commands_photo_pin_namespace
AFTER INSERT ON photo_version_head_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER project_versioning_commands_photo_pin_namespace
AFTER INSERT ON project_versioning_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_comment_commands_photo_pin_namespace
AFTER INSERT ON owner_comment_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_comment_processing_commands_photo_pin_namespace
AFTER INSERT ON owner_comment_processing_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_external_intents_photo_pin_namespace
AFTER INSERT ON owner_external_intents BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_annotation_processing_commands_photo_pin_namespace
AFTER INSERT ON owner_annotation_processing_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_annotation_commands_photo_pin_namespace
AFTER INSERT ON owner_annotation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER version_approval_owner_commands_photo_pin_namespace
AFTER INSERT ON version_approval_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER album_activation_commands_photo_pin_namespace
AFTER INSERT ON album_activation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_review_flags_photo_pin_namespace
AFTER INSERT ON upload_review_flags BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_key_fences_photo_pin_namespace
AFTER INSERT ON upload_key_fences WHEN NEW.actor_type='user' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photo_pin_audit_namespace
BEFORE INSERT ON audit_events WHEN NEW.actor_type='user' BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_pin_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
      AND NOT (c.id=NEW.event_id AND NEW.action=CASE WHEN c.is_pinned=1
        THEN 'photo.pinned' ELSE 'photo.unpinned' END)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER photo_pin_state_insert_guard
BEFORE INSERT ON photo_pin_states BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_pin_commands c JOIN photo_pin_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.photo_id=NEW.photo_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.is_pinned=NEW.is_pinned AND c.expected_revision+1=NEW.revision AND r.changed=1
  ) THEN RAISE(ABORT,'PHOTO_PIN_COMMAND_REQUIRED') END;
END;
CREATE TRIGGER photo_pin_state_update_guard
BEFORE UPDATE ON photo_pin_states BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_pin_commands c JOIN photo_pin_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.photo_id=NEW.photo_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.is_pinned=NEW.is_pinned AND c.expected_revision=OLD.revision
      AND NEW.revision=OLD.revision+1 AND r.changed=1
  ) THEN RAISE(ABORT,'PHOTO_PIN_COMMAND_REQUIRED') END;
END;
CREATE TRIGGER photo_pin_state_no_delete BEFORE DELETE ON photo_pin_states
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_STATE'); END;
CREATE TRIGGER photo_pin_commands_no_update BEFORE UPDATE ON photo_pin_commands
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_COMMAND'); END;
CREATE TRIGGER photo_pin_commands_no_delete BEFORE DELETE ON photo_pin_commands
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_COMMAND'); END;
CREATE TRIGGER photo_pin_results_no_update BEFORE UPDATE ON photo_pin_results
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_RESULT'); END;
CREATE TRIGGER photo_pin_results_no_delete BEFORE DELETE ON photo_pin_results
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_RESULT'); END;
CREATE TRIGGER photo_pin_results_insert_guard
BEFORE INSERT ON photo_pin_results BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_pin_results r
    WHERE r.command_id=NEW.command_id OR
      (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
  ) THEN RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_pin_commands c LEFT JOIN photo_pin_states s ON s.photo_id=c.photo_id
    WHERE c.id=NEW.command_id AND NEW.occurred_at_utc=
      strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND NEW.changed=CASE WHEN c.is_pinned<>COALESCE(s.is_pinned,0) THEN 1 ELSE 0 END
      AND NEW.before_json=json_object('photoId',c.photo_id,'albumId',c.album_id,
        'isPinned',json(CASE WHEN COALESCE(s.is_pinned,0)=1 THEN 'true' ELSE 'false' END),
        'revision',COALESCE(s.revision,0))
      AND NEW.after_json=json_object('photoId',c.photo_id,'albumId',c.album_id,
        'isPinned',json(CASE WHEN c.is_pinned=1 THEN 'true' ELSE 'false' END),
        'revision',c.expected_revision+NEW.changed)
  ) THEN RAISE(ABORT,'INVALID_PHOTO_PIN_RESULT') END;
END;
CREATE TRIGGER photo_pin_results_no_replace
BEFORE INSERT ON photo_pin_results WHEN EXISTS(
  SELECT 1 FROM photo_pin_results r WHERE r.command_id=NEW.command_id
) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_PHOTO_PIN_RESULT'); END;
CREATE TRIGGER photo_pin_audit_insert_guard
BEFORE INSERT ON audit_events WHEN NEW.action IN('photo.pinned','photo.unpinned') BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_pin_commands c JOIN photo_pin_results r ON r.command_id=c.id
    WHERE c.id=NEW.event_id AND NEW.actor_type='user' AND NEW.actor_id=c.actor_id
      AND NEW.session_id=c.session_id AND NEW.workspace_id=c.workspace_id
      AND NEW.project_id=c.project_id AND NEW.album_id=c.album_id AND NEW.photo_id=c.photo_id
      AND NEW.version_id IS NULL AND NEW.request_id=c.request_id
      AND NEW.action=CASE WHEN c.is_pinned=1 THEN 'photo.pinned' ELSE 'photo.unpinned' END
      AND NEW.before_json=r.before_json AND NEW.after_json=r.after_json
      AND NEW.occurred_at_utc=r.occurred_at_utc AND r.changed=1
  ) THEN RAISE(ABORT,'INVALID_PHOTO_PIN_AUDIT') END;
END;
