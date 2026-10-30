-- M2m3: durable project defaults, explicit album inheritance/override epochs,
-- one immutable command/result ledger, and live private-selection enforcement.
PRAGMA foreign_keys=ON;

CREATE TABLE selection_policy_configuration_commands(
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN('project','album')),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  album_id TEXT,
  expected_project_revision INTEGER NOT NULL CHECK(typeof(expected_project_revision)='integer' AND expected_project_revision>=0),
  expected_album_revision INTEGER CHECK(expected_album_revision IS NULL OR (typeof(expected_album_revision)='integer' AND expected_album_revision>=0)),
  configuration TEXT CHECK(configuration IS NULL OR configuration IN('inherit','override')),
  minimum INTEGER CHECK(minimum IS NULL OR (typeof(minimum)='integer' AND minimum BETWEEN 1 AND 100000)),
  maximum INTEGER CHECK(maximum IS NULL OR (typeof(maximum)='integer' AND maximum BETWEEN 1 AND 100000)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  legacy_payload_json TEXT CHECK(legacy_payload_json IS NULL OR json_valid(legacy_payload_json)),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id) REFERENCES albums(id,workspace_id),
  CHECK(COALESCE((
    (target_type='project' AND legacy_payload_json IS NULL AND album_id IS NULL AND expected_album_revision IS NULL
      AND configuration IS NULL AND minimum IS NOT NULL
      AND (maximum IS NULL OR minimum<=maximum)
      AND payload_json=json_object('projectId',project_id,'expectedRevision',expected_project_revision,
        'minimum',minimum,'maximum',maximum,'confirm',json('true')))
    OR
    (target_type='album' AND album_id IS NOT NULL AND expected_album_revision IS NOT NULL
      AND (
        (configuration='inherit' AND minimum IS NULL AND maximum IS NULL
          AND payload_json=json_object('albumId',album_id,'expectedAlbumRevision',expected_album_revision,
            'expectedProjectRevision',expected_project_revision,'configuration','inherit','confirm',json('true')))
        OR
        (configuration='override' AND minimum IS NOT NULL AND (maximum IS NULL OR minimum<=maximum)
          AND payload_json=json_object('albumId',album_id,'expectedAlbumRevision',expected_album_revision,
            'expectedProjectRevision',expected_project_revision,'configuration','override',
            'minimum',minimum,'maximum',maximum,'confirm',json('true')))
      )
      AND (
        legacy_payload_json IS NULL
        OR (configuration='override' AND legacy_payload_json=json_object('albumId',album_id,
          'expectedRevision',expected_album_revision,'minimum',minimum,'maximum',maximum,'confirm',json('true')))
      ))
  ),0)=1)
);

CREATE TABLE selection_policy_configuration_results(
  command_id TEXT PRIMARY KEY REFERENCES selection_policy_configuration_commands(id),
  previous_command_id TEXT REFERENCES selection_policy_configuration_commands(id),
  previous_legacy_command_id TEXT REFERENCES selection_policy_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE project_selection_policy_configurations(
  project_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  minimum INTEGER NOT NULL CHECK(typeof(minimum)='integer' AND minimum BETWEEN 1 AND 100000),
  maximum INTEGER CHECK(maximum IS NULL OR (typeof(maximum)='integer' AND maximum BETWEEN 1 AND 100000)),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
  last_command_id TEXT NOT NULL UNIQUE REFERENCES selection_policy_configuration_commands(id),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  CHECK(maximum IS NULL OR minimum<=maximum),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id)
);

CREATE TABLE album_selection_policy_configurations(
  album_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  configuration TEXT NOT NULL CHECK(configuration IN('inherit','override')),
  minimum INTEGER,
  maximum INTEGER,
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
  last_command_id TEXT UNIQUE REFERENCES selection_policy_configuration_commands(id),
  legacy_command_id TEXT UNIQUE REFERENCES selection_policy_commands(id),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  CHECK(
    (configuration='inherit' AND minimum IS NULL AND maximum IS NULL)
    OR (configuration='override' AND typeof(minimum)='integer' AND minimum BETWEEN 1 AND 100000
      AND (maximum IS NULL OR (typeof(maximum)='integer' AND maximum BETWEEN 1 AND 100000))
      AND (maximum IS NULL OR minimum<=maximum))
  ),
  CHECK(last_command_id IS NOT NULL OR legacy_command_id IS NOT NULL),
  FOREIGN KEY(album_id,workspace_id) REFERENCES albums(id,workspace_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id)
);

