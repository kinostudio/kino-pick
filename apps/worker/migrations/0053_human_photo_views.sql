-- Additive append-only witnesses for human-visible photo views. No quota, R2,
-- upload, deletion, or workflow state is changed by this migration.
-- Rollback: first set HUMAN_VIEW_TRACKING_ENABLED=false. Preserve these tables,
-- projections, and event history; prefer a forward fix to disabling native guards.
PRAGMA foreign_keys=ON;

CREATE TABLE human_photo_views(
  event_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(event_id)=36 AND substr(event_id,9,1)='-' AND substr(event_id,14,1)='-'
    AND substr(event_id,19,1)='-' AND substr(event_id,24,1)='-'
    AND length(replace(event_id,'-',''))=32
    AND replace(event_id,'-','') NOT GLOB '*[^0-9a-fA-F]*'),
  request_id TEXT NOT NULL UNIQUE CHECK(
    length(request_id)=36 AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
    AND replace(request_id,'-','') NOT GLOB '*[^0-9a-fA-F]*'
    AND request_id<>event_id),
  actor_type TEXT NOT NULL CHECK(actor_type IN('user','guest')),
  actor_id TEXT NOT NULL CHECK(length(actor_id)=36),
  authorization_session_id TEXT NOT NULL CHECK(length(authorization_session_id) BETWEEN 1 AND 512),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  viewed_at_ms INTEGER NOT NULL CHECK(typeof(viewed_at_ms)='integer' AND viewed_at_ms>=0),
  visible_for_ms INTEGER NOT NULL CHECK(typeof(visible_for_ms)='integer' AND visible_for_ms BETWEEN 1000 AND 60000),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX human_photo_views_session_album_recent
  ON human_photo_views(authorization_session_id,actor_type,actor_id,album_id,viewed_at_ms DESC,event_id DESC);
CREATE INDEX human_photo_views_album_recent
  ON human_photo_views(workspace_id,project_id,album_id,viewed_at_ms DESC,event_id DESC);

CREATE TABLE album_human_activity(
  album_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  last_valid_viewed_at_ms INTEGER NOT NULL CHECK(typeof(last_valid_viewed_at_ms)='integer' AND last_valid_viewed_at_ms>=0),
  view_event_id TEXT NOT NULL UNIQUE REFERENCES human_photo_views(event_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id)
);

