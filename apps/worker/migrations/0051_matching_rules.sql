-- M3i4 additive immutable opt-in matching profiles.
-- The default-v1 index and project-versioning ledger remain unchanged.
-- Nondefault canonical keys allow locale-free Unicode lowercase expansion;
-- never truncate a valid original filename's derived key.
PRAGMA foreign_keys=ON;

CREATE TABLE matching_rule_filename_index(
  upload_session_id TEXT NOT NULL CHECK(typeof(upload_session_id)='text'),
  profile TEXT NOT NULL CHECK(profile IN(
    'rules-v1-001','rules-v1-010','rules-v1-011','rules-v1-100',
    'rules-v1-101','rules-v1-110','rules-v1-111'
  )),
  workspace_id TEXT NOT NULL CHECK(typeof(workspace_id)='text'),
  project_id TEXT NOT NULL CHECK(typeof(project_id)='text'),
  album_id TEXT NOT NULL CHECK(typeof(album_id)='text'),
  original_filename TEXT NOT NULL
    CHECK(typeof(original_filename)='text' AND length(original_filename) BETWEEN 1 AND 255),
  canonical_basename TEXT,
  canonical_extension TEXT,
  is_invalid INTEGER NOT NULL CHECK(typeof(is_invalid)='integer' AND is_invalid IN(0,1)),
  PRIMARY KEY(upload_session_id,profile),
  CHECK(
    (is_invalid=1 AND canonical_basename IS NULL AND canonical_extension IS NULL)
    OR (is_invalid=0 AND typeof(canonical_basename)='text'
      AND length(canonical_basename) BETWEEN 1 AND 1024
      AND (canonical_extension IS NULL OR
        (typeof(canonical_extension)='text'
          AND lower(canonical_extension) IN(
            'avif','bmp','gif','heic','heif','jpeg','jpg','png','tif','tiff','webp'
          )
        )
      )
    )
  ),
  FOREIGN KEY(upload_session_id,workspace_id,project_id,album_id,original_filename)
    REFERENCES upload_sessions(id,workspace_id,project_id,album_id,original_filename)
);
CREATE INDEX matching_rule_filename_index_album_profile
  ON matching_rule_filename_index(workspace_id,project_id,album_id,profile,upload_session_id);
CREATE INDEX matching_rule_filename_index_canonical_scope
  ON matching_rule_filename_index(
    workspace_id,project_id,album_id,profile,
    canonical_basename,canonical_extension,upload_session_id
  ) WHERE is_invalid=0;

CREATE VIEW matching_profile_filename_keys AS
  SELECT upload_session_id,profile,workspace_id,project_id,album_id,
    original_filename,canonical_basename,canonical_extension,is_invalid
  FROM matching_filename_index
  UNION ALL
  SELECT upload_session_id,profile,workspace_id,project_id,album_id,
    original_filename,canonical_basename,canonical_extension,is_invalid
  FROM matching_rule_filename_index;

CREATE TRIGGER matching_rule_filename_index_insert_guard
BEFORE INSERT ON matching_rule_filename_index BEGIN
  SELECT CASE WHEN NEW.profile NOT IN(
      'rules-v1-001','rules-v1-010','rules-v1-011','rules-v1-100',
      'rules-v1-101','rules-v1-110','rules-v1-111'
    ) THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_PROFILE') END;
  SELECT CASE WHEN
    (NEW.is_invalid=1 AND
      (NEW.canonical_basename IS NOT NULL OR NEW.canonical_extension IS NOT NULL))
    OR (NEW.is_invalid=0 AND
      (typeof(NEW.canonical_basename)<>'text' OR length(NEW.canonical_basename)=0
        OR (NEW.canonical_extension IS NOT NULL AND
          (typeof(NEW.canonical_extension)<>'text'
            OR lower(NEW.canonical_extension) NOT IN(
              'avif','bmp','gif','heic','heif','jpeg','jpg','png','tif','tiff','webp'
            )
          )
        )
      )
    )
    THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_INVALID_PAIR') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM upload_sessions u
    WHERE u.id=NEW.upload_session_id AND u.workspace_id=NEW.workspace_id
      AND u.project_id=NEW.project_id AND u.album_id=NEW.album_id
      AND u.original_filename=NEW.original_filename
  ) THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_SOURCE_MISMATCH') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM matching_rule_filename_index old
    WHERE old.upload_session_id=NEW.upload_session_id AND old.profile=NEW.profile
      AND (old.workspace_id IS NOT NEW.workspace_id
        OR old.project_id IS NOT NEW.project_id OR old.album_id IS NOT NEW.album_id
        OR old.original_filename IS NOT NEW.original_filename
        OR old.canonical_basename IS NOT NEW.canonical_basename
        OR old.canonical_extension IS NOT NEW.canonical_extension
        OR old.is_invalid IS NOT NEW.is_invalid)
  ) THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_IMMUTABLE') END;
