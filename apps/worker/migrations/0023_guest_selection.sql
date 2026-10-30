-- Add Guest selection state and immutable commands. Existing Guest/audit/photo history is untouched.
PRAGMA foreign_keys=ON;
CREATE UNIQUE INDEX guest_invite_album_selection_scope ON guest_invite_albums(invite_id,workspace_id,project_id,album_id);
CREATE UNIQUE INDEX guest_sessions_selection_scope ON guest_sessions(id,guest_id,invite_id);

CREATE TABLE guest_selection_state(
  invite_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  selected_at_ms INTEGER NOT NULL CHECK(typeof(selected_at_ms)='integer'),
  PRIMARY KEY(invite_id,guest_id,photo_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_selection_album_page ON guest_selection_state(invite_id,guest_id,album_id,selected_at_ms,photo_id);

CREATE TABLE guest_selection_commands(
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  selected INTEGER NOT NULL CHECK(selected IN(0,1)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_extract(payload_json,'$.selected')=selected AND json_extract(payload_json,'$.versionId')=version_id),
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_selection_commands_photo ON guest_selection_commands(invite_id,guest_id,photo_id,created_at_ms);

CREATE TABLE guest_selection_results(
  command_id TEXT PRIMARY KEY REFERENCES guest_selection_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

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
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id OR c.selected<>NEW.selected OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
END;

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
CREATE TRIGGER guest_selection_commands_no_update BEFORE UPDATE ON guest_selection_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_COMMAND'); END;
CREATE TRIGGER guest_selection_commands_no_delete BEFORE DELETE ON guest_selection_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_COMMAND'); END;
CREATE TRIGGER guest_selection_results_no_update BEFORE UPDATE ON guest_selection_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_RESULT'); END;
CREATE TRIGGER guest_selection_results_no_delete BEFORE DELETE ON guest_selection_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_RESULT'); END;
