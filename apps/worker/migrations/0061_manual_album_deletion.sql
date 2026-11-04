-- Explicit Owner cleanup only. Keep immutable asset/history IDs and permanent R2 markers.
-- Recovery: keep these ledgers and resume pending items; never restore SQL over reclaimed bytes.
PRAGMA foreign_keys=ON;

CREATE TABLE manual_album_deletion_jobs(
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK(length(request_id)=36 AND request_id=lower(request_id)),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL UNIQUE,
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision BETWEEN 1 AND 2147483646),
  confirmation_name TEXT NOT NULL,
  policy_snapshot TEXT NOT NULL CHECK(json_valid(policy_snapshot)),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  inventory_count INTEGER NOT NULL CHECK(typeof(inventory_count)='integer' AND inventory_count BETWEEN 0 AND 100000),
  bytes_before INTEGER NOT NULL CHECK(typeof(bytes_before)='integer' AND bytes_before>=0),
  bytes_reclaimed INTEGER NOT NULL DEFAULT 0 CHECK(typeof(bytes_reclaimed)='integer' AND bytes_reclaimed BETWEEN 0 AND bytes_before),
  status TEXT NOT NULL DEFAULT 'deleting' CHECK(status IN('deleting','completed')),
  completed_at_ms INTEGER,
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  CHECK((status='deleting' AND completed_at_ms IS NULL) OR (status='completed' AND completed_at_ms IS NOT NULL))
);
CREATE INDEX manual_album_deletion_jobs_workspace ON manual_album_deletion_jobs(workspace_id,created_at_ms DESC,id DESC);

CREATE TABLE manual_album_deletion_items(
  job_id TEXT NOT NULL REFERENCES manual_album_deletion_jobs(id),
  asset_id TEXT NOT NULL UNIQUE REFERENCES photo_assets(id),
  storage_node_id TEXT NOT NULL REFERENCES storage_nodes(id),
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK(typeof(byte_size)='integer' AND byte_size>0),
  checksum_sha256 TEXT NOT NULL CHECK(length(checksum_sha256)=64 AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','reclaimed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempts)='integer' AND attempts BETWEEN 0 AND 2147483647),
  last_error_code TEXT CHECK(last_error_code IS NULL OR last_error_code IN('STORAGE_IO_UNCERTAIN','STORAGE_WITNESS_MISMATCH')),
  fence_etag TEXT,
  verified_at_ms INTEGER,
  execution_actor_id TEXT REFERENCES users(id),
  execution_session_id TEXT,
  PRIMARY KEY(job_id,asset_id),
  CHECK((status='pending' AND fence_etag IS NULL AND verified_at_ms IS NULL)
    OR(status='reclaimed' AND fence_etag IS NOT NULL AND length(fence_etag) BETWEEN 1 AND 128 AND typeof(verified_at_ms)='integer' AND last_error_code IS NULL)),
  CHECK((attempts=0 AND execution_actor_id IS NULL AND execution_session_id IS NULL AND last_error_code IS NULL)
    OR(attempts>0 AND execution_actor_id IS NOT NULL AND execution_session_id IS NOT NULL))
);
CREATE INDEX manual_album_deletion_items_pending ON manual_album_deletion_items(job_id,status,asset_id);

