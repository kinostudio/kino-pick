-- Add Guest selection state reads, frozen submission snapshots and explicit rounds.
-- Existing selection commands/audit remain immutable and are used to seed round revisions.
PRAGMA foreign_keys=ON;

CREATE TABLE guest_selection_round_state(
  invite_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  round_no INTEGER NOT NULL DEFAULT 1 CHECK(round_no>0),
  selection_revision INTEGER NOT NULL DEFAULT 0 CHECK(selection_revision>=0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','submitted')),
  submitted_at_ms INTEGER CHECK(submitted_at_ms IS NULL OR typeof(submitted_at_ms)='integer'),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  PRIMARY KEY(invite_id,guest_id,album_id),
  CHECK((status='open' AND submitted_at_ms IS NULL) OR (status='submitted' AND submitted_at_ms IS NOT NULL)),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id)
);
INSERT INTO guest_selection_round_state(invite_id,guest_id,workspace_id,project_id,album_id,round_no,selection_revision,status,submitted_at_ms,updated_at_ms)
SELECT c.invite_id,c.guest_id,c.workspace_id,c.project_id,c.album_id,1,
  SUM(CASE WHEN r.event_id IS NOT NULL THEN 1 ELSE 0 END),'open',NULL,MAX(c.created_at_ms)
FROM guest_selection_commands c JOIN guest_selection_results r ON r.command_id=c.id
GROUP BY c.invite_id,c.guest_id,c.workspace_id,c.project_id,c.album_id;

CREATE TRIGGER guest_selection_round_state_no_delete BEFORE DELETE ON guest_selection_round_state BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_ROUND_STATE');
END;
CREATE TRIGGER guest_selection_round_state_update_guard BEFORE UPDATE ON guest_selection_round_state BEGIN
  SELECT CASE WHEN NOT (
    (OLD.status='open' AND NEW.status='open' AND NEW.round_no=OLD.round_no
      AND NEW.selection_revision=OLD.selection_revision+1 AND NEW.submitted_at_ms IS NULL)
    OR (OLD.status='open' AND NEW.status='submitted' AND NEW.round_no=OLD.round_no
      AND NEW.selection_revision=OLD.selection_revision AND NEW.submitted_at_ms IS NOT NULL
      AND EXISTS(SELECT 1 FROM guest_selection_submissions s WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id AND s.round_no=NEW.round_no))
    OR (OLD.status='submitted' AND NEW.status='open' AND NEW.round_no=OLD.round_no+1
      AND NEW.selection_revision=0 AND NEW.submitted_at_ms IS NULL
      AND EXISTS(SELECT 1 FROM audit_events e JOIN owners o ON o.user_id=e.actor_id AND o.enabled=1
        JOIN workspaces w ON w.owner_user_id=o.user_id AND w.id=NEW.workspace_id
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=e.session_id AND s.expiresAt>unixepoch('subsec')*1000
        WHERE e.event_id='guest-selection-reopen:'||NEW.invite_id||':'||NEW.guest_id||':'||NEW.album_id||':'||NEW.round_no
          AND e.actor_type='user' AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id AND e.album_id=NEW.album_id
          AND e.action='selection.reopened' AND json_extract(e.after_json,'$.roundNo')=NEW.round_no))
  ) THEN RAISE(ABORT,'INVALID_GUEST_SELECTION_ROUND_TRANSITION') END;
END;
CREATE TRIGGER guest_selection_state_round_insert AFTER INSERT ON guest_selection_state BEGIN
  INSERT INTO guest_selection_round_state(invite_id,guest_id,workspace_id,project_id,album_id,round_no,selection_revision,status,submitted_at_ms,updated_at_ms)
  VALUES(NEW.invite_id,NEW.guest_id,NEW.workspace_id,NEW.project_id,NEW.album_id,1,1,'open',NULL,NEW.selected_at_ms)
  ON CONFLICT(invite_id,guest_id,album_id) DO UPDATE SET selection_revision=selection_revision+1,updated_at_ms=NEW.selected_at_ms
  WHERE guest_selection_round_state.status='open';
