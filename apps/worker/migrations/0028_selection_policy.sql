-- Add private, per-album selection bounds and serialize policy changes with Guest writes.
PRAGMA foreign_keys=ON;

CREATE TABLE selection_policy_commands(
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision>=0),
  minimum INTEGER NOT NULL CHECK(typeof(minimum)='integer' AND minimum BETWEEN 1 AND 100000),
  maximum INTEGER CHECK(maximum IS NULL OR (typeof(maximum)='integer' AND maximum BETWEEN 1 AND 100000)),
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id) REFERENCES albums(id,workspace_id),
  CHECK(maximum IS NULL OR minimum<=maximum),
  CHECK(CASE WHEN json_valid(payload_json) THEN COALESCE(
    json_type(payload_json)='object'
    AND json_type(payload_json,'$.albumId')='text'
    AND json_extract(payload_json,'$.albumId')=album_id
    AND json_type(payload_json,'$.expectedRevision')='integer'
    AND json_extract(payload_json,'$.expectedRevision')=expected_revision
    AND json_type(payload_json,'$.minimum')='integer'
    AND json_extract(payload_json,'$.minimum')=minimum
    AND json_type(payload_json,'$.maximum') IS CASE WHEN maximum IS NULL THEN 'null' ELSE 'integer' END
    AND json_extract(payload_json,'$.maximum') IS maximum
    AND json_type(payload_json,'$.confirm')='true'
    AND payload_json=json_object('albumId',album_id,'expectedRevision',expected_revision,
      'minimum',minimum,'maximum',maximum,'confirm',json('true')),0
  ) ELSE 0 END=1)
);

CREATE TABLE selection_policy_results(
  command_id TEXT PRIMARY KEY REFERENCES selection_policy_commands(id),
  previous_command_id TEXT REFERENCES selection_policy_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE album_selection_policies(
  album_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  minimum INTEGER NOT NULL CHECK(typeof(minimum)='integer' AND minimum BETWEEN 1 AND 100000),
  maximum INTEGER CHECK(maximum IS NULL OR (typeof(maximum)='integer' AND maximum BETWEEN 1 AND 100000)),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
  last_command_id TEXT NOT NULL UNIQUE REFERENCES selection_policy_commands(id),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  CHECK(maximum IS NULL OR minimum<=maximum),
  FOREIGN KEY(album_id,workspace_id) REFERENCES albums(id,workspace_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id)
);

CREATE INDEX selection_policy_commands_album ON selection_policy_commands(album_id,created_at_ms,id);

CREATE TRIGGER selection_policy_commands_no_update BEFORE UPDATE ON selection_policy_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_COMMAND');
END;
CREATE TRIGGER selection_policy_commands_no_delete BEFORE DELETE ON selection_policy_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_COMMAND');
END;
CREATE TRIGGER selection_policy_results_no_update BEFORE UPDATE ON selection_policy_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_RESULT');
END;
CREATE TRIGGER selection_policy_results_no_delete BEFORE DELETE ON selection_policy_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_RESULT');
END;
CREATE TRIGGER album_selection_policies_no_delete BEFORE DELETE ON album_selection_policies BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_STATE');
END;

CREATE TRIGGER album_selection_policy_insert_witness BEFORE INSERT ON album_selection_policies BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM selection_policy_commands c
    JOIN selection_policy_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.album_id=NEW.album_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.minimum=NEW.minimum AND c.maximum IS NEW.maximum
      AND c.expected_revision=COALESCE((SELECT revision FROM album_selection_policies p WHERE p.album_id=NEW.album_id),0)
      AND NEW.revision=c.expected_revision+1
      AND NEW.updated_at_ms=c.created_at_ms
      AND r.previous_command_id IS (SELECT last_command_id FROM album_selection_policies p WHERE p.album_id=NEW.album_id)
      AND json_extract(r.after_json,'$.minimum')=NEW.minimum
      AND json_extract(r.after_json,'$.maximum') IS NEW.maximum
      AND json_extract(r.after_json,'$.revision')=NEW.revision
      AND r.event_id='selection-policy:'||c.id
  ) THEN RAISE(ABORT,'INVALID_SELECTION_POLICY_WITNESS') END;