CREATE VIEW manual_album_deletion_blockers AS
  SELECT a.id AS album_id,'DELETE_PROTECTED' AS blocker FROM albums a
    WHERE a.is_pinned=1 OR a.legal_hold=1 OR EXISTS(SELECT 1 FROM photo_pin_states pin WHERE pin.album_id=a.id AND pin.is_pinned=1)
  UNION ALL SELECT a.id,'DELETE_CONTENT_BUSY' FROM albums a JOIN projects p ON p.id=a.project_id
    WHERE p.status NOT IN('draft','uploading','delivered','archived')
      OR EXISTS(SELECT 1 FROM upload_sessions u JOIN storage_reservations r ON r.id=u.id WHERE u.album_id=a.id)
      OR EXISTS(SELECT 1 FROM upload_sessions u JOIN upload_authorizations grant_row ON grant_row.upload_session_id=u.id
        WHERE u.album_id=a.id AND grant_row.expires_at_ms>unixepoch('subsec')*1000)
      OR EXISTS(SELECT 1 FROM image_processing_jobs j JOIN photo_assets asset ON asset.id=j.id JOIN photos photo ON photo.id=asset.photo_id
        WHERE photo.album_id=a.id AND (j.status<>'succeeded' OR j.reserved_bytes<>0))
  UNION ALL SELECT a.id,'DELETE_ACTIVE_REVIEW' FROM albums a WHERE EXISTS(
    SELECT 1 FROM guest_invite_albums ia JOIN guest_invites i ON i.id=ia.invite_id JOIN guest_sessions s ON s.invite_id=i.id
    WHERE ia.album_id=a.id AND i.expires_at_ms>unixepoch('subsec')*1000 AND s.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) OR EXISTS(SELECT 1 FROM album_human_activity h WHERE h.album_id=a.id AND h.last_valid_viewed_at_ms>unixepoch('subsec')*1000-900000)
  UNION ALL SELECT a.id,'DELETE_SHARED_REFERENCE' FROM albums a WHERE EXISTS(
    SELECT 1 FROM photo_versions child JOIN photo_versions parent ON parent.id=child.parent_version_id
    JOIN photos cp ON cp.id=child.photo_id JOIN photos pp ON pp.id=parent.photo_id
    WHERE (cp.album_id=a.id OR pp.album_id=a.id) AND cp.album_id<>pp.album_id
  ) OR EXISTS(SELECT 1 FROM version_approval_requests r WHERE r.album_id=a.id);

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
    OR NOT EXISTS(SELECT 1 FROM storage_nodes n WHERE n.id='primary' AND n.used_bytes>=NEW.bytes_before)
    OR EXISTS(SELECT 1 FROM photo_assets a JOIN photos p ON p.id=a.photo_id JOIN storage_nodes n ON n.id=a.storage_node_id
      WHERE p.album_id=NEW.album_id AND (a.workspace_id<>NEW.workspace_id OR p.workspace_id<>NEW.workspace_id OR p.project_id<>NEW.project_id
        OR a.storage_node_id<>'primary' OR n.provider<>'r2' OR n.credential_ref<>'binding:PRIMARY_STORAGE'
        OR n.status NOT IN('active','readonly') OR instr(a.object_key,'..')>0 OR instr(a.object_key,'%')>0 OR instr(a.object_key,char(92))>0
        OR substr(a.object_key,1,length(NEW.workspace_id||'/'||NEW.project_id||'/'||NEW.album_id||'/'))<>NEW.workspace_id||'/'||NEW.project_id||'/'||NEW.album_id||'/'))
    THEN RAISE(ABORT,'DELETE_INVENTORY_CHANGED') END;
END;

CREATE TRIGGER manual_album_deletion_item_guard BEFORE INSERT ON manual_album_deletion_items BEGIN
  SELECT CASE WHEN NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.last_error_code IS NOT NULL
    OR NEW.fence_etag IS NOT NULL OR NEW.verified_at_ms IS NOT NULL
    OR NEW.execution_actor_id IS NOT NULL OR NEW.execution_session_id IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM manual_album_deletion_jobs j JOIN albums al ON al.id=j.album_id AND al.state='deleting'
      JOIN photos p ON p.album_id=al.id AND p.workspace_id=j.workspace_id AND p.project_id=j.project_id
      JOIN photo_assets a ON a.photo_id=p.id AND a.id=NEW.asset_id AND a.workspace_id=j.workspace_id
      WHERE j.id=NEW.job_id AND j.status='deleting' AND a.storage_node_id=NEW.storage_node_id AND a.object_key=NEW.object_key
        AND a.byte_size=NEW.byte_size AND a.checksum_sha256=NEW.checksum_sha256)
    THEN RAISE(ABORT,'DELETE_ITEM_WITNESS_MISMATCH') END;
END;

CREATE TRIGGER manual_album_deletion_job_start AFTER INSERT ON manual_album_deletion_jobs BEGIN
  UPDATE albums SET state='deleting',archived_from_state=NULL,revision=revision+1 WHERE id=NEW.album_id;
  INSERT INTO manual_album_deletion_items(job_id,asset_id,storage_node_id,object_key,byte_size,checksum_sha256)
    SELECT NEW.id,a.id,a.storage_node_id,a.object_key,a.byte_size,a.checksum_sha256
    FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE p.album_id=NEW.album_id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id)
    VALUES('manual-delete:'||NEW.id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,'album.deletion_started',
      json_object('revision',NEW.expected_revision),json_object('jobId',NEW.id,'items',NEW.inventory_count,'bytes',NEW.bytes_before,'policy',json(NEW.policy_snapshot)),NEW.request_id);
  UPDATE manual_album_deletion_jobs SET status='completed',completed_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)
    WHERE id=NEW.id AND NEW.inventory_count=0;
