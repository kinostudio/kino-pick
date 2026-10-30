-- M3c1: audited project-level version mode configuration.
-- Recovery: disable configuration writes; preserve ledgers/provenance/audit and repair forward.
PRAGMA foreign_keys=ON;

CREATE TABLE project_versioning_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND length(replace(id,'-',''))=32
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'
  ),
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND length(replace(request_id,'-',''))=32
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND lower(replace(request_id,'-','')) NOT GLOB '*[^0-9a-f]*'
  ),
  operation TEXT NOT NULL CHECK(operation='project.versioning_mode.set'),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL
    CHECK(typeof(expected_revision)='integer' AND expected_revision BETWEEN 1 AND 2147483647),
  before_mode TEXT NOT NULL
    CHECK(before_mode IN('off','manual','auto_filename','assisted')),
  mode TEXT NOT NULL CHECK(mode IN('off','manual','auto_filename','assisted')),
  confirm INTEGER NOT NULL CHECK(typeof(confirm)='integer' AND confirm=1),
  previous_command_id TEXT REFERENCES project_versioning_commands(id),
  payload_json TEXT NOT NULL CHECK(COALESCE(
    CASE WHEN json_valid(payload_json) THEN
      json_type(payload_json)='object'
      AND json_type(payload_json,'$.projectId')='text'
      AND json_extract(payload_json,'$.projectId')=project_id
      AND json_type(payload_json,'$.expectedRevision')='integer'
      AND json_extract(payload_json,'$.expectedRevision')=expected_revision
      AND json_type(payload_json,'$.mode')='text'
      AND json_extract(payload_json,'$.mode')=mode
      AND json_type(payload_json,'$.confirm')='true'
      AND json_extract(payload_json,'$.confirm')=1
      AND payload_json=json_object(
        'projectId',project_id,
        'expectedRevision',expected_revision,
        'mode',mode,
        'confirm',json('true'))
    ELSE 0 END,0)=1),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id)
);

CREATE INDEX project_versioning_commands_project
  ON project_versioning_commands(project_id,created_at_ms DESC,id DESC);
CREATE INDEX project_versioning_commands_actor
  ON project_versioning_commands(actor_id,created_at_ms DESC,id DESC);

