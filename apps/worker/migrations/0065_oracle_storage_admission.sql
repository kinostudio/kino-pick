-- Oracle overflow admission and effective capacity accounting.
-- Recovery: preserve immutable storage rows and ledgers; repair forward.
CREATE TABLE oracle_storage_health(
 id INTEGER PRIMARY KEY CHECK(id=1),
 observed_at_ms INTEGER NOT NULL CHECK(observed_at_ms>=0),
 mounted INTEGER NOT NULL CHECK(mounted IN(0,1)),
 free_bytes INTEGER NOT NULL CHECK(free_bytes>=0),
 maximum_quota_bytes INTEGER NOT NULL CHECK(maximum_quota_bytes>0),
 quota_bytes INTEGER NOT NULL CHECK(quota_bytes BETWEEN 1000000000 AND 100000000000)
);
CREATE TRIGGER oracle_storage_health_no_delete BEFORE DELETE ON oracle_storage_health BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_STORAGE_HEALTH');
END;
CREATE TRIGGER oracle_storage_health_update_guard BEFORE UPDATE ON oracle_storage_health
WHEN NEW.id<>OLD.id OR NEW.observed_at_ms<OLD.observed_at_ms
 OR (NEW.observed_at_ms=OLD.observed_at_ms AND
   (NEW.mounted<>OLD.mounted OR NEW.free_bytes<>OLD.free_bytes
    OR NEW.maximum_quota_bytes<>OLD.maximum_quota_bytes OR NEW.quota_bytes<>OLD.quota_bytes))
BEGIN SELECT RAISE(ABORT,'INVALID_STORAGE_HEALTH_UPDATE'); END;

CREATE INDEX storage_pending_upload_derivative_idx
 ON upload_sessions(storage_node_id,workspace_id) WHERE status='reserved';

CREATE VIEW storage_pending_derivative_capacity AS
SELECT storage_node_id,workspace_id,SUM(pending_bytes) AS pending_bytes
FROM (
 SELECT u.storage_node_id,u.workspace_id,16777216 AS pending_bytes
 FROM upload_sessions u
 WHERE u.status='reserved'
   AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id)
   AND NOT EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=u.id)
 UNION ALL
 SELECT a.storage_node_id,a.workspace_id,16777216-j.reserved_bytes AS pending_bytes
 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id
 WHERE j.status IN('queued','running','retryable','needs_review')
   AND j.reserved_bytes<16777216
) pending
GROUP BY storage_node_id,workspace_id;

CREATE TRIGGER storage_settings_multi_account_guard
BEFORE UPDATE OF multi_account_enabled ON storage_settings
WHEN NEW.multi_account_enabled<>0
BEGIN SELECT RAISE(ABORT,'MULTI_NODE_DISABLED'); END;
CREATE TRIGGER storage_settings_multi_account_insert_guard
BEFORE INSERT ON storage_settings
WHEN NEW.multi_account_enabled<>0
BEGIN SELECT RAISE(ABORT,'MULTI_NODE_DISABLED'); END;

DROP TRIGGER single_active_storage;
CREATE TRIGGER single_active_storage BEFORE INSERT ON storage_nodes
WHEN NEW.status='active' BEGIN
 SELECT CASE WHEN COALESCE((SELECT multi_account_enabled FROM storage_settings WHERE id=1),1)<>0
   THEN RAISE(ABORT,'MULTI_NODE_DISABLED') END;
 SELECT CASE WHEN NEW.id NOT IN('primary','oracle-vm')
   THEN RAISE(ABORT,'MULTI_NODE_DISABLED') END;
 SELECT CASE WHEN NEW.id='primary' AND (NEW.provider<>'r2'
   OR NEW.bucket_name<>'PRIMARY_STORAGE' OR NEW.credential_ref<>'binding:PRIMARY_STORAGE')
   THEN RAISE(ABORT,'STORAGE_NODE_INVALID') END;
 SELECT CASE WHEN NEW.id='oracle-vm' AND (NEW.provider<>'s3'
   OR NEW.endpoint<>'https://drive.kinostudio.tw' OR NEW.bucket_name<>'kino-pick-overflow'
   OR NEW.credential_ref<>'env:ORACLE_STORAGE')
   THEN RAISE(ABORT,'STORAGE_NODE_INVALID') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM storage_nodes WHERE status='active'
   AND id NOT IN('primary','oracle-vm'))
   THEN RAISE(ABORT,'MULTI_NODE_DISABLED') END;
