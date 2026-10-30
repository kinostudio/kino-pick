-- CF-03b: one bounded, checksum-bound single-part R2 upload, immutable asset metadata,
-- and fencing before a capability-backed reservation can be released.
CREATE TABLE upload_specs(
  upload_session_id TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  content_type TEXT NOT NULL CHECK(content_type IN('image/jpeg','image/png','image/webp')),
  sha256_hex TEXT NOT NULL CHECK(length(sha256_hex)=64 AND sha256_hex NOT GLOB '*[^0-9a-f]*'),
  created_at_ms INTEGER NOT NULL
);
CREATE TRIGGER upload_request_spec_guard BEFORE INSERT ON upload_requests WHEN NEW.operation='upload.reserved' BEGIN
  SELECT CASE WHEN NEW.expected_bytes>5363466240 OR json_extract(NEW.payload_json,'$.contentType') IS NULL OR json_extract(NEW.payload_json,'$.contentType') NOT IN('image/jpeg','image/png','image/webp') OR json_extract(NEW.payload_json,'$.sha256') IS NULL OR length(json_extract(NEW.payload_json,'$.sha256'))<>64 OR json_extract(NEW.payload_json,'$.sha256') GLOB '*[^0-9a-f]*' THEN RAISE(ABORT,'INVALID_INPUT') END;
END;
CREATE TRIGGER upload_session_add_spec AFTER INSERT ON upload_sessions BEGIN
  INSERT INTO upload_specs(upload_session_id,content_type,sha256_hex,created_at_ms) SELECT NEW.id,json_extract(r.payload_json,'$.contentType'),json_extract(r.payload_json,'$.sha256'),r.created_at_ms FROM upload_requests r WHERE r.upload_session_id=NEW.id AND r.operation='upload.reserved';
END;
CREATE TRIGGER upload_specs_no_update BEFORE UPDATE ON upload_specs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_SPEC'); END;
CREATE TRIGGER upload_specs_no_delete BEFORE DELETE ON upload_specs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_SPEC'); END;

CREATE TABLE upload_workflow_requests(
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('upload.authorized','upload.completed')),
  payload_json TEXT NOT NULL,
  session_id TEXT NOT NULL,
  upload_session_id TEXT NOT NULL REFERENCES upload_sessions(id),
  created_at_ms INTEGER NOT NULL,
  signed_at_ms INTEGER,
  expires_at_ms INTEGER,
  content_type TEXT,
  sha256_hex TEXT,
  actual_bytes INTEGER,
  photo_id TEXT,
  version_id TEXT,
  asset_id TEXT,
  result_json TEXT,
  PRIMARY KEY(actor_id,request_id)
);
CREATE INDEX upload_workflow_by_session ON upload_workflow_requests(upload_session_id,operation);

CREATE TABLE upload_authorizations(
  upload_session_id TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  signed_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  sha256_hex TEXT NOT NULL,
  UNIQUE(actor_id,request_id)
);
CREATE TABLE upload_key_fences(
  upload_session_id TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  object_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK(reason IN('cancel','expire')),
  actor_type TEXT NOT NULL CHECK(actor_type IN('user','system')),
  actor_id TEXT REFERENCES users(id),
  session_id TEXT,
  request_id TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL
);
CREATE TABLE upload_review_flags(
  upload_session_id TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN('UPLOAD_CONTENT_INVALID','UPLOAD_METADATA_MISMATCH')),
  occurred_at_ms INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE
);

CREATE TABLE photo_versions(
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  photo_id TEXT NOT NULL REFERENCES photos(id),
  version_no INTEGER NOT NULL CHECK(version_no>0),
  parent_version_id TEXT REFERENCES photo_versions(id),
  created_by_actor TEXT NOT NULL REFERENCES users(id),
  source_hash_sha256 TEXT NOT NULL CHECK(length(source_hash_sha256)=64 AND source_hash_sha256 NOT GLOB '*[^0-9a-f]*'),
  byte_size INTEGER NOT NULL CHECK(byte_size>0),
  mime TEXT NOT NULL CHECK(mime IN('image/jpeg','image/png','image/webp')),
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL CHECK(status IN('private','current','superseded','quarantined')),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(photo_id,version_no)
);
CREATE TABLE photo_assets(
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  photo_id TEXT NOT NULL REFERENCES photos(id),
  version_id TEXT NOT NULL REFERENCES photo_versions(id),
  storage_node_id TEXT NOT NULL REFERENCES storage_nodes(id),
  asset_kind TEXT NOT NULL CHECK(asset_kind IN('original','preview','thumbnail','delivery')),
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK(byte_size>0),
  mime TEXT NOT NULL CHECK(mime IN('image/jpeg','image/png','image/webp')),
  checksum_sha256 TEXT NOT NULL CHECK(length(checksum_sha256)=64 AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN('private','available','quarantined')),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(version_id,asset_kind)
);
CREATE INDEX photo_assets_album_lookup ON photo_assets(workspace_id,photo_id,version_id);

