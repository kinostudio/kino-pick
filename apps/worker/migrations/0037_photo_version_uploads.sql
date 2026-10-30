-- DRAFT ONLY. Depends on 0036_photo_version_heads.sql; do not auto-apply.
PRAGMA foreign_keys=ON;

CREATE TABLE upload_version_targets(
  upload_session_id TEXT PRIMARY KEY NOT NULL REFERENCES upload_sessions(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  parent_version_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer'
    AND expected_revision BETWEEN 0 AND 9007199254740991),
  confirm INTEGER NOT NULL CHECK(typeof(confirm)='integer' AND confirm=1),
  captured_versioning_mode TEXT NOT NULL
    CHECK(captured_versioning_mode IN('off','manual','auto_filename','assisted')),
  change_type TEXT NOT NULL CHECK(change_type IN('new_retouch','replace_current')),
  change_note TEXT NOT NULL CHECK(length(change_note)<=2000),
  labels_json TEXT NOT NULL CHECK(COALESCE(CASE WHEN json_valid(labels_json)
    THEN json_type(labels_json)='array' AND json_array_length(labels_json)<=16
    ELSE 0 END,0)),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,project_id,workspace_id)
    REFERENCES albums(id,project_id,workspace_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(parent_version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX upload_version_targets_photo
  ON upload_version_targets(photo_id,created_at_ms DESC,upload_session_id);

-- upload_completions has UNIQUE(photo_id), so V2 uses a separate immutable
-- completion/result ledger while sharing upload_workflow_requests.
CREATE TABLE upload_version_completions(
  upload_session_id TEXT PRIMARY KEY NOT NULL REFERENCES upload_sessions(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  parent_version_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK(typeof(version_no)='integer'
    AND version_no BETWEEN 2 AND 9007199254740991),
  change_type TEXT NOT NULL CHECK(change_type IN('new_retouch','replace_current')),
  change_note TEXT NOT NULL CHECK(length(change_note)<=2000),
  labels_json TEXT NOT NULL CHECK(COALESCE(CASE WHEN json_valid(labels_json)
    THEN json_type(labels_json)='array' AND json_array_length(labels_json)<=16
    ELSE 0 END,0)),
  actual_bytes INTEGER NOT NULL CHECK(typeof(actual_bytes)='integer'
    AND actual_bytes BETWEEN 1 AND 5363466240),
  content_type TEXT NOT NULL CHECK(content_type IN('image/jpeg','image/png','image/webp')),
  sha256_hex TEXT NOT NULL CHECK(length(sha256_hex)=64
    AND sha256_hex NOT GLOB '*[^0-9a-f]*'),
  image_width INTEGER NOT NULL CHECK(typeof(image_width)='integer'
    AND image_width BETWEEN 1 AND 32768),
  image_height INTEGER NOT NULL CHECK(typeof(image_height)='integer'
    AND image_height BETWEEN 1 AND 32768),
  completed_at_ms INTEGER NOT NULL CHECK(typeof(completed_at_ms)='integer'),
  event_id TEXT NOT NULL UNIQUE,
  result_json TEXT NOT NULL CHECK(COALESCE(json_valid(result_json),0)=1),
  UNIQUE(actor_id,request_id), UNIQUE(version_id), UNIQUE(asset_id),
  UNIQUE(photo_id,version_no),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,project_id,workspace_id)
    REFERENCES albums(id,project_id,workspace_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(asset_id,workspace_id,photo_id,version_id)
    REFERENCES photo_assets(id,workspace_id,photo_id,version_id),
  FOREIGN KEY(parent_version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX upload_version_completions_photo
  ON upload_version_completions(photo_id,version_no DESC);

CREATE TRIGGER upload_version_targets_insert_guard
BEFORE INSERT ON upload_version_targets BEGIN
  SELECT CASE WHEN NEW.upload_session_id IS NULL OR NEW.actor_id IS NULL
    OR NEW.request_id IS NULL OR NEW.session_id IS NULL OR NEW.photo_id IS NULL
    OR NEW.parent_version_id IS NULL OR NEW.expected_revision IS NULL
    OR NEW.confirm IS NULL OR NEW.captured_versioning_mode IS NULL
    OR NEW.change_type IS NULL OR NEW.change_note IS NULL
    OR NEW.labels_json IS NULL OR NEW.created_at_ms IS NULL
    OR EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id
        OR (t.actor_id=NEW.actor_id AND t.request_id=NEW.request_id))
    THEN RAISE(ABORT,'IMMUTABLE_UPLOAD_VERSION_TARGET') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM upload_requests r
    JOIN upload_sessions u ON u.id=r.upload_session_id
    JOIN owners o ON o.user_id=NEW.actor_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
      AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id
    JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
    JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
      AND a.workspace_id=ph.workspace_id
    JOIN photo_version_heads h ON h.photo_id=ph.id
      AND h.workspace_id=ph.workspace_id AND h.project_id=ph.project_id
      AND h.album_id=ph.album_id
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
      AND r.operation='upload.reserved' AND r.upload_session_id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.workspace_id=NEW.workspace_id
      AND u.project_id=NEW.project_id AND u.album_id=NEW.album_id
      AND u.created_by_session_id=NEW.session_id AND NEW.session_id=r.session_id
      AND NEW.created_at_ms=r.created_at_ms
      AND NEW.photo_id=json_extract(r.payload_json,'$.versionTarget.photoId')
      AND NEW.parent_version_id=json_extract(r.payload_json,'$.versionTarget.parentVersionId')
      AND NEW.expected_revision=json_extract(r.payload_json,'$.versionTarget.expectedRevision')
      AND NEW.confirm=json_extract(r.payload_json,'$.versionTarget.confirm')
      AND NEW.change_type=json_extract(r.payload_json,'$.versionTarget.changeType')
      AND NEW.change_note=json_extract(r.payload_json,'$.versionTarget.changeNote')
      AND json(NEW.labels_json)=json(json_extract(r.payload_json,'$.versionTarget.labels'))
      AND NEW.captured_versioning_mode=p.versioning_mode
      AND h.revision=NEW.expected_revision AND h.version_id=NEW.parent_version_id
      AND a.state NOT IN('archived','deleting','deleted')
      AND p.status NOT IN('archived','deleting','deleted')
      AND (NEW.change_type='replace_current'
        OR p.versioning_mode IN('manual','auto_filename','assisted'))
  ) THEN RAISE(ABORT,'UPLOAD_VERSION_TARGET_MISMATCH') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.labels_json) l
      WHERE l.type<>'text' OR length(l.value) NOT BETWEEN 1 AND 40
        OR l.value<>trim(l.value))
    OR (SELECT count(*) FROM json_each(NEW.labels_json))
      <>(SELECT count(DISTINCT value COLLATE BINARY) FROM json_each(NEW.labels_json))
    THEN RAISE(ABORT,'INVALID_INPUT') END;
END;
CREATE TRIGGER upload_version_targets_no_update
BEFORE UPDATE ON upload_version_targets BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_VERSION_TARGET');
END;
CREATE TRIGGER upload_version_targets_no_delete
BEFORE DELETE ON upload_version_targets BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_VERSION_TARGET');
END;
-- A single ordered reservation guard checks current Owner/session, V2 live photo
-- ACL, all shared Owner request namespaces, then canonical replay.
DROP TRIGGER upload_request_guard;
DROP TRIGGER upload_request_spec_guard;
DROP TRIGGER upload_requests_processing_review_id_guard;
DROP TRIGGER upload_request_workflow_id_guard;
DROP TRIGGER upload_request_completion_guard;
DROP TRIGGER upload_request_fence_guard;
CREATE TRIGGER upload_request_guard BEFORE INSERT ON upload_requests BEGIN
  SELECT CASE WHEN NEW.actor_id IS NULL OR NEW.request_id IS NULL
    OR NEW.session_id IS NULL OR NEW.upload_session_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      WHERE o.user_id=NEW.actor_id AND o.enabled=1
        AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)
    THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Only V2 reservations require the existing photo to be live before replay.
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_valid(NEW.payload_json)
    AND json_type(NEW.payload_json,'$.versionTarget')='object'
    AND NOT EXISTS(
      SELECT 1 FROM photos ph
      JOIN photo_versions parent
        ON parent.id=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId')
        AND parent.workspace_id=ph.workspace_id AND parent.photo_id=ph.id
      JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
      JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
      JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
        AND a.workspace_id=ph.workspace_id
      WHERE ph.id=json_extract(NEW.payload_json,'$.versionTarget.photoId')
        AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
        AND ph.album_id=NEW.album_id
        AND a.state NOT IN('archived','deleting','deleted')
        AND p.status NOT IN('archived','deleting','deleted'))
    THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
      AND (r.operation<>NEW.operation OR r.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
    THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN NEW.operation='upload.reserved' AND (
    NEW.workspace_id IS NULL OR NEW.project_id IS NULL OR NEW.album_id IS NULL
    OR NEW.storage_node_id<>'primary'
    OR NEW.object_key<>NEW.workspace_id||'/'||NEW.project_id||'/'||NEW.album_id||'/'||NEW.upload_session_id||'/original'
    OR NEW.original_filename IS NULL OR length(NEW.original_filename) NOT BETWEEN 1 AND 255
    OR NEW.expected_bytes IS NULL OR NEW.expected_bytes<=0
    OR NEW.expected_bytes>5363466240
    OR NOT json_valid(NEW.payload_json) OR json_type(NEW.payload_json)<>'object')
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved' AND (
    json_type(NEW.payload_json,'$.workspaceId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.workspaceId')<>NEW.workspace_id
    OR json_type(NEW.payload_json,'$.projectId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.projectId')<>NEW.project_id
    OR json_type(NEW.payload_json,'$.albumId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.albumId')<>NEW.album_id
    OR json_type(NEW.payload_json,'$.originalFilename') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.originalFilename')<>NEW.original_filename
    OR json_type(NEW.payload_json,'$.expectedBytes') IS NOT 'integer'
    OR json_extract(NEW.payload_json,'$.expectedBytes')<>NEW.expected_bytes
    OR json_type(NEW.payload_json,'$.contentType') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.contentType') NOT IN('image/jpeg','image/png','image/webp')
    OR json_type(NEW.payload_json,'$.sha256') IS NOT 'text'
    OR length(json_extract(NEW.payload_json,'$.sha256'))<>64
    OR json_extract(NEW.payload_json,'$.sha256') GLOB '*[^0-9a-f]*')
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NULL
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>7
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>8
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND (
      json_type(NEW.payload_json,'$.versionTarget')<>'object'
      OR (SELECT count(*) FROM json_each(NEW.payload_json,'$.versionTarget'))<>7
      OR json_type(NEW.payload_json,'$.versionTarget.photoId') IS NOT 'text'
      OR json_type(NEW.payload_json,'$.versionTarget.parentVersionId') IS NOT 'text'
      OR json_type(NEW.payload_json,'$.versionTarget.expectedRevision') IS NOT 'integer'
      OR json_extract(NEW.payload_json,'$.versionTarget.expectedRevision') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(NEW.payload_json,'$.versionTarget.confirm') IS NOT 'true'
      OR json_extract(NEW.payload_json,'$.versionTarget.confirm')<>1
      OR json_type(NEW.payload_json,'$.versionTarget.changeType') IS NOT 'text'
      OR json_extract(NEW.payload_json,'$.versionTarget.changeType') NOT IN('new_retouch','replace_current')
      OR json_type(NEW.payload_json,'$.versionTarget.changeNote') IS NOT 'text'
      OR length(json_extract(NEW.payload_json,'$.versionTarget.changeNote'))>2000
      OR json_type(NEW.payload_json,'$.versionTarget.labels') IS NOT 'array'
      OR json_array_length(NEW.payload_json,'$.versionTarget.labels')>16
      OR EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.versionTarget.labels') l
        WHERE l.type<>'text' OR length(l.value) NOT BETWEEN 1 AND 40 OR l.value<>trim(l.value))
      OR (SELECT count(*) FROM json_each(NEW.payload_json,'$.versionTarget.labels'))
        <>(SELECT count(DISTINCT value COLLATE BINARY)
          FROM json_each(NEW.payload_json,'$.versionTarget.labels')))
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  -- New reservation CAS; an exact retry returned above keeps its original parent.
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM photos ph
      JOIN photo_version_heads h ON h.photo_id=ph.id
        AND h.workspace_id=ph.workspace_id AND h.project_id=ph.project_id
        AND h.album_id=ph.album_id
      WHERE ph.id=json_extract(NEW.payload_json,'$.versionTarget.photoId')
        AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
        AND ph.album_id=NEW.album_id
        AND h.revision=json_extract(NEW.payload_json,'$.versionTarget.expectedRevision')
        AND h.version_id=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId'))
    THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND json_extract(NEW.payload_json,'$.versionTarget.changeType')='new_retouch'
    AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id
      AND p.workspace_id=NEW.workspace_id
      AND p.versioning_mode IN('manual','auto_filename','assisted'))
    THEN RAISE(ABORT,'VERSIONING_MODE_DISABLED') END;

  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NULL
    AND NOT EXISTS(
      SELECT 1 FROM albums a JOIN projects p
        ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      JOIN workspaces w ON w.id=p.workspace_id
      JOIN storage_nodes n ON n.id=NEW.storage_node_id AND n.status='active'
      WHERE a.id=NEW.album_id AND a.project_id=NEW.project_id
        AND a.workspace_id=NEW.workspace_id
        AND p.status IN('draft','uploading') AND a.state IN('draft','active')
        AND w.owner_user_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND EXISTS(SELECT 1 FROM workspace_storage_usage u
      JOIN workspaces w ON w.id=u.workspace_id
      WHERE u.workspace_id=NEW.workspace_id
        AND u.used_bytes+u.reserved_bytes+NEW.expected_bytes>w.quota_bytes)
    THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND NOT EXISTS(SELECT 1 FROM workspace_storage_usage u
      WHERE u.workspace_id=NEW.workspace_id)
    THEN RAISE(ABORT,'STORAGE_LEDGER_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND NOT EXISTS(SELECT 1 FROM storage_nodes n WHERE n.id=NEW.storage_node_id
      AND n.status='active'
      AND n.used_bytes+n.reserved_bytes+NEW.expected_bytes<=n.quota_bytes)
    THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;

  SELECT CASE WHEN NEW.operation='upload.cancelled' AND (
    NEW.workspace_id IS NOT NULL OR NEW.project_id IS NOT NULL OR NEW.album_id IS NOT NULL
    OR NEW.storage_node_id IS NOT NULL OR NEW.object_key IS NOT NULL
    OR NEW.original_filename IS NOT NULL OR NEW.expected_bytes IS NOT NULL)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status<>'reserved')
    THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status='reserved'
      AND u.expires_at_ms<=NEW.created_at_ms)
    THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND (EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=NEW.upload_session_id)
      OR EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=NEW.upload_session_id))
    THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_authorizations a WHERE a.upload_session_id=NEW.upload_session_id)
    AND NOT EXISTS(SELECT 1 FROM upload_key_fences f JOIN upload_sessions u
      ON u.id=f.upload_session_id WHERE f.upload_session_id=NEW.upload_session_id
      AND f.object_key=u.object_key)
    THEN RAISE(ABORT,'UPLOAD_KEY_NOT_FENCED') END;
