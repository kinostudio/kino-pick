-- Expiring, immutable ZIP manifests; originals and prior delivery history stay unchanged.
-- Recovery: disable DELIVERY_ZIP_ENABLED and repair forward; retain ticket/download audits.
CREATE UNIQUE INDEX delivery_zip_request_unique ON audit_events(guest_session_id,request_id,action)
 WHERE action IN('delivery.zip_created','delivery.zip_download_requested','delivery.zip_download_generated');
CREATE TRIGGER delivery_zip_create_guard BEFORE INSERT ON audit_events WHEN NEW.action='delivery.zip_created' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events old WHERE old.action=NEW.action AND old.guest_session_id=NEW.guest_session_id AND old.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN NEW.actor_type IS NOT 'guest' OR NEW.session_id IS NOT NULL OR NEW.photo_id IS NOT NULL OR NEW.version_id IS NOT NULL
 OR length(NEW.event_id) IS NOT 36 OR length(NEW.request_id) IS NOT 36
 OR json_type(NEW.after_json,'$.deliveryIds') IS NOT 'array' OR json_type(NEW.after_json,'$.items') IS NOT 'array'
 OR json_array_length(NEW.after_json,'$.items') NOT BETWEEN 1 AND 24
 OR json_array_length(NEW.after_json,'$.deliveryIds') IS NOT json_array_length(NEW.after_json,'$.items')
 OR json_type(NEW.after_json,'$.expiresAtMs') IS NOT 'integer'
 OR json_extract(NEW.after_json,'$.expiresAtMs')<=unixepoch('subsec')*1000
 OR json_extract(NEW.after_json,'$.expiresAtMs')>unixepoch('subsec')*1000+900000
 OR NEW.before_json IS NOT NULL
 OR NEW.after_json IS NOT json_object('deliveryIds',json_extract(NEW.after_json,'$.deliveryIds'),'items',json_extract(NEW.after_json,'$.items'),'expiresAtMs',json_extract(NEW.after_json,'$.expiresAtMs'))
 THEN RAISE(ABORT,'INVALID_ZIP_MANIFEST') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM json_each(NEW.after_json,'$.items') item
 WHERE json_extract(NEW.after_json,'$.deliveryIds['||item.key||']') IS NOT json_extract(item.value,'$.deliveryId')
 OR (item.key>0 AND json_extract(NEW.after_json,'$.deliveryIds['||(item.key-1)||']')>=json_extract(item.value,'$.deliveryId') COLLATE BINARY)
 OR json_type(item.value,'$.entryName') IS NOT 'text' OR length(json_extract(item.value,'$.entryName')) NOT BETWEEN 1 AND 240
 OR instr(json_extract(item.value,'$.entryName'),'/')>0 OR instr(json_extract(item.value,'$.entryName'),'\')>0
 OR instr(json_extract(item.value,'$.entryName'),':')>0 OR instr(json_extract(item.value,'$.entryName'),char(0))>0
 OR instr(json_extract(item.value,'$.entryName'),char(10))>0 OR instr(json_extract(item.value,'$.entryName'),char(13))>0
 OR substr(json_extract(item.value,'$.entryName'),1,4) IS NOT printf('%03d-',item.key+1)
 OR NOT EXISTS(SELECT 1 FROM approved_delivery_live_guests live WHERE live.delivery_id=json_extract(item.value,'$.deliveryId')
 AND live.guest_id=NEW.actor_id AND live.guest_session_id=NEW.guest_session_id AND (live.permissions_mask&4)=4
 AND live.workspace_id=NEW.workspace_id AND live.project_id=NEW.project_id AND live.album_id=NEW.album_id
 AND json_extract(NEW.after_json,'$.expiresAtMs')<=live.expires_at_ms
 AND item.value IS json_object('deliveryId',live.delivery_id,'photoId',live.photo_id,'versionId',live.version_id,
 'versionNo',json_extract(live.after_json,'$.item.versionNo'),'assetId',live.asset_id,'filename',live.filename,
 'byteSize',live.byte_size,'mime',live.mime,'sha256',live.checksum_sha256,'entryName',json_extract(item.value,'$.entryName'))))
 OR (SELECT sum(json_extract(value,'$.byteSize')) FROM json_each(NEW.after_json,'$.items'))>67108864
 THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
END;
CREATE VIEW delivery_zip_live_guests AS
SELECT ticket.event_id AS ticket_id,ticket.workspace_id,ticket.project_id,ticket.album_id,ticket.actor_id AS guest_id,
 ticket.guest_session_id,s.secret_hash,ticket.manifest,ticket.occurred_at_utc
FROM (SELECT audit_events.*,CASE WHEN action='delivery.zip_created' AND json_valid(after_json) THEN after_json ELSE '{}' END AS manifest FROM audit_events WHERE action='delivery.zip_created') ticket
JOIN guest_sessions s ON s.id=ticket.guest_session_id AND s.guest_id=ticket.actor_id
WHERE json_extract(ticket.manifest,'$.expiresAtMs')>unixepoch('subsec')*1000
AND json_array_length(ticket.manifest,'$.items')=(SELECT count(*) FROM json_each(ticket.manifest,'$.items') item
 JOIN approved_delivery_live_guests live ON live.delivery_id=json_extract(item.value,'$.deliveryId')
 AND live.guest_id=ticket.actor_id AND live.guest_session_id=s.id AND (live.permissions_mask&4)=4
 AND live.workspace_id=ticket.workspace_id AND live.project_id=ticket.project_id AND live.album_id=ticket.album_id
 AND live.asset_id=json_extract(item.value,'$.assetId') AND live.version_id=json_extract(item.value,'$.versionId')
 AND live.byte_size=json_extract(item.value,'$.byteSize') AND live.checksum_sha256=json_extract(item.value,'$.sha256'));
CREATE TRIGGER delivery_zip_download_guard BEFORE INSERT ON audit_events WHEN NEW.action IN('delivery.zip_download_requested','delivery.zip_download_generated') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events old WHERE old.action=NEW.action AND old.guest_session_id=NEW.guest_session_id AND old.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN NEW.actor_type IS NOT 'guest' OR NEW.session_id IS NOT NULL OR NEW.photo_id IS NOT NULL OR NEW.version_id IS NOT NULL OR NEW.before_json IS NOT NULL
 OR length(NEW.event_id) IS NOT 36 OR length(NEW.request_id) IS NOT 36
 OR json_type(NEW.after_json,'$.clientIp') NOT IN('null','text') OR length(json_extract(NEW.after_json,'$.clientIp'))>45
 OR NOT EXISTS(SELECT 1 FROM delivery_zip_live_guests live WHERE live.ticket_id=json_extract(NEW.after_json,'$.ticketId')
 AND live.guest_id=NEW.actor_id AND live.guest_session_id=NEW.guest_session_id
 AND live.workspace_id=NEW.workspace_id AND live.project_id=NEW.project_id AND live.album_id=NEW.album_id
 AND NEW.after_json IS json_object('ticketId',live.ticket_id,'clientIp',json_extract(NEW.after_json,'$.clientIp')))
 THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
 SELECT CASE WHEN NEW.action='delivery.zip_download_generated' AND NOT EXISTS(SELECT 1 FROM audit_events r WHERE r.action='delivery.zip_download_requested' AND r.actor_id=NEW.actor_id AND r.guest_session_id=NEW.guest_session_id AND r.request_id=NEW.request_id AND r.after_json=NEW.after_json AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.album_id=NEW.album_id) THEN RAISE(ABORT,'DOWNLOAD_AUDIT_UNAVAILABLE') END;
END;