END;
CREATE TRIGGER guest_selection_state_round_update AFTER UPDATE ON guest_selection_state WHEN OLD.version_id<>NEW.version_id BEGIN
  UPDATE guest_selection_round_state SET selection_revision=selection_revision+1,updated_at_ms=NEW.selected_at_ms
  WHERE invite_id=NEW.invite_id AND guest_id=NEW.guest_id AND album_id=NEW.album_id AND status='open';
END;
CREATE TRIGGER guest_selection_state_round_delete AFTER DELETE ON guest_selection_state BEGIN
  UPDATE guest_selection_round_state SET selection_revision=selection_revision+1,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)
  WHERE invite_id=OLD.invite_id AND guest_id=OLD.guest_id AND album_id=OLD.album_id AND status='open';
END;
CREATE INDEX guest_selection_round_status ON guest_selection_round_state(invite_id,guest_id,album_id,status,round_no);

CREATE TABLE guest_selection_submissions(
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  round_no INTEGER NOT NULL CHECK(round_no>0),
  selection_revision INTEGER NOT NULL CHECK(selection_revision>0),
  expected_round_no INTEGER CHECK(expected_round_no IS NULL OR expected_round_no>0),
  expected_revision INTEGER CHECK(expected_revision IS NULL OR expected_revision>=0),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)
    AND json_extract(payload_json,'$.expectedRoundNo') IS expected_round_no
    AND json_extract(payload_json,'$.expectedRevision') IS expected_revision),
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  UNIQUE(guest_id,request_id),
  UNIQUE(invite_id,guest_id,album_id,round_no),
  UNIQUE(id,invite_id,guest_id,workspace_id,project_id,album_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(invite_id,guest_id,album_id) REFERENCES guest_selection_round_state(invite_id,guest_id,album_id)
);
CREATE INDEX guest_selection_submissions_album ON guest_selection_submissions(invite_id,guest_id,album_id,round_no);