END;

CREATE TRIGGER manual_album_deletion_item_transition BEFORE UPDATE ON manual_album_deletion_items BEGIN
  SELECT CASE WHEN OLD.status<>'pending' OR NEW.job_id<>OLD.job_id OR NEW.asset_id<>OLD.asset_id
    OR NEW.storage_node_id<>OLD.storage_node_id OR NEW.object_key<>OLD.object_key OR NEW.byte_size<>OLD.byte_size OR NEW.checksum_sha256<>OLD.checksum_sha256
    OR NEW.attempts<>OLD.attempts+1 OR NOT EXISTS(
      SELECT 1 FROM manual_album_deletion_jobs j JOIN albums a ON a.id=j.album_id AND a.state='deleting'
      JOIN workspaces w ON w.id=j.workspace_id AND w.owner_user_id=NEW.execution_actor_id
      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.execution_session_id AND s.expiresAt>unixepoch('subsec')*1000
      WHERE j.id=OLD.job_id AND j.status='deleting' AND j.actor_id=NEW.execution_actor_id
    ) THEN RAISE(ABORT,'INVALID_DELETE_ITEM_TRANSITION') END;
  SELECT CASE WHEN (NEW.status='pending' AND NEW.last_error_code IS NULL)
    OR (NEW.status='reclaimed' AND (abs(NEW.verified_at_ms-unixepoch('subsec')*1000)>60000
      OR NOT EXISTS(SELECT 1 FROM manual_album_deletion_jobs j JOIN workspace_storage_usage w ON w.workspace_id=j.workspace_id
        JOIN storage_nodes n ON n.id=NEW.storage_node_id WHERE j.id=NEW.job_id AND w.used_bytes>=NEW.byte_size AND n.used_bytes>=NEW.byte_size)))
    THEN RAISE(ABORT,'DELETE_RECLAIM_WITNESS_REQUIRED') END;
END;

CREATE TRIGGER manual_album_deletion_item_apply AFTER UPDATE ON manual_album_deletion_items BEGIN
  UPDATE workspace_storage_usage SET used_bytes=used_bytes-NEW.byte_size
    WHERE workspace_id=(SELECT workspace_id FROM manual_album_deletion_jobs WHERE id=NEW.job_id) AND NEW.status='reclaimed';
  UPDATE storage_nodes SET used_bytes=used_bytes-NEW.byte_size WHERE id=NEW.storage_node_id AND NEW.status='reclaimed';
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id)
    SELECT 'manual-delete-item:'||NEW.job_id||':'||NEW.asset_id||':'||NEW.attempts,'user',NEW.execution_actor_id,NEW.execution_session_id,
      j.workspace_id,j.project_id,j.album_id,a.photo_id,a.version_id,
      CASE WHEN NEW.status='reclaimed' THEN 'storage.asset_reclaimed' ELSE 'storage.reclaim_failed' END,
      json_object('status',OLD.status,'bytes',OLD.byte_size),
      json_object('jobId',NEW.job_id,'assetId',NEW.asset_id,'status',NEW.status,'bytesReclaimed',CASE WHEN NEW.status='reclaimed' THEN NEW.byte_size ELSE 0 END,'attempt',NEW.attempts,'error',NEW.last_error_code,'fenceEtag',NEW.fence_etag),
      NEW.job_id||':'||NEW.asset_id||':'||NEW.attempts
    FROM manual_album_deletion_jobs j JOIN photo_assets a ON a.id=NEW.asset_id WHERE j.id=NEW.job_id;
  UPDATE manual_album_deletion_jobs SET
    bytes_reclaimed=(SELECT COALESCE(sum(byte_size),0) FROM manual_album_deletion_items WHERE job_id=NEW.job_id AND status='reclaimed'),
    status=CASE WHEN EXISTS(SELECT 1 FROM manual_album_deletion_items WHERE job_id=NEW.job_id AND status='pending') THEN 'deleting' ELSE 'completed' END,
    completed_at_ms=CASE WHEN EXISTS(SELECT 1 FROM manual_album_deletion_items WHERE job_id=NEW.job_id AND status='pending') THEN NULL ELSE CAST(unixepoch('subsec')*1000 AS INTEGER) END
    WHERE id=NEW.job_id;