END;
CREATE TRIGGER matching_rule_filename_index_no_update
BEFORE UPDATE ON matching_rule_filename_index BEGIN
  SELECT RAISE(ABORT,'MATCHING_FILENAME_INDEX_IMMUTABLE');
END;
CREATE TRIGGER matching_rule_filename_index_no_delete
BEFORE DELETE ON matching_rule_filename_index BEGIN
  SELECT RAISE(ABORT,'MATCHING_FILENAME_INDEX_IMMUTABLE');
END;

CREATE TABLE project_matching_rule_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND length(replace(id,'-',''))=32
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'
  ),
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND length(replace(request_id,'-',''))=32
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND lower(replace(request_id,'-','')) NOT GLOB '*[^0-9a-f]*'
    AND request_id=lower(request_id)
  ),
  operation TEXT NOT NULL CHECK(operation='project.matching_rules.set'),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  expected_project_revision INTEGER NOT NULL
    CHECK(typeof(expected_project_revision)='integer'
      AND expected_project_revision BETWEEN 1 AND 2147483647),
  expected_rule_revision INTEGER NOT NULL
    CHECK(typeof(expected_rule_revision)='integer'
      AND expected_rule_revision BETWEEN 0 AND 2147483647),
  before_profile TEXT NOT NULL CHECK(before_profile IN(
    'default-v1','rules-v1-001','rules-v1-010','rules-v1-011',
    'rules-v1-100','rules-v1-101','rules-v1-110','rules-v1-111'
  )),
  profile TEXT NOT NULL CHECK(profile IN(
    'default-v1','rules-v1-001','rules-v1-010','rules-v1-011',
    'rules-v1-100','rules-v1-101','rules-v1-110','rules-v1-111'
  )),
  confirm INTEGER NOT NULL CHECK(typeof(confirm)='integer' AND confirm=1),
  previous_command_id TEXT REFERENCES project_matching_rule_commands(id),
  payload_json TEXT NOT NULL CHECK(COALESCE(
    CASE WHEN json_valid(payload_json) THEN
      json_type(payload_json)='object'
      AND json_type(payload_json,'$.projectId')='text'
      AND json_extract(payload_json,'$.projectId')=project_id
      AND json_type(payload_json,'$.expectedProjectRevision')='integer'
      AND json_extract(payload_json,'$.expectedProjectRevision')=expected_project_revision
      AND json_type(payload_json,'$.expectedRuleRevision')='integer'
      AND json_extract(payload_json,'$.expectedRuleRevision')=expected_rule_revision
      AND json_type(payload_json,'$.profile')='text'
      AND json_extract(payload_json,'$.profile')=profile
      AND json_type(payload_json,'$.confirm')='true'
      AND json_extract(payload_json,'$.confirm')=1
      AND payload_json=json_object(
        'projectId',project_id,
        'expectedProjectRevision',expected_project_revision,
        'expectedRuleRevision',expected_rule_revision,
        'profile',profile,
        'confirm',json('true'))
    ELSE 0 END,0)=1),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id)
);
CREATE INDEX project_matching_rule_commands_project
  ON project_matching_rule_commands(project_id,created_at_ms DESC,id DESC);
CREATE INDEX project_matching_rule_commands_actor
  ON project_matching_rule_commands(actor_id,created_at_ms DESC,id DESC);

