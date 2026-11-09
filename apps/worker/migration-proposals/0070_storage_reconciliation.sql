-- Proposal only. Do not copy into migrations or apply before the 0070 release gate.
CREATE TABLE storage_inventory_clock(
  id INTEGER PRIMARY KEY CHECK(id=1),
  epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch BETWEEN 0 AND 9007199254740991)
);

CREATE TRIGGER storage_inventory_clock_insert_guard BEFORE INSERT ON storage_inventory_clock BEGIN
  SELECT CASE WHEN typeof(NEW.id)<>'integer' OR NEW.id<>1
    OR typeof(NEW.epoch)<>'integer' OR NEW.epoch<>0
    OR EXISTS(SELECT 1 FROM storage_inventory_clock)
    THEN RAISE(ABORT,'STORAGE_INVENTORY_CLOCK_INVALID') END;
END;
CREATE TRIGGER storage_inventory_clock_update_guard BEFORE UPDATE ON storage_inventory_clock BEGIN
  SELECT CASE WHEN typeof(NEW.id)<>'integer' OR NEW.id<>OLD.id OR NEW.id<>1
    OR typeof(NEW.epoch)<>'integer' OR OLD.epoch>=9007199254740991
    OR NEW.epoch<>OLD.epoch+1
    THEN RAISE(ABORT,'STORAGE_INVENTORY_CLOCK_INVALID') END;
END;
CREATE TRIGGER storage_inventory_clock_delete_guard BEFORE DELETE ON storage_inventory_clock BEGIN
  SELECT RAISE(ABORT,'STORAGE_INVENTORY_CLOCK_IMMUTABLE');
END;
INSERT INTO storage_inventory_clock(id,epoch) VALUES(1,0);

CREATE TABLE storage_reconciliation_receipts(
  id TEXT PRIMARY KEY NOT NULL CHECK(typeof(id)='text' AND length(id)=36 AND id=lower(id)
    AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*'),
  workspace_id TEXT NOT NULL CHECK(typeof(workspace_id)='text' AND length(workspace_id)=36 AND workspace_id=lower(workspace_id)
    AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-'
    AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  storage_node_id TEXT NOT NULL CHECK(typeof(storage_node_id)='text' AND length(storage_node_id) BETWEEN 1 AND 64
    AND substr(storage_node_id,1,1) GLOB '[a-z0-9]' AND storage_node_id NOT GLOB '*[^a-z0-9_-]*'),
  actor_id TEXT NOT NULL CHECK(typeof(actor_id)='text' AND length(actor_id) BETWEEN 1 AND 256),
  session_id TEXT NOT NULL CHECK(typeof(session_id)='text' AND length(session_id) BETWEEN 1 AND 256),
  epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch BETWEEN 0 AND 9007199254740991),
  inventory_revision TEXT NOT NULL CHECK(typeof(inventory_revision)='text' AND length(inventory_revision)=64
    AND inventory_revision NOT GLOB '*[^0-9a-f]*'),
  object_count INTEGER NOT NULL CHECK(typeof(object_count)='integer' AND object_count BETWEEN 0 AND 20000),
  confirmed_bytes INTEGER NOT NULL CHECK(typeof(confirmed_bytes)='integer' AND confirmed_bytes BETWEEN 0 AND 9007199254740991),
  pages INTEGER NOT NULL CHECK(typeof(pages)='integer' AND pages BETWEEN 1 AND 64),
  started_at_ms INTEGER NOT NULL CHECK(typeof(started_at_ms)='integer' AND started_at_ms BETWEEN 1 AND 9007199254740991),
  completed_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(completed_at_ms)='integer' AND completed_at_ms BETWEEN 1 AND 9007199254740991),
  CHECK(object_count<=pages*1000)
) WITHOUT ROWID;

