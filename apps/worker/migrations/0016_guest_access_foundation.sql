-- Additive authorization foundation only. Public issuance/exchange stays absent.
-- No existing table rebuild, backfill, photo access or deletion.
CREATE UNIQUE INDEX albums_guest_scope ON albums(id,workspace_id,project_id);
CREATE TABLE guest_invites(
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  access_mode TEXT NOT NULL CHECK(access_mode IN('link_only','generated_password','custom_password')),
  password_verifier TEXT,
  permissions_mask INTEGER NOT NULL CHECK(typeof(permissions_mask)='integer' AND permissions_mask BETWEEN 0 AND 4095),
  expires_at_ms INTEGER NOT NULL CHECK(typeof(expires_at_ms)='integer'),
  max_uses INTEGER CHECK(max_uses IS NULL OR (typeof(max_uses)='integer' AND max_uses BETWEEN 1 AND 10000)),
  created_by TEXT NOT NULL REFERENCES users(id),
  owner_session_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  UNIQUE(id,workspace_id,project_id),
  CHECK((access_mode='link_only' AND password_verifier IS NULL) OR (access_mode<>'link_only' AND password_verifier IS NOT NULL AND length(password_verifier) BETWEEN 32 AND 1024)),
  CHECK(expires_at_ms>created_at_ms)
);
CREATE INDEX guest_invites_project ON guest_invites(workspace_id,project_id,created_at_ms,id);
CREATE TABLE guest_invite_albums(
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  PRIMARY KEY(invite_id,album_id),
  FOREIGN KEY(invite_id,workspace_id,project_id) REFERENCES guest_invites(id,workspace_id,project_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id)
);
CREATE TABLE guest_identities(
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES guest_invites(id),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  UNIQUE(id,invite_id)
);
CREATE TABLE guest_invite_seals(
  invite_id TEXT PRIMARY KEY REFERENCES guest_invites(id),
  sealed_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000)
);
CREATE TABLE guest_sessions(
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES guest_invites(id),
  guest_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at_ms INTEGER NOT NULL CHECK(typeof(expires_at_ms)='integer'),
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  CHECK(expires_at_ms>created_at_ms AND expires_at_ms<=created_at_ms+86400000)
);
CREATE INDEX guest_sessions_invite ON guest_sessions(invite_id,created_at_ms,id);
CREATE TABLE guest_invite_revocations(
  invite_id TEXT PRIMARY KEY REFERENCES guest_invites(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  owner_session_id TEXT NOT NULL,
  revoked_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000)
);
CREATE TABLE guest_session_revocations(
  session_id TEXT PRIMARY KEY REFERENCES guest_sessions(id),
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  revoked_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000)
);
CREATE TRIGGER guest_invite_insert_guard BEFORE INSERT ON guest_invites BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM workspaces w JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.owner_session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN projects p ON p.workspace_id=w.id AND p.id=NEW.project_id AND p.status<>'archived'
    WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.created_by
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.expires_at_ms<=unixepoch('subsec')*1000 THEN RAISE(ABORT,'INVITE_EXPIRED') END;
END;
CREATE TRIGGER guest_invite_audit AFTER INSERT ON guest_invites BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,action,after_json,request_id)
  VALUES('guest-invite:'||NEW.id,'user',NEW.created_by,NEW.owner_session_id,NEW.workspace_id,NEW.project_id,'share.created',json_object('inviteId',NEW.id,'accessMode',NEW.access_mode,'permissionsMask',NEW.permissions_mask,'expiresAtMs',NEW.expires_at_ms,'maxUses',NEW.max_uses),'guest-invite:'||NEW.id);
END;
CREATE TRIGGER guest_invite_album_guard BEFORE INSERT ON guest_invite_albums BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_invite_seals WHERE invite_id=NEW.invite_id)
    OR EXISTS(SELECT 1 FROM guest_invite_revocations WHERE invite_id=NEW.invite_id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_SCOPE') END;
END;
CREATE TRIGGER guest_invite_seal_guard BEFORE INSERT ON guest_invite_seals BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=i.owner_session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status<>'archived'
    WHERE i.id=NEW.invite_id AND i.created_by=o.user_id AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
  ) THEN RAISE(ABORT,'GUEST_SCOPE_NOT_READY') END;
