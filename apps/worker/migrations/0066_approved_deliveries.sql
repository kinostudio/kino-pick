-- Approved single-original delivery uses the existing append-only audit ledger.
-- Recovery: disable APPROVED_DELIVERIES_ENABLED; retain all events and versions;
-- repair forward. No existing product rows are changed. Approval references remain protected by 0062.
PRAGMA foreign_keys=ON;
CREATE VIEW approved_delivery_sources AS
SELECT ready.workspace_id,ready.project_id,ready.album_id,ready.photo_id,ready.version_id,
 w.owner_user_id, v.version_no,a.id AS asset_id,a.storage_node_id,a.object_key,
 a.byte_size,a.mime,a.checksum_sha256,u.original_filename AS filename,
 COALESCE(c.completed_at_ms,vc.completed_at_ms) AS verified_at_ms
FROM client_activity_ready_versions ready
JOIN workspaces w ON w.id=ready.workspace_id
JOIN photo_versions v ON v.id=ready.version_id AND v.photo_id=ready.photo_id AND v.workspace_id=ready.workspace_id
JOIN photo_assets a ON a.version_id=v.id AND a.photo_id=v.photo_id AND a.workspace_id=v.workspace_id
 AND a.asset_kind='original' AND a.state='private' AND a.byte_size=v.byte_size AND a.mime=v.mime AND a.checksum_sha256=v.source_hash_sha256
LEFT JOIN upload_completions c ON c.asset_id=a.id AND c.photo_id=ready.photo_id AND c.version_id=ready.version_id AND c.workspace_id=ready.workspace_id AND c.project_id=ready.project_id AND c.album_id=ready.album_id AND c.actor_id=w.owner_user_id
LEFT JOIN upload_version_completions vc ON vc.asset_id=a.id AND vc.photo_id=ready.photo_id AND vc.version_id=ready.version_id AND vc.workspace_id=ready.workspace_id AND vc.project_id=ready.project_id AND vc.album_id=ready.album_id AND vc.actor_id=w.owner_user_id
JOIN upload_sessions u ON u.id=COALESCE(c.upload_session_id,vc.upload_session_id)
 AND u.workspace_id=ready.workspace_id AND u.project_id=ready.project_id AND u.album_id=ready.album_id
 AND u.actor_id=w.owner_user_id AND u.object_key=a.object_key AND u.storage_node_id=a.storage_node_id
WHERE ready.published=1 AND ((c.asset_id IS NOT NULL AND vc.asset_id IS NULL) OR(c.asset_id IS NULL AND vc.asset_id IS NOT NULL))
 AND COALESCE(c.actual_bytes,vc.actual_bytes)=a.byte_size
 AND COALESCE(c.content_type,vc.content_type)=a.mime AND COALESCE(c.sha256_hex,vc.sha256_hex)=a.checksum_sha256;
CREATE VIEW approved_delivery_live_guests AS
SELECT d.event_id AS delivery_id,d.workspace_id,d.project_id,d.album_id,d.photo_id,d.version_id,d.after_json,
 s.id AS guest_session_id,s.secret_hash,g.id AS guest_id,i.id AS invite_id,i.permissions_mask,
 min(s.expires_at_ms,i.expires_at_ms) AS expires_at_ms,src.asset_id,src.storage_node_id,src.object_key,
 src.filename,src.byte_size,src.mime,src.checksum_sha256
FROM audit_events d
JOIN json_each(CASE WHEN d.action='delivery.published' AND json_valid(d.after_json) THEN d.after_json ELSE '{}' END,'$.inviteIds') member
JOIN guest_invites i ON i.id=member.value AND i.workspace_id=d.workspace_id AND i.project_id=d.project_id
JOIN guest_invite_seals seal ON seal.invite_id=i.id
JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.album_id=d.album_id AND ia.workspace_id=d.workspace_id AND ia.project_id=d.project_id
JOIN guest_sessions s ON s.invite_id=i.id
JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=i.id
JOIN approved_delivery_sources src ON src.workspace_id=d.workspace_id AND src.project_id=d.project_id AND src.album_id=d.album_id AND src.photo_id=d.photo_id AND src.version_id=d.version_id AND src.asset_id=json_extract(d.after_json,'$.item.asset.id') AND src.owner_user_id=d.actor_id AND src.filename=json_extract(d.after_json,'$.item.asset.filename') AND src.byte_size=json_extract(d.after_json,'$.item.asset.byteSize') AND src.mime=json_extract(d.after_json,'$.item.asset.mime') AND src.checksum_sha256=json_extract(d.after_json,'$.item.asset.checksumSha256')
WHERE d.action='delivery.published' AND (i.permissions_mask&5)<>0
 AND i.expires_at_ms>unixepoch('subsec')*1000 AND s.expires_at_ms>unixepoch('subsec')*1000
 AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
 AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM audit_events r WHERE r.action='delivery.revoked' AND json_extract(r.after_json,'$.deliveryId')=d.event_id);