CREATE TABLE project_matching_rule_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES project_matching_rule_commands(id),
  previous_command_id TEXT REFERENCES project_matching_rule_commands(id),
  before_json TEXT NOT NULL CHECK(COALESCE(json_valid(before_json),0)=1),
  after_json TEXT NOT NULL CHECK(COALESCE(json_valid(after_json),0)=1),
  result_json TEXT NOT NULL CHECK(COALESCE(json_valid(result_json),0)=1),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);
CREATE TABLE project_matching_rule_heads(
  project_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  profile TEXT NOT NULL CHECK(profile IN(
    'default-v1','rules-v1-001','rules-v1-010','rules-v1-011',
    'rules-v1-100','rules-v1-101','rules-v1-110','rules-v1-111'
  )),
  revision INTEGER NOT NULL
    CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 2147483647),
  command_id TEXT NOT NULL UNIQUE REFERENCES project_matching_rule_commands(id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id)
);
CREATE INDEX project_matching_rule_heads_workspace
  ON project_matching_rule_heads(workspace_id,project_id);

CREATE TRIGGER project_matching_rule_command_guard
BEFORE INSERT ON project_matching_rule_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p WHERE p.id=NEW.project_id
      AND p.workspace_id=NEW.workspace_id
      AND p.status IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
  SELECT CASE WHEN NEW.id IS NULL OR NEW.request_id IS NULL
      OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND') END;

  -- Exact retries ignore captured session and before-state, but keep the original
  -- canonical intent and pass the current Owner/project checks above.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
      AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id
        OR c.expected_project_revision<>NEW.expected_project_revision
        OR c.expected_rule_revision<>NEW.expected_rule_revision
        OR c.profile<>NEW.profile OR c.confirm<>NEW.confirm
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  -- Shared case-folded actor/request namespace with every prior Owner writer.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND lower(e.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN COALESCE(
    CASE WHEN json_valid(NEW.payload_json) THEN
      json_type(NEW.payload_json)='object'
      AND (SELECT count(*) FROM json_each(NEW.payload_json))=5
      AND json_type(NEW.payload_json,'$.projectId')='text'
      AND json_extract(NEW.payload_json,'$.projectId')=NEW.project_id
      AND json_type(NEW.payload_json,'$.expectedProjectRevision')='integer'
      AND json_extract(NEW.payload_json,'$.expectedProjectRevision')=NEW.expected_project_revision
      AND json_type(NEW.payload_json,'$.expectedRuleRevision')='integer'
      AND json_extract(NEW.payload_json,'$.expectedRuleRevision')=NEW.expected_rule_revision
      AND json_type(NEW.payload_json,'$.profile')='text'
      AND json_extract(NEW.payload_json,'$.profile')=NEW.profile
      AND json_type(NEW.payload_json,'$.confirm')='true'
      AND json_extract(NEW.payload_json,'$.confirm')=1
      AND NEW.payload_json=json_object(
        'projectId',NEW.project_id,
        'expectedProjectRevision',NEW.expected_project_revision,
        'expectedRuleRevision',NEW.expected_rule_revision,
        'profile',NEW.profile, 'confirm',json('true'))
    ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    LEFT JOIN project_matching_rule_heads h
      ON h.project_id=p.id AND h.workspace_id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
      AND p.revision=NEW.expected_project_revision
      AND COALESCE(h.profile,'default-v1')=NEW.before_profile
      AND COALESCE(h.revision,0)=NEW.expected_rule_revision
      AND h.command_id IS NEW.previous_command_id
  ) THEN RAISE(ABORT,'MATCHING_RULES_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.profile<>NEW.before_profile
      AND (NEW.expected_project_revision=2147483647
        OR NEW.expected_rule_revision=2147483647)
    THEN RAISE(ABORT,'MATCHING_RULES_REVISION_EXHAUSTED') END;
END;

CREATE TRIGGER project_matching_rule_results_insert_guard
BEFORE INSERT ON project_matching_rule_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM project_matching_rule_results r
    WHERE r.command_id=NEW.command_id
      OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
  ) THEN RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
    LEFT JOIN project_matching_rule_heads h
      ON h.project_id=p.id AND h.workspace_id=p.workspace_id
    WHERE c.id=NEW.command_id AND p.status NOT IN('archived','deleting','deleted')
      AND c.expected_project_revision=p.revision
      AND c.expected_rule_revision=COALESCE(h.revision,0)
      AND c.before_profile=COALESCE(h.profile,'default-v1')
      AND c.previous_command_id IS h.command_id
      AND NEW.previous_command_id IS c.previous_command_id
      AND NEW.before_json=json_object('profile',c.before_profile,
        'ruleRevision',c.expected_rule_revision,'projectRevision',p.revision)
      AND NEW.occurred_at_utc=strftime(
        '%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND (
        (c.profile=c.before_profile AND NEW.event_id IS NULL
          AND NEW.after_json=json_object('profile',c.before_profile,
            'ruleRevision',c.expected_rule_revision,'projectRevision',p.revision)
          AND NEW.result_json=json_object('projectId',p.id,'workspaceId',p.workspace_id,
            'projectRevision',p.revision,'profile',c.profile,
            'ruleRevision',c.expected_rule_revision,'changed',json('false'),'eventId',NULL))
        OR
        (c.profile<>c.before_profile
          AND c.expected_project_revision<2147483647
          AND c.expected_rule_revision<2147483647
          AND NEW.event_id=c.id
          AND NEW.after_json=json_object('profile',c.profile,
            'ruleRevision',c.expected_rule_revision+1,
            'projectRevision',p.revision+1)
          AND NEW.result_json=json_object('projectId',p.id,'workspaceId',p.workspace_id,
            'projectRevision',p.revision+1,'profile',c.profile,
            'ruleRevision',c.expected_rule_revision+1,'changed',json('true'),'eventId',c.id))
      )
  ) THEN RAISE(ABORT,'INVALID_PROJECT_MATCHING_RULE_RESULT') END;