CREATE TABLE guest_selection_submission_items(
  submission_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  selected_at_ms INTEGER NOT NULL CHECK(typeof(selected_at_ms)='integer'),
  PRIMARY KEY(submission_id,photo_id),
  FOREIGN KEY(submission_id,invite_id,guest_id,workspace_id,project_id,album_id)
    REFERENCES guest_selection_submissions(id,invite_id,guest_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_selection_submission_items_page ON guest_selection_submission_items(submission_id,selected_at_ms,photo_id);
CREATE TABLE guest_selection_submission_results(
  submission_id TEXT PRIMARY KEY REFERENCES guest_selection_submissions(id),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT NOT NULL UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

-- A changed Guest request ID cannot collide with another selection command/submission.
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
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id OR c.selected<>NEW.selected OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.status='submitted')
    THEN RAISE(ABORT,'SELECTION_ALREADY_SUBMITTED') END;
END;

-- Preserve immutable request result shape and include the current round revision.
DROP TRIGGER guest_selection_command_apply;
CREATE TRIGGER guest_selection_command_apply AFTER INSERT ON guest_selection_commands BEGIN
  INSERT INTO guest_selection_results(command_id,before_json,after_json,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,
    CASE WHEN s.photo_id IS NULL THEN json_object('selected',json('false'),'versionId',NULL,'selectedAt',NULL)
      ELSE json_object('selected',json('true'),'versionId',s.version_id,'selectedAt',strftime('%Y-%m-%dT%H:%M:%fZ',s.selected_at_ms/1000.0,'unixepoch')) END,
    CASE WHEN NEW.selected=1 THEN json_object('selected',json('true'),'versionId',NEW.version_id,'selectedAt',strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(s.selected_at_ms,NEW.created_at_ms)/1000.0,'unixepoch'))
      ELSE json_object('selected',json('false'),'versionId',NULL,'selectedAt',NULL) END,
    json_object('photoId',NEW.photo_id,'selected',json(CASE WHEN NEW.selected=1 THEN 'true' ELSE 'false' END),
      'selectedVersionId',CASE WHEN NEW.selected=1 THEN NEW.version_id ELSE NULL END,
      'selectedAt',CASE WHEN NEW.selected=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(s.selected_at_ms,NEW.created_at_ms)/1000.0,'unixepoch') ELSE NULL END,
      'selectedCount',(SELECT count(*) FROM guest_selection_state x WHERE x.invite_id=NEW.invite_id AND x.guest_id=NEW.guest_id AND x.album_id=NEW.album_id)
        + CASE WHEN NEW.selected=1 AND s.photo_id IS NULL THEN 1 WHEN NEW.selected=0 AND s.photo_id IS NOT NULL THEN -1 ELSE 0 END,
      'roundNo',COALESCE((SELECT r.round_no FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id),1),
      'selectionRevision',COALESCE((SELECT r.selection_revision FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id),0)
        + CASE WHEN (NEW.selected=1 AND (s.photo_id IS NULL OR s.version_id<>NEW.version_id)) OR (NEW.selected=0 AND s.photo_id IS NOT NULL) THEN 1 ELSE 0 END,
      'roundStatus',COALESCE((SELECT r.status FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id),'open'),
      'eventId',CASE WHEN (NEW.selected=1 AND (s.photo_id IS NULL OR s.version_id<>NEW.version_id)) OR (NEW.selected=0 AND s.photo_id IS NOT NULL) THEN 'guest-selection:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN (NEW.selected=1 AND (s.photo_id IS NULL OR s.version_id<>NEW.version_id)) OR (NEW.selected=0 AND s.photo_id IS NOT NULL) THEN 'guest-selection:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM (SELECT 1) seed LEFT JOIN guest_selection_state s ON s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.photo_id=NEW.photo_id;
  INSERT INTO guest_selection_state(invite_id,guest_id,workspace_id,project_id,album_id,photo_id,version_id,selected_at_ms)
    SELECT NEW.invite_id,NEW.guest_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,NEW.created_at_ms WHERE NEW.selected=1
    ON CONFLICT(invite_id,guest_id,photo_id) DO UPDATE SET version_id=excluded.version_id
    WHERE guest_selection_state.version_id<>excluded.version_id;
  DELETE FROM guest_selection_state WHERE invite_id=NEW.invite_id AND guest_id=NEW.guest_id AND photo_id=NEW.photo_id AND NEW.selected=0;
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
    SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,
      COALESCE(json_extract(r.after_json,'$.versionId'),json_extract(r.before_json,'$.versionId'),NEW.version_id),
      CASE WHEN json_extract(r.before_json,'$.selected')=0 THEN 'selection.added'
        WHEN json_extract(r.after_json,'$.selected')=0 THEN 'selection.removed'
        ELSE 'selection.version_changed' END,
      r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
    FROM guest_selection_results r WHERE r.command_id=NEW.id AND r.event_id IS NOT NULL;
END;

-- Keep a submission snapshot pinned to the current server-side selection state.
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
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.round_no<>NEW.round_no OR c.selection_revision<>NEW.selection_revision OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.expected_round_no IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id
      AND r.round_no=NEW.expected_round_no AND r.selection_revision=NEW.expected_revision AND r.status='open'
  ) THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.status='submitted')
    THEN RAISE(ABORT,'SELECTION_ALREADY_SUBMITTED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.round_no=NEW.round_no AND r.selection_revision=NEW.selection_revision AND r.status='open')
    THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_selection_state s WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id)
    THEN RAISE(ABORT,'EMPTY_SELECTION') END;