CREATE TABLE project_versioning_results(
  command_id TEXT PRIMARY KEY NOT NULL
    REFERENCES project_versioning_commands(id),
  previous_command_id TEXT
    REFERENCES project_versioning_commands(id),
  before_json TEXT NOT NULL CHECK(COALESCE(json_valid(before_json),0)=1),
  after_json TEXT NOT NULL CHECK(COALESCE(json_valid(after_json),0)=1),
  result_json TEXT NOT NULL CHECK(COALESCE(json_valid(result_json),0)=1),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

ALTER TABLE projects
  ADD COLUMN versioning_command_id TEXT
  REFERENCES project_versioning_commands(id);

CREATE UNIQUE INDEX projects_versioning_command
  ON projects(versioning_command_id);

-- Authorization and exact project scope precede cross-ledger checks and replay.
CREATE TRIGGER project_versioning_command_guard
BEFORE INSERT ON project_versioning_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN NEW.id IS NULL OR NEW.request_id IS NULL
      OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_COMMAND') END;

  -- Owner actor/request IDs share one namespace across all Owner command ledgers.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e
      WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
        AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Ignore captured before-state/session fields for canonical intent comparison:
  -- a retry may arrive in a later live Owner session and after newer mode changes.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation
        OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id
        OR c.expected_revision<>NEW.expected_revision
        OR c.mode<>NEW.mode OR c.confirm<>NEW.confirm
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Current Owner/session and project scope above still apply to exact retries.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN COALESCE(
      CASE WHEN json_valid(NEW.payload_json) THEN
        json_type(NEW.payload_json)='object'
        AND json_type(NEW.payload_json,'$.projectId')='text'
        AND json_extract(NEW.payload_json,'$.projectId')=NEW.project_id
        AND json_type(NEW.payload_json,'$.expectedRevision')='integer'
        AND json_extract(NEW.payload_json,'$.expectedRevision')=NEW.expected_revision
        AND json_type(NEW.payload_json,'$.mode')='text'
        AND json_extract(NEW.payload_json,'$.mode')=NEW.mode
        AND json_type(NEW.payload_json,'$.confirm')='true'
        AND json_extract(NEW.payload_json,'$.confirm')=1
        AND NEW.payload_json=json_object(
          'projectId',NEW.project_id,
          'expectedRevision',NEW.expected_revision,
          'mode',NEW.mode,
          'confirm',json('true'))
      ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.mode IN('auto_filename','assisted')
    THEN RAISE(ABORT,'VERSION_MATCHING_UNAVAILABLE') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
      AND p.revision=NEW.expected_revision
      AND p.versioning_mode=NEW.before_mode
      AND p.versioning_command_id IS NEW.previous_command_id
  ) THEN RAISE(ABORT,'PROJECT_VERSIONING_REVISION_CONFLICT') END;

  SELECT CASE WHEN NEW.mode<>NEW.before_mode
      AND NEW.expected_revision=2147483647
    THEN RAISE(ABORT,'PROJECT_VERSIONING_REVISION_EXHAUSTED') END;
END;

CREATE TRIGGER project_versioning_results_insert_guard
BEFORE INSERT ON project_versioning_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM project_versioning_results r
    WHERE r.command_id=NEW.command_id
      OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
  ) THEN RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_RESULT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM project_versioning_commands c
    JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
    WHERE c.id=NEW.command_id
      AND NEW.previous_command_id IS c.previous_command_id
      AND c.expected_revision=p.revision
      AND c.before_mode=p.versioning_mode
      AND c.previous_command_id IS p.versioning_command_id
      AND NEW.before_json=json_object(
        'mode',p.versioning_mode,'revision',p.revision)
      AND NEW.occurred_at_utc=strftime(
        '%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND (
        (
          c.mode=p.versioning_mode
          AND NEW.event_id IS NULL
          AND NEW.after_json=json_object(
            'mode',p.versioning_mode,'revision',p.revision)
          AND NEW.result_json=json_object(
            'projectId',p.id,
            'workspaceId',p.workspace_id,
            'mode',c.mode,
            'revision',p.revision,
            'changed',json('false'),
            'eventId',NULL)
        )
        OR
        (
          c.mode<>p.versioning_mode
          AND NEW.event_id=c.id
          AND NEW.after_json=json_object(
            'mode',c.mode,'revision',p.revision+1)
          AND NEW.result_json=json_object(
            'projectId',p.id,
            'workspaceId',p.workspace_id,
            'mode',c.mode,
            'revision',p.revision+1,
            'changed',json('true'),
            'eventId',c.id)
        )
      )
  ) THEN RAISE(ABORT,'INVALID_PROJECT_VERSIONING_RESULT') END;
END;

CREATE TRIGGER project_versioning_command_apply
AFTER INSERT ON project_versioning_commands BEGIN
  INSERT INTO project_versioning_results(
    command_id,previous_command_id,before_json,after_json,result_json,
    event_id,occurred_at_utc
  )
  SELECT NEW.id,p.versioning_command_id,
    json_object('mode',p.versioning_mode,'revision',p.revision),
    json_object('mode',NEW.mode,
      'revision',p.revision+CASE WHEN NEW.mode=p.versioning_mode THEN 0 ELSE 1 END),
    json_object(
      'projectId',p.id,
      'workspaceId',p.workspace_id,
      'mode',NEW.mode,
      'revision',p.revision+CASE WHEN NEW.mode=p.versioning_mode THEN 0 ELSE 1 END,
      'changed',json(CASE WHEN NEW.mode=p.versioning_mode THEN 'false' ELSE 'true' END),
      'eventId',CASE WHEN NEW.mode=p.versioning_mode THEN NULL ELSE NEW.id END),
    CASE WHEN NEW.mode=p.versioning_mode THEN NULL ELSE NEW.id END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM projects p
  WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,
    action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT r.event_id,'user',c.actor_id,c.session_id,c.workspace_id,c.project_id,
    'project.versioning_mode_changed',r.before_json,r.after_json,
    c.request_id,r.occurred_at_utc
  FROM project_versioning_commands c
  JOIN project_versioning_results r ON r.command_id=c.id
  WHERE c.id=NEW.id AND r.event_id IS NOT NULL;

  UPDATE projects
  SET versioning_mode=NEW.mode,
      revision=revision+1,
      versioning_command_id=NEW.id
  WHERE id=NEW.project_id AND workspace_id=NEW.workspace_id
    AND NEW.mode<>NEW.before_mode;
END;

