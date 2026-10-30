-- Durable outbox for NEW originals. Historical assets are not guessed/backfilled.
-- Native decoding runs in a trusted external/local runner, never the request Worker.
CREATE TABLE image_processing_jobs(
  id TEXT PRIMARY KEY REFERENCES photo_assets(id),
  recipe TEXT NOT NULL CHECK(recipe='local-sharp-0.35.5-v1'),
  status TEXT NOT NULL CHECK(status IN('queued','running','retryable','needs_review','succeeded','unsupported')),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes IN(0,16777216)),
  lease_token TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK(lease_epoch>=0),
  lease_until_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts=lease_epoch),
  reason_code TEXT CHECK(reason_code IN('PROCESSING_CONTENT_INVALID','PROCESSING_IO_UNCERTAIN')),
  result_json TEXT,
  transition_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK(
    (status IN('queued','unsupported') AND reserved_bytes=0 AND lease_token IS NULL AND lease_until_ms IS NULL AND lease_epoch=0 AND result_json IS NULL)
    OR(status='running' AND reserved_bytes=16777216 AND lease_token IS NOT NULL AND lease_until_ms>updated_at_ms AND lease_epoch>0 AND result_json IS NULL)
    OR(status IN('retryable','needs_review') AND reserved_bytes=16777216 AND lease_token IS NULL AND lease_until_ms IS NULL AND lease_epoch>0 AND result_json IS NULL)
    OR(status='succeeded' AND reserved_bytes=0 AND lease_token IS NULL AND lease_until_ms IS NULL AND lease_epoch>0 AND result_json IS NOT NULL)
  )
);
CREATE INDEX processing_jobs_pending ON image_processing_jobs(status,created_at_ms,id);
CREATE TABLE image_processing_outputs(
  job_id TEXT NOT NULL REFERENCES image_processing_jobs(id),
  kind TEXT NOT NULL CHECK(kind IN('thumbnail','preview')),
  asset_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  max_bytes INTEGER NOT NULL CHECK(max_bytes=8388608),
  PRIMARY KEY(job_id,kind)
);
CREATE TRIGGER processing_job_insert_guard BEFORE INSERT ON image_processing_jobs BEGIN
  SELECT CASE WHEN NEW.status NOT IN('queued','unsupported') OR NEW.reserved_bytes<>0 OR NEW.lease_epoch<>0 OR NOT EXISTS(
    SELECT 1 FROM photo_assets a JOIN photo_versions v ON v.id=a.version_id WHERE a.id=NEW.id AND a.asset_kind='original' AND a.state='private' AND a.checksum_sha256=v.source_hash_sha256 AND a.byte_size=v.byte_size AND a.mime=v.mime
  ) THEN RAISE(ABORT,'PROCESSING_SOURCE_INVALID') END;
END;
CREATE TRIGGER processing_original_outbox AFTER INSERT ON photo_assets WHEN NEW.asset_kind='original' BEGIN
  INSERT INTO image_processing_jobs(id,recipe,status,transition_id,created_at_ms,updated_at_ms)
    SELECT NEW.id,'local-sharp-0.35.5-v1',CASE WHEN v.width IS NOT NULL AND v.height IS NOT NULL AND v.byte_size<=67108864 THEN 'queued' ELSE 'unsupported' END,
      NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER) FROM photo_versions v WHERE v.id=NEW.version_id;
END;
CREATE TRIGGER processing_output_insert_guard BEFORE INSERT ON image_processing_outputs BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN photos p ON p.id=a.photo_id
    WHERE j.id=NEW.job_id AND j.status IN('queued','unsupported') AND NEW.object_key=p.workspace_id||'/'||p.project_id||'/'||p.album_id||'/'||j.id||'/derived/'||j.recipe||'/'||NEW.kind||'.jpg'
  ) THEN RAISE(ABORT,'PROCESSING_OUTPUT_SCOPE_MISMATCH') END;
