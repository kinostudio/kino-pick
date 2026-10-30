-- Bind immutable photo/version/asset references to one tenant and logical photo.
-- Triggers enforce composite ownership without rebuilding append-only tables.
CREATE UNIQUE INDEX photos_id_scope_ref ON photos(id,workspace_id,project_id,album_id);
CREATE UNIQUE INDEX photo_versions_id_scope_ref ON photo_versions(id,workspace_id,photo_id);
CREATE UNIQUE INDEX photo_assets_id_scope_ref ON photo_assets(id,workspace_id,photo_id,version_id);

CREATE TRIGGER photo_versions_scope_guard BEFORE INSERT ON photo_versions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM photos p WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id) THEN RAISE(ABORT,'PHOTO_VERSION_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.parent_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM photo_versions parent WHERE parent.id=NEW.parent_version_id AND parent.photo_id=NEW.photo_id AND parent.workspace_id=NEW.workspace_id AND parent.version_no<NEW.version_no) THEN RAISE(ABORT,'PHOTO_VERSION_PARENT_MISMATCH') END;
END;

CREATE TRIGGER photo_assets_scope_guard BEFORE INSERT ON photo_assets BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM photo_versions v JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id WHERE v.id=NEW.version_id AND v.photo_id=NEW.photo_id AND v.workspace_id=NEW.workspace_id AND p.id=NEW.photo_id) THEN RAISE(ABORT,'PHOTO_ASSET_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM photos p WHERE p.id=NEW.photo_id AND length(NEW.object_key)>length(p.workspace_id||'/'||p.project_id||'/'||p.album_id||'/') AND substr(NEW.object_key,1,length(p.workspace_id||'/'||p.project_id||'/'||p.album_id||'/'))=p.workspace_id||'/'||p.project_id||'/'||p.album_id||'/') THEN RAISE(ABORT,'PHOTO_ASSET_KEY_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER upload_completions_scope_guard BEFORE INSERT ON upload_completions BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM upload_sessions u
    JOIN photos p ON p.id=NEW.photo_id AND p.workspace_id=u.workspace_id AND p.project_id=u.project_id AND p.album_id=u.album_id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=u.workspace_id AND v.photo_id=p.id AND v.version_no=1 AND v.parent_version_id IS NULL AND v.status='private'
    JOIN photo_assets a ON a.id=NEW.asset_id AND a.workspace_id=u.workspace_id AND a.photo_id=p.id AND a.version_id=v.id AND a.asset_kind='original' AND a.object_key=u.object_key AND a.storage_node_id=u.storage_node_id
    WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id AND u.workspace_id=NEW.workspace_id AND u.project_id=NEW.project_id AND u.album_id=NEW.album_id
      AND a.byte_size=NEW.actual_bytes AND a.mime=NEW.content_type AND a.checksum_sha256=NEW.sha256_hex
      AND v.byte_size=NEW.actual_bytes AND v.mime=NEW.content_type AND v.source_hash_sha256=NEW.sha256_hex
  ) THEN RAISE(ABORT,'UPLOAD_COMPLETION_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER audit_photo_scope_guard BEFORE INSERT ON audit_events WHEN NEW.photo_id IS NOT NULL OR NEW.version_id IS NOT NULL BEGIN
  SELECT CASE WHEN NEW.version_id IS NOT NULL AND NEW.photo_id IS NULL THEN RAISE(ABORT,'AUDIT_PHOTO_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.photo_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM photos p WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id AND p.project_id=NEW.project_id AND p.album_id=NEW.album_id
  ) THEN RAISE(ABORT,'AUDIT_PHOTO_SCOPE_MISMATCH') END;
  SELECT CASE WHEN NEW.version_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM photo_versions v WHERE v.id=NEW.version_id AND v.photo_id=NEW.photo_id AND v.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'AUDIT_VERSION_SCOPE_MISMATCH') END;
END;