-- Guard mutable configuration state with its immutable command/result/audit witness.
CREATE TRIGGER projects_versioning_transition_guard
BEFORE UPDATE ON projects
WHEN NEW.versioning_mode IS NOT OLD.versioning_mode
  OR NEW.versioning_command_id IS NOT OLD.versioning_command_id BEGIN
  SELECT CASE WHEN NEW.versioning_mode NOT IN('off','manual')
      OR NEW.versioning_command_id IS NULL
      OR NEW.revision<>OLD.revision+1
      OR NOT EXISTS(
        SELECT 1 FROM project_versioning_commands c
        JOIN project_versioning_results r ON r.command_id=c.id
        JOIN audit_events e ON e.event_id=r.event_id
        WHERE c.id=NEW.versioning_command_id
          AND c.operation='project.versioning_mode.set'
          AND c.actor_id IS NOT NULL
          AND c.workspace_id=OLD.workspace_id AND c.project_id=OLD.id
          AND c.expected_revision=OLD.revision
          AND c.before_mode=OLD.versioning_mode
          AND c.mode=NEW.versioning_mode
          AND c.previous_command_id IS OLD.versioning_command_id
          AND c.confirm=1
          AND r.previous_command_id IS OLD.versioning_command_id
          AND r.event_id=c.id
          AND r.before_json=json_object(
            'mode',OLD.versioning_mode,'revision',OLD.revision)
          AND r.after_json=json_object(
            'mode',NEW.versioning_mode,'revision',NEW.revision)
          AND e.actor_type='user' AND e.actor_id=c.actor_id
          AND e.session_id=c.session_id
          AND e.workspace_id=OLD.workspace_id AND e.project_id=OLD.id
          AND e.action='project.versioning_mode_changed'
          AND e.request_id=c.request_id
          AND e.occurred_at_utc=r.occurred_at_utc
      )
    THEN RAISE(ABORT,'INVALID_PROJECT_VERSIONING_TRANSITION') END;
END;

-- A project may receive provenance only through the guarded UPDATE transition.
-- This also prevents cloning a historical command pointer onto another project.
CREATE TRIGGER projects_versioning_insert_guard
BEFORE INSERT ON projects
WHEN NEW.versioning_command_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'PROJECT_VERSIONING_STATE_IMMUTABLE');
END;

-- REPLACE must not restore an older mode, revision, or command provenance.
CREATE TRIGGER projects_versioning_replace_guard
BEFORE INSERT ON projects
WHEN EXISTS(
  SELECT 1 FROM projects p
  WHERE p.id=NEW.id
    AND (p.versioning_mode IS NOT NEW.versioning_mode
      OR p.revision IS NOT NEW.revision
      OR p.versioning_command_id IS NOT NEW.versioning_command_id)
) BEGIN
  SELECT RAISE(ABORT,'INVALID_PROJECT_VERSIONING_REPLACE');
END;

CREATE TRIGGER project_versioning_commands_no_update
BEFORE UPDATE ON project_versioning_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_COMMAND');
END;
CREATE TRIGGER project_versioning_commands_no_delete
BEFORE DELETE ON project_versioning_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_COMMAND');
END;
CREATE TRIGGER project_versioning_results_no_update
BEFORE UPDATE ON project_versioning_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_RESULT');
END;
CREATE TRIGGER project_versioning_results_no_delete
BEFORE DELETE ON project_versioning_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_RESULT');
END;

-- Cross-ledger namespace is symmetric with every existing Owner writer.
CREATE TRIGGER workspace_commands_project_versioning_namespace
AFTER INSERT ON workspace_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER request_commands_project_versioning_namespace
AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_project_versioning_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_requests_project_versioning_namespace
AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_commands_project_versioning_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_commands_project_versioning_namespace
AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_commands_project_versioning_namespace
AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_commands_project_versioning_namespace
AFTER INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_configuration_commands_project_versioning_namespace
AFTER INSERT ON selection_policy_configuration_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_owner_commands_project_versioning_namespace
AFTER INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photo_version_head_commands_project_versioning_namespace
AFTER INSERT ON photo_version_head_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_reopened_project_versioning_namespace
BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER project_versioning_commands_no_replace
BEFORE INSERT ON project_versioning_commands
WHEN NEW.id IS NULL OR EXISTS(
  SELECT 1 FROM project_versioning_commands c WHERE c.id=NEW.id
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_COMMAND');
END;
CREATE TRIGGER project_versioning_results_no_replace
BEFORE INSERT ON project_versioning_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM project_versioning_results r
  WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_RESULT');
END;

-- Projects use archive/restore state transitions; physical deletion would let
-- a caller recreate the same ID with configuration state lacking its witness.
CREATE TRIGGER projects_versioning_no_delete
BEFORE DELETE ON projects BEGIN
  SELECT RAISE(ABORT,'PROJECT_VERSIONING_STATE_IMMUTABLE');
END;