END;

DROP TRIGGER upload_request_apply_reservation;
CREATE TRIGGER upload_request_apply_reservation
AFTER INSERT ON upload_requests WHEN NEW.operation='upload.reserved' BEGIN
  INSERT INTO upload_sessions(
    id,actor_id,created_by_session_id,workspace_id,project_id,album_id,
    storage_node_id,object_key,original_filename,expected_bytes,reserved_bytes,
    status,created_at_ms,expires_at_ms,updated_at_ms,created_request_id,
    updated_by_request_id,updated_by_session_id,updated_by_actor_type
  ) VALUES(NEW.upload_session_id,NEW.actor_id,NEW.session_id,NEW.workspace_id,
    NEW.project_id,NEW.album_id,NEW.storage_node_id,NEW.object_key,
    NEW.original_filename,NEW.expected_bytes,NEW.expected_bytes,'reserved',
    NEW.created_at_ms,NEW.created_at_ms+900000,NEW.created_at_ms,NEW.request_id,
    NEW.request_id,NEW.session_id,'user');
  INSERT INTO storage_reservations(
    id,workspace_id,storage_node_id,reserved_bytes,created_at_ms,expires_at_ms
  ) VALUES(NEW.upload_session_id,NEW.workspace_id,NEW.storage_node_id,
    NEW.expected_bytes,NEW.created_at_ms,NEW.created_at_ms+900000);
  UPDATE workspace_storage_usage SET reserved_bytes=reserved_bytes+NEW.expected_bytes
    WHERE workspace_id=NEW.workspace_id;
  UPDATE storage_nodes SET reserved_bytes=reserved_bytes+NEW.expected_bytes
    WHERE id=NEW.storage_node_id;
  INSERT INTO upload_version_targets(
    upload_session_id,actor_id,request_id,session_id,workspace_id,project_id,
    album_id,photo_id,parent_version_id,expected_revision,confirm,
    captured_versioning_mode,change_type,change_note,labels_json,created_at_ms
  )
  SELECT NEW.upload_session_id,NEW.actor_id,NEW.request_id,NEW.session_id,
    NEW.workspace_id,NEW.project_id,NEW.album_id,
    json_extract(NEW.payload_json,'$.versionTarget.photoId'),
    json_extract(NEW.payload_json,'$.versionTarget.parentVersionId'),
    json_extract(NEW.payload_json,'$.versionTarget.expectedRevision'),
    json_extract(NEW.payload_json,'$.versionTarget.confirm'),p.versioning_mode,
    json_extract(NEW.payload_json,'$.versionTarget.changeType'),
    json_extract(NEW.payload_json,'$.versionTarget.changeNote'),
    json_extract(NEW.payload_json,'$.versionTarget.labels'),NEW.created_at_ms
  FROM projects p WHERE p.id=NEW.project_id
    AND p.workspace_id=NEW.workspace_id
    AND json_type(NEW.payload_json,'$.versionTarget')='object';

  -- Ordinary and V2 reservation result_json remains the historical session snapshot.
  UPDATE upload_requests SET result_json=(
    SELECT json_object('id',u.id,'workspaceId',u.workspace_id,'projectId',u.project_id,
      'albumId',u.album_id,'originalFilename',u.original_filename,
      'expectedBytes',u.expected_bytes,'reservedBytes',u.reserved_bytes,
      'status',u.status,'expiresAtMs',u.expires_at_ms,'createdAtMs',u.created_at_ms)
    FROM upload_sessions u WHERE u.id=NEW.upload_session_id)
    WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id;
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    action,after_json,request_id
  )
  SELECT 'upload:'||u.id,'user',NEW.actor_id,NEW.session_id,u.workspace_id,
    u.project_id,u.album_id,'upload.reserved',
    json_object('id',u.id,'workspaceId',u.workspace_id,'projectId',u.project_id,
      'albumId',u.album_id,'originalFilename',u.original_filename,
      'expectedBytes',u.expected_bytes,'reservedBytes',u.reserved_bytes,
      'status',u.status,'expiresAt',strftime('%Y-%m-%dT%H:%M:%fZ',
        u.expires_at_ms/1000.0,'unixepoch'),
      'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',
        u.created_at_ms/1000.0,'unixepoch')),NEW.request_id
  FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
