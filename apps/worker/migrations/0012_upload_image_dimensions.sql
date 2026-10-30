-- Add encoded image dimensions to new uploads without rewriting immutable history.
-- Old versions/completions keep NULL dimensions; never guess values or down-migrate.
ALTER TABLE upload_workflow_requests ADD COLUMN image_width INTEGER;
ALTER TABLE upload_workflow_requests ADD COLUMN image_height INTEGER;
ALTER TABLE upload_completions ADD COLUMN image_width INTEGER;
ALTER TABLE upload_completions ADD COLUMN image_height INTEGER;

CREATE TRIGGER upload_workflow_dimensions_guard BEFORE INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN NEW.operation='upload.completed' AND (NEW.image_width IS NULL OR NEW.image_height IS NULL OR typeof(NEW.image_width)<>'integer' OR typeof(NEW.image_height)<>'integer' OR NEW.image_width<1 OR NEW.image_height<1 OR NEW.image_width>32768 OR NEW.image_height>32768 OR NEW.image_width*NEW.image_height>80000000) THEN RAISE(ABORT,'IMAGE_DIMENSIONS_EXCEEDED') END;
  SELECT CASE WHEN NEW.operation='upload.authorized' AND (NEW.image_width IS NOT NULL OR NEW.image_height IS NOT NULL) THEN RAISE(ABORT,'INVALID_INPUT') END;
END;
CREATE TRIGGER upload_workflow_dimensions_no_update BEFORE UPDATE ON upload_workflow_requests WHEN NEW.image_width IS NOT OLD.image_width OR NEW.image_height IS NOT OLD.image_height BEGIN SELECT RAISE(ABORT,'IMMUTABLE_UPLOAD_WORKFLOW_REQUEST'); END;
CREATE TRIGGER photo_versions_dimensions_guard BEFORE INSERT ON photo_versions WHEN NEW.width IS NULL OR NEW.height IS NULL OR typeof(NEW.width)<>'integer' OR typeof(NEW.height)<>'integer' OR NEW.width<1 OR NEW.height<1 OR NEW.width>32768 OR NEW.height>32768 OR NEW.width*NEW.height>80000000 BEGIN SELECT RAISE(ABORT,'IMAGE_DIMENSIONS_EXCEEDED'); END;
CREATE TRIGGER upload_completions_dimensions_guard BEFORE INSERT ON upload_completions WHEN NOT EXISTS(SELECT 1 FROM photo_versions v WHERE v.id=NEW.version_id AND v.width=NEW.image_width AND v.height=NEW.image_height) BEGIN SELECT RAISE(ABORT,'UPLOAD_COMPLETION_DIMENSIONS_MISMATCH'); END;

DROP TRIGGER upload_workflow_apply_completion;
CREATE TRIGGER upload_workflow_apply_completion AFTER INSERT ON upload_workflow_requests WHEN NEW.operation='upload.completed' BEGIN
  INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) SELECT NEW.photo_id,u.workspace_id,u.project_id,u.album_id,u.original_filename FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) SELECT NEW.version_id,u.workspace_id,NEW.photo_id,1,NULL,NEW.actor_id,NEW.sha256_hex,NEW.actual_bytes,NEW.content_type,NEW.image_width,NEW.image_height,'private' FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) SELECT NEW.asset_id,u.workspace_id,NEW.photo_id,NEW.version_id,u.storage_node_id,'original',u.object_key,NEW.actual_bytes,NEW.content_type,NEW.sha256_hex,'private' FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  INSERT INTO upload_completions(upload_session_id,actor_id,request_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,asset_id,actual_bytes,content_type,sha256_hex,completed_at_ms,image_width,image_height) SELECT u.id,NEW.actor_id,NEW.request_id,NEW.session_id,u.workspace_id,u.project_id,u.album_id,NEW.photo_id,NEW.version_id,NEW.asset_id,NEW.actual_bytes,NEW.content_type,NEW.sha256_hex,NEW.created_at_ms,NEW.image_width,NEW.image_height FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
  UPDATE workspace_storage_usage SET reserved_bytes=reserved_bytes-NEW.actual_bytes,used_bytes=used_bytes+NEW.actual_bytes WHERE workspace_id=(SELECT workspace_id FROM upload_sessions WHERE id=NEW.upload_session_id);
  UPDATE storage_nodes SET reserved_bytes=reserved_bytes-NEW.actual_bytes,used_bytes=used_bytes+NEW.actual_bytes WHERE id=(SELECT storage_node_id FROM upload_sessions WHERE id=NEW.upload_session_id);
  UPDATE upload_workflow_requests SET result_json=json_object('uploadSessionId',NEW.upload_session_id,'status','completed','photoId',NEW.photo_id,'versionId',NEW.version_id,'assetId',NEW.asset_id,'actualBytes',NEW.actual_bytes,'contentType',NEW.content_type,'sha256',NEW.sha256_hex,'width',NEW.image_width,'height',NEW.image_height,'completedAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')) WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id) SELECT 'upload-completed:'||u.id,'user',NEW.actor_id,NEW.session_id,u.workspace_id,u.project_id,u.album_id,NEW.photo_id,NEW.version_id,'upload.completed',json_object('status','reserved','reservedBytes',u.reserved_bytes),json_object('status','completed','actualBytes',NEW.actual_bytes,'contentType',NEW.content_type,'sha256',NEW.sha256_hex,'assetId',NEW.asset_id,'width',NEW.image_width,'height',NEW.image_height),NEW.request_id FROM upload_sessions u WHERE u.id=NEW.upload_session_id;
END;