END;

CREATE TRIGGER project_matching_rule_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action='project.matching_rules_changed' BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    JOIN project_matching_rule_results r ON r.command_id=c.id
    JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
    WHERE c.id=NEW.event_id AND c.profile<>c.before_profile
      AND c.expected_project_revision=p.revision
      AND NEW.actor_type='user' AND NEW.actor_id=c.actor_id
      AND NEW.session_id=c.session_id AND NEW.workspace_id=c.workspace_id
      AND NEW.project_id=c.project_id
      AND NEW.before_json=r.before_json AND NEW.after_json=r.after_json
      AND NEW.request_id=c.request_id AND NEW.occurred_at_utc=r.occurred_at_utc
      AND r.event_id=c.id
      AND r.before_json=json_object('profile',c.before_profile,
        'ruleRevision',c.expected_rule_revision,
        'projectRevision',c.expected_project_revision)
      AND r.after_json=json_object('profile',c.profile,
        'ruleRevision',c.expected_rule_revision+1,
        'projectRevision',c.expected_project_revision+1)
  ) THEN RAISE(ABORT,'INVALID_PROJECT_MATCHING_RULE_AUDIT') END;
END;

CREATE TRIGGER project_matching_rule_command_apply
AFTER INSERT ON project_matching_rule_commands BEGIN
  INSERT INTO project_matching_rule_results(
    command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc
  )
  SELECT NEW.id,h.command_id,
    json_object('profile',COALESCE(h.profile,'default-v1'),
      'ruleRevision',COALESCE(h.revision,0),'projectRevision',p.revision),
    json_object('profile',NEW.profile,
      'ruleRevision',COALESCE(h.revision,0)
        +CASE WHEN NEW.profile=COALESCE(h.profile,'default-v1') THEN 0 ELSE 1 END,
      'projectRevision',p.revision
        +CASE WHEN NEW.profile=COALESCE(h.profile,'default-v1') THEN 0 ELSE 1 END),
    json_object('projectId',p.id,'workspaceId',p.workspace_id,
      'projectRevision',p.revision
        +CASE WHEN NEW.profile=COALESCE(h.profile,'default-v1') THEN 0 ELSE 1 END,
      'profile',NEW.profile,
      'ruleRevision',COALESCE(h.revision,0)
        +CASE WHEN NEW.profile=COALESCE(h.profile,'default-v1') THEN 0 ELSE 1 END,
      'changed',json(CASE WHEN NEW.profile=COALESCE(h.profile,'default-v1')
        THEN 'false' ELSE 'true' END),
      'eventId',CASE WHEN NEW.profile=COALESCE(h.profile,'default-v1') THEN NULL ELSE NEW.id END),
    CASE WHEN NEW.profile=COALESCE(h.profile,'default-v1') THEN NULL ELSE NEW.id END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM projects p
  LEFT JOIN project_matching_rule_heads h
    ON h.project_id=p.id AND h.workspace_id=p.workspace_id
  WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,
    action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT r.event_id,'user',c.actor_id,c.session_id,c.workspace_id,c.project_id,
    'project.matching_rules_changed',r.before_json,r.after_json,c.request_id,r.occurred_at_utc
  FROM project_matching_rule_commands c
  JOIN project_matching_rule_results r ON r.command_id=c.id
  WHERE c.id=NEW.id AND r.event_id IS NOT NULL;

  UPDATE project_matching_rule_heads
  SET profile=NEW.profile,revision=NEW.expected_rule_revision+1,command_id=NEW.id
  WHERE project_id=NEW.project_id AND workspace_id=NEW.workspace_id
    AND NEW.profile<>NEW.before_profile;
  INSERT INTO project_matching_rule_heads(project_id,workspace_id,profile,revision,command_id)
  SELECT NEW.project_id,NEW.workspace_id,NEW.profile,NEW.expected_rule_revision+1,NEW.id
  WHERE NEW.profile<>NEW.before_profile
    AND NOT EXISTS(SELECT 1 FROM project_matching_rule_heads h
      WHERE h.project_id=NEW.project_id AND h.workspace_id=NEW.workspace_id);

  UPDATE projects SET revision=revision+1
  WHERE id=NEW.project_id AND workspace_id=NEW.workspace_id
    AND revision=NEW.expected_project_revision
    AND NEW.profile<>NEW.before_profile;