END;

CREATE TRIGGER manual_album_deletion_job_transition BEFORE UPDATE ON manual_album_deletion_jobs BEGIN
  SELECT CASE WHEN OLD.status<>'deleting' OR NEW.id<>OLD.id OR NEW.actor_id<>OLD.actor_id OR NEW.session_id<>OLD.session_id
    OR NEW.request_id<>OLD.request_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id
    OR NEW.expected_revision<>OLD.expected_revision OR NEW.confirmation_name<>OLD.confirmation_name OR NEW.policy_snapshot<>OLD.policy_snapshot
    OR NEW.created_at_ms<>OLD.created_at_ms OR NEW.inventory_count<>OLD.inventory_count OR NEW.bytes_before<>OLD.bytes_before
    OR NEW.bytes_reclaimed<>(SELECT COALESCE(sum(byte_size),0) FROM manual_album_deletion_items WHERE job_id=OLD.id AND status='reclaimed')
    OR (SELECT count(*) FROM manual_album_deletion_items WHERE job_id=OLD.id)<>OLD.inventory_count
    OR (NEW.status='completed' AND (EXISTS(SELECT 1 FROM manual_album_deletion_items WHERE job_id=OLD.id AND status='pending')
      OR NEW.bytes_reclaimed<>OLD.bytes_before OR abs(NEW.completed_at_ms-unixepoch('subsec')*1000)>60000))
    OR (NEW.status='deleting' AND NEW.completed_at_ms IS NOT NULL)
    THEN RAISE(ABORT,'INVALID_DELETE_JOB_TRANSITION') END;
END;

CREATE TRIGGER manual_album_deletion_job_complete AFTER UPDATE ON manual_album_deletion_jobs WHEN NEW.status='completed' BEGIN
  UPDATE albums SET state='deleted',revision=revision+1 WHERE id=NEW.album_id AND state='deleting';
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,after_json,request_id)
    VALUES('manual-delete-complete:'||NEW.id,'system',NEW.actor_id,NULL,NEW.workspace_id,NEW.project_id,NEW.album_id,'album.deleted',
      json_object('jobId',NEW.id,'bytesReclaimed',NEW.bytes_reclaimed,'items',NEW.inventory_count),NEW.id);
END;

CREATE TRIGGER manual_album_deletion_jobs_no_delete BEFORE DELETE ON manual_album_deletion_jobs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DELETE_JOB'); END;
CREATE TRIGGER manual_album_deletion_items_no_delete BEFORE DELETE ON manual_album_deletion_items BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DELETE_ITEM'); END;
CREATE TRIGGER manual_album_deletion_asset_insert_guard BEFORE INSERT ON photo_assets WHEN EXISTS(
  SELECT 1 FROM photos p JOIN albums a ON a.id=p.album_id WHERE p.id=NEW.photo_id AND a.state IN('deleting','deleted')
) BEGIN SELECT RAISE(ABORT,'ALBUM_DELETION_IN_PROGRESS'); END;
CREATE TRIGGER manual_album_deletion_parent_insert_guard BEFORE INSERT ON photo_versions WHEN EXISTS(
  SELECT 1 FROM photo_versions parent JOIN photos p ON p.id=parent.photo_id JOIN albums a ON a.id=p.album_id
  WHERE parent.id=NEW.parent_version_id AND a.state IN('deleting','deleted')
) BEGIN SELECT RAISE(ABORT,'ALBUM_DELETION_IN_PROGRESS'); END;
CREATE TRIGGER manual_album_deletion_album_transition BEFORE UPDATE ON albums
WHEN NEW.state IN('deleting','deleted') OR OLD.state IN('deleting','deleted') BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    OR NEW.name<>OLD.name OR NEW.is_pinned<>OLD.is_pinned OR NEW.legal_hold<>OLD.legal_hold
    OR NEW.revision<>OLD.revision+1 OR OLD.state='deleted'
    OR NOT EXISTS(SELECT 1 FROM manual_album_deletion_jobs j WHERE j.album_id=OLD.id
      AND ((OLD.state NOT IN('deleting','deleted') AND NEW.state='deleting' AND j.status='deleting' AND j.expected_revision=OLD.revision)
        OR (OLD.state='deleting' AND NEW.state='deleted' AND j.status='completed')))
    THEN RAISE(ABORT,'INVALID_ALBUM_DELETE_TRANSITION') END;
END;