END;
CREATE TRIGGER guest_selection_submission_apply AFTER INSERT ON guest_selection_submissions BEGIN
  INSERT INTO guest_selection_submission_items(submission_id,invite_id,guest_id,workspace_id,project_id,album_id,photo_id,version_id,selected_at_ms)
  SELECT NEW.id,NEW.invite_id,NEW.guest_id,NEW.workspace_id,NEW.project_id,NEW.album_id,s.photo_id,s.version_id,s.selected_at_ms
  FROM guest_selection_state s WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id;
  INSERT INTO guest_selection_submission_results(submission_id,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,json_object('submissionId',NEW.id,'roundNo',NEW.round_no,'selectionRevision',NEW.selection_revision,
    'selectedCount',(SELECT count(*) FROM guest_selection_submission_items i WHERE i.submission_id=NEW.id),
    'submittedAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch'),
    'eventId','guest-selection-submit:'||NEW.id),
    'guest-selection-submit:'||NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch');
  UPDATE guest_selection_round_state SET status='submitted',submitted_at_ms=NEW.created_at_ms,updated_at_ms=NEW.created_at_ms
  WHERE invite_id=NEW.invite_id AND guest_id=NEW.guest_id AND album_id=NEW.album_id AND round_no=NEW.round_no AND selection_revision=NEW.selection_revision AND status='open';
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,'selection.submitted',
    json_object('roundNo',NEW.round_no,'selectionRevision',NEW.selection_revision,'status','open'),
    json_object('submissionId',NEW.id,'roundNo',NEW.round_no,'selectionRevision',NEW.selection_revision,
      'selectedCount',json_extract(r.result_json,'$.selectedCount'),'status','submitted'),NEW.request_id,r.occurred_at_utc
  FROM guest_selection_submission_results r WHERE r.submission_id=NEW.id;
END;

-- Symmetric request-ID collision guards for Guest logout/exchange and selection ledgers.
DROP TRIGGER guest_logout_command_guard;
CREATE TRIGGER guest_logout_command_guard BEFORE INSERT ON guest_logout_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_sessions s WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.secret_hash=NEW.secret_hash) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id AND (c.session_id<>NEW.session_id OR c.secret_hash<>NEW.secret_hash)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c JOIN guest_sessions s ON s.id=c.session_id WHERE s.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=NEW.session_id) THEN RAISE(IGNORE) END;
END;
DROP TRIGGER guest_exchange_command_guard;
CREATE TRIGGER guest_exchange_command_guard BEFORE INSERT ON guest_exchange_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status<>'archived'
    JOIN guest_identities g ON g.id=NEW.guest_id AND g.invite_id=i.id
    WHERE i.id=NEW.invite_id AND i.token_hash=NEW.invite_token_hash AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
      AND (i.max_uses IS NULL OR (SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id)<i.max_uses)
      AND ((i.access_mode='link_only' AND NEW.kdf_permit_id IS NULL)
        OR (i.access_mode IN('generated_password','custom_password') AND NEW.kdf_permit_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM guest_kdf_permits gp JOIN guest_kdf_permit_releases gr ON gr.permit_id=gp.id WHERE gp.id=NEW.kdf_permit_id AND gp.invite_id=i.id)))
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c JOIN guest_sessions s ON s.id=c.session_id WHERE s.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_GUEST_EXCHANGE_TIME') END;
END;

CREATE TRIGGER guest_selection_submissions_no_update BEFORE UPDATE ON guest_selection_submissions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SUBMISSION'); END;
CREATE TRIGGER guest_selection_submissions_no_delete BEFORE DELETE ON guest_selection_submissions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SUBMISSION'); END;
CREATE TRIGGER guest_selection_submission_items_no_update BEFORE UPDATE ON guest_selection_submission_items BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SNAPSHOT'); END;
CREATE TRIGGER guest_selection_submission_items_no_delete BEFORE DELETE ON guest_selection_submission_items BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SNAPSHOT'); END;
CREATE TRIGGER guest_selection_submission_results_no_update BEFORE UPDATE ON guest_selection_submission_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SUBMISSION_RESULT'); END;
CREATE TRIGGER guest_selection_submission_results_no_delete BEFORE DELETE ON guest_selection_submission_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SUBMISSION_RESULT'); END;