END;
DROP TRIGGER single_active_storage_update;
CREATE TRIGGER single_active_storage_update BEFORE UPDATE ON storage_nodes
WHEN NEW.status='active' BEGIN
 SELECT CASE WHEN COALESCE((SELECT multi_account_enabled FROM storage_settings WHERE id=1),1)<>0
   THEN RAISE(ABORT,'MULTI_NODE_DISABLED') END;
 SELECT CASE WHEN NEW.id NOT IN('primary','oracle-vm')
   THEN RAISE(ABORT,'MULTI_NODE_DISABLED') END;
 SELECT CASE WHEN NEW.id='primary' AND (NEW.provider<>'r2'
   OR NEW.bucket_name<>'PRIMARY_STORAGE' OR NEW.credential_ref<>'binding:PRIMARY_STORAGE')
   THEN RAISE(ABORT,'STORAGE_NODE_INVALID') END;
 SELECT CASE WHEN NEW.id='oracle-vm' AND (NEW.provider<>'s3'
   OR NEW.endpoint<>'https://drive.kinostudio.tw' OR NEW.bucket_name<>'kino-pick-overflow'
   OR NEW.credential_ref<>'env:ORACLE_STORAGE')
   THEN RAISE(ABORT,'STORAGE_NODE_INVALID') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM storage_nodes WHERE status='active'
   AND id NOT IN('primary','oracle-vm'))
   THEN RAISE(ABORT,'MULTI_NODE_DISABLED') END;
END;

CREATE TRIGGER oracle_storage_node_insert_guard BEFORE INSERT ON storage_nodes
WHEN NEW.id='oracle-vm' AND (NEW.provider<>'s3' OR NEW.endpoint<>'https://drive.kinostudio.tw'
 OR NEW.bucket_name<>'kino-pick-overflow' OR NEW.credential_ref<>'env:ORACLE_STORAGE')
BEGIN SELECT RAISE(ABORT,'STORAGE_NODE_INVALID'); END;
CREATE TRIGGER oracle_storage_node_identity_guard BEFORE UPDATE ON storage_nodes
WHEN OLD.id='oracle-vm' AND (NEW.id<>OLD.id OR NEW.provider<>OLD.provider
 OR NEW.endpoint IS NOT OLD.endpoint OR NEW.bucket_name<>OLD.bucket_name
 OR NEW.credential_ref<>OLD.credential_ref)
BEGIN SELECT RAISE(ABORT,'STORAGE_NODE_INVALID'); END;
CREATE TRIGGER oracle_storage_node_quota_guard BEFORE UPDATE OF quota_bytes ON storage_nodes
WHEN OLD.id='oracle-vm' AND NEW.quota_bytes<>OLD.quota_bytes
 AND NOT EXISTS(
   SELECT 1 FROM oracle_storage_policy p JOIN oracle_storage_health h ON h.id=1
   WHERE p.id=1 AND p.quota_bytes=NEW.quota_bytes AND h.quota_bytes=p.quota_bytes
     AND h.maximum_quota_bytes>=p.quota_bytes AND h.mounted=1
     AND h.observed_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER)
     AND h.observed_at_ms>=CAST(unixepoch('subsec')*1000 AS INTEGER)-120000
     AND NEW.used_bytes+NEW.reserved_bytes+COALESCE((SELECT SUM(pending_bytes)
       FROM storage_pending_derivative_capacity WHERE storage_node_id='oracle-vm'),0)<=p.quota_bytes
      AND h.free_bytes>=p.free_floor_bytes+NEW.reserved_bytes+COALESCE((SELECT SUM(pending_bytes)
        FROM storage_pending_derivative_capacity WHERE storage_node_id='oracle-vm'),0)
 )
BEGIN SELECT RAISE(ABORT,'STORAGE_NODE_QUOTA_UNAVAILABLE'); END;
DROP TRIGGER oracle_storage_policy_command_guard;
CREATE TRIGGER oracle_storage_policy_command_guard BEFORE INSERT ON oracle_storage_policy_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN NEW.occurred_at_ms<unixepoch('subsec')*1000-60000 OR NEW.occurred_at_ms>unixepoch('subsec')*1000+60000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM oracle_storage_policy_commands WHERE request_id=NEW.request_id AND(actor_id<>NEW.actor_id OR session_id<>NEW.session_id OR payload_json<>NEW.payload_json)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM oracle_storage_policy_commands WHERE request_id=NEW.request_id) THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NEW.expected_revision<>(SELECT revision FROM oracle_storage_policy WHERE id=1) THEN RAISE(ABORT,'STORAGE_POLICY_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM storage_nodes n WHERE n.id='oracle-vm'
   AND n.used_bytes+n.reserved_bytes+COALESCE((SELECT SUM(pending_bytes)
     FROM storage_pending_derivative_capacity WHERE storage_node_id='oracle-vm'),0)>NEW.quota_bytes)
   THEN RAISE(ABORT,'STORAGE_POLICY_BELOW_USAGE') END;