-- Preserve the historical 0028 policy ledger and seed its current state as
-- explicit album overrides at precisely the same value and revision.
INSERT INTO album_selection_policy_configurations(
  album_id,workspace_id,project_id,configuration,minimum,maximum,revision,
  last_command_id,legacy_command_id,updated_at_ms
)
SELECT album_id,workspace_id,project_id,'override',minimum,maximum,revision,
  NULL,last_command_id,updated_at_ms
FROM album_selection_policies;

CREATE INDEX selection_policy_configuration_commands_project
  ON selection_policy_configuration_commands(project_id,created_at_ms,id);
CREATE INDEX selection_policy_configuration_commands_album
  ON selection_policy_configuration_commands(album_id,created_at_ms,id);
CREATE INDEX album_selection_policy_configurations_project
  ON album_selection_policy_configurations(project_id,configuration,album_id);

CREATE TRIGGER selection_policy_configuration_commands_no_update
BEFORE UPDATE ON selection_policy_configuration_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_COMMAND');
END;
CREATE TRIGGER selection_policy_configuration_commands_no_delete
BEFORE DELETE ON selection_policy_configuration_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_COMMAND');
END;
CREATE TRIGGER selection_policy_configuration_results_no_update
BEFORE UPDATE ON selection_policy_configuration_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_RESULT');
END;
CREATE TRIGGER selection_policy_configuration_results_no_delete
BEFORE DELETE ON selection_policy_configuration_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_RESULT');
END;
CREATE TRIGGER project_selection_policy_configurations_no_delete
BEFORE DELETE ON project_selection_policy_configurations BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_STATE');
END;
CREATE TRIGGER album_selection_policy_configurations_no_delete
BEFORE DELETE ON album_selection_policy_configurations BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_STATE');
END;

CREATE TRIGGER album_selection_policy_legacy_seed_witness
BEFORE INSERT ON album_selection_policy_configurations
WHEN NEW.last_command_id IS NULL BEGIN
  -- Legacy seeds were copied above before installing this guard. Never allow
  -- a later INSERT OR REPLACE to restore a historical seed over current state.
  SELECT RAISE(ABORT,'INVALID_SELECTION_POLICY_LEGACY_SEED');
END;

CREATE TRIGGER project_selection_policy_configuration_insert_witness
BEFORE INSERT ON project_selection_policy_configurations BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    JOIN selection_policy_configuration_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.target_type='project'
      AND c.project_id=NEW.project_id AND c.workspace_id=NEW.workspace_id
      AND c.minimum=NEW.minimum AND c.maximum IS NEW.maximum
      AND c.expected_project_revision=COALESCE((SELECT revision FROM project_selection_policy_configurations WHERE project_id=NEW.project_id),0)
      AND NEW.revision=c.expected_project_revision+1
      AND NEW.updated_at_ms=c.created_at_ms
      AND r.previous_command_id IS (SELECT last_command_id FROM project_selection_policy_configurations WHERE project_id=NEW.project_id)
      AND r.previous_legacy_command_id IS NULL
      AND json_extract(r.after_json,'$.minimum')=NEW.minimum
      AND json_extract(r.after_json,'$.maximum') IS NEW.maximum
      AND json_extract(r.after_json,'$.revision')=NEW.revision
      AND r.event_id='selection-policy-config:'||c.id
  ) THEN RAISE(ABORT,'INVALID_SELECTION_POLICY_CONFIGURATION_WITNESS') END;