END;
-- Complete/authorize retain the existing workflow request namespace and replay
-- ledger. V2 target ACL is checked before a replay can be returned.
DROP TRIGGER upload_workflow_request_guard;
DROP TRIGGER upload_workflow_requests_processing_review_id_guard;
CREATE TRIGGER upload_workflow_request_guard
BEFORE INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN NEW.actor_id IS NULL OR NEW.request_id IS NULL
    OR NEW.session_id IS NULL OR NEW.upload_session_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      WHERE o.user_id=NEW.actor_id AND o.enabled=1
        AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)
    THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id)
    AND NOT EXISTS(
      SELECT 1 FROM upload_version_targets t
      JOIN upload_sessions u ON u.id=t.upload_session_id
      JOIN photos ph ON ph.id=t.photo_id AND ph.workspace_id=t.workspace_id
        AND ph.project_id=t.project_id AND ph.album_id=t.album_id
      JOIN workspaces w ON w.id=ph.workspace_id
      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
      JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
        AND a.workspace_id=ph.workspace_id
      JOIN photo_versions parent ON parent.id=t.parent_version_id
        AND parent.workspace_id=t.workspace_id AND parent.photo_id=t.photo_id
      WHERE t.upload_session_id=NEW.upload_session_id
        AND t.actor_id=NEW.actor_id AND u.actor_id=NEW.actor_id
        AND w.owner_user_id=NEW.actor_id
        AND a.state NOT IN('archived','deleting','deleted')
        AND p.status NOT IN('archived','deleting','deleted')
        AND (NEW.operation='upload.authorized'
          OR (NEW.operation='upload.completed' AND NEW.photo_id=t.photo_id))
    ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
      AND (r.operation<>NEW.operation OR r.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
    THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_sessions u
    JOIN workspaces w ON w.id=u.workspace_id
    WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id
      AND u.status='reserved' AND w.owner_user_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_completions c
      WHERE c.upload_session_id=NEW.upload_session_id)
    OR EXISTS(SELECT 1 FROM upload_version_completions c
      WHERE c.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_review_flags f
      WHERE f.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'UPLOAD_NEEDS_REVIEW') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;

  SELECT CASE WHEN NEW.operation='upload.authorized' AND (
    NEW.signed_at_ms IS NULL OR NEW.expires_at_ms IS NULL
    OR NEW.content_type IS NULL OR NEW.sha256_hex IS NULL
    OR NEW.actual_bytes IS NOT NULL OR NEW.photo_id IS NOT NULL
    OR NEW.version_id IS NOT NULL OR NEW.asset_id IS NOT NULL)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.authorized'
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u
      JOIN upload_specs p ON p.upload_session_id=u.id
      WHERE u.id=NEW.upload_session_id AND u.expires_at_ms>NEW.created_at_ms
        AND p.content_type=NEW.content_type AND p.sha256_hex=NEW.sha256_hex
        AND NEW.signed_at_ms=NEW.created_at_ms
        AND NEW.expires_at_ms>NEW.signed_at_ms
        AND NEW.expires_at_ms<=u.expires_at_ms
        AND NEW.expires_at_ms<=NEW.signed_at_ms+600000)
    THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.authorized'
    AND EXISTS(SELECT 1 FROM upload_authorizations a
      WHERE a.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'UPLOAD_ALREADY_AUTHORIZED') END;

  SELECT CASE WHEN NEW.operation='upload.completed' AND (
    NEW.signed_at_ms IS NOT NULL OR NEW.expires_at_ms IS NOT NULL
    OR NEW.content_type IS NULL OR NEW.sha256_hex IS NULL
    OR NEW.actual_bytes IS NULL OR NEW.photo_id IS NULL
    OR NEW.version_id IS NULL OR NEW.asset_id IS NULL)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.completed'
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u
      JOIN upload_specs p ON p.upload_session_id=u.id
      JOIN upload_authorizations auth ON auth.upload_session_id=u.id
      JOIN workspace_storage_usage ws ON ws.workspace_id=u.workspace_id
      JOIN storage_nodes n ON n.id=u.storage_node_id
      WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id
        AND p.content_type=NEW.content_type AND p.sha256_hex=NEW.sha256_hex
        AND u.expected_bytes=NEW.actual_bytes
        AND ws.reserved_bytes>=u.reserved_bytes
        AND n.reserved_bytes>=u.reserved_bytes
        AND n.status IN('active','readonly')
        AND NOT EXISTS(SELECT 1 FROM upload_key_fences f
          WHERE f.upload_session_id=u.id))
    THEN RAISE(ABORT,'UPLOAD_VERIFICATION_MISMATCH') END;
  SELECT CASE WHEN NEW.operation='upload.completed'
    AND EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id)
    AND NOT EXISTS(SELECT 1 FROM upload_version_targets t
      JOIN upload_sessions u ON u.id=t.upload_session_id
      WHERE t.upload_session_id=NEW.upload_session_id
        AND t.actor_id=NEW.actor_id AND t.photo_id=NEW.photo_id
        AND t.workspace_id=u.workspace_id AND t.project_id=u.project_id
        AND t.album_id=u.album_id)
    THEN RAISE(ABORT,'UPLOAD_VERSION_TARGET_MISMATCH') END;
  SELECT CASE WHEN NEW.operation='upload.completed'
    AND EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id)
    AND (SELECT COALESCE(MAX(v.version_no),0) FROM photo_versions v
      JOIN upload_version_targets t ON t.photo_id=v.photo_id
      WHERE t.upload_session_id=NEW.upload_session_id)>=9007199254740991
    THEN RAISE(ABORT,'PHOTO_VERSION_NUMBER_EXHAUSTED') END;
