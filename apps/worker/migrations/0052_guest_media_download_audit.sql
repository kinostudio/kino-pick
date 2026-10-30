-- Additive first current-version media-download audit gate.
-- Rollback: set GUEST_DOWNLOADS_ENABLED=false, then DROP TRIGGER guest_media_download_audit_guard.
-- Keep audit rows and media assets; prefer a forward fix after deployment.
CREATE TRIGGER guest_media_download_audit_guard
BEFORE INSERT ON audit_events
WHEN NEW.action IN('download.requested','download.generated')
  AND (NEW.actor_type='guest' OR json_type(NEW.after_json,'$.assetKind') IS NOT NULL)
BEGIN
  SELECT CASE WHEN
    NEW.actor_type<>'guest'
    OR NEW.actor_id IS NULL
    OR NEW.guest_session_id IS NULL
    OR NEW.session_id IS NOT NULL
    OR NEW.before_json IS NOT NULL
    OR COALESCE(json_valid(NEW.after_json),0)<>1
    OR json_type(NEW.after_json,'$') IS NOT 'object'
    OR (SELECT count(*) FROM json_each(NEW.after_json))<>5
    OR (SELECT count(DISTINCT key) FROM json_each(NEW.after_json))<>5
    OR EXISTS(SELECT 1 FROM json_each(NEW.after_json)
      WHERE key NOT IN('assetKind','assetId','filename','byteSize','mime'))
    OR json_type(NEW.after_json,'$.assetKind') IS NOT 'text'
    OR json_extract(NEW.after_json,'$.assetKind') NOT IN('preview','original')
    OR json_type(NEW.after_json,'$.assetId') IS NOT 'text'
    OR length(json_extract(NEW.after_json,'$.assetId'))<>36
    OR substr(json_extract(NEW.after_json,'$.assetId'),9,1)<>'-'
    OR substr(json_extract(NEW.after_json,'$.assetId'),14,1)<>'-'
    OR substr(json_extract(NEW.after_json,'$.assetId'),19,1)<>'-'
    OR substr(json_extract(NEW.after_json,'$.assetId'),24,1)<>'-'
    OR length(replace(json_extract(NEW.after_json,'$.assetId'),'-',''))<>32
    OR replace(json_extract(NEW.after_json,'$.assetId'),'-','') GLOB '*[^0-9a-fA-F]*'
    OR json_type(NEW.after_json,'$.filename') IS NOT 'text'
    OR json_type(NEW.after_json,'$.byteSize') IS NOT 'integer'
    OR json_extract(NEW.after_json,'$.byteSize')<1
    OR json_type(NEW.after_json,'$.mime') IS NOT 'text'
    OR NEW.event_id IS NULL
    OR length(NEW.event_id)<>36
    OR substr(NEW.event_id,9,1)<>'-'
    OR substr(NEW.event_id,14,1)<>'-'
    OR substr(NEW.event_id,19,1)<>'-'
    OR substr(NEW.event_id,24,1)<>'-'
    OR length(replace(NEW.event_id,'-',''))<>32
    OR replace(NEW.event_id,'-','') GLOB '*[^0-9a-fA-F]*'
    OR NEW.request_id IS NULL
    OR length(NEW.request_id)<>36
    OR substr(NEW.request_id,9,1)<>'-'
    OR substr(NEW.request_id,14,1)<>'-'
    OR substr(NEW.request_id,19,1)<>'-'
    OR substr(NEW.request_id,24,1)<>'-'
    OR length(replace(NEW.request_id,'-',''))<>32
    OR replace(NEW.request_id,'-','') GLOB '*[^0-9a-fA-F]*'
    OR NOT EXISTS(
      SELECT 1
      FROM guest_sessions s
      JOIN guest_identities g
        ON g.id=s.guest_id AND g.invite_id=s.invite_id
      JOIN guest_invites i ON i.id=s.invite_id
      JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
      JOIN guest_invite_albums ia
        ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
        AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
      JOIN albums al
        ON al.id=ia.album_id AND al.workspace_id=i.workspace_id
        AND al.project_id=i.project_id AND al.state='active'
      JOIN projects pr
        ON pr.id=i.project_id AND pr.workspace_id=i.workspace_id
        AND pr.status NOT IN('archived','deleting','deleted')
      JOIN workspaces w ON w.id=i.workspace_id
      JOIN owners o
        ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
      JOIN photos p
        ON p.id=NEW.photo_id AND p.workspace_id=i.workspace_id
        AND p.project_id=i.project_id AND p.album_id=al.id
      JOIN photo_version_heads head
        ON head.photo_id=p.id AND head.workspace_id=p.workspace_id
        AND head.project_id=p.project_id AND head.album_id=p.album_id
        AND head.version_id=NEW.version_id
      JOIN photo_versions v
        ON v.id=head.version_id AND v.photo_id=p.id
        AND v.workspace_id=p.workspace_id
      JOIN photo_assets original
        ON original.version_id=v.id AND original.photo_id=p.id
        AND original.workspace_id=p.workspace_id AND original.asset_kind='original'
        AND original.state='private' AND original.byte_size=v.byte_size
        AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
      LEFT JOIN upload_completions sourceV1
        ON sourceV1.asset_id=original.id AND sourceV1.photo_id=p.id
        AND sourceV1.version_id=v.id AND sourceV1.workspace_id=p.workspace_id
        AND sourceV1.project_id=p.project_id AND sourceV1.album_id=p.album_id
        AND sourceV1.actor_id=w.owner_user_id
      LEFT JOIN upload_version_completions sourceV2
        ON sourceV2.asset_id=original.id AND sourceV2.photo_id=p.id
        AND sourceV2.version_id=v.id AND sourceV2.workspace_id=p.workspace_id
        AND sourceV2.project_id=p.project_id AND sourceV2.album_id=p.album_id
        AND sourceV2.actor_id=w.owner_user_id
      JOIN upload_sessions sourceUpload
        ON sourceUpload.id=COALESCE(sourceV1.upload_session_id,sourceV2.upload_session_id)
        AND sourceUpload.workspace_id=p.workspace_id
        AND sourceUpload.project_id=p.project_id AND sourceUpload.album_id=p.album_id
        AND sourceUpload.actor_id=w.owner_user_id
        AND sourceUpload.object_key=original.object_key
      JOIN image_processing_jobs job
        ON job.id=original.id AND job.status='succeeded'
      JOIN image_processing_outputs thumbnail_slot
        ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
      JOIN photo_assets thumbnail
        ON thumbnail.id=thumbnail_slot.asset_id
        AND thumbnail.object_key=thumbnail_slot.object_key
        AND thumbnail.version_id=v.id AND thumbnail.photo_id=p.id
        AND thumbnail.workspace_id=p.workspace_id
        AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private'
        AND thumbnail.mime='image/jpeg'
      JOIN image_processing_outputs preview_slot
        ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
      JOIN photo_assets preview
        ON preview.id=preview_slot.asset_id
        AND preview.object_key=preview_slot.object_key
        AND preview.version_id=v.id AND preview.photo_id=p.id
        AND preview.workspace_id=p.workspace_id
        AND preview.asset_kind='preview' AND preview.state='private'
        AND preview.mime='image/jpeg'
      JOIN photo_assets target
        ON target.id=json_extract(NEW.after_json,'$.assetId')
        AND target.version_id=v.id AND target.photo_id=p.id
        AND target.workspace_id=p.workspace_id AND target.state='private'
        AND target.asset_kind=CASE json_extract(NEW.after_json,'$.assetKind')
          WHEN 'preview' THEN 'preview' ELSE 'original' END
        AND target.byte_size=json_extract(NEW.after_json,'$.byteSize')
        AND target.mime=json_extract(NEW.after_json,'$.mime')
        AND ((json_extract(NEW.after_json,'$.assetKind')='original'
            AND target.id=original.id)
          OR (json_extract(NEW.after_json,'$.assetKind')='preview'
            AND target.id=preview.id))
      WHERE s.id=NEW.guest_session_id AND s.guest_id=NEW.actor_id
        AND g.id=NEW.actor_id AND s.expires_at_ms>unixepoch('subsec')*1000
        AND i.expires_at_ms>unixepoch('subsec')*1000
        AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
        AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
        AND ((json_extract(NEW.after_json,'$.assetKind')='preview'
            AND (i.permissions_mask & 2)=2)
          OR (json_extract(NEW.after_json,'$.assetKind')='original'
            AND (i.permissions_mask & 4)=4))
        AND NEW.actor_type='guest' AND NEW.actor_id=g.id
        AND NEW.guest_session_id=s.id AND NEW.session_id IS NULL
        AND NEW.workspace_id=i.workspace_id AND NEW.project_id=i.project_id
        AND NEW.album_id=ia.album_id AND NEW.photo_id=p.id
        AND NEW.version_id=v.id
        AND json_extract(NEW.after_json,'$.filename')=sourceUpload.original_filename
        AND ((sourceV1.upload_session_id IS NOT NULL AND sourceV2.upload_session_id IS NULL)
          OR (sourceV2.upload_session_id IS NOT NULL AND sourceV1.upload_session_id IS NULL))
    ) THEN RAISE(ABORT,'GUEST_MEDIA_DOWNLOAD_INVALID') END;

  SELECT CASE WHEN NEW.action='download.generated' AND NOT EXISTS(
    SELECT 1 FROM audit_events requested
    WHERE requested.action='download.requested'
      AND requested.request_id=NEW.request_id
      AND requested.actor_type=NEW.actor_type
      AND requested.actor_id=NEW.actor_id
      AND requested.guest_session_id=NEW.guest_session_id
      AND requested.session_id IS NULL
      AND requested.workspace_id=NEW.workspace_id
      AND requested.project_id=NEW.project_id
      AND requested.album_id=NEW.album_id
      AND requested.photo_id=NEW.photo_id
      AND requested.version_id=NEW.version_id
      AND requested.before_json IS NULL
      AND requested.after_json=NEW.after_json
  ) THEN RAISE(ABORT,'GUEST_MEDIA_DOWNLOAD_REQUEST_REQUIRED') END;
END;