END;

CREATE TRIGGER album_selection_policy_update_witness BEFORE UPDATE ON album_selection_policies BEGIN
  SELECT CASE WHEN NEW.album_id<>OLD.album_id OR NEW.workspace_id<>OLD.workspace_id
    OR NEW.project_id<>OLD.project_id
    THEN RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM selection_policy_commands c
    JOIN selection_policy_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.album_id=NEW.album_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.minimum=NEW.minimum AND c.maximum IS NEW.maximum
      AND c.expected_revision=OLD.revision AND NEW.revision=OLD.revision+1
      AND NEW.updated_at_ms=c.created_at_ms
      AND r.previous_command_id=OLD.last_command_id
      AND json_extract(r.after_json,'$.minimum')=NEW.minimum
      AND json_extract(r.after_json,'$.maximum') IS NEW.maximum
      AND json_extract(r.after_json,'$.revision')=NEW.revision
      AND r.event_id='selection-policy:'||c.id
  ) THEN RAISE(ABORT,'INVALID_SELECTION_POLICY_WITNESS') END;
END;

CREATE TRIGGER selection_policy_command_apply AFTER INSERT ON selection_policy_commands BEGIN
  INSERT INTO selection_policy_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,s.last_command_id,
    json_object('albumId',NEW.album_id,'minimum',COALESCE(s.minimum,1),'maximum',s.maximum,
      'revision',COALESCE(s.revision,0),'mode','private'),
    json_object('albumId',NEW.album_id,'minimum',NEW.minimum,'maximum',NEW.maximum,
      'revision',COALESCE(s.revision,0)+CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum THEN 1 ELSE 0 END,
      'mode','private'),
    json_object('policy',json_object('albumId',NEW.album_id,'minimum',NEW.minimum,'maximum',NEW.maximum,
      'revision',COALESCE(s.revision,0)+CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum THEN 1 ELSE 0 END,
      'mode','private'),
      'eventId',CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum THEN 'selection-policy:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum THEN 'selection-policy:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM (SELECT 1) seed
  LEFT JOIN album_selection_policies s ON s.album_id=NEW.album_id;

  INSERT INTO album_selection_policies(album_id,workspace_id,project_id,minimum,maximum,revision,last_command_id,updated_at_ms)
  SELECT NEW.album_id,NEW.workspace_id,NEW.project_id,NEW.minimum,NEW.maximum,COALESCE(s.revision,0)+1,NEW.id,NEW.created_at_ms
  FROM (SELECT 1) seed
  LEFT JOIN album_selection_policies s ON s.album_id=NEW.album_id
  WHERE COALESCE(s.minimum,1)<>NEW.minimum OR s.maximum IS NOT NEW.maximum
  ON CONFLICT(album_id) DO UPDATE SET
    minimum=excluded.minimum,maximum=excluded.maximum,revision=excluded.revision,
    last_command_id=excluded.last_command_id,updated_at_ms=excluded.updated_at_ms;

  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    'selection.policy_changed',r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM selection_policy_results r WHERE r.command_id=NEW.id AND r.event_id IS NOT NULL;
END;

CREATE TRIGGER selection_policy_command_guard BEFORE INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=NEW.actor_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND a.state IN('active','draft')
      AND p.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.album_id<>NEW.album_id OR c.expected_revision<>NEW.expected_revision
        OR c.minimum<>NEW.minimum OR c.maximum IS NOT NEW.maximum OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.expected_revision<>COALESCE(
    (SELECT revision FROM album_selection_policies p WHERE p.album_id=NEW.album_id),0
  ) THEN RAISE(ABORT,'SELECTION_POLICY_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.maximum IS NOT NULL AND EXISTS(
    SELECT 1 FROM guest_selection_round_state r
    WHERE r.album_id=NEW.album_id AND r.status='open'
      AND (SELECT count(*) FROM guest_selection_state s
        WHERE s.invite_id=r.invite_id AND s.guest_id=r.guest_id AND s.album_id=r.album_id)>NEW.maximum
  ) THEN RAISE(ABORT,'SELECTION_POLICY_BELOW_CURRENT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

-- Keep the Owner request-ID namespace symmetric with all prior Owner ledgers.
CREATE TRIGGER request_commands_selection_policy_namespace AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_selection_policy_namespace AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_requests_selection_policy_namespace AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_commands_selection_policy_namespace AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_commands_selection_policy_namespace AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_commands_selection_policy_namespace AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_reopened_selection_policy_namespace BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

-- A cap only applies to a new logical selection key. Re-versioning an existing key,
-- exact retries/no-ops, and deselection remain available at the limit.
CREATE TRIGGER guest_selection_state_limit_guard BEFORE INSERT ON guest_selection_state
WHEN NOT EXISTS(
  SELECT 1 FROM guest_selection_state s
  WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id
    AND s.album_id=NEW.album_id AND s.photo_id=NEW.photo_id
) BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM album_selection_policies p
    WHERE p.album_id=NEW.album_id AND p.maximum IS NOT NULL
      AND (SELECT count(*) FROM guest_selection_state s
        WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id)>=p.maximum
  ) THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
END;

-- Read only the live selection state here. The submission's sibling AFTER trigger
-- writes its immutable snapshot; trigger order must not affect these bounds.
CREATE TRIGGER guest_selection_submission_bounds_guard AFTER INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN (
    SELECT count(*) FROM guest_selection_state s
    WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id
  )<COALESCE((SELECT p.minimum FROM album_selection_policies p WHERE p.album_id=NEW.album_id),1)
    THEN RAISE(ABORT,'SELECTION_MINIMUM_NOT_MET') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM album_selection_policies p
    WHERE p.album_id=NEW.album_id AND p.maximum IS NOT NULL
      AND (SELECT count(*) FROM guest_selection_state s
        WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id)>p.maximum
  ) THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