CREATE TRIGGER human_photo_view_insert_guard BEFORE INSERT ON human_photo_views BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM human_photo_views prior
    WHERE prior.event_id=NEW.event_id OR prior.request_id=NEW.request_id)
    THEN RAISE(ABORT,'IMMUTABLE_HUMAN_PHOTO_VIEW') END;
  SELECT CASE WHEN NEW.viewed_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+1000
    THEN RAISE(ABORT,'HUMAN_VIEW_TIMESTAMP_INVALID') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1
    FROM workspaces w
    JOIN owners owner ON owner.user_id=w.owner_user_id AND owner.enabled=1
    JOIN projects project ON project.id=NEW.project_id
      AND project.workspace_id=NEW.workspace_id
      AND project.status NOT IN('archived','deleting','deleted')
    JOIN albums album ON album.id=NEW.album_id
      AND album.workspace_id=NEW.workspace_id AND album.project_id=NEW.project_id
      AND album.state='active'
    JOIN photos photo ON photo.id=NEW.photo_id
      AND photo.workspace_id=NEW.workspace_id AND photo.project_id=NEW.project_id
      AND photo.album_id=NEW.album_id
    JOIN photo_version_heads head ON head.photo_id=photo.id
      AND head.workspace_id=photo.workspace_id AND head.project_id=photo.project_id
      AND head.album_id=photo.album_id
    JOIN photo_versions version ON version.id=NEW.version_id
      AND version.workspace_id=photo.workspace_id AND version.photo_id=photo.id
    JOIN photo_assets original ON original.version_id=version.id
      AND original.photo_id=photo.id AND original.workspace_id=photo.workspace_id
      AND original.asset_kind='original' AND original.state='private'
      AND original.byte_size=version.byte_size AND original.mime=version.mime
      AND original.checksum_sha256=version.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=photo.id AND source_v1.version_id=version.id
      AND source_v1.workspace_id=photo.workspace_id
      AND source_v1.project_id=photo.project_id AND source_v1.album_id=photo.album_id
      AND source_v1.actor_id=w.owner_user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=photo.id AND source_v2.version_id=version.id
      AND source_v2.workspace_id=photo.workspace_id
      AND source_v2.project_id=photo.project_id AND source_v2.album_id=photo.album_id
      AND source_v2.actor_id=w.owner_user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=photo.workspace_id
      AND source_upload.project_id=photo.project_id AND source_upload.album_id=photo.album_id
      AND source_upload.actor_id=w.owner_user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key
      AND thumbnail.version_id=version.id AND thumbnail.photo_id=photo.id
      AND thumbnail.workspace_id=photo.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private'
      AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key
      AND preview.version_id=version.id AND preview.photo_id=photo.id
      AND preview.workspace_id=photo.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private'
      AND preview.mime='image/jpeg'
    WHERE w.id=NEW.workspace_id AND owner.user_id=w.owner_user_id
      AND version.id=NEW.version_id AND photo.id=NEW.photo_id
      AND source_upload.original_filename IS NOT NULL
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
      AND (
        (NEW.actor_type='user' AND EXISTS(
          SELECT 1 FROM owner_sessions owner_session
          WHERE owner_session.id=NEW.authorization_session_id
            AND owner_session.userId=owner.user_id
            AND owner_session.userId=NEW.actor_id
            AND owner_session.expiresAt>unixepoch('subsec')*1000))
        OR
        (NEW.actor_type='guest' AND EXISTS(
          SELECT 1 FROM guest_sessions guest_session
          JOIN guest_identities guest ON guest.id=guest_session.guest_id
            AND guest.invite_id=guest_session.invite_id
          JOIN guest_invites invite ON invite.id=guest_session.invite_id
          JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
          JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
            AND invite_album.workspace_id=invite.workspace_id
            AND invite_album.project_id=invite.project_id
            AND invite_album.album_id=NEW.album_id
          WHERE guest_session.id=NEW.authorization_session_id
            AND guest.id=NEW.actor_id
            AND invite.workspace_id=NEW.workspace_id
            AND invite.project_id=NEW.project_id
            AND invite.created_by=owner.user_id
            AND (invite.permissions_mask & 1)=1
            AND guest_session.expires_at_ms>unixepoch('subsec')*1000
            AND invite.expires_at_ms>unixepoch('subsec')*1000
            AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
              WHERE revoked.invite_id=invite.id)
            AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
              WHERE revoked.session_id=guest_session.id)
            AND (version.id=head.version_id OR (
              (invite.permissions_mask & 2048)=2048
              AND (version.version_no=1 OR EXISTS(
                SELECT 1 FROM photo_version_head_commands head_command
                JOIN photo_version_head_results head_result
                  ON head_result.command_id=head_command.id
                WHERE head_command.photo_id=photo.id
                  AND head_command.workspace_id=photo.workspace_id
                  AND head_command.project_id=photo.project_id
                  AND head_command.album_id=photo.album_id
                  AND head_command.version_id=version.id
                  AND json_extract(head_result.result_json,'$.changed')=1))
            ))))
      )
  ) THEN RAISE(ABORT,'HUMAN_VIEW_NOT_AUTHORIZED') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM human_photo_views prior
    WHERE prior.authorization_session_id=NEW.authorization_session_id
      AND prior.actor_type=NEW.actor_type AND prior.actor_id=NEW.actor_id
      AND prior.album_id=NEW.album_id
      AND prior.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)-300000
  ) THEN RAISE(ABORT,'HUMAN_VIEW_RATE_LIMITED') END;
END;

CREATE TRIGGER human_photo_views_no_update BEFORE UPDATE ON human_photo_views BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_HUMAN_PHOTO_VIEW');
END;
CREATE TRIGGER human_photo_views_no_delete BEFORE DELETE ON human_photo_views BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_HUMAN_PHOTO_VIEW');
END;

CREATE TRIGGER album_human_activity_insert_guard BEFORE INSERT ON album_human_activity BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM human_photo_views witness
    WHERE witness.event_id=NEW.view_event_id
      AND witness.album_id=NEW.album_id
      AND witness.workspace_id=NEW.workspace_id
      AND witness.project_id=NEW.project_id
      AND witness.viewed_at_ms=NEW.last_valid_viewed_at_ms
      AND NOT EXISTS(SELECT 1 FROM human_photo_views later
        WHERE later.album_id=witness.album_id
          AND (later.viewed_at_ms>witness.viewed_at_ms
            OR (later.viewed_at_ms=witness.viewed_at_ms AND later.event_id>witness.event_id)))
  ) THEN RAISE(ABORT,'HUMAN_ACTIVITY_WITNESS_REQUIRED') END;
END;
CREATE TRIGGER album_human_activity_update_guard BEFORE UPDATE ON album_human_activity BEGIN
  SELECT CASE WHEN NEW.album_id<>OLD.album_id
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    OR NEW.last_valid_viewed_at_ms<OLD.last_valid_viewed_at_ms
    OR (NEW.last_valid_viewed_at_ms=OLD.last_valid_viewed_at_ms
      AND NEW.view_event_id<=OLD.view_event_id)
    OR NOT EXISTS(
      SELECT 1 FROM human_photo_views witness
      WHERE witness.event_id=NEW.view_event_id
        AND witness.album_id=NEW.album_id
        AND witness.workspace_id=NEW.workspace_id
        AND witness.project_id=NEW.project_id
        AND witness.viewed_at_ms=NEW.last_valid_viewed_at_ms
        AND NOT EXISTS(SELECT 1 FROM human_photo_views later
          WHERE later.album_id=witness.album_id
            AND (later.viewed_at_ms>witness.viewed_at_ms
              OR (later.viewed_at_ms=witness.viewed_at_ms AND later.event_id>witness.event_id)))
    ) THEN RAISE(ABORT,'HUMAN_ACTIVITY_WITNESS_REQUIRED') END;