CREATE UNIQUE INDEX approved_delivery_request_unique ON audit_events(actor_id,request_id) WHERE action IN('delivery.published','delivery.revoked');
CREATE UNIQUE INDEX approved_delivery_revoke_unique ON audit_events(json_extract(after_json,'$.deliveryId')) WHERE action='delivery.revoked';
CREATE UNIQUE INDEX approved_delivery_download_unique ON audit_events(guest_session_id,request_id,action) WHERE action IN('delivery.download_requested','delivery.download_generated');
CREATE TRIGGER approved_delivery_publish_guard BEFORE INSERT ON audit_events WHEN NEW.action='delivery.published' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events prior WHERE prior.action='delivery.revoked' AND prior.actor_id=NEW.actor_id AND prior.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events p WHERE p.action=NEW.action AND p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id AND (p.session_id IS NOT NEW.session_id OR p.album_id IS NOT NEW.album_id OR p.photo_id IS NOT NEW.photo_id OR p.version_id IS NOT NEW.version_id OR p.after_json IS NOT NEW.after_json)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events p WHERE p.action=NEW.action AND p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NEW.actor_type IS NOT 'user' OR NEW.guest_session_id IS NOT NULL OR NEW.before_json IS NOT NULL
 OR length(NEW.event_id) IS NOT 36 OR NEW.event_id GLOB '*[^0-9a-f-]*' OR length(NEW.request_id) IS NOT 36 OR NEW.request_id GLOB '*[^0-9a-f-]*'
 OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)
 THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN COALESCE(json_valid(NEW.after_json),0)<>1 THEN RAISE(ABORT,'INVALID_DELIVERY') END;
 SELECT CASE WHEN json_type(NEW.after_json,'$.inviteIds') IS NOT 'array' OR json_array_length(NEW.after_json,'$.inviteIds') NOT BETWEEN 1 AND 24
 OR (SELECT count(DISTINCT value) FROM json_each(NEW.after_json,'$.inviteIds'))<>json_array_length(NEW.after_json,'$.inviteIds')
 OR EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.inviteIds') dest WHERE dest.type<>'text' OR NOT EXISTS(
 SELECT 1 FROM version_approval_request_invites member JOIN guest_invites i ON i.id=member.invite_id JOIN guest_invite_seals seal ON seal.invite_id=i.id JOIN guest_invite_albums ia ON ia.invite_id=i.id
 WHERE member.approval_request_id=json_extract(NEW.after_json,'$.approvalRequestId') AND member.invite_id=dest.value
 AND member.workspace_id=NEW.workspace_id AND member.project_id=NEW.project_id AND member.album_id=NEW.album_id
 AND i.created_by=NEW.actor_id AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id AND ia.album_id=NEW.album_id AND ia.workspace_id=NEW.workspace_id AND ia.project_id=NEW.project_id
 AND i.expires_at_ms>unixepoch('subsec')*1000 AND (i.permissions_mask&5)<>0 AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)))
 THEN RAISE(ABORT,'INVALID_DELIVERY_RECIPIENTS') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM approved_delivery_sources src JOIN version_approval_requests ar ON ar.workspace_id=src.workspace_id AND ar.project_id=src.project_id AND ar.album_id=src.album_id AND ar.photo_id=src.photo_id AND ar.version_id=src.version_id
 JOIN version_approval_request_seals sealed ON sealed.approval_request_id=ar.id
 JOIN version_approval_receipts receipt ON receipt.approval_request_id=ar.id AND receipt.event_id=json_extract(NEW.after_json,'$.approvalReceiptId')
 WHERE ar.id=json_extract(NEW.after_json,'$.approvalRequestId') AND ar.owner_id=NEW.actor_id AND src.owner_user_id=NEW.actor_id
 AND src.workspace_id=NEW.workspace_id AND src.project_id=NEW.project_id AND src.album_id=NEW.album_id AND src.photo_id=NEW.photo_id AND src.version_id=NEW.version_id

 AND NEW.after_json IS json_object('approvalRequestId',ar.id,'approvalReceiptId',receipt.event_id,'inviteIds',json(json_extract(NEW.after_json,'$.inviteIds')),'expiresAt',NULL,'item',json_object('photoId',src.photo_id,'versionId',src.version_id,'versionNo',src.version_no,'asset',json_object('id',src.asset_id,'assetKind','original','filename',src.filename,'byteSize',src.byte_size,'mime',src.mime,'checksumSha256',src.checksum_sha256,'verification',json_object('state','verified','verifiedAt',strftime('%Y-%m-%dT%H:%M:%fZ',src.verified_at_ms/1000.0,'unixepoch')))))
 ) THEN RAISE(ABORT,'APPROVED_VERSION_REQUIRED') END;
