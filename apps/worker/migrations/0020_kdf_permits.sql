-- Global single native-KDF slot. No TTL: time passing cannot prove native work stopped.
CREATE TABLE kdf_permits(
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL, request_id TEXT NOT NULL,
  acquired_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000)
);
CREATE TABLE kdf_permit_releases(
  permit_id TEXT PRIMARY KEY REFERENCES kdf_permits(id),
  released_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000)
);
-- Bounded current state; append-only permit/release/audit ledgers retain history.
CREATE TABLE kdf_active_slot(
  slot INTEGER PRIMARY KEY CHECK(slot=1),
  permit_id TEXT NOT NULL UNIQUE REFERENCES kdf_permits(id)
);
CREATE TRIGGER kdf_permit_guard BEFORE INSERT ON kdf_permits BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM kdf_active_slot WHERE slot=1) THEN RAISE(ABORT,'KDF_CAPACITY_UNAVAILABLE') END;
END;
CREATE TRIGGER kdf_permit_audit AFTER INSERT ON kdf_permits BEGIN
  INSERT INTO kdf_active_slot(slot,permit_id) VALUES(1,NEW.id);
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,action,after_json,request_id)
  VALUES('kdf-acquired:'||NEW.id,'user',NEW.actor_id,NEW.session_id,'security.kdf_acquired',json_object('permitId',NEW.id),NEW.request_id);
END;
CREATE TRIGGER kdf_release_audit AFTER INSERT ON kdf_permit_releases BEGIN
  DELETE FROM kdf_active_slot WHERE slot=1 AND permit_id=NEW.permit_id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,action,after_json,request_id)
  SELECT 'kdf-released:'||p.id,'system',p.actor_id,p.session_id,'security.kdf_released',json_object('permitId',p.id),p.request_id FROM kdf_permits p WHERE p.id=NEW.permit_id;
END;
CREATE TRIGGER kdf_permits_no_update BEFORE UPDATE ON kdf_permits BEGIN SELECT RAISE(ABORT,'IMMUTABLE_KDF_PERMIT'); END;
CREATE TRIGGER kdf_permits_no_delete BEFORE DELETE ON kdf_permits BEGIN SELECT RAISE(ABORT,'IMMUTABLE_KDF_PERMIT'); END;
CREATE TRIGGER kdf_releases_no_update BEFORE UPDATE ON kdf_permit_releases BEGIN SELECT RAISE(ABORT,'IMMUTABLE_KDF_RELEASE'); END;
CREATE TRIGGER kdf_releases_no_delete BEFORE DELETE ON kdf_permit_releases BEGIN SELECT RAISE(ABORT,'IMMUTABLE_KDF_RELEASE'); END;