END;

CREATE TRIGGER project_matching_rule_head_insert_guard
BEFORE INSERT ON project_matching_rule_heads BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_matching_rule_heads h
    WHERE h.project_id=NEW.project_id)
    THEN RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_HEAD') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    JOIN project_matching_rule_results r ON r.command_id=c.id
    JOIN audit_events e ON e.event_id=r.event_id
    JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
    WHERE c.id=NEW.command_id AND c.profile<>c.before_profile
      AND c.before_profile='default-v1' AND c.expected_rule_revision=0
      AND c.previous_command_id IS NULL
      AND NEW.project_id=c.project_id AND NEW.workspace_id=c.workspace_id
      AND NEW.profile=c.profile AND NEW.revision=1
      AND p.revision=c.expected_project_revision
      AND r.event_id=c.id AND r.previous_command_id IS NULL
      AND r.before_json=json_object('profile','default-v1','ruleRevision',0,
        'projectRevision',c.expected_project_revision)
      AND r.after_json=json_object('profile',c.profile,'ruleRevision',1,
        'projectRevision',c.expected_project_revision+1)
      AND e.actor_type='user' AND e.actor_id=c.actor_id AND e.session_id=c.session_id
      AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id
      AND e.action='project.matching_rules_changed' AND e.request_id=c.request_id
      AND e.before_json=r.before_json AND e.after_json=r.after_json
      AND e.occurred_at_utc=r.occurred_at_utc
  ) THEN RAISE(ABORT,'INVALID_PROJECT_MATCHING_RULE_HEAD') END;
END;