END;
CREATE TRIGGER approved_delivery_revoke_guard BEFORE INSERT ON audit_events WHEN NEW.action='delivery.revoked' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events prior WHERE prior.action IN('delivery.published','delivery.revoked') AND prior.actor_id=NEW.actor_id AND prior.request_id=NEW.request_id AND (prior.action IS NOT NEW.action OR prior.session_id IS NOT NEW.session_id OR prior.album_id IS NOT NEW.album_id OR prior.after_json IS NOT NEW.after_json)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events r WHERE r.action=NEW.action AND json_extract(r.after_json,'$.deliveryId')=json_extract(NEW.after_json,'$.deliveryId') AND (r.actor_id IS NOT NEW.actor_id OR r.session_id IS NOT NEW.session_id OR r.request_id IS NOT NEW.request_id)) THEN RAISE(ABORT,'ALREADY_REVOKED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events r WHERE r.action=NEW.action AND json_extract(r.after_json,'$.deliveryId')=json_extract(NEW.after_json,'$.deliveryId')) THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NEW.actor_type IS NOT 'user' OR NEW.guest_session_id IS NOT NULL OR NEW.before_json IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM audit_events d JOIN owners o ON o.user_id=d.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
 WHERE d.action='delivery.published' AND d.event_id=json_extract(NEW.after_json,'$.deliveryId') AND d.actor_id=NEW.actor_id
 AND d.workspace_id=NEW.workspace_id AND d.project_id=NEW.project_id AND d.album_id=NEW.album_id AND d.photo_id=NEW.photo_id AND d.version_id=NEW.version_id
 AND NEW.after_json IS json_object('deliveryId',d.event_id)) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
END;
CREATE TRIGGER approved_delivery_download_guard BEFORE INSERT ON audit_events WHEN NEW.action IN('delivery.download_requested','delivery.download_generated') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events r WHERE r.action=NEW.action AND r.guest_session_id=NEW.guest_session_id AND r.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN NEW.actor_type IS NOT 'guest' OR NEW.session_id IS NOT NULL OR NEW.before_json IS NOT NULL
 OR length(NEW.event_id) IS NOT 36 OR NEW.event_id GLOB '*[^0-9a-f-]*' OR length(NEW.request_id) IS NOT 36 OR NEW.request_id GLOB '*[^0-9a-f-]*'
 OR json_type(NEW.after_json,'$.clientIp') NOT IN('null','text') OR length(json_extract(NEW.after_json,'$.clientIp'))>45
 OR NOT EXISTS(SELECT 1 FROM approved_delivery_live_guests live WHERE live.delivery_id=json_extract(NEW.after_json,'$.deliveryId')
 AND live.guest_id=NEW.actor_id AND live.guest_session_id=NEW.guest_session_id AND (live.permissions_mask&4)=4
 AND live.workspace_id=NEW.workspace_id AND live.project_id=NEW.project_id AND live.album_id=NEW.album_id AND live.photo_id=NEW.photo_id AND live.version_id=NEW.version_id
 AND NEW.after_json IS json_object('deliveryId',live.delivery_id,'assetId',live.asset_id,'filename',live.filename,'byteSize',live.byte_size,'mime',live.mime,'clientIp',json_extract(NEW.after_json,'$.clientIp'))) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
 SELECT CASE WHEN NEW.action='delivery.download_generated' AND NOT EXISTS(SELECT 1 FROM audit_events r WHERE r.action='delivery.download_requested' AND r.actor_id=NEW.actor_id AND r.guest_session_id=NEW.guest_session_id AND r.request_id=NEW.request_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id AND r.after_json=NEW.after_json) THEN RAISE(ABORT,'DOWNLOAD_AUDIT_UNAVAILABLE') END;
END;