END;

-- Preserve current ACL, replay and submitted-round guards while making feedback
-- request IDs symmetric with the Guest selection command ledger.
DROP TRIGGER guest_selection_command_guard;
CREATE TRIGGER guest_selection_command_guard BEFORE INSERT ON guest_selection_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=i.workspace_id AND ph.project_id=i.project_id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=ph.workspace_id AND v.photo_id=ph.id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id AND s.secret_hash=NEW.secret_hash
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND (i.permissions_mask & 8)=8
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c JOIN guest_sessions s ON s.id=c.session_id WHERE s.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id OR c.selected<>NEW.selected OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.status='submitted')
    THEN RAISE(ABORT,'SELECTION_ALREADY_SUBMITTED') END;
END;

-- Keep strict submission replay ahead of the new AFTER bounds guard. A feedback
-- command collision is checked before this ledger's own exact-replay IGNORE.
DROP TRIGGER guest_selection_submission_guard;
CREATE TRIGGER guest_selection_submission_guard BEFORE INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id AND s.secret_hash=NEW.secret_hash
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id AND (i.permissions_mask & 512)=512
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.round_no<>NEW.round_no OR c.selection_revision<>NEW.selection_revision OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_selection_state s WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id)
    THEN RAISE(ABORT,'EMPTY_SELECTION') END;
  SELECT CASE WHEN NEW.expected_round_no IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id
      AND r.round_no=NEW.expected_round_no AND r.selection_revision=NEW.expected_revision AND r.status='open'
  ) THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.status='submitted')
    THEN RAISE(ABORT,'SELECTION_ALREADY_SUBMITTED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.round_no=NEW.round_no AND r.selection_revision=NEW.selection_revision AND r.status='open')
    THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
END;

