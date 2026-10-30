-- Additive self-logout and strict verifier shape for NEW password invites only.
-- Existing hashes/verifiers/revocations/audit are preserved, never rewritten.
CREATE TABLE guest_logout_commands(
  guest_id TEXT NOT NULL REFERENCES guest_identities(id),
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES guest_sessions(id),
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  PRIMARY KEY(guest_id,request_id)
);
CREATE TRIGGER guest_logout_command_guard BEFORE INSERT ON guest_logout_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_sessions s WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.secret_hash=NEW.secret_hash) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id AND (c.session_id<>NEW.session_id OR c.secret_hash<>NEW.secret_hash)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=NEW.session_id) THEN RAISE(IGNORE) END;
END;
CREATE TRIGGER guest_logout_command_apply AFTER INSERT ON guest_logout_commands BEGIN
  INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(NEW.session_id,NEW.secret_hash);
END;
CREATE TRIGGER guest_logout_no_update BEFORE UPDATE ON guest_logout_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMAND'); END;
CREATE TRIGGER guest_logout_no_delete BEFORE DELETE ON guest_logout_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMAND'); END;
DROP TRIGGER guest_session_revoke_audit;
CREATE TRIGGER guest_session_revoke_audit AFTER INSERT ON guest_session_revocations BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,action,before_json,after_json,request_id)
  SELECT 'guest-session-revoke:'||s.id,'guest',s.guest_id,s.id,i.workspace_id,i.project_id,'guest.session_revoked',json_object('inviteId',i.id,'revoked',json('false')),json_object('inviteId',i.id,'revoked',json('true')),
    COALESCE((SELECT request_id FROM guest_logout_commands c WHERE c.session_id=s.id AND c.guest_id=s.guest_id AND c.secret_hash=NEW.secret_hash),'guest-session-revoke:'||s.id)
    FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id WHERE s.id=NEW.session_id;
END;
CREATE TRIGGER guest_password_verifier_guard BEFORE INSERT ON guest_invites BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.created_by AND o.enabled=1 AND s.id=NEW.owner_session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.access_mode<>'link_only' AND (
    NEW.password_verifier IS NULL
    OR instr(NEW.password_verifier,char(0))>0
    OR length(NEW.password_verifier)<>length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+97
    OR substr(NEW.password_verifier,1,length('$kino-scrypt$v=1$N=32768,r=8,p=3$'))<>'$kino-scrypt$v=1$N=32768,r=8,p=3$'
    OR substr(NEW.password_verifier,length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+1,32) GLOB '*[^0-9a-f]*'
    OR substr(NEW.password_verifier,length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+33,1)<>'$'
    OR substr(NEW.password_verifier,length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+34,64) GLOB '*[^0-9a-f]*'
  ) THEN RAISE(ABORT,'INVALID_GUEST_PASSWORD_VERIFIER') END;
END;