END;
CREATE TRIGGER project_selection_policy_configuration_update_witness
BEFORE UPDATE ON project_selection_policy_configurations BEGIN
  SELECT CASE WHEN NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id
    THEN RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    JOIN selection_policy_configuration_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.target_type='project'
      AND c.project_id=NEW.project_id AND c.workspace_id=NEW.workspace_id
      AND c.minimum=NEW.minimum AND c.maximum IS NEW.maximum
      AND c.expected_project_revision=OLD.revision AND NEW.revision=OLD.revision+1
      AND NEW.updated_at_ms=c.created_at_ms
      AND r.previous_command_id=OLD.last_command_id AND r.previous_legacy_command_id IS NULL
      AND json_extract(r.after_json,'$.minimum')=NEW.minimum
      AND json_extract(r.after_json,'$.maximum') IS NEW.maximum
      AND json_extract(r.after_json,'$.revision')=NEW.revision
      AND r.event_id='selection-policy-config:'||c.id
  ) THEN RAISE(ABORT,'INVALID_SELECTION_POLICY_CONFIGURATION_WITNESS') END;
END;
CREATE TRIGGER album_selection_policy_configuration_insert_witness
BEFORE INSERT ON album_selection_policy_configurations
WHEN NEW.last_command_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    JOIN selection_policy_configuration_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.target_type='album'
      AND c.album_id=NEW.album_id AND c.project_id=NEW.project_id
      AND c.workspace_id=NEW.workspace_id AND c.configuration=NEW.configuration
      AND c.minimum IS NEW.minimum AND c.maximum IS NEW.maximum
      AND c.expected_album_revision=COALESCE((SELECT revision FROM album_selection_policy_configurations WHERE album_id=NEW.album_id),0)
      AND NEW.revision=c.expected_album_revision+1
      AND NEW.updated_at_ms=c.created_at_ms
      AND r.previous_command_id IS (SELECT last_command_id FROM album_selection_policy_configurations WHERE album_id=NEW.album_id)
      AND r.previous_legacy_command_id IS (SELECT legacy_command_id FROM album_selection_policy_configurations WHERE album_id=NEW.album_id)
      AND NEW.legacy_command_id IS (SELECT legacy_command_id FROM album_selection_policy_configurations WHERE album_id=NEW.album_id)
      AND json_extract(r.after_json,'$.configuration')=NEW.configuration
      AND json_extract(r.after_json,'$.minimum') IS CASE WHEN NEW.configuration='override' THEN NEW.minimum
        ELSE COALESCE((SELECT minimum FROM project_selection_policy_configurations WHERE project_id=NEW.project_id),1) END
      AND json_extract(r.after_json,'$.maximum') IS CASE WHEN NEW.configuration='override' THEN NEW.maximum
        ELSE (SELECT maximum FROM project_selection_policy_configurations WHERE project_id=NEW.project_id) END
      AND json_extract(r.after_json,'$.albumRevision')=NEW.revision
      AND r.event_id='selection-policy-config:'||c.id
  ) THEN RAISE(ABORT,'INVALID_SELECTION_POLICY_CONFIGURATION_WITNESS') END;
END;
CREATE TRIGGER album_selection_policy_configuration_update_witness
BEFORE UPDATE ON album_selection_policy_configurations BEGIN
  SELECT CASE WHEN NEW.album_id<>OLD.album_id OR NEW.workspace_id<>OLD.workspace_id
    OR NEW.project_id<>OLD.project_id OR NEW.legacy_command_id IS NOT OLD.legacy_command_id
    THEN RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    JOIN selection_policy_configuration_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.target_type='album'
      AND c.album_id=NEW.album_id AND c.project_id=NEW.project_id
      AND c.workspace_id=NEW.workspace_id AND c.configuration=NEW.configuration
      AND c.minimum IS NEW.minimum AND c.maximum IS NEW.maximum
      AND c.expected_album_revision=OLD.revision AND NEW.revision=OLD.revision+1
      AND NEW.updated_at_ms=c.created_at_ms
      AND r.previous_command_id IS OLD.last_command_id
      AND r.previous_legacy_command_id IS OLD.legacy_command_id
      AND json_extract(r.after_json,'$.configuration')=NEW.configuration
      AND json_extract(r.after_json,'$.minimum') IS CASE WHEN NEW.configuration='override' THEN NEW.minimum
        ELSE COALESCE((SELECT minimum FROM project_selection_policy_configurations WHERE project_id=NEW.project_id),1) END
      AND json_extract(r.after_json,'$.maximum') IS CASE WHEN NEW.configuration='override' THEN NEW.maximum
        ELSE (SELECT maximum FROM project_selection_policy_configurations WHERE project_id=NEW.project_id) END
      AND json_extract(r.after_json,'$.albumRevision')=NEW.revision
      AND r.event_id='selection-policy-config:'||c.id
  ) THEN RAISE(ABORT,'INVALID_SELECTION_POLICY_CONFIGURATION_WITNESS') END;