END;
CREATE TRIGGER guest_invite_seal_audit AFTER INSERT ON guest_invite_seals BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,action,after_json,request_id)
  SELECT 'guest-invite-seal:'||i.id,'user',i.created_by,i.owner_session_id,i.workspace_id,i.project_id,'share.scope_sealed',json_object('inviteId',i.id,'albumIds',json((SELECT json_group_array(album_id) FROM (SELECT album_id FROM guest_invite_albums WHERE invite_id=i.id ORDER BY album_id)))),'guest-invite-seal:'||i.id FROM guest_invites i WHERE i.id=NEW.invite_id;
END;
CREATE TRIGGER guest_session_insert_guard BEFORE INSERT ON guest_sessions BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
    JOIN workspaces w ON w.id=i.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    WHERE i.id=NEW.invite_id AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NEW.expires_at_ms<=i.expires_at_ms AND p.status<>'archived'
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
      AND (i.max_uses IS NULL OR (SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id)<i.max_uses)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    OR NEW.expires_at_ms<=unixepoch('subsec')*1000 THEN RAISE(ABORT,'INVALID_GUEST_SESSION_TIME') END;
END;
CREATE TRIGGER guest_session_audit AFTER INSERT ON guest_sessions BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,action,after_json,request_id)
  SELECT 'guest-session:'||NEW.id,'guest',NEW.guest_id,NEW.id,i.workspace_id,i.project_id,'guest.session_created',json_object('inviteId',i.id,'expiresAtMs',NEW.expires_at_ms),'guest-session:'||NEW.id FROM guest_invites i WHERE i.id=NEW.invite_id;
END;
CREATE TRIGGER guest_invite_revoke_guard BEFORE INSERT ON guest_invite_revocations BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.owner_session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE i.id=NEW.invite_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
END;
CREATE TRIGGER guest_invite_revoke_audit AFTER INSERT ON guest_invite_revocations BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,action,before_json,after_json,request_id)
  SELECT 'guest-invite-revoke:'||i.id,'user',NEW.actor_id,NEW.owner_session_id,i.workspace_id,i.project_id,'share.revoked','{"revoked":false}','{"revoked":true}','guest-invite-revoke:'||i.id FROM guest_invites i WHERE i.id=NEW.invite_id;
END;
CREATE TRIGGER guest_session_revoke_audit AFTER INSERT ON guest_session_revocations BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,action,before_json,after_json,request_id)
  SELECT 'guest-session-revoke:'||s.id,'guest',s.guest_id,s.id,i.workspace_id,i.project_id,'guest.session_revoked','{"revoked":false}','{"revoked":true}','guest-session-revoke:'||s.id FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id WHERE s.id=NEW.session_id;
END;
CREATE TRIGGER guest_session_revoke_guard BEFORE INSERT ON guest_session_revocations BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_sessions s WHERE s.id=NEW.session_id AND s.secret_hash=NEW.secret_hash)
    THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
END;
CREATE TRIGGER guest_seals_no_update BEFORE UPDATE ON guest_invite_seals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_seals_no_delete BEFORE DELETE ON guest_invite_seals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_invites_no_update BEFORE UPDATE ON guest_invites BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_invites_no_delete BEFORE DELETE ON guest_invites BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_albums_no_update BEFORE UPDATE ON guest_invite_albums BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_albums_no_delete BEFORE DELETE ON guest_invite_albums BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_identities_no_update BEFORE UPDATE ON guest_identities BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_identities_no_delete BEFORE DELETE ON guest_identities BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_sessions_no_update BEFORE UPDATE ON guest_sessions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_sessions_no_delete BEFORE DELETE ON guest_sessions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_invite_revocations_no_update BEFORE UPDATE ON guest_invite_revocations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_invite_revocations_no_delete BEFORE DELETE ON guest_invite_revocations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_session_revocations_no_update BEFORE UPDATE ON guest_session_revocations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
CREATE TRIGGER guest_session_revocations_no_delete BEFORE DELETE ON guest_session_revocations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;