CREATE TRIGGER storage_reconciliation_receipts_insert_guard BEFORE INSERT ON storage_reconciliation_receipts BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM storage_reconciliation_receipts WHERE id=NEW.id)
    THEN RAISE(ABORT,'STORAGE_RECONCILIATION_RECEIPT_IMMUTABLE') END;
  SELECT CASE WHEN typeof(NEW.epoch)<>'integer' OR typeof(NEW.object_count)<>'integer'
    OR typeof(NEW.confirmed_bytes)<>'integer' OR typeof(NEW.pages)<>'integer'
    OR typeof(NEW.started_at_ms)<>'integer' OR typeof(NEW.completed_at_ms)<>'integer'
    THEN RAISE(ABORT,'STORAGE_RECONCILIATION_RECEIPT_INVALID') END;
  SELECT CASE WHEN NEW.completed_at_ms<>CAST(unixepoch('subsec')*1000 AS INTEGER)
    OR NEW.started_at_ms>NEW.completed_at_ms
    OR NEW.completed_at_ms-NEW.started_at_ms>300000
    THEN RAISE(ABORT,'STORAGE_RECONCILIATION_RECEIPT_TIME_INVALID') END;
  SELECT CASE WHEN NEW.epoch IS NOT (SELECT epoch FROM storage_inventory_clock WHERE id=1)
    THEN RAISE(ABORT,'STORAGE_RECONCILIATION_EPOCH_STALE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>CAST(unixepoch('subsec')*1000 AS INTEGER)
    JOIN workspaces w ON w.id=NEW.workspace_id AND w.owner_user_id=o.user_id
    JOIN storage_nodes n ON n.id=NEW.storage_node_id
    WHERE o.id=1 AND o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'STORAGE_RECONCILIATION_OWNER_SCOPE_INVALID') END;
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM storage_nodes n WHERE n.id=NEW.storage_node_id AND n.reserved_bytes<>0)
    OR EXISTS(SELECT 1 FROM workspace_storage_usage u WHERE u.workspace_id=NEW.workspace_id AND u.reserved_bytes<>0)
    OR NOT EXISTS(SELECT 1 FROM workspace_storage_usage u WHERE u.workspace_id=NEW.workspace_id)
    OR EXISTS(SELECT 1 FROM pending_upload_storage_reservations r
      WHERE r.workspace_id=NEW.workspace_id AND r.storage_node_id=NEW.storage_node_id)
    OR EXISTS(SELECT 1 FROM upload_authorizations g JOIN upload_sessions s ON s.id=g.upload_session_id
      WHERE s.workspace_id=NEW.workspace_id AND s.storage_node_id=NEW.storage_node_id
        AND g.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER))
    OR EXISTS(SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id
      WHERE a.workspace_id=NEW.workspace_id AND a.storage_node_id=NEW.storage_node_id
        AND (j.status<>'succeeded' OR j.reserved_bytes<>0))
    OR EXISTS(SELECT 1 FROM manual_album_deletion_jobs j
      WHERE j.workspace_id=NEW.workspace_id AND j.status='deleting')
    THEN RAISE(ABORT,'STORAGE_RECONCILIATION_PENDING') END;
  SELECT CASE WHEN NEW.object_count <>
    (SELECT count(*) FROM photo_assets a
      WHERE a.workspace_id=NEW.workspace_id AND a.storage_node_id=NEW.storage_node_id)
    + (SELECT count(*) FROM upload_key_fences f JOIN upload_sessions s
        ON s.id=f.upload_session_id AND s.workspace_id=NEW.workspace_id
          AND s.storage_node_id=NEW.storage_node_id AND f.object_key=s.object_key)
    OR NEW.confirmed_bytes <>
    (SELECT COALESCE(sum(CASE WHEN EXISTS(
       SELECT 1 FROM photos p
       JOIN manual_album_deletion_jobs j ON j.album_id=p.album_id
         AND j.workspace_id=p.workspace_id AND j.project_id=p.project_id
       JOIN manual_album_deletion_items i ON i.job_id=j.id AND i.asset_id=a.id
       WHERE p.id=a.photo_id AND p.workspace_id=a.workspace_id
         AND i.storage_node_id=a.storage_node_id AND i.object_key=a.object_key
         AND i.byte_size=a.byte_size AND i.checksum_sha256=a.checksum_sha256
         AND i.status='reclaimed'
     ) THEN 0 ELSE a.byte_size END),0)
     FROM photo_assets a
     WHERE a.workspace_id=NEW.workspace_id AND a.storage_node_id=NEW.storage_node_id)
    THEN RAISE(ABORT,'STORAGE_RECONCILIATION_INVENTORY_MISMATCH') END;
END;

CREATE TRIGGER storage_reconciliation_receipts_no_update BEFORE UPDATE ON storage_reconciliation_receipts BEGIN
  SELECT RAISE(ABORT,'STORAGE_RECONCILIATION_RECEIPT_IMMUTABLE');
END;
CREATE TRIGGER storage_reconciliation_receipts_no_delete BEFORE DELETE ON storage_reconciliation_receipts BEGIN
  SELECT RAISE(ABORT,'STORAGE_RECONCILIATION_RECEIPT_IMMUTABLE');
