-- Short read leases block manual deletion around authorized private asset GETs.
-- They do not represent continuous activity or complete a storage inventory.
PRAGMA foreign_keys=ON;

CREATE TABLE album_read_protections(
  album_id TEXT PRIMARY KEY NOT NULL REFERENCES albums(id),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  renewed_at_ms INTEGER NOT NULL CHECK(typeof(renewed_at_ms)='integer' AND renewed_at_ms>=0),
  protected_until_ms INTEGER NOT NULL CHECK(typeof(protected_until_ms)='integer' AND protected_until_ms=renewed_at_ms+900000),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 2147483647)
) WITHOUT ROWID;

DROP VIEW manual_album_deletion_blockers;
CREATE VIEW manual_album_deletion_blockers AS
  SELECT a.id AS album_id,'DELETE_PROTECTED' AS blocker FROM albums a
    WHERE a.is_pinned=1 OR a.legal_hold=1 OR EXISTS(SELECT 1 FROM photo_pin_states pin WHERE pin.album_id=a.id AND pin.is_pinned=1)
  UNION ALL SELECT a.id,'DELETE_CONTENT_BUSY' FROM albums a JOIN projects p ON p.id=a.project_id
    WHERE p.status NOT IN('draft','uploading','delivered','archived')
      OR EXISTS(SELECT 1 FROM pending_upload_storage_reservations r WHERE r.album_id=a.id)
      OR EXISTS(SELECT 1 FROM upload_sessions u JOIN upload_authorizations grant_row ON grant_row.upload_session_id=u.id
        WHERE u.album_id=a.id AND grant_row.expires_at_ms>unixepoch('subsec')*1000)
      OR EXISTS(SELECT 1 FROM image_processing_jobs j JOIN photo_assets asset ON asset.id=j.id JOIN photos photo ON photo.id=asset.photo_id
        WHERE photo.album_id=a.id AND (j.status<>'succeeded' OR j.reserved_bytes<>0))
  UNION ALL SELECT a.id,'DELETE_ACTIVE_REVIEW' FROM albums a WHERE EXISTS(
    SELECT 1 FROM guest_invite_albums ia JOIN guest_invites i ON i.id=ia.invite_id JOIN guest_sessions s ON s.invite_id=i.id
    WHERE ia.album_id=a.id AND ia.workspace_id=a.workspace_id AND ia.project_id=a.project_id AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=a.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=a.project_id AND share_expiry.album_id=a.id AND share_expiry.expiry_valid=1) AND s.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) OR EXISTS(SELECT 1 FROM album_human_activity h WHERE h.album_id=a.id AND h.last_valid_viewed_at_ms>unixepoch('subsec')*1000-900000) OR EXISTS(
    SELECT 1 FROM album_read_protections r
    WHERE r.album_id=a.id AND r.workspace_id=a.workspace_id AND r.project_id=a.project_id
      AND r.protected_until_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
  )
  UNION ALL SELECT a.id,'DELETE_SHARED_REFERENCE' FROM albums a WHERE EXISTS(
    SELECT 1 FROM photo_versions child JOIN photo_versions parent ON parent.id=child.parent_version_id
    JOIN photos cp ON cp.id=child.photo_id JOIN photos pp ON pp.id=parent.photo_id
    WHERE (cp.album_id=a.id OR pp.album_id=a.id) AND cp.album_id<>pp.album_id
  ) OR EXISTS(SELECT 1 FROM version_approval_requests r WHERE r.album_id=a.id);

CREATE TRIGGER album_read_protections_insert_guard
BEFORE INSERT ON album_read_protections BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_read_protections WHERE album_id=NEW.album_id)
    THEN RAISE(ABORT,'ALBUM_READ_PROTECTION_IMMUTABLE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
      AND a.state NOT IN('deleting','deleted') AND p.status NOT IN('deleting','deleted')
      AND NOT EXISTS(SELECT 1 FROM manual_album_deletion_jobs j WHERE j.album_id=a.id AND j.status='deleting')
  ) THEN RAISE(ABORT,'ALBUM_READ_PROTECTION_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.renewed_at_ms<>CAST(unixepoch('subsec')*1000 AS INTEGER)
    OR NEW.protected_until_ms<>CAST(unixepoch('subsec')*1000 AS INTEGER)+900000
    OR NEW.revision<>0 THEN RAISE(ABORT,'INVALID_ALBUM_READ_PROTECTION') END;
END;

CREATE TRIGGER album_read_protections_update_guard
BEFORE UPDATE ON album_read_protections BEGIN
  SELECT CASE WHEN NEW.album_id<>OLD.album_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    THEN RAISE(ABORT,'ALBUM_READ_PROTECTION_SCOPE_IMMUTABLE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
      AND a.state NOT IN('deleting','deleted') AND p.status NOT IN('deleting','deleted')
      AND NOT EXISTS(SELECT 1 FROM manual_album_deletion_jobs j WHERE j.album_id=a.id AND j.status='deleting')
  ) THEN RAISE(ABORT,'ALBUM_READ_PROTECTION_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.renewed_at_ms<>CAST(unixepoch('subsec')*1000 AS INTEGER)
    OR NEW.protected_until_ms<>CAST(unixepoch('subsec')*1000 AS INTEGER)+900000
    OR NEW.revision<>OLD.revision+1 OR OLD.revision>=2147483647
    THEN RAISE(ABORT,'INVALID_ALBUM_READ_PROTECTION_RENEWAL') END;
  SELECT CASE WHEN OLD.renewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
    OR OLD.renewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)-60000
    OR OLD.protected_until_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+840000
    THEN RAISE(ABORT,'ALBUM_READ_PROTECTION_RENEWAL_TOO_SOON') END;
END;

CREATE TRIGGER album_read_protections_no_delete
BEFORE DELETE ON album_read_protections BEGIN
  SELECT RAISE(ABORT,'ALBUM_READ_PROTECTION_IMMUTABLE');
END;

CREATE TRIGGER album_read_protections_block_album_deletion
BEFORE UPDATE OF state ON albums
WHEN NEW.state='deleting' AND EXISTS(
  SELECT 1 FROM album_read_protections r
  WHERE r.album_id=OLD.id AND r.protected_until_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT,'ALBUM_READ_PROTECTION_ACTIVE');
END;

CREATE TRIGGER album_read_protections_block_deletion_job_insert
BEFORE INSERT ON manual_album_deletion_jobs
WHEN NEW.status='deleting' AND EXISTS(
  SELECT 1 FROM album_read_protections r
  WHERE r.album_id=NEW.album_id AND r.protected_until_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT,'ALBUM_READ_PROTECTION_ACTIVE');
END;

CREATE TRIGGER album_read_protections_block_deletion_job_update
BEFORE UPDATE OF status ON manual_album_deletion_jobs
WHEN NEW.status='deleting' AND EXISTS(
  SELECT 1 FROM album_read_protections r
  WHERE r.album_id=OLD.album_id AND r.protected_until_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT,'ALBUM_READ_PROTECTION_ACTIVE');
END;