CREATE TRIGGER project_matching_rule_head_update_guard
BEFORE UPDATE ON project_matching_rule_heads BEGIN
  SELECT CASE WHEN NEW.project_id IS NOT OLD.project_id
      OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.revision<>OLD.revision+1
    THEN RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_HEAD') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    JOIN project_matching_rule_results r ON r.command_id=c.id
    JOIN audit_events e ON e.event_id=r.event_id
    JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
    WHERE c.id=NEW.command_id AND c.profile<>c.before_profile
      AND c.project_id=OLD.project_id AND c.workspace_id=OLD.workspace_id
      AND c.before_profile=OLD.profile AND c.expected_rule_revision=OLD.revision
      AND c.previous_command_id IS OLD.command_id
      AND NEW.project_id=c.project_id AND NEW.workspace_id=c.workspace_id
      AND NEW.profile=c.profile AND NEW.revision=c.expected_rule_revision+1
      AND p.revision=c.expected_project_revision
      AND r.event_id=c.id AND r.previous_command_id IS OLD.command_id
      AND r.before_json=json_object('profile',OLD.profile,'ruleRevision',OLD.revision,
        'projectRevision',c.expected_project_revision)
      AND r.after_json=json_object('profile',c.profile,'ruleRevision',NEW.revision,
        'projectRevision',c.expected_project_revision+1)
      AND e.actor_type='user' AND e.actor_id=c.actor_id AND e.session_id=c.session_id
      AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id
      AND e.action='project.matching_rules_changed' AND e.request_id=c.request_id
      AND e.before_json=r.before_json AND e.after_json=r.after_json
      AND e.occurred_at_utc=r.occurred_at_utc
  ) THEN RAISE(ABORT,'INVALID_PROJECT_MATCHING_RULE_HEAD') END;
END;
CREATE TRIGGER project_matching_rule_heads_no_delete
BEFORE DELETE ON project_matching_rule_heads BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_HEAD');
END;

-- A revision-only project update is accepted for matching rules only when
-- command, result, audit and new head all witness the same atomic transition.
CREATE TRIGGER projects_matching_rule_revision_guard
BEFORE UPDATE ON projects
WHEN NEW.revision IS NOT OLD.revision
  AND EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    JOIN project_matching_rule_results r ON r.command_id=c.id
    JOIN audit_events e ON e.event_id=r.event_id
    JOIN project_matching_rule_heads h ON h.project_id=c.project_id
      AND h.workspace_id=c.workspace_id
    WHERE c.project_id=OLD.id AND c.workspace_id=OLD.workspace_id
      AND c.expected_project_revision=OLD.revision
      AND c.profile<>c.before_profile AND r.event_id=c.id
      AND h.profile=c.profile AND h.revision=c.expected_rule_revision+1
      AND h.command_id=c.id AND e.action='project.matching_rules_changed'
  ) BEGIN
  SELECT CASE WHEN NEW.revision<>OLD.revision+1
      OR NEW.versioning_mode IS NOT OLD.versioning_mode
      OR NEW.versioning_command_id IS NOT OLD.versioning_command_id
      OR NOT EXISTS(
        SELECT 1 FROM project_matching_rule_commands c
        JOIN project_matching_rule_results r ON r.command_id=c.id
        JOIN audit_events e ON e.event_id=r.event_id
        JOIN project_matching_rule_heads h ON h.project_id=c.project_id
          AND h.workspace_id=c.workspace_id
        WHERE c.project_id=OLD.id AND c.workspace_id=OLD.workspace_id
          AND c.expected_project_revision=OLD.revision
          AND c.profile<>c.before_profile AND r.event_id=c.id
          AND r.before_json=json_object('profile',c.before_profile,
            'ruleRevision',c.expected_rule_revision,'projectRevision',OLD.revision)
          AND r.after_json=json_object('profile',c.profile,
            'ruleRevision',c.expected_rule_revision+1,'projectRevision',NEW.revision)
          AND h.profile=c.profile AND h.revision=c.expected_rule_revision+1
          AND h.command_id=c.id
          AND e.actor_type='user' AND e.actor_id=c.actor_id
          AND e.session_id=c.session_id AND e.workspace_id=c.workspace_id
          AND e.project_id=c.project_id AND e.action='project.matching_rules_changed'
          AND e.request_id=c.request_id AND e.before_json=r.before_json
          AND e.after_json=r.after_json AND e.occurred_at_utc=r.occurred_at_utc
      )
    THEN RAISE(ABORT,'INVALID_PROJECT_MATCHING_RULE_REVISION') END;