END;
CREATE TRIGGER processing_job_slots AFTER INSERT ON image_processing_jobs BEGIN
  INSERT INTO image_processing_outputs(job_id,kind,asset_id,object_key,max_bytes)
    SELECT NEW.id,k.kind,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
      p.workspace_id||'/'||p.project_id||'/'||p.album_id||'/'||NEW.id||'/derived/'||NEW.recipe||'/'||k.kind||'.jpg',8388608
    FROM photo_assets a JOIN photos p ON p.id=a.photo_id CROSS JOIN(SELECT 'thumbnail' AS kind UNION ALL SELECT 'preview') k WHERE a.id=NEW.id;
  INSERT INTO audit_events(event_id,actor_type,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id)
    SELECT 'processing:'||NEW.id||':0:'||NEW.status,'system',p.workspace_id,p.project_id,p.album_id,p.id,a.version_id,'processing.enqueued',json_object('jobId',NEW.id,'status',NEW.status,'recipe',NEW.recipe),NEW.transition_id
    FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE a.id=NEW.id;
END;
CREATE TRIGGER processing_outputs_no_update BEFORE UPDATE ON image_processing_outputs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_OUTPUT'); END;
CREATE TRIGGER processing_outputs_no_delete BEFORE DELETE ON image_processing_outputs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_OUTPUT'); END;
CREATE TRIGGER processing_jobs_no_delete BEFORE DELETE ON image_processing_jobs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_JOB'); END;
CREATE TRIGGER processing_job_transition_guard BEFORE UPDATE ON image_processing_jobs BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.recipe<>OLD.recipe OR NEW.created_at_ms<>OLD.created_at_ms OR NEW.transition_id=OLD.transition_id OR ABS(NEW.updated_at_ms-unixepoch('subsec')*1000)>60000 THEN RAISE(ABORT,'INVALID_PROCESSING_TRANSITION') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_assets a JOIN photos p ON p.id=a.photo_id JOIN albums al ON al.id=p.album_id AND al.project_id=p.project_id AND al.workspace_id=p.workspace_id
    JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN storage_nodes n ON n.id=a.storage_node_id AND n.status='active'
    WHERE a.id=NEW.id AND al.state NOT IN('archived','deleting','deleted') AND pr.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'PROCESSING_SOURCE_UNAVAILABLE') END;
  SELECT CASE WHEN NOT(
    (NEW.status='running' AND (OLD.status IN('queued','retryable') OR (OLD.status='running' AND OLD.lease_until_ms<=unixepoch('subsec')*1000)) AND NEW.lease_epoch=OLD.lease_epoch+1 AND NEW.lease_token IS NOT OLD.lease_token AND NEW.lease_until_ms<=unixepoch('subsec')*1000+600000 AND NEW.reason_code IS NULL)
    OR(OLD.status='running' AND OLD.lease_until_ms>unixepoch('subsec')*1000 AND NEW.status IN('retryable','needs_review','succeeded') AND NEW.lease_epoch=OLD.lease_epoch AND NEW.reason_code IS CASE WHEN NEW.status='succeeded' THEN NULL WHEN NEW.status='retryable' THEN 'PROCESSING_IO_UNCERTAIN' ELSE 'PROCESSING_CONTENT_INVALID' END)
  ) THEN RAISE(ABORT,'PROCESSING_LEASE_LOST') END;
  SELECT CASE WHEN NEW.status='running' AND (SELECT COUNT(*) FROM image_processing_outputs WHERE job_id=NEW.id)<>2 THEN RAISE(ABORT,'PROCESSING_OUTPUTS_MISSING') END;
  SELECT CASE WHEN NEW.reserved_bytes>OLD.reserved_bytes AND NOT EXISTS(
    SELECT 1 FROM photo_assets a JOIN workspace_storage_usage u ON u.workspace_id=a.workspace_id JOIN workspaces w ON w.id=u.workspace_id JOIN storage_nodes n ON n.id=a.storage_node_id
    WHERE a.id=NEW.id AND u.used_bytes+u.reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes<=w.quota_bytes AND n.used_bytes+n.reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes<=n.quota_bytes
  ) THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;