END;

-- Stop direct V2 photo_version inserts unless they are this pending verified
-- workflow and the target's parent is retained. The existing 0033 duplicate
-- identity guard and UNIQUE(photo_id,version_no) remain final guards.
CREATE TRIGGER photo_version_upload_insert_guard
BEFORE INSERT ON photo_versions
WHEN NEW.version_no>1
  -- Preserve the established identity/scope/dimension guard precedence. Invalid
  -- basic records are rejected by 0011/0012/0033, never admitted by this filter.
  AND NEW.id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM photo_versions old WHERE old.id=NEW.id
    OR (old.photo_id=NEW.photo_id AND old.version_no=NEW.version_no))
  AND EXISTS(SELECT 1 FROM photos p WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id)
  AND (NEW.parent_version_id IS NULL OR EXISTS(SELECT 1 FROM photo_versions parent
    WHERE parent.id=NEW.parent_version_id AND parent.photo_id=NEW.photo_id
      AND parent.workspace_id=NEW.workspace_id AND parent.version_no<NEW.version_no))
  AND NEW.width IS NOT NULL AND NEW.height IS NOT NULL
  AND typeof(NEW.width)='integer' AND typeof(NEW.height)='integer'
  AND NEW.width BETWEEN 1 AND 32768 AND NEW.height BETWEEN 1 AND 32768
  AND NEW.width*NEW.height<=80000000
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM upload_workflow_requests w
    JOIN upload_sessions u ON u.id=w.upload_session_id
    JOIN upload_version_targets t ON t.upload_session_id=u.id
    WHERE w.operation='upload.completed' AND w.result_json IS NULL
      AND w.photo_id=t.photo_id AND w.version_id=NEW.id
      AND w.actor_id=NEW.created_by_actor AND u.workspace_id=NEW.workspace_id
      AND t.photo_id=NEW.photo_id AND t.workspace_id=NEW.workspace_id
      AND t.parent_version_id=NEW.parent_version_id
      AND w.sha256_hex=NEW.source_hash_sha256 AND w.actual_bytes=NEW.byte_size
      AND w.content_type=NEW.mime AND w.image_width=NEW.width
      AND w.image_height=NEW.height AND NEW.status='private'
      AND NEW.version_no=(SELECT COALESCE(MAX(v.version_no),0)+1
        FROM photo_versions v WHERE v.photo_id=t.photo_id)
      AND (SELECT COALESCE(MAX(v.version_no),0)
        FROM photo_versions v WHERE v.photo_id=t.photo_id)<9007199254740991
  ) THEN RAISE(ABORT,'VERSION_UPLOAD_REQUIRED') END;