CREATE TABLE upload_completions(
  upload_session_id TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL UNIQUE REFERENCES photos(id),
  version_id TEXT NOT NULL UNIQUE REFERENCES photo_versions(id),
  asset_id TEXT NOT NULL UNIQUE REFERENCES photo_assets(id),
  actual_bytes INTEGER NOT NULL CHECK(actual_bytes>0),
  content_type TEXT NOT NULL,
  sha256_hex TEXT NOT NULL,
  completed_at_ms INTEGER NOT NULL,
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,project_id,workspace_id) REFERENCES albums(id,project_id,workspace_id)
);

CREATE TRIGGER upload_workflow_request_guard BEFORE INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id AND (r.operation<>NEW.operation OR r.payload_json<>NEW.payload_json)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+60000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_sessions u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id AND u.status='reserved' AND w.owner_user_id=NEW.actor_id) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=NEW.upload_session_id) THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_review_flags f WHERE f.upload_session_id=NEW.upload_session_id) THEN RAISE(ABORT,'UPLOAD_NEEDS_REVIEW') END;
  SELECT CASE WHEN NEW.operation='upload.authorized' AND (NEW.signed_at_ms IS NULL OR NEW.expires_at_ms IS NULL OR NEW.content_type IS NULL OR NEW.sha256_hex IS NULL OR NEW.actual_bytes IS NOT NULL OR NEW.photo_id IS NOT NULL OR NEW.version_id IS NOT NULL OR NEW.asset_id IS NOT NULL) THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.authorized' AND NOT EXISTS(SELECT 1 FROM upload_sessions u JOIN upload_specs p ON p.upload_session_id=u.id WHERE u.id=NEW.upload_session_id AND u.expires_at_ms>NEW.created_at_ms AND p.content_type=NEW.content_type AND p.sha256_hex=NEW.sha256_hex AND NEW.signed_at_ms=NEW.created_at_ms AND NEW.expires_at_ms>NEW.signed_at_ms AND NEW.expires_at_ms<=u.expires_at_ms AND NEW.expires_at_ms<=NEW.signed_at_ms+600000) THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.authorized' AND EXISTS(SELECT 1 FROM upload_authorizations a WHERE a.upload_session_id=NEW.upload_session_id) THEN RAISE(ABORT,'UPLOAD_ALREADY_AUTHORIZED') END;
  SELECT CASE WHEN NEW.operation='upload.completed' AND (NEW.signed_at_ms IS NOT NULL OR NEW.expires_at_ms IS NOT NULL OR NEW.content_type IS NULL OR NEW.sha256_hex IS NULL OR NEW.actual_bytes IS NULL OR NEW.photo_id IS NULL OR NEW.version_id IS NULL OR NEW.asset_id IS NULL) THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.completed' AND NOT EXISTS(SELECT 1 FROM upload_sessions u JOIN upload_specs p ON p.upload_session_id=u.id JOIN upload_authorizations a ON a.upload_session_id=u.id JOIN workspace_storage_usage w ON w.workspace_id=u.workspace_id JOIN storage_nodes n ON n.id=u.storage_node_id WHERE u.id=NEW.upload_session_id AND p.content_type=NEW.content_type AND p.sha256_hex=NEW.sha256_hex AND u.expected_bytes=NEW.actual_bytes AND w.reserved_bytes>=u.reserved_bytes AND n.reserved_bytes>=u.reserved_bytes AND n.status IN('active','readonly')) THEN RAISE(ABORT,'UPLOAD_VERIFICATION_MISMATCH') END;
END;

CREATE TRIGGER request_command_workflow_id_guard BEFORE INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_request_workflow_id_guard BEFORE INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_request_completion_guard BEFORE INSERT ON upload_requests WHEN NEW.operation='upload.cancelled' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_completions WHERE upload_session_id=NEW.upload_session_id) THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
END;
CREATE TRIGGER upload_request_fence_guard BEFORE INSERT ON upload_requests WHEN NEW.operation='upload.cancelled' AND EXISTS(SELECT 1 FROM upload_authorizations WHERE upload_session_id=NEW.upload_session_id) BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.upload_session_id=NEW.upload_session_id AND f.object_key=(SELECT object_key FROM upload_sessions WHERE id=NEW.upload_session_id)) THEN RAISE(ABORT,'UPLOAD_KEY_NOT_FENCED') END;
END;