END;
CREATE TRIGGER processing_result_guard BEFORE UPDATE ON image_processing_jobs WHEN NEW.status='succeeded' BEGIN
  SELECT CASE WHEN NOT json_valid(NEW.result_json) THEN RAISE(ABORT,'INVALID_PROCESSING_RESULT') END;
  SELECT CASE WHEN json_type(NEW.result_json)<>'array' OR json_array_length(NEW.result_json)<>2 THEN RAISE(ABORT,'INVALID_PROCESSING_RESULT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.result_json) e LEFT JOIN image_processing_outputs s ON s.job_id=NEW.id AND s.kind=json_extract(e.value,'$.kind') WHERE s.kind IS NULL
      OR json_type(e.value,'$.bytes') IS NOT 'integer' OR json_extract(e.value,'$.bytes')<1 OR json_extract(e.value,'$.bytes')>s.max_bytes
      OR json_extract(e.value,'$.mime') IS NOT 'image/jpeg'
      OR json_type(e.value,'$.sha256') IS NOT 'text' OR length(json_extract(e.value,'$.sha256'))<>64 OR json_extract(e.value,'$.sha256') GLOB '*[^0-9a-f]*'
      OR json_type(e.value,'$.width') IS NOT 'integer' OR json_type(e.value,'$.height') IS NOT 'integer'
      OR json_extract(e.value,'$.width')<1 OR json_extract(e.value,'$.height')<1
      OR max(json_extract(e.value,'$.width'),json_extract(e.value,'$.height'))>CASE WHEN s.kind='thumbnail' THEN 320 ELSE 2048 END
  ) OR (SELECT COUNT(DISTINCT json_extract(value,'$.kind')) FROM json_each(NEW.result_json))<>2 THEN RAISE(ABORT,'INVALID_PROCESSING_RESULT') END;
END;
CREATE TRIGGER processing_job_apply AFTER UPDATE ON image_processing_jobs BEGIN
  UPDATE workspace_storage_usage SET reserved_bytes=reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes,
    used_bytes=used_bytes+CASE WHEN NEW.status='succeeded' THEN (SELECT SUM(json_extract(value,'$.bytes')) FROM json_each(NEW.result_json)) ELSE 0 END
    WHERE workspace_id=(SELECT workspace_id FROM photo_assets WHERE id=NEW.id);
  UPDATE storage_nodes SET reserved_bytes=reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes,
    used_bytes=used_bytes+CASE WHEN NEW.status='succeeded' THEN (SELECT SUM(json_extract(value,'$.bytes')) FROM json_each(NEW.result_json)) ELSE 0 END
    WHERE id=(SELECT storage_node_id FROM photo_assets WHERE id=NEW.id);
  INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state)
    SELECT s.asset_id,a.workspace_id,a.photo_id,a.version_id,a.storage_node_id,s.kind,s.object_key,json_extract(e.value,'$.bytes'),'image/jpeg',json_extract(e.value,'$.sha256'),'private'
    FROM json_each(NEW.result_json) e JOIN image_processing_outputs s ON s.job_id=NEW.id AND s.kind=json_extract(e.value,'$.kind') JOIN photo_assets a ON a.id=NEW.id WHERE NEW.status='succeeded';
  INSERT INTO audit_events(event_id,actor_type,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id)
    SELECT 'processing:'||NEW.id||':'||NEW.lease_epoch||':'||NEW.status,'system',p.workspace_id,p.project_id,p.album_id,p.id,a.version_id,'processing.'||NEW.status,
      json_object('status',OLD.status,'reservedBytes',OLD.reserved_bytes,'leaseEpoch',OLD.lease_epoch),
      json_object('status',NEW.status,'reservedBytes',NEW.reserved_bytes,'leaseEpoch',NEW.lease_epoch,'reason',NEW.reason_code,'outputs',json(NEW.result_json)),NEW.transition_id
    FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE a.id=NEW.id;
END;
CREATE TRIGGER content_archive_processing_guard BEFORE INSERT ON request_commands WHEN NEW.operation IN('project.archived','album.archived') BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN photos p ON p.id=a.photo_id WHERE j.status IN('queued','running','retryable','needs_review') AND ((NEW.operation='project.archived' AND p.project_id=NEW.resource_id) OR (NEW.operation='album.archived' AND p.album_id=NEW.resource_id))) THEN RAISE(ABORT,'PROCESSING_IN_PROGRESS') END;
END;