END;

CREATE TRIGGER project_matching_rule_commands_no_update
BEFORE UPDATE ON project_matching_rule_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND');
END;
CREATE TRIGGER project_matching_rule_commands_no_delete
BEFORE DELETE ON project_matching_rule_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND');
END;
CREATE TRIGGER project_matching_rule_results_no_update
BEFORE UPDATE ON project_matching_rule_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_RESULT');
END;
CREATE TRIGGER project_matching_rule_results_no_delete
BEFORE DELETE ON project_matching_rule_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_RESULT');
END;
CREATE TRIGGER project_matching_rule_commands_no_replace
BEFORE INSERT ON project_matching_rule_commands
WHEN NEW.id IS NULL OR EXISTS(
  SELECT 1 FROM project_matching_rule_commands c WHERE c.id=NEW.id
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND');
END;
CREATE TRIGGER project_matching_rule_results_no_replace
BEFORE INSERT ON project_matching_rule_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM project_matching_rule_results r
  WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_RESULT');
END;

-- Every prior Owner ledger also rejects a collision created here.
CREATE TRIGGER workspace_commands_project_matching_rules_namespace AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER request_commands_project_matching_rules_namespace AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER upload_requests_project_matching_rules_namespace AFTER INSERT ON upload_requests
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER upload_workflow_requests_project_matching_rules_namespace AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER processing_review_commands_project_matching_rules_namespace AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER invite_revocation_commands_project_matching_rules_namespace AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER invite_creation_commands_project_matching_rules_namespace AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER selection_policy_commands_project_matching_rules_namespace AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER selection_policy_configuration_commands_project_matching_rules_namespace AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER shared_review_owner_commands_project_matching_rules_namespace AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER photo_version_head_commands_project_matching_rules_namespace AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER project_versioning_commands_project_matching_rules_namespace AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_commands_project_matching_rules_namespace AFTER INSERT ON owner_comment_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_commands_project_matching_rules_namespace AFTER INSERT ON owner_comment_processing_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_project_matching_rules_namespace AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER upload_key_fences_project_matching_rules_namespace AFTER INSERT ON upload_key_fences
WHEN NEW.actor_type='user' AND EXISTS(
  SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_commands_project_matching_rules_namespace AFTER INSERT ON owner_annotation_processing_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_commands_project_matching_rules_namespace AFTER INSERT ON owner_annotation_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER selection_reopened_project_matching_rules_namespace BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

-- Preserve old 6-field resolved-upload payloads and accept one exact rule context.
DROP TRIGGER upload_resolved_reservation_guard;
CREATE TRIGGER upload_resolved_reservation_guard
BEFORE INSERT ON upload_requests
WHEN NEW.operation='upload.reserved'
  AND json_valid(NEW.payload_json)
  AND json_type(NEW.payload_json,'$.resolution') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    JOIN albums a ON a.id=NEW.album_id AND a.project_id=p.id
      AND a.workspace_id=w.id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND a.state NOT IN('archived','deleting','deleted')
      AND p.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p JOIN albums a ON a.id=NEW.album_id
      AND a.project_id=p.id AND a.workspace_id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND (p.status IN('archived','deleting','deleted') OR a.state NOT IN('draft','active'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  -- Resolve cross-ledger request conflicts before stale-CAS checks.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
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
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND lower(f.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND lower(e.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.actor_id=NEW.actor_id
      AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN COALESCE(CASE WHEN
    json_type(NEW.payload_json,'$.resolution')='object' THEN
      (
        ((SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution'))=6
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile') IS NULL)
        OR
        ((SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution'))=7
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile')='object'
          AND (SELECT count(*) FROM json_each(
            NEW.payload_json,'$.resolution.matchingProfile'))=2
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile.profile')='text'
          AND json_extract(NEW.payload_json,'$.resolution.matchingProfile.profile') IN(
            'default-v1','rules-v1-001','rules-v1-010','rules-v1-011',
            'rules-v1-100','rules-v1-101','rules-v1-110','rules-v1-111')
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile.ruleRevision')='integer'
          AND json_extract(NEW.payload_json,'$.resolution.matchingProfile.ruleRevision')
            BETWEEN 0 AND 2147483647)
      )
      AND json_type(NEW.payload_json,'$.resolution.expectedChangeSequence')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.expectedChangeSequence') BETWEEN 0 AND 9007199254740991
      AND json_type(NEW.payload_json,'$.resolution.expectedProjectRevision')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.expectedProjectRevision') BETWEEN 1 AND 2147483647
      AND json_extract(NEW.payload_json,'$.resolution.expectedMode') IN('auto_filename','assisted')
      AND json_type(NEW.payload_json,'$.resolution.confirm')='true'
      AND json_type(NEW.payload_json,'$.resolution.dimensions')='object'
      AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.dimensions'))=2
      AND json_type(NEW.payload_json,'$.resolution.dimensions.width')='integer'
      AND json_type(NEW.payload_json,'$.resolution.dimensions.height')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.width') BETWEEN 1 AND 32768
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.height') BETWEEN 1 AND 32768
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.width')*json_extract(NEW.payload_json,'$.resolution.dimensions.height')<=80000000
      AND json_type(NEW.payload_json,'$.resolution.choice')='object'
      AND ((json_extract(NEW.payload_json,'$.resolution.choice.kind')='new_photo'
          AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.choice'))=1
          AND json_type(NEW.payload_json,'$.versionTarget') IS NULL)
        OR (json_extract(NEW.payload_json,'$.resolution.choice.kind')='new_version'
          AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.choice'))=4
          AND json_type(NEW.payload_json,'$.versionTarget')='object'
          AND json_extract(NEW.payload_json,'$.resolution.choice.photoId')=json_extract(NEW.payload_json,'$.versionTarget.photoId')
          AND json_extract(NEW.payload_json,'$.resolution.choice.parentVersionId')=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId')
          AND json_extract(NEW.payload_json,'$.resolution.choice.expectedRevision')=json_extract(NEW.payload_json,'$.versionTarget.expectedRevision')
          AND json_extract(NEW.payload_json,'$.versionTarget.changeType')='new_retouch'))
    ELSE 0 END,0)<>1 THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN
    json_extract(NEW.payload_json,'$.resolution.expectedChangeSequence')<>
      COALESCE((SELECT MAX(m.sequence) FROM album_matching_changes m
        WHERE m.workspace_id=NEW.workspace_id AND m.project_id=NEW.project_id
          AND m.album_id=NEW.album_id),0)
    OR NOT EXISTS(SELECT 1 FROM projects p
      WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
        AND p.revision=json_extract(NEW.payload_json,'$.resolution.expectedProjectRevision')
        AND p.versioning_mode=json_extract(NEW.payload_json,'$.resolution.expectedMode')
        AND p.status NOT IN('archived','deleting','deleted'))
    OR (json_type(NEW.payload_json,'$.resolution.matchingProfile') IS NULL
      AND COALESCE((SELECT h.profile FROM project_matching_rule_heads h
        WHERE h.project_id=NEW.project_id AND h.workspace_id=NEW.workspace_id),
        'default-v1')<>'default-v1')
    OR (json_type(NEW.payload_json,'$.resolution.matchingProfile')='object'
      AND (
        COALESCE((SELECT h.profile FROM project_matching_rule_heads h
          WHERE h.project_id=NEW.project_id AND h.workspace_id=NEW.workspace_id),
          'default-v1') IS NOT
          json_extract(NEW.payload_json,'$.resolution.matchingProfile.profile')
        OR COALESCE((SELECT h.revision FROM project_matching_rule_heads h
          WHERE h.project_id=NEW.project_id AND h.workspace_id=NEW.workspace_id),0) IS NOT
          json_extract(NEW.payload_json,'$.resolution.matchingProfile.ruleRevision')
      ))
    THEN RAISE(ABORT,'RESOLUTION_STALE') END;
END;