END;
DROP TRIGGER upload_request_guard;
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
    OR NEW.storage_node_id NOT IN('primary','oracle-vm')
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
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>7+CASE WHEN json_type(NEW.payload_json,'$.resolution') IS NOT NULL THEN 1 ELSE 0 END
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>8+CASE WHEN json_type(NEW.payload_json,'$.resolution') IS NOT NULL THEN 1 ELSE 0 END
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
        AND u.used_bytes+u.reserved_bytes+NEW.expected_bytes+16777216
          +COALESCE((SELECT SUM(pending_bytes) FROM storage_pending_derivative_capacity
            WHERE workspace_id=NEW.workspace_id),0)>w.quota_bytes)
    THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND NOT EXISTS(SELECT 1 FROM workspace_storage_usage u
      WHERE u.workspace_id=NEW.workspace_id)
    THEN RAISE(ABORT,'STORAGE_LEDGER_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.operation='upload.reserved' AND NOT (
    (NEW.storage_node_id='primary' AND EXISTS(
      SELECT 1 FROM storage_nodes n WHERE n.id='primary' AND n.provider='r2'
        AND n.bucket_name='PRIMARY_STORAGE' AND n.credential_ref='binding:PRIMARY_STORAGE'
        AND n.status='active'
        AND n.used_bytes+n.reserved_bytes+COALESCE((SELECT SUM(pending_bytes)
          FROM storage_pending_derivative_capacity WHERE storage_node_id='primary'),0)
          +NEW.expected_bytes+16777216<=n.quota_bytes))
    OR
    (NEW.storage_node_id='oracle-vm' AND EXISTS(
      SELECT 1 FROM storage_nodes n
      JOIN oracle_storage_policy p ON p.id=1
      JOIN oracle_storage_health h ON h.id=1
      WHERE n.id='oracle-vm' AND n.provider='s3' AND n.status='active'
        AND n.endpoint='https://drive.kinostudio.tw'
        AND n.bucket_name='kino-pick-overflow'
        AND n.credential_ref='env:ORACLE_STORAGE'
        AND p.requested_enabled=1 AND n.quota_bytes=p.quota_bytes
        AND h.quota_bytes=p.quota_bytes AND h.maximum_quota_bytes>=p.quota_bytes
        AND h.mounted=1
        AND h.observed_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER)
        AND h.observed_at_ms>=CAST(unixepoch('subsec')*1000 AS INTEGER)-120000
        AND h.free_bytes>=p.free_floor_bytes+n.reserved_bytes
          +COALESCE((SELECT SUM(pending_bytes) FROM storage_pending_derivative_capacity
            WHERE storage_node_id='oracle-vm'),0)+NEW.expected_bytes+16777216
        AND n.used_bytes+n.reserved_bytes+COALESCE((SELECT SUM(pending_bytes)
          FROM storage_pending_derivative_capacity WHERE storage_node_id='oracle-vm'),0)
          +NEW.expected_bytes+16777216<=min(n.quota_bytes,p.quota_bytes,h.maximum_quota_bytes)
        AND EXISTS(
          SELECT 1 FROM storage_nodes r WHERE r.id='primary' AND r.provider='r2'
            AND r.bucket_name='PRIMARY_STORAGE' AND r.credential_ref='binding:PRIMARY_STORAGE'
            AND r.status='active'
            AND r.used_bytes+r.reserved_bytes+COALESCE((SELECT SUM(pending_bytes)
              FROM storage_pending_derivative_capacity WHERE storage_node_id='primary'),0)
              +NEW.expected_bytes+16777216>r.quota_bytes))
    ))
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
DROP TRIGGER processing_review_command_guard;
CREATE TRIGGER processing_review_command_guard BEFORE INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM invite_creation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM invite_revocation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id AND (job_id<>NEW.job_id OR expected_epoch<>NEW.expected_epoch OR payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id AND a.asset_kind='original' AND a.state='private'
    JOIN photos p ON p.id=a.photo_id JOIN workspaces w ON w.id=p.workspace_id JOIN albums al ON al.id=p.album_id JOIN projects pr ON pr.id=p.project_id JOIN storage_nodes n ON n.id=a.storage_node_id AND n.status='active'
      AND ((n.id='primary' AND n.provider='r2' AND n.bucket_name='PRIMARY_STORAGE'
        AND n.credential_ref='binding:PRIMARY_STORAGE')
        OR (n.id='oracle-vm' AND n.provider='s3'
          AND n.endpoint='https://drive.kinostudio.tw' AND n.bucket_name='kino-pick-overflow'
          AND n.credential_ref='env:ORACLE_STORAGE'))
    WHERE j.id=NEW.job_id AND j.status='needs_review' AND j.reserved_bytes=16777216 AND j.lease_epoch=NEW.expected_epoch AND w.owner_user_id=NEW.actor_id
      AND p.id=json_extract(NEW.payload_json,'$.photoId') AND a.version_id=json_extract(NEW.payload_json,'$.versionId')
      AND json_extract(NEW.payload_json,'$.expectedLeaseEpoch')=NEW.expected_epoch AND json_extract(NEW.payload_json,'$.confirmAbandon')=1
      AND al.state NOT IN('archived','deleting','deleted') AND pr.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'PROCESSING_REVIEW_CONFLICT') END;
  SELECT CASE WHEN ABS(NEW.created_at_ms-unixepoch('subsec')*1000)>60000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN json_type(NEW.fences_json)<>'array' OR json_array_length(NEW.fences_json)<>2
    OR (SELECT count(DISTINCT json_extract(value,'$.kind')) FROM json_each(NEW.fences_json))<>2
    OR EXISTS(SELECT 1 FROM json_each(NEW.fences_json) e LEFT JOIN image_processing_outputs s ON s.job_id=NEW.job_id AND s.kind=json_extract(e.value,'$.kind') WHERE s.kind IS NULL OR json_extract(e.value,'$.state') IS NOT 'fenced')
    THEN RAISE(ABORT,'PROCESSING_FENCES_REQUIRED') END;
