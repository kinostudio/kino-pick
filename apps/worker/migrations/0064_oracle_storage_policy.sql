-- Configuration only. Does not activate an S3 node or relax existing upload guards.
CREATE TABLE oracle_storage_policy(
 id INTEGER PRIMARY KEY CHECK(id=1),
 requested_enabled INTEGER NOT NULL DEFAULT 0 CHECK(requested_enabled IN(0,1)),
 quota_bytes INTEGER NOT NULL DEFAULT 30000000000 CHECK(quota_bytes BETWEEN 1000000000 AND 100000000000),
 free_floor_bytes INTEGER NOT NULL DEFAULT 20000000000 CHECK(free_floor_bytes=20000000000),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT INTO oracle_storage_policy(id) VALUES(1);
CREATE TABLE oracle_storage_policy_commands(
 request_id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id),
 session_id TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 requested_enabled INTEGER NOT NULL CHECK(requested_enabled IN(0,1)),
 quota_bytes INTEGER NOT NULL CHECK(quota_bytes BETWEEN 1000000000 AND 100000000000),
 occurred_at_ms INTEGER NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
CREATE TRIGGER oracle_storage_policy_command_guard BEFORE INSERT ON oracle_storage_policy_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN NEW.occurred_at_ms<unixepoch('subsec')*1000-60000 OR NEW.occurred_at_ms>unixepoch('subsec')*1000+60000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM oracle_storage_policy_commands WHERE request_id=NEW.request_id AND(actor_id<>NEW.actor_id OR session_id<>NEW.session_id OR payload_json<>NEW.payload_json)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM oracle_storage_policy_commands WHERE request_id=NEW.request_id) THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NEW.expected_revision<>(SELECT revision FROM oracle_storage_policy WHERE id=1) THEN RAISE(ABORT,'STORAGE_POLICY_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM storage_nodes WHERE id='oracle-vm' AND used_bytes+reserved_bytes>NEW.quota_bytes) THEN RAISE(ABORT,'STORAGE_POLICY_BELOW_USAGE') END;
END;
CREATE TRIGGER oracle_storage_policy_command_apply AFTER INSERT ON oracle_storage_policy_commands BEGIN
 INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,action,before_json,after_json,request_id) SELECT 'oracle-policy:'||NEW.request_id,'user',NEW.actor_id,NEW.session_id,'storage.oracle_policy_changed',json_object('requestedEnabled',requested_enabled,'quotaBytes',quota_bytes,'revision',revision),json_object('requestedEnabled',NEW.requested_enabled,'quotaBytes',NEW.quota_bytes,'revision',revision+1),NEW.request_id FROM oracle_storage_policy WHERE id=1;
 UPDATE oracle_storage_policy SET requested_enabled=NEW.requested_enabled,quota_bytes=NEW.quota_bytes,revision=revision+1 WHERE id=1;
 UPDATE oracle_storage_policy_commands SET result_json=(SELECT json_object('requestedEnabled',requested_enabled=1,'quotaBytes',quota_bytes,'freeFloorBytes',free_floor_bytes,'revision',revision) FROM oracle_storage_policy WHERE id=1) WHERE request_id=NEW.request_id;
END;
CREATE TRIGGER oracle_storage_policy_no_delete BEFORE DELETE ON oracle_storage_policy BEGIN SELECT RAISE(ABORT,'IMMUTABLE_STORAGE_POLICY'); END;
CREATE TRIGGER oracle_storage_policy_no_insert BEFORE INSERT ON oracle_storage_policy BEGIN SELECT RAISE(ABORT,'IMMUTABLE_STORAGE_POLICY'); END;
CREATE TRIGGER oracle_storage_policy_update_guard BEFORE UPDATE ON oracle_storage_policy WHEN NOT EXISTS(SELECT 1 FROM oracle_storage_policy_commands c WHERE c.result_json IS NULL AND c.expected_revision=OLD.revision AND NEW.revision=OLD.revision+1 AND NEW.id=OLD.id AND NEW.requested_enabled=c.requested_enabled AND NEW.quota_bytes=c.quota_bytes AND NEW.free_floor_bytes=OLD.free_floor_bytes) BEGIN SELECT RAISE(ABORT,'IMMUTABLE_STORAGE_POLICY'); END;
CREATE TRIGGER oracle_storage_policy_commands_no_delete BEFORE DELETE ON oracle_storage_policy_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COMMAND'); END;
CREATE TRIGGER oracle_storage_policy_commands_update_guard BEFORE UPDATE ON oracle_storage_policy_commands WHEN OLD.result_json IS NOT NULL OR NEW.request_id<>OLD.request_id OR NEW.actor_id<>OLD.actor_id OR NEW.session_id<>OLD.session_id OR NEW.expected_revision<>OLD.expected_revision OR NEW.requested_enabled<>OLD.requested_enabled OR NEW.quota_bytes<>OLD.quota_bytes OR NEW.occurred_at_ms<>OLD.occurred_at_ms OR NEW.payload_json<>OLD.payload_json OR NEW.result_json IS NULL BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COMMAND'); END;