END;
-- V1 and V2 completion share one statement trigger. V1 retains its historical
-- new-photo/result/audit branch. V2 appends to its immutable reservation target.
DROP TRIGGER upload_workflow_apply_completion;
CREATE TRIGGER upload_workflow_apply_completion
AFTER INSERT ON upload_workflow_requests
WHEN NEW.operation='upload.completed' BEGIN
  INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename)
  SELECT NEW.photo_id,u.workspace_id,u.project_id,u.album_id,u.original_filename
  FROM upload_sessions u WHERE u.id=NEW.upload_session_id
    AND NOT EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=u.id);

  INSERT INTO photo_versions(
    id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,
    source_hash_sha256,byte_size,mime,width,height,status
  )
  SELECT NEW.version_id,u.workspace_id,COALESCE(t.photo_id,NEW.photo_id),
    CASE WHEN t.upload_session_id IS NULL THEN 1
      ELSE (SELECT COALESCE(MAX(v.version_no),0)+1 FROM photo_versions v
        WHERE v.photo_id=t.photo_id) END,
    t.parent_version_id,NEW.actor_id,NEW.sha256_hex,NEW.actual_bytes,
    NEW.content_type,NEW.image_width,NEW.image_height,'private'
  FROM upload_sessions u LEFT JOIN upload_version_targets t
    ON t.upload_session_id=u.id
  WHERE u.id=NEW.upload_session_id;

  INSERT INTO photo_assets(
    id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,
    byte_size,mime,checksum_sha256,state
  )
  SELECT NEW.asset_id,u.workspace_id,COALESCE(t.photo_id,NEW.photo_id),
    NEW.version_id,u.storage_node_id,'original',u.object_key,
    NEW.actual_bytes,NEW.content_type,NEW.sha256_hex,'private'
  FROM upload_sessions u LEFT JOIN upload_version_targets t
    ON t.upload_session_id=u.id
  WHERE u.id=NEW.upload_session_id;

  INSERT INTO upload_completions(
    upload_session_id,actor_id,request_id,session_id,workspace_id,project_id,
    album_id,photo_id,version_id,asset_id,actual_bytes,content_type,sha256_hex,
    completed_at_ms,image_width,image_height
  )
  SELECT u.id,NEW.actor_id,NEW.request_id,NEW.session_id,u.workspace_id,
    u.project_id,u.album_id,NEW.photo_id,NEW.version_id,NEW.asset_id,
    NEW.actual_bytes,NEW.content_type,NEW.sha256_hex,NEW.created_at_ms,
    NEW.image_width,NEW.image_height
  FROM upload_sessions u WHERE u.id=NEW.upload_session_id
    AND NOT EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=u.id);

  INSERT INTO upload_version_completions(
    upload_session_id,actor_id,request_id,session_id,workspace_id,project_id,
    album_id,photo_id,version_id,asset_id,parent_version_id,version_no,
    change_type,change_note,labels_json,actual_bytes,content_type,sha256_hex,
    image_width,image_height,completed_at_ms,event_id,result_json
  )
  SELECT u.id,NEW.actor_id,NEW.request_id,NEW.session_id,u.workspace_id,
    u.project_id,u.album_id,t.photo_id,NEW.version_id,NEW.asset_id,
    t.parent_version_id,v.version_no,t.change_type,t.change_note,t.labels_json,
    NEW.actual_bytes,NEW.content_type,NEW.sha256_hex,NEW.image_width,
    NEW.image_height,NEW.created_at_ms,'photo-version-created:'||NEW.version_id,
    json_object('uploadSessionId',NEW.upload_session_id,'status','completed',
      'photoId',t.photo_id,'versionId',NEW.version_id,'assetId',NEW.asset_id,
      'actualBytes',NEW.actual_bytes,'contentType',NEW.content_type,
      'sha256',NEW.sha256_hex,'width',NEW.image_width,'height',NEW.image_height,
      'completedAt',strftime('%Y-%m-%dT%H:%M:%fZ',
        NEW.created_at_ms/1000.0,'unixepoch'),
      'versionNo',v.version_no,'parentVersionId',t.parent_version_id,
      'changeType',t.change_type,'changeNote',t.change_note,
      'labels',json(t.labels_json))
  FROM upload_sessions u JOIN upload_version_targets t
    ON t.upload_session_id=u.id
  JOIN photo_versions v ON v.id=NEW.version_id
    AND v.workspace_id=t.workspace_id AND v.photo_id=t.photo_id
  WHERE u.id=NEW.upload_session_id;

  UPDATE workspace_storage_usage
  SET reserved_bytes=reserved_bytes-NEW.actual_bytes,
      used_bytes=used_bytes+NEW.actual_bytes
  WHERE workspace_id=(SELECT workspace_id FROM upload_sessions
    WHERE id=NEW.upload_session_id);
  UPDATE storage_nodes
  SET reserved_bytes=reserved_bytes-NEW.actual_bytes,
      used_bytes=used_bytes+NEW.actual_bytes
  WHERE id=(SELECT storage_node_id FROM upload_sessions
    WHERE id=NEW.upload_session_id);

  UPDATE upload_workflow_requests
  SET result_json=CASE WHEN EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id)
    THEN (SELECT c.result_json FROM upload_version_completions c
      WHERE c.upload_session_id=NEW.upload_session_id)
    ELSE json_object('uploadSessionId',NEW.upload_session_id,
      'status','completed','photoId',NEW.photo_id,'versionId',NEW.version_id,
      'assetId',NEW.asset_id,'actualBytes',NEW.actual_bytes,
      'contentType',NEW.content_type,'sha256',NEW.sha256_hex,
      'width',NEW.image_width,'height',NEW.image_height,
      'completedAt',strftime('%Y-%m-%dT%H:%M:%fZ',
        NEW.created_at_ms/1000.0,'unixepoch')) END
  WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id
  )
  SELECT 'upload-completed:'||u.id,'user',NEW.actor_id,NEW.session_id,
    u.workspace_id,u.project_id,u.album_id,NEW.photo_id,NEW.version_id,
    'upload.completed',json_object('status','reserved',
      'reservedBytes',u.reserved_bytes),
    json_object('status','completed','actualBytes',NEW.actual_bytes,
      'contentType',NEW.content_type,'sha256',NEW.sha256_hex,
      'assetId',NEW.asset_id,'width',NEW.image_width,'height',NEW.image_height),
    NEW.request_id
  FROM upload_sessions u WHERE u.id=NEW.upload_session_id
    AND NOT EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=u.id);
