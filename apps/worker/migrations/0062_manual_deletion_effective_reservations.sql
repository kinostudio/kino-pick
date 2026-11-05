-- Reservation rows are immutable history. Only unresolved reserved sessions hold capacity.
-- Recovery: preserve data and ledgers; fix forward. This changes no stored rows.
PRAGMA foreign_keys=ON;

CREATE VIEW pending_upload_storage_reservations AS
  SELECT r.id,u.workspace_id,u.project_id,u.album_id,r.storage_node_id,r.reserved_bytes
  FROM storage_reservations r JOIN upload_sessions u ON u.id=r.id
  WHERE u.status='reserved'
    AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM upload_version_completions vc WHERE vc.upload_session_id=u.id);

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
    WHERE ia.album_id=a.id AND i.expires_at_ms>unixepoch('subsec')*1000 AND s.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) OR EXISTS(SELECT 1 FROM album_human_activity h WHERE h.album_id=a.id AND h.last_valid_viewed_at_ms>unixepoch('subsec')*1000-900000)
  UNION ALL SELECT a.id,'DELETE_SHARED_REFERENCE' FROM albums a WHERE EXISTS(
    SELECT 1 FROM photo_versions child JOIN photo_versions parent ON parent.id=child.parent_version_id
    JOIN photos cp ON cp.id=child.photo_id JOIN photos pp ON pp.id=parent.photo_id
    WHERE (cp.album_id=a.id OR pp.album_id=a.id) AND cp.album_id<>pp.album_id
  ) OR EXISTS(SELECT 1 FROM version_approval_requests r WHERE r.album_id=a.id);
