-- Additive, local-only Guest exchange foundation. No existing Guest state is rewritten.
-- There is no TTL: only confirmed native-KDF completion may release this slot.

CREATE TABLE guest_kdf_permits(
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES guest_invites(id),
  request_id TEXT NOT NULL,
  acquired_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000)
);
CREATE TABLE guest_kdf_permit_releases(
  permit_id TEXT PRIMARY KEY REFERENCES guest_kdf_permits(id),
  released_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000)
);
CREATE TABLE guest_kdf_active_slot(
  slot INTEGER PRIMARY KEY CHECK(slot=1),
  permit_id TEXT NOT NULL UNIQUE REFERENCES guest_kdf_permits(id)
);

-- Owner and Guest use distinct immutable ledgers but share one global active slot.
DROP TRIGGER kdf_permit_guard;
CREATE TRIGGER kdf_permit_guard BEFORE INSERT ON kdf_permits BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM kdf_active_slot WHERE slot=1) OR EXISTS(SELECT 1 FROM guest_kdf_active_slot WHERE slot=1) THEN RAISE(ABORT,'KDF_CAPACITY_UNAVAILABLE') END;
END;
CREATE TRIGGER guest_kdf_permit_guard BEFORE INSERT ON guest_kdf_permits BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status<>'archived'
    WHERE i.id=NEW.invite_id AND i.access_mode<>'link_only' AND i.password_verifier IS NOT NULL AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
      AND (i.max_uses IS NULL OR (SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id)<i.max_uses)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM kdf_active_slot WHERE slot=1) OR EXISTS(SELECT 1 FROM guest_kdf_active_slot WHERE slot=1) THEN RAISE(ABORT,'KDF_CAPACITY_UNAVAILABLE') END;
END;
CREATE TRIGGER guest_kdf_permit_audit AFTER INSERT ON guest_kdf_permits BEGIN
  INSERT INTO guest_kdf_active_slot(slot,permit_id) VALUES(1,NEW.id);
  INSERT INTO audit_events(event_id,actor_type,workspace_id,project_id,action,after_json,request_id)
  SELECT 'guest-kdf-acquired:'||NEW.id,'system',i.workspace_id,i.project_id,'security.guest_kdf_acquired',json_object('inviteId',i.id,'permitId',NEW.id),NEW.request_id
  FROM guest_invites i WHERE i.id=NEW.invite_id;
END;
CREATE TRIGGER guest_kdf_release_guard BEFORE INSERT ON guest_kdf_permit_releases BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_kdf_active_slot s WHERE s.slot=1 AND s.permit_id=NEW.permit_id) THEN RAISE(ABORT,'KDF_RELEASE_UNAVAILABLE') END;
END;
CREATE TRIGGER guest_kdf_release_audit AFTER INSERT ON guest_kdf_permit_releases BEGIN
  DELETE FROM guest_kdf_active_slot WHERE slot=1 AND permit_id=NEW.permit_id;
  INSERT INTO audit_events(event_id,actor_type,workspace_id,project_id,action,after_json,request_id)
  SELECT 'guest-kdf-released:'||p.id,'system',i.workspace_id,i.project_id,'security.guest_kdf_released',json_object('inviteId',i.id,'permitId',p.id),p.request_id
  FROM guest_kdf_permits p JOIN guest_invites i ON i.id=p.invite_id WHERE p.id=NEW.permit_id;
END;
CREATE TRIGGER guest_kdf_permits_no_update BEFORE UPDATE ON guest_kdf_permits BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_KDF_PERMIT'); END;
CREATE TRIGGER guest_kdf_permits_no_delete BEFORE DELETE ON guest_kdf_permits BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_KDF_PERMIT'); END;
CREATE TRIGGER guest_kdf_releases_no_update BEFORE UPDATE ON guest_kdf_permit_releases BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_KDF_RELEASE'); END;
CREATE TRIGGER guest_kdf_releases_no_delete BEFORE DELETE ON guest_kdf_permit_releases BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_KDF_RELEASE'); END;

CREATE TABLE guest_exchange_commands(
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES guest_invites(id),
  invite_token_hash TEXT NOT NULL CHECK(length(invite_token_hash)=64 AND invite_token_hash NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT NOT NULL,
  request_commitment TEXT NOT NULL CHECK(length(request_commitment)=64 AND request_commitment NOT GLOB '*[^0-9a-f]*'),
  guest_id TEXT NOT NULL UNIQUE REFERENCES guest_identities(id),
  session_id TEXT NOT NULL UNIQUE REFERENCES guest_sessions(id),
  session_secret_hash TEXT NOT NULL UNIQUE CHECK(length(session_secret_hash)=64 AND session_secret_hash NOT GLOB '*[^0-9a-f]*'),
  password_verified INTEGER NOT NULL CHECK(password_verified=1),
  kdf_permit_id TEXT REFERENCES guest_kdf_permits(id),
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  UNIQUE(invite_id,request_id)
);
CREATE INDEX guest_exchange_commands_session ON guest_exchange_commands(session_id);
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
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_GUEST_EXCHANGE_TIME') END;
END;
CREATE TRIGGER guest_exchange_command_apply AFTER INSERT ON guest_exchange_commands BEGIN
  INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms)
  SELECT NEW.session_id,NEW.invite_id,NEW.guest_id,NEW.session_secret_hash,
    CASE WHEN i.expires_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)+86400000 THEN i.expires_at_ms ELSE CAST(unixepoch('subsec')*1000 AS INTEGER)+86400000 END
  FROM guest_invites i WHERE i.id=NEW.invite_id;
END;
CREATE TRIGGER guest_exchange_commands_no_update BEFORE UPDATE ON guest_exchange_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_EXCHANGE_COMMAND'); END;
CREATE TRIGGER guest_exchange_commands_no_delete BEFORE DELETE ON guest_exchange_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_EXCHANGE_COMMAND'); END;

-- Keep the existing event ID/schema but correlate future exchange events to the client request.
DROP TRIGGER guest_session_audit;
CREATE TRIGGER guest_session_audit AFTER INSERT ON guest_sessions BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,action,after_json,request_id)
  SELECT 'guest-session:'||NEW.id,'guest',NEW.guest_id,NEW.id,i.workspace_id,i.project_id,'guest.session_created',json_object('inviteId',i.id,'expiresAtMs',NEW.expires_at_ms),
    COALESCE((SELECT c.request_id FROM guest_exchange_commands c WHERE c.session_id=NEW.id),'guest-session:'||NEW.id)
  FROM guest_invites i WHERE i.id=NEW.invite_id;
END;