END;

-- Reject NULL and every unique-key replacement before a completion row can
-- replace its upload session, request, version, asset, photo/version number,
-- or audit event. The ledger snapshots full canonical retouch metadata.
CREATE TRIGGER upload_version_completions_insert_guard
BEFORE INSERT ON upload_version_completions BEGIN
  SELECT CASE WHEN NEW.upload_session_id IS NULL OR NEW.actor_id IS NULL
    OR NEW.request_id IS NULL OR NEW.session_id IS NULL OR NEW.photo_id IS NULL
    OR NEW.version_id IS NULL OR NEW.asset_id IS NULL OR NEW.parent_version_id IS NULL
    OR NEW.version_no IS NULL OR NEW.event_id IS NULL OR length(NEW.event_id)=0
    OR NEW.result_json IS NULL
    OR EXISTS(SELECT 1 FROM upload_version_completions c
      WHERE c.upload_session_id=NEW.upload_session_id
        OR (c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
        OR c.version_id=NEW.version_id OR c.asset_id=NEW.asset_id
        OR (c.photo_id=NEW.photo_id AND c.version_no=NEW.version_no)
        OR c.event_id=NEW.event_id)
    THEN RAISE(ABORT,'IMMUTABLE_UPLOAD_VERSION_COMPLETION') END;
  SELECT CASE WHEN NEW.event_id<>'photo-version-created:'||NEW.version_id
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.event_id=NEW.event_id)
    OR NOT EXISTS(
      SELECT 1 FROM upload_workflow_requests w
      JOIN upload_sessions u ON u.id=w.upload_session_id
      JOIN upload_version_targets t ON t.upload_session_id=u.id
      JOIN photo_versions v ON v.id=NEW.version_id
        AND v.workspace_id=t.workspace_id AND v.photo_id=t.photo_id
      JOIN photo_assets asset ON asset.id=NEW.asset_id
        AND asset.workspace_id=t.workspace_id AND asset.photo_id=t.photo_id
        AND asset.version_id=v.id
      WHERE w.actor_id=NEW.actor_id AND w.request_id=NEW.request_id
        AND w.operation='upload.completed' AND w.result_json IS NULL
        AND w.upload_session_id=NEW.upload_session_id
        AND w.session_id=NEW.session_id AND w.photo_id=NEW.photo_id
        AND w.version_id=NEW.version_id AND w.asset_id=NEW.asset_id
        AND w.actual_bytes=NEW.actual_bytes
        AND w.content_type=NEW.content_type AND w.sha256_hex=NEW.sha256_hex
        AND w.image_width=NEW.image_width AND w.image_height=NEW.image_height
        AND w.created_at_ms=NEW.completed_at_ms
        AND w.payload_json=json_object('uploadSessionId',NEW.upload_session_id)
        AND u.actor_id=NEW.actor_id AND u.workspace_id=NEW.workspace_id
        AND u.project_id=NEW.project_id AND u.album_id=NEW.album_id
        AND t.photo_id=NEW.photo_id AND t.parent_version_id=NEW.parent_version_id
        AND t.change_type=NEW.change_type AND t.change_note=NEW.change_note
        AND json(t.labels_json)=json(NEW.labels_json)
        AND v.version_no=NEW.version_no AND v.parent_version_id=t.parent_version_id
        AND v.status='private' AND v.created_by_actor=NEW.actor_id
        AND v.source_hash_sha256=NEW.sha256_hex AND v.byte_size=NEW.actual_bytes
        AND v.mime=NEW.content_type AND v.width=NEW.image_width
        AND v.height=NEW.image_height
        AND asset.asset_kind='original' AND asset.state='private'
        AND asset.object_key=u.object_key AND asset.storage_node_id=u.storage_node_id
        AND asset.checksum_sha256=NEW.sha256_hex
        AND asset.byte_size=NEW.actual_bytes AND asset.mime=NEW.content_type)
    THEN RAISE(ABORT,'UPLOAD_VERSION_COMPLETION_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.result_json IS NOT json_object(
    'uploadSessionId',NEW.upload_session_id,'status','completed',
    'photoId',NEW.photo_id,'versionId',NEW.version_id,'assetId',NEW.asset_id,
    'actualBytes',NEW.actual_bytes,'contentType',NEW.content_type,
    'sha256',NEW.sha256_hex,'width',NEW.image_width,'height',NEW.image_height,
    'completedAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.completed_at_ms/1000.0,'unixepoch'),
    'versionNo',NEW.version_no,'parentVersionId',NEW.parent_version_id,
    'changeType',NEW.change_type,'changeNote',NEW.change_note,
    'labels',json(NEW.labels_json))
    THEN RAISE(ABORT,'UPLOAD_VERSION_RESULT_MISMATCH') END;
  SELECT CASE WHEN json_extract(NEW.result_json,'$.uploadSessionId') IS NOT NEW.upload_session_id
    OR json_extract(NEW.result_json,'$.photoId') IS NOT NEW.photo_id
    OR json_extract(NEW.result_json,'$.versionId') IS NOT NEW.version_id
    OR json_extract(NEW.result_json,'$.assetId') IS NOT NEW.asset_id
    OR json_extract(NEW.result_json,'$.versionNo') IS NOT NEW.version_no
    OR json_extract(NEW.result_json,'$.parentVersionId') IS NOT NEW.parent_version_id
    OR json_extract(NEW.result_json,'$.changeType') IS NOT NEW.change_type
    OR json_extract(NEW.result_json,'$.changeNote') IS NOT NEW.change_note
    OR json(json_extract(NEW.result_json,'$.labels')) IS NOT json(NEW.labels_json)
    OR json_extract(NEW.result_json,'$.actualBytes') IS NOT NEW.actual_bytes
    OR json_extract(NEW.result_json,'$.contentType') IS NOT NEW.content_type
    OR json_extract(NEW.result_json,'$.sha256') IS NOT NEW.sha256_hex
    OR json_extract(NEW.result_json,'$.width') IS NOT NEW.image_width
    OR json_extract(NEW.result_json,'$.height') IS NOT NEW.image_height
    OR json_extract(NEW.result_json,'$.completedAt') IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.completed_at_ms/1000.0,'unixepoch')
    THEN RAISE(ABORT,'UPLOAD_VERSION_RESULT_MISMATCH') END;