CREATE TRIGGER upload_workflow_apply_authorization AFTER INSERT ON upload_workflow_requests WHEN NEW.operation='upload.authorized' BEGIN
  INSERT INTO upload_authorizations(upload_session_id,actor_id,request_id,session_id,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(NEW.upload_session_id,NEW.actor_id,NEW.request_id,NEW.session_id,NEW.signed_at_ms,NEW.expires_at_ms,NEW.content_type,NEW.sha256_hex);
  UPDATE upload_workflow_requests SET result_json=(SELECT json_object('uploadSessionId',NEW.upload_session_id,'expiresAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at_ms/1000.0,'unixepoch'),'contentType',NEW.content_type,'expectedBytes',u.expected_bytes,'sha256',NEW.sha256_hex) FROM upload_sessions u WHERE u.id=NEW.upload_session_id) WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,after_json,request_id) SELECT 'upload-authorized:'||u.id,'user',NEW.actor_id,NEW.session_id,u.workspace_id,u.project_id,u.album_id,'upload.authorized',(SELECT result_json FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id),NEW.request_id FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
END;

CREATE TRIGGER upload_workflow_apply_completion AFTER INSERT ON upload_workflow_requests WHEN NEW.operation='upload.completed' BEGIN
  INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) SELECT NEW.photo_id,u.workspace_id,u.project_id,u.album_id,u.original_filename FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,status) SELECT NEW.version_id,u.workspace_id,NEW.photo_id,1,NULL,NEW.actor_id,NEW.sha256_hex,NEW.actual_bytes,NEW.content_type,'private' FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) SELECT NEW.asset_id,u.workspace_id,NEW.photo_id,NEW.version_id,u.storage_node_id,'original',u.object_key,NEW.actual_bytes,NEW.content_type,NEW.sha256_hex,'private' FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  INSERT INTO upload_completions(upload_session_id,actor_id,request_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,asset_id,actual_bytes,content_type,sha256_hex,completed_at_ms) SELECT u.id,NEW.actor_id,NEW.request_id,NEW.session_id,u.workspace_id,u.project_id,u.album_id,NEW.photo_id,NEW.version_id,NEW.asset_id,NEW.actual_bytes,NEW.content_type,NEW.sha256_hex,NEW.created_at_ms FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  UPDATE workspace_storage_usage SET reserved_bytes=reserved_bytes-NEW.actual_bytes,used_bytes=used_bytes+NEW.actual_bytes WHERE workspace_id=(SELECT workspace_id FROM upload_sessions WHERE id=NEW.upload_session_id);
  UPDATE storage_nodes SET reserved_bytes=reserved_bytes-NEW.actual_bytes,used_bytes=used_bytes+NEW.actual_bytes WHERE id=(SELECT storage_node_id FROM upload_sessions WHERE id=NEW.upload_session_id);
  UPDATE upload_workflow_requests SET result_json=json_object('uploadSessionId',NEW.upload_session_id,'status','completed','photoId',NEW.photo_id,'versionId',NEW.version_id,'assetId',NEW.asset_id,'actualBytes',NEW.actual_bytes,'contentType',NEW.content_type,'sha256',NEW.sha256_hex,'completedAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')) WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id) SELECT 'upload-completed:'||u.id,'user',NEW.actor_id,NEW.session_id,u.workspace_id,u.project_id,u.album_id,NEW.photo_id,NEW.version_id,'upload.completed',json_object('status','reserved','reservedBytes',u.reserved_bytes),json_object('status','completed','actualBytes',NEW.actual_bytes,'contentType',NEW.content_type,'sha256',NEW.sha256_hex,'assetId',NEW.asset_id),NEW.request_id FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
END;