END;
DROP TRIGGER manual_album_deletion_job_guard;
CREATE TRIGGER manual_album_deletion_job_guard BEFORE INSERT ON manual_album_deletion_jobs BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND w.id=NEW.workspace_id
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.status<>'deleting' OR NEW.bytes_reclaimed<>0 OR NEW.completed_at_ms IS NOT NULL
    OR abs(NEW.created_at_ms-unixepoch('subsec')*1000)>60000
    OR json_type(NEW.policy_snapshot)<>'object' OR json_extract(NEW.policy_snapshot,'$.reason') IS NOT 'manual'
    OR json_extract(NEW.policy_snapshot,'$.graceHours') IS NOT 0
    OR json_extract(NEW.policy_snapshot,'$.minimumRetentionDays') IS NOT 0
    OR json_type(NEW.policy_snapshot,'$.confirmed') IS NOT 'true'
    THEN RAISE(ABORT,'INVALID_DELETE_CONFIRMATION') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
      AND a.name=NEW.confirmation_name AND a.revision=NEW.expected_revision
      AND a.state IN('draft','active','archived') AND a.is_pinned=0 AND a.legal_hold=0
      AND p.status IN('draft','uploading','delivered','archived')
  ) THEN RAISE(ABORT,'ALBUM_NOT_DELETABLE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM manual_album_deletion_blockers WHERE album_id=NEW.album_id)
    THEN RAISE(ABORT,'DELETE_BLOCKED') END;
  SELECT CASE WHEN NEW.inventory_count<>(SELECT count(*) FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE p.album_id=NEW.album_id)
    OR NEW.bytes_before<>COALESCE((SELECT sum(a.byte_size) FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE p.album_id=NEW.album_id),0)
    OR NOT EXISTS(SELECT 1 FROM workspace_storage_usage u WHERE u.workspace_id=NEW.workspace_id AND u.used_bytes>=NEW.bytes_before)
    OR EXISTS(SELECT 1 FROM (
      SELECT a.storage_node_id,SUM(a.byte_size) AS bytes
      FROM photo_assets a JOIN photos p ON p.id=a.photo_id
      WHERE p.album_id=NEW.album_id GROUP BY a.storage_node_id
    ) totals LEFT JOIN storage_nodes n ON n.id=totals.storage_node_id
    WHERE n.id IS NULL OR n.used_bytes<totals.bytes)
    OR EXISTS(SELECT 1 FROM photo_assets a JOIN photos p ON p.id=a.photo_id JOIN storage_nodes n ON n.id=a.storage_node_id
      WHERE p.album_id=NEW.album_id AND (a.workspace_id<>NEW.workspace_id OR p.workspace_id<>NEW.workspace_id OR p.project_id<>NEW.project_id
        OR NOT (
          (a.storage_node_id='primary' AND n.id='primary' AND n.provider='r2'
            AND n.bucket_name='PRIMARY_STORAGE' AND n.credential_ref='binding:PRIMARY_STORAGE')
          OR (a.storage_node_id='oracle-vm' AND n.id='oracle-vm' AND n.provider='s3'
            AND n.endpoint='https://drive.kinostudio.tw' AND n.bucket_name='kino-pick-overflow'
            AND n.credential_ref='env:ORACLE_STORAGE'))
        OR n.status NOT IN('active','readonly') OR instr(a.object_key,'..')>0 OR instr(a.object_key,'%')>0 OR instr(a.object_key,char(92))>0
        OR substr(a.object_key,1,length(NEW.workspace_id||'/'||NEW.project_id||'/'||NEW.album_id||'/'))<>NEW.workspace_id||'/'||NEW.project_id||'/'||NEW.album_id||'/'))
    THEN RAISE(ABORT,'DELETE_INVENTORY_CHANGED') END;
END;