END;
CREATE TRIGGER upload_version_completions_no_update
BEFORE UPDATE ON upload_version_completions BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_VERSION_COMPLETION');
END;
CREATE TRIGGER upload_version_completions_no_delete
BEFORE DELETE ON upload_version_completions BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_VERSION_COMPLETION');
END;
CREATE TRIGGER upload_version_completion_audit
AFTER INSERT ON upload_version_completions BEGIN
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id
  )
  SELECT c.event_id,'user',c.actor_id,c.session_id,c.workspace_id,c.project_id,
    c.album_id,c.photo_id,c.version_id,'photo.version.created',
    json_object('current',json_object('versionId',t.parent_version_id,
      'revision',t.expected_revision),'uploadStatus','reserved'),
    json_object('versionId',c.version_id,'versionNo',c.version_no,
      'parentVersionId',c.parent_version_id,'status','private',
      'changeType',c.change_type,'changeNote',c.change_note,
      'labels',json(c.labels_json),'actualBytes',c.actual_bytes,
      'contentType',c.content_type,'sha256',c.sha256_hex,
      'width',c.image_width,'height',c.image_height,'assetId',c.asset_id),
    c.request_id
  FROM upload_version_completions c
  JOIN upload_version_targets t ON t.upload_session_id=c.upload_session_id
  WHERE c.upload_session_id=NEW.upload_session_id;