CREATE TRIGGER upload_workflow_request_no_update BEFORE UPDATE ON upload_workflow_requests WHEN OLD.result_json IS NOT NULL OR NEW.actor_id<>OLD.actor_id OR NEW.request_id<>OLD.request_id OR NEW.operation<>OLD.operation OR NEW.payload_json<>OLD.payload_json OR NEW.session_id<>OLD.session_id OR NEW.upload_session_id<>OLD.upload_session_id OR NEW.created_at_ms<>OLD.created_at_ms OR NEW.signed_at_ms IS NOT OLD.signed_at_ms OR NEW.expires_at_ms IS NOT OLD.expires_at_ms OR NEW.content_type IS NOT OLD.content_type OR NEW.sha256_hex IS NOT OLD.sha256_hex OR NEW.actual_bytes IS NOT OLD.actual_bytes OR NEW.photo_id IS NOT OLD.photo_id OR NEW.version_id IS NOT OLD.version_id OR NEW.asset_id IS NOT OLD.asset_id OR NEW.result_json IS NULL BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_WORKFLOW_REQUEST'); END;
CREATE TRIGGER upload_workflow_request_no_delete BEFORE DELETE ON upload_workflow_requests BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_WORKFLOW_REQUEST'); END;
CREATE TRIGGER upload_authorizations_no_update BEFORE UPDATE ON upload_authorizations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_AUTHORIZATION'); END;
CREATE TRIGGER upload_authorizations_no_delete BEFORE DELETE ON upload_authorizations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_AUTHORIZATION'); END;
CREATE TRIGGER upload_key_fence_guard BEFORE INSERT ON upload_key_fences BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_sessions u JOIN upload_authorizations a ON a.upload_session_id=u.id WHERE u.id=NEW.upload_session_id AND u.object_key=NEW.object_key AND u.status='reserved') THEN RAISE(ABORT,'UPLOAD_KEY_NOT_FENCED') END;
  SELECT CASE WHEN NEW.actor_type='user' AND (NEW.reason<>'cancel' OR NEW.actor_id<>(SELECT actor_id FROM upload_sessions WHERE id=NEW.upload_session_id) OR NEW.session_id IS NULL OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.actor_type='system' AND (NEW.reason<>'expire' OR NEW.actor_id IS NOT NULL OR NEW.session_id IS NOT NULL OR NEW.occurred_at_ms<(SELECT expires_at_ms FROM upload_sessions WHERE id=NEW.upload_session_id)) THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
END;
CREATE TRIGGER upload_key_fence_audit AFTER INSERT ON upload_key_fences BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,after_json,request_id) SELECT 'upload-fence:'||u.id,NEW.actor_type,NEW.actor_id,NEW.session_id,u.workspace_id,u.project_id,u.album_id,'upload.capability_fenced',json_object('uploadSessionId',u.id,'reason',NEW.reason),NEW.request_id FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
END;
CREATE TRIGGER upload_key_fence_no_update BEFORE UPDATE ON upload_key_fences BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_KEY_FENCE'); END;
CREATE TRIGGER upload_key_fence_no_delete BEFORE DELETE ON upload_key_fences BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_KEY_FENCE'); END;
CREATE TRIGGER upload_session_fenced_transition_guard BEFORE UPDATE ON upload_sessions WHEN OLD.status='reserved' AND EXISTS(SELECT 1 FROM upload_authorizations WHERE upload_session_id=OLD.id) BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.upload_session_id=OLD.id AND f.object_key=OLD.object_key) THEN RAISE(ABORT,'UPLOAD_KEY_NOT_FENCED') END;
END;
CREATE TRIGGER upload_completions_no_update BEFORE UPDATE ON upload_completions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_COMPLETION'); END;
CREATE TRIGGER upload_completions_no_delete BEFORE DELETE ON upload_completions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_COMPLETION'); END;
CREATE TRIGGER upload_review_flags_no_update BEFORE UPDATE ON upload_review_flags BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_REVIEW'); END;
CREATE TRIGGER upload_review_flags_no_delete BEFORE DELETE ON upload_review_flags BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_REVIEW'); END;
CREATE TRIGGER upload_review_flag_guard BEFORE INSERT ON upload_review_flags BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id AND u.status='reserved') OR EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=NEW.upload_session_id) THEN RAISE(ABORT,'NOT_FOUND') END;
END;
CREATE TRIGGER upload_review_flag_audit AFTER INSERT ON upload_review_flags BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,after_json,request_id) SELECT 'upload-review:'||u.id,'user',NEW.actor_id,NEW.session_id,u.workspace_id,u.project_id,u.album_id,'upload.needs_review',json_object('uploadSessionId',u.id,'reason',NEW.reason_code),NEW.request_id FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
END;
CREATE TRIGGER photo_versions_no_update BEFORE UPDATE ON photo_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION'); END;
CREATE TRIGGER photo_versions_no_delete BEFORE DELETE ON photo_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION'); END;
CREATE TRIGGER photo_assets_no_update BEFORE UPDATE ON photo_assets BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_ASSET'); END;
CREATE TRIGGER photo_assets_no_delete BEFORE DELETE ON photo_assets BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_ASSET'); END;

CREATE TRIGGER upload_session_completed_transition_guard BEFORE UPDATE ON upload_sessions WHEN EXISTS(SELECT 1 FROM upload_completions WHERE upload_session_id=OLD.id) BEGIN SELECT RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED'); END;
DROP TRIGGER content_archive_upload_guard;
CREATE TRIGGER content_archive_upload_guard BEFORE INSERT ON request_commands WHEN NEW.operation IN('project.archived','album.archived') BEGIN
  SELECT CASE WHEN NEW.operation='project.archived' AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.project_id=NEW.resource_id AND u.status='reserved' AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id)) THEN RAISE(ABORT,'UPLOADS_IN_PROGRESS') END;
  SELECT CASE WHEN NEW.operation='album.archived' AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.album_id=NEW.resource_id AND u.status='reserved' AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id)) THEN RAISE(ABORT,'UPLOADS_IN_PROGRESS') END;
END;