END;
CREATE TRIGGER storage_reconciliation_receipts_audit AFTER INSERT ON storage_reconciliation_receipts BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,action,after_json,request_id)
  VALUES('storage-reconciliation:'||NEW.id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,
    'storage.reconciled',json_object(
      'storageNodeId',NEW.storage_node_id,'epoch',NEW.epoch,'inventoryRevision',NEW.inventory_revision,
      'objectCount',NEW.object_count,'confirmedBytes',NEW.confirmed_bytes,'pages',NEW.pages,
      'startedAtMs',NEW.started_at_ms,'completedAtMs',NEW.completed_at_ms
    ),NEW.id);
END;

-- Every source row change conservatively invalidates every saved receipt.
-- A direct single-step increment can only invalidate; reset, replacement, jumps and overflow are blocked above.
CREATE TRIGGER storage_inventory_clock_owners_insert AFTER INSERT ON owners BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_owners_update AFTER UPDATE ON owners BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_owners_delete AFTER DELETE ON owners BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_owner_sessions_insert AFTER INSERT ON owner_sessions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_owner_sessions_update AFTER UPDATE ON owner_sessions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_owner_sessions_delete AFTER DELETE ON owner_sessions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_workspaces_insert AFTER INSERT ON workspaces BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_workspaces_update AFTER UPDATE ON workspaces BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_workspaces_delete AFTER DELETE ON workspaces BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_storage_nodes_insert AFTER INSERT ON storage_nodes BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_storage_nodes_update AFTER UPDATE ON storage_nodes BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_storage_nodes_delete AFTER DELETE ON storage_nodes BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_workspace_storage_usage_insert AFTER INSERT ON workspace_storage_usage BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_workspace_storage_usage_update AFTER UPDATE ON workspace_storage_usage BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_workspace_storage_usage_delete AFTER DELETE ON workspace_storage_usage BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_photo_assets_insert AFTER INSERT ON photo_assets BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_photo_assets_update AFTER UPDATE ON photo_assets BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_photo_assets_delete AFTER DELETE ON photo_assets BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_photos_insert AFTER INSERT ON photos BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_photos_update AFTER UPDATE ON photos BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_photos_delete AFTER DELETE ON photos BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_manual_album_deletion_jobs_insert AFTER INSERT ON manual_album_deletion_jobs BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_manual_album_deletion_jobs_update AFTER UPDATE ON manual_album_deletion_jobs BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_manual_album_deletion_jobs_delete AFTER DELETE ON manual_album_deletion_jobs BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_manual_album_deletion_items_insert AFTER INSERT ON manual_album_deletion_items BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_manual_album_deletion_items_update AFTER UPDATE ON manual_album_deletion_items BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_manual_album_deletion_items_delete AFTER DELETE ON manual_album_deletion_items BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_sessions_insert AFTER INSERT ON upload_sessions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_sessions_update AFTER UPDATE ON upload_sessions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_sessions_delete AFTER DELETE ON upload_sessions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_key_fences_insert AFTER INSERT ON upload_key_fences BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_key_fences_update AFTER UPDATE ON upload_key_fences BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_key_fences_delete AFTER DELETE ON upload_key_fences BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_authorizations_insert AFTER INSERT ON upload_authorizations BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_authorizations_update AFTER UPDATE ON upload_authorizations BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_authorizations_delete AFTER DELETE ON upload_authorizations BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_image_processing_jobs_insert AFTER INSERT ON image_processing_jobs BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_image_processing_jobs_update AFTER UPDATE ON image_processing_jobs BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_image_processing_jobs_delete AFTER DELETE ON image_processing_jobs BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_storage_reservations_insert AFTER INSERT ON storage_reservations BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_storage_reservations_update AFTER UPDATE ON storage_reservations BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_storage_reservations_delete AFTER DELETE ON storage_reservations BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_completions_insert AFTER INSERT ON upload_completions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_completions_update AFTER UPDATE ON upload_completions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_completions_delete AFTER DELETE ON upload_completions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_version_completions_insert AFTER INSERT ON upload_version_completions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_version_completions_update AFTER UPDATE ON upload_version_completions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
CREATE TRIGGER storage_inventory_clock_upload_version_completions_delete AFTER DELETE ON upload_version_completions BEGIN UPDATE storage_inventory_clock SET epoch=epoch+1 WHERE id=1; END;