END;

CREATE VIEW effective_selection_policy AS
SELECT a.id AS album_id,a.workspace_id,a.project_id,
  CASE WHEN ac.configuration='override' THEN ac.minimum ELSE COALESCE(pc.minimum,1) END AS minimum,
  CASE WHEN ac.configuration='override' THEN ac.maximum ELSE pc.maximum END AS maximum,
  'private' AS mode,
  CASE WHEN ac.configuration='override' THEN 'album'
    WHEN pc.project_id IS NOT NULL THEN 'project' ELSE 'system' END AS source,
  COALESCE(ac.revision,0) AS revision,
  COALESCE(pc.revision,0) AS project_revision,
  COALESCE(ac.revision,0) AS album_revision
FROM albums a
LEFT JOIN project_selection_policy_configurations pc
  ON pc.project_id=a.project_id AND pc.workspace_id=a.workspace_id
LEFT JOIN album_selection_policy_configurations ac
  ON ac.album_id=a.id AND ac.workspace_id=a.workspace_id AND ac.project_id=a.project_id;

CREATE TRIGGER selection_policy_configuration_command_guard
BEFORE INSERT ON selection_policy_configuration_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.target_type='project' AND NOT EXISTS(
    SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.target_type='album' AND NOT EXISTS(
    SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      JOIN workspaces w ON w.id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN (NEW.target_type='project' AND NOT EXISTS(
      SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
        AND p.status NOT IN('archived','deleting','deleted')
    )) OR (NEW.target_type='album' AND NOT EXISTS(
      SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
        AND a.project_id=NEW.project_id AND a.state IN('active','draft')
        AND p.status NOT IN('archived','deleting','deleted')
    )) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.target_type<>NEW.target_type OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id IS NOT NEW.album_id
        OR c.expected_project_revision<>NEW.expected_project_revision
        OR c.expected_album_revision IS NOT NEW.expected_album_revision
        OR c.configuration IS NOT NEW.configuration OR c.minimum IS NOT NEW.minimum
        OR c.maximum IS NOT NEW.maximum OR c.payload_json<>NEW.payload_json
        OR c.legacy_payload_json IS NOT NEW.legacy_payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.target_type='project' AND NEW.expected_project_revision<>COALESCE(
    (SELECT revision FROM project_selection_policy_configurations p WHERE p.project_id=NEW.project_id),0
  ) THEN RAISE(ABORT,'SELECTION_POLICY_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.target_type='album' AND (
    NEW.expected_album_revision<>COALESCE(
      (SELECT revision FROM album_selection_policy_configurations a WHERE a.album_id=NEW.album_id),0
    )
    OR NEW.expected_project_revision<>COALESCE(
      (SELECT revision FROM project_selection_policy_configurations p WHERE p.project_id=NEW.project_id),0
    )
  ) THEN RAISE(ABORT,'SELECTION_POLICY_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.target_type='project' AND NEW.maximum IS NOT NULL AND EXISTS(
    SELECT 1 FROM guest_selection_round_state r
    JOIN albums a ON a.id=r.album_id AND a.workspace_id=r.workspace_id AND a.project_id=r.project_id
    LEFT JOIN album_selection_policy_configurations ac ON ac.album_id=a.id
    WHERE r.project_id=NEW.project_id AND r.status='open'
      AND COALESCE(ac.configuration,'inherit')='inherit'
      AND (SELECT count(*) FROM guest_selection_state st
        WHERE st.invite_id=r.invite_id AND st.guest_id=r.guest_id AND st.album_id=r.album_id)>NEW.maximum
  ) THEN RAISE(ABORT,'SELECTION_POLICY_BELOW_CURRENT') END;
  SELECT CASE WHEN NEW.target_type='album' AND (
    CASE WHEN NEW.configuration='override' THEN NEW.maximum
      ELSE COALESCE((SELECT p.maximum FROM project_selection_policy_configurations p
        WHERE p.project_id=NEW.project_id),NULL) END
  ) IS NOT NULL AND EXISTS(
    SELECT 1 FROM guest_selection_round_state r
    WHERE r.album_id=NEW.album_id AND r.status='open'
      AND (SELECT count(*) FROM guest_selection_state st
        WHERE st.invite_id=r.invite_id AND st.guest_id=r.guest_id AND st.album_id=r.album_id)>
        CASE WHEN NEW.configuration='override' THEN NEW.maximum
          ELSE COALESCE((SELECT p.maximum FROM project_selection_policy_configurations p
            WHERE p.project_id=NEW.project_id),NULL) END
  ) THEN RAISE(ABORT,'SELECTION_POLICY_BELOW_CURRENT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

CREATE TRIGGER selection_policy_configuration_command_apply
AFTER INSERT ON selection_policy_configuration_commands BEGIN
  INSERT INTO selection_policy_configuration_results(
    command_id,previous_command_id,previous_legacy_command_id,before_json,after_json,
    result_json,event_id,occurred_at_utc
  )
  SELECT NEW.id,s.last_command_id,NULL,
    json_object('targetType','project','projectId',NEW.project_id,
      'minimum',COALESCE(s.minimum,1),'maximum',s.maximum,'revision',COALESCE(s.revision,0)),
    json_object('targetType','project','projectId',NEW.project_id,
      'minimum',NEW.minimum,'maximum',NEW.maximum,
      'revision',COALESCE(s.revision,0)+CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum
        OR s.maximum IS NOT NEW.maximum THEN 1 ELSE 0 END),
    json_object('configuration',json_object('projectId',NEW.project_id,
      'minimum',NEW.minimum,'maximum',NEW.maximum,
      'revision',COALESCE(s.revision,0)+CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum
        OR s.maximum IS NOT NEW.maximum THEN 1 ELSE 0 END),
      'eventId',CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum
        THEN 'selection-policy-config:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum
      THEN 'selection-policy-config:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM (SELECT 1) seed LEFT JOIN project_selection_policy_configurations s
    ON s.project_id=NEW.project_id
  WHERE NEW.target_type='project';

  INSERT INTO selection_policy_configuration_results(
    command_id,previous_command_id,previous_legacy_command_id,before_json,after_json,
    result_json,event_id,occurred_at_utc
  )
  SELECT NEW.id,s.last_command_id,s.legacy_command_id,
    json_object('targetType','album','albumId',NEW.album_id,'projectId',NEW.project_id,
      'configuration',COALESCE(s.configuration,'inherit'),
      'minimum',CASE WHEN s.configuration='override' THEN s.minimum ELSE COALESCE(pc.minimum,1) END,
      'maximum',CASE WHEN s.configuration='override' THEN s.maximum ELSE pc.maximum END,
      'mode','private',
      'source',CASE WHEN s.configuration='override' THEN 'album'
        WHEN pc.project_id IS NOT NULL THEN 'project' ELSE 'system' END,
      'projectRevision',COALESCE(pc.revision,0),'albumRevision',COALESCE(s.revision,0)),
    json_object('targetType','album','albumId',NEW.album_id,'projectId',NEW.project_id,
      'configuration',NEW.configuration,
      'minimum',CASE WHEN NEW.configuration='override' THEN NEW.minimum ELSE COALESCE(pc.minimum,1) END,
      'maximum',CASE WHEN NEW.configuration='override' THEN NEW.maximum ELSE pc.maximum END,
      'mode','private',
      'source',CASE WHEN NEW.configuration='override' THEN 'album'
        WHEN pc.project_id IS NOT NULL THEN 'project' ELSE 'system' END,
      'projectRevision',COALESCE(pc.revision,0),
      'albumRevision',COALESCE(s.revision,0)+CASE WHEN COALESCE(s.configuration,'inherit')<>NEW.configuration
        OR (NEW.configuration='override' AND (s.minimum IS NOT NEW.minimum OR s.maximum IS NOT NEW.maximum))
        THEN 1 ELSE 0 END),
    json_object('configuration',json_object('albumId',NEW.album_id,'projectId',NEW.project_id,
      'configuration',NEW.configuration,
      'policy',json_object(
        'minimum',CASE WHEN NEW.configuration='override' THEN NEW.minimum ELSE COALESCE(pc.minimum,1) END,
        'maximum',CASE WHEN NEW.configuration='override' THEN NEW.maximum ELSE pc.maximum END,
        'mode','private',
        'source',CASE WHEN NEW.configuration='override' THEN 'album'
          WHEN pc.project_id IS NOT NULL THEN 'project' ELSE 'system' END,
        'projectRevision',COALESCE(pc.revision,0),
        'albumRevision',COALESCE(s.revision,0)+CASE WHEN COALESCE(s.configuration,'inherit')<>NEW.configuration
          OR (NEW.configuration='override' AND (s.minimum IS NOT NEW.minimum OR s.maximum IS NOT NEW.maximum))
          THEN 1 ELSE 0 END)),
      'eventId',CASE WHEN COALESCE(s.configuration,'inherit')<>NEW.configuration
        OR (NEW.configuration='override' AND (s.minimum IS NOT NEW.minimum OR s.maximum IS NOT NEW.maximum))
        THEN 'selection-policy-config:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN COALESCE(s.configuration,'inherit')<>NEW.configuration
      OR (NEW.configuration='override' AND (s.minimum IS NOT NEW.minimum OR s.maximum IS NOT NEW.maximum))
      THEN 'selection-policy-config:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM (SELECT 1) seed
  LEFT JOIN album_selection_policy_configurations s ON s.album_id=NEW.album_id
  LEFT JOIN project_selection_policy_configurations pc ON pc.project_id=NEW.project_id
  WHERE NEW.target_type='album';

  INSERT INTO project_selection_policy_configurations(
    project_id,workspace_id,minimum,maximum,revision,last_command_id,updated_at_ms
  )
  SELECT NEW.project_id,NEW.workspace_id,NEW.minimum,NEW.maximum,
    COALESCE(s.revision,0)+1,NEW.id,NEW.created_at_ms
  FROM (SELECT 1) seed LEFT JOIN project_selection_policy_configurations s
    ON s.project_id=NEW.project_id
  WHERE NEW.target_type='project'
    AND (COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum)
  ON CONFLICT(project_id) DO UPDATE SET minimum=excluded.minimum,maximum=excluded.maximum,
    revision=excluded.revision,last_command_id=excluded.last_command_id,updated_at_ms=excluded.updated_at_ms;

  INSERT INTO album_selection_policy_configurations(
    album_id,workspace_id,project_id,configuration,minimum,maximum,revision,
    last_command_id,legacy_command_id,updated_at_ms
  )
  SELECT NEW.album_id,NEW.workspace_id,NEW.project_id,NEW.configuration,NEW.minimum,NEW.maximum,
    COALESCE(s.revision,0)+1,NEW.id,s.legacy_command_id,NEW.created_at_ms
  FROM (SELECT 1) seed LEFT JOIN album_selection_policy_configurations s
    ON s.album_id=NEW.album_id
  WHERE NEW.target_type='album'
    AND (COALESCE(s.configuration,'inherit')<>NEW.configuration
      OR (NEW.configuration='override' AND (s.minimum IS NOT NEW.minimum OR s.maximum IS NOT NEW.maximum)))
  ON CONFLICT(album_id) DO UPDATE SET configuration=excluded.configuration,
    minimum=excluded.minimum,maximum=excluded.maximum,revision=excluded.revision,
    last_command_id=excluded.last_command_id,updated_at_ms=excluded.updated_at_ms;

  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    'selection.policy_configuration_changed',r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM selection_policy_configuration_results r
  WHERE r.command_id=NEW.id AND r.event_id IS NOT NULL;
END;

CREATE VIEW project_selection_policy_configuration_view AS
SELECT p.id AS project_id,p.workspace_id,
  COALESCE(c.minimum,1) AS minimum,c.maximum,COALESCE(c.revision,0) AS revision
FROM projects p LEFT JOIN project_selection_policy_configurations c
  ON c.project_id=p.id AND c.workspace_id=p.workspace_id;

DROP TRIGGER guest_selection_state_limit_guard;
CREATE TRIGGER guest_selection_state_limit_guard
BEFORE INSERT ON guest_selection_state
WHEN NOT EXISTS(
  SELECT 1 FROM guest_selection_state s
  WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id
    AND s.album_id=NEW.album_id AND s.photo_id=NEW.photo_id
) BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM effective_selection_policy p
    WHERE p.album_id=NEW.album_id AND p.maximum IS NOT NULL
      AND (SELECT count(*) FROM guest_selection_state s
        WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id
          AND s.album_id=NEW.album_id)>=p.maximum
  ) THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
END;

DROP TRIGGER guest_selection_submission_bounds_guard;
CREATE TRIGGER guest_selection_submission_bounds_guard
AFTER INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN (
    SELECT count(*) FROM guest_selection_state s
    WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id
  )<COALESCE((SELECT p.minimum FROM effective_selection_policy p WHERE p.album_id=NEW.album_id),1)
    THEN RAISE(ABORT,'SELECTION_MINIMUM_NOT_MET') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM effective_selection_policy p
    WHERE p.album_id=NEW.album_id AND p.maximum IS NOT NULL
      AND (SELECT count(*) FROM guest_selection_state s
        WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id)>p.maximum
  ) THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
END;

-- No new 0028 commands are issued after the adapter migration. Historical
-- command/result/audit rows remain immutable replay witnesses.
CREATE TRIGGER selection_policy_legacy_command_read_only
BEFORE INSERT ON selection_policy_commands BEGIN
  SELECT RAISE(ABORT,'LEGACY_SELECTION_POLICY_READ_ONLY');
END;

-- Complete the Owner request-ID namespace in both directions. AFTER guards
-- abort the whole legacy statement and every row its other triggers wrote.
CREATE TRIGGER request_commands_policy_configuration_namespace
AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_policy_configuration_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_policy_configuration_namespace
AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_policy_configuration_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_policy_configuration_namespace
AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_policy_configuration_namespace
AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_owner_policy_configuration_namespace
AFTER INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_reopened_policy_configuration_namespace
BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

-- REPLACE can bypass delete triggers when recursive_triggers is off.
-- Reject duplicate insertion explicitly; existing result/audit bytes are immutable.
CREATE TRIGGER selection_policy_configuration_results_no_replace
BEFORE INSERT ON selection_policy_configuration_results
WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_results r WHERE r.command_id=NEW.command_id) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_RESULT');
END;
CREATE TRIGGER selection_policy_results_no_replace
BEFORE INSERT ON selection_policy_results
WHEN EXISTS(SELECT 1 FROM selection_policy_results r WHERE r.command_id=NEW.command_id) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_RESULT');
END;
CREATE TRIGGER audit_events_no_replace
BEFORE INSERT ON audit_events
WHEN EXISTS(SELECT 1 FROM audit_events e WHERE e.event_id=NEW.event_id) BEGIN
  SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT');
END;