END;
CREATE TRIGGER album_human_activity_no_delete BEFORE DELETE ON album_human_activity BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_HUMAN_ACTIVITY_PROJECTION');
END;

CREATE TRIGGER human_photo_view_audit_guard BEFORE INSERT ON audit_events
WHEN NEW.action='gallery.viewed' BEGIN
  SELECT CASE WHEN
    NEW.actor_type NOT IN('user','guest')
    OR NEW.before_json IS NOT NULL
    OR COALESCE(json_valid(NEW.after_json),0)<>1
    OR json_type(NEW.after_json,'$') IS NOT 'object'
    OR (SELECT count(*) FROM json_each(NEW.after_json))<>2
    OR (SELECT count(DISTINCT key) FROM json_each(NEW.after_json))<>2
    OR EXISTS(SELECT 1 FROM json_each(NEW.after_json)
      WHERE key NOT IN('source','visibleForMs'))
    OR json_type(NEW.after_json,'$.source') IS NOT 'text'
    OR json_extract(NEW.after_json,'$.source')<>'visible_photo'
    OR json_type(NEW.after_json,'$.visibleForMs') IS NOT 'integer'
    OR NOT EXISTS(
      SELECT 1 FROM human_photo_views witness
      WHERE witness.event_id=NEW.event_id
        AND witness.request_id=NEW.request_id
        AND witness.actor_type=NEW.actor_type
        AND witness.actor_id=NEW.actor_id
        AND witness.workspace_id=NEW.workspace_id
        AND witness.project_id=NEW.project_id
        AND witness.album_id=NEW.album_id
        AND witness.photo_id=NEW.photo_id
        AND witness.version_id=NEW.version_id
        AND witness.visible_for_ms=json_extract(NEW.after_json,'$.visibleForMs')
        AND NEW.after_json=json_object('source','visible_photo',
          'visibleForMs',witness.visible_for_ms)
        AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',
          witness.viewed_at_ms/1000.0,'unixepoch')
        AND ((NEW.actor_type='user'
            AND NEW.session_id=witness.authorization_session_id
            AND NEW.guest_session_id IS NULL)
          OR (NEW.actor_type='guest'
            AND NEW.guest_session_id=witness.authorization_session_id
            AND NEW.session_id IS NULL))
    )
    THEN RAISE(ABORT,'GALLERY_VIEW_AUDIT_WITNESS_REQUIRED') END;
END;

CREATE TRIGGER human_photo_view_after_insert AFTER INSERT ON human_photo_views BEGIN
  INSERT INTO album_human_activity(
    album_id,workspace_id,project_id,last_valid_viewed_at_ms,view_event_id
  ) SELECT NEW.album_id,NEW.workspace_id,NEW.project_id,NEW.viewed_at_ms,NEW.event_id
  WHERE NOT EXISTS(SELECT 1 FROM album_human_activity current
      WHERE current.album_id=NEW.album_id)
    OR EXISTS(SELECT 1 FROM album_human_activity current
      WHERE current.album_id=NEW.album_id
        AND (NEW.viewed_at_ms>current.last_valid_viewed_at_ms
          OR (NEW.viewed_at_ms=current.last_valid_viewed_at_ms
            AND NEW.event_id>current.view_event_id)))
  ON CONFLICT(album_id) DO UPDATE SET
    workspace_id=excluded.workspace_id,
    project_id=excluded.project_id,
    last_valid_viewed_at_ms=excluded.last_valid_viewed_at_ms,
    view_event_id=excluded.view_event_id
  WHERE excluded.last_valid_viewed_at_ms>album_human_activity.last_valid_viewed_at_ms
    OR (excluded.last_valid_viewed_at_ms=album_human_activity.last_valid_viewed_at_ms
      AND excluded.view_event_id>album_human_activity.view_event_id);

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,
    workspace_id,project_id,album_id,photo_id,version_id,action,
    before_json,after_json,request_id,occurred_at_utc
  ) VALUES(
    NEW.event_id,NEW.actor_type,NEW.actor_id,
    CASE WHEN NEW.actor_type='guest' THEN NEW.authorization_session_id END,
    CASE WHEN NEW.actor_type='user' THEN NEW.authorization_session_id END,
    NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,
    'gallery.viewed',NULL,
    json_object('source','visible_photo','visibleForMs',NEW.visible_for_ms),
    NEW.request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.viewed_at_ms/1000.0,'unixepoch')
  );
END;