END;
-- Completion-aware guards: completed V2 reservations cannot be cancelled,
-- reviewed as unfinished, expired, or treated as busy during archive checks.
DROP TRIGGER upload_review_flag_guard;
CREATE TRIGGER upload_review_flag_guard
BEFORE INSERT ON upload_review_flags BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000)
    THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_sessions u
      WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id
        AND u.status='reserved')
    OR EXISTS(SELECT 1 FROM upload_completions c
      WHERE c.upload_session_id=NEW.upload_session_id)
    OR EXISTS(SELECT 1 FROM upload_version_completions c
      WHERE c.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
END;

DROP TRIGGER upload_session_completed_transition_guard;
CREATE TRIGGER upload_session_completed_transition_guard
BEFORE UPDATE ON upload_sessions
WHEN EXISTS(SELECT 1 FROM upload_completions c
    WHERE c.upload_session_id=OLD.id)
  OR EXISTS(SELECT 1 FROM upload_version_completions c
    WHERE c.upload_session_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED');
END;

DROP TRIGGER content_archive_upload_guard;
CREATE TRIGGER content_archive_upload_guard
BEFORE INSERT ON request_commands
WHEN NEW.operation IN('project.archived','album.archived')
  AND NOT EXISTS(SELECT 1 FROM processing_review_commands r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM request_commands r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_workflow_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM upload_sessions u
    JOIN workspaces w ON w.id=u.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE w.owner_user_id=NEW.actor_id AND u.status='reserved'
      AND NOT EXISTS(SELECT 1 FROM upload_completions c
        WHERE c.upload_session_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM upload_version_completions c
        WHERE c.upload_session_id=u.id)
      AND ((NEW.operation='project.archived' AND u.project_id=NEW.resource_id)
        OR (NEW.operation='album.archived' AND u.album_id=NEW.resource_id))
  ) THEN RAISE(ABORT,'UPLOADS_IN_PROGRESS') END;
END;