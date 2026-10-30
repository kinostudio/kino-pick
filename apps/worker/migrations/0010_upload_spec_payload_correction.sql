-- Forward-only repair for early local 0009 builds that added redundant columns.
-- New installs keep the request payload as the immutable source of upload specs.
DROP TRIGGER IF EXISTS upload_request_spec_guard;
DROP TRIGGER IF EXISTS upload_session_add_spec;
DROP TRIGGER IF EXISTS upload_request_spec_no_update;
CREATE TRIGGER upload_request_spec_guard BEFORE INSERT ON upload_requests WHEN NEW.operation='upload.reserved' BEGIN
  SELECT CASE WHEN NEW.expected_bytes>5363466240 OR json_extract(NEW.payload_json,'$.contentType') IS NULL OR json_extract(NEW.payload_json,'$.contentType') NOT IN('image/jpeg','image/png','image/webp') OR json_extract(NEW.payload_json,'$.sha256') IS NULL OR length(json_extract(NEW.payload_json,'$.sha256'))<>64 OR json_extract(NEW.payload_json,'$.sha256') GLOB '*[^0-9a-f]*' THEN RAISE(ABORT,'INVALID_INPUT') END;
END;
CREATE TRIGGER upload_session_add_spec AFTER INSERT ON upload_sessions BEGIN
  INSERT INTO upload_specs(upload_session_id,content_type,sha256_hex,created_at_ms) SELECT NEW.id,json_extract(r.payload_json,'$.contentType'),json_extract(r.payload_json,'$.sha256'),r.created_at_ms FROM upload_requests r WHERE r.upload_session_id=NEW.id AND r.operation='upload.reserved';
END;
