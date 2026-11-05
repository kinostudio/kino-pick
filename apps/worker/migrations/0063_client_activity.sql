-- Additive Guest browse receipts and download IP witnesses. IP evidence is
-- permanent and Owner-projected only; no expiry job or retention policy applies.
PRAGMA foreign_keys=ON;

CREATE UNIQUE INDEX guest_sessions_client_activity_scope
  ON guest_sessions(id,guest_id,invite_id);

CREATE TABLE client_browse_events(
  event_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(event_id)=36 AND substr(event_id,9,1)='-' AND substr(event_id,14,1)='-'
    AND substr(event_id,19,1)='-' AND substr(event_id,24,1)='-'
    AND length(replace(event_id,'-',''))=32
    AND replace(event_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  browser_digest TEXT NOT NULL,
  viewed_at_ms INTEGER NOT NULL CHECK(typeof(viewed_at_ms)='integer' AND viewed_at_ms>=0),
  raw_ip TEXT CHECK(raw_ip IS NULL OR length(raw_ip) BETWEEN 3 AND 45),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(guest_session_id,guest_id,invite_id)
    REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,album_id) REFERENCES guest_invite_albums(invite_id,album_id)
);
CREATE INDEX client_browse_events_owner_page
  ON client_browse_events(workspace_id,project_id,album_id,viewed_at_ms DESC,event_id DESC);
CREATE INDEX client_browse_events_album_digest
  ON client_browse_events(album_id,browser_digest);
CREATE INDEX client_browse_events_guest_rate
  ON client_browse_events(guest_session_id,viewed_at_ms DESC);

CREATE TABLE client_album_browser_receipts(
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  browser_digest TEXT NOT NULL CHECK(
    length(browser_digest)=64 AND browser_digest NOT GLOB '*[^0-9a-f]*'),
  guest_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  first_event_id TEXT NOT NULL UNIQUE REFERENCES client_browse_events(event_id),
  first_seen_at_ms INTEGER NOT NULL CHECK(
    typeof(first_seen_at_ms)='integer' AND first_seen_at_ms>=0),
  PRIMARY KEY(album_id,browser_digest),
  UNIQUE(album_id,browser_digest,workspace_id,project_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(guest_session_id,guest_id,invite_id)
    REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,album_id) REFERENCES guest_invite_albums(invite_id,album_id)
);
CREATE INDEX client_album_browser_receipts_owner
  ON client_album_browser_receipts(workspace_id,project_id,album_id,first_seen_at_ms DESC);

-- A ready-version projection lets the native insert guard share the same
-- immutable upload and derivative witnesses as the Guest read path.
CREATE VIEW client_activity_ready_versions AS
SELECT workspace.id AS workspace_id,project.id AS project_id,album.id AS album_id,
  photo.id AS photo_id,version.id AS version_id,head.version_id AS head_version_id,
  CASE WHEN version.version_no=1 OR EXISTS(
    SELECT 1 FROM photo_version_head_commands command
    JOIN photo_version_head_results result ON result.command_id=command.id
    WHERE command.photo_id=photo.id AND command.workspace_id=photo.workspace_id
      AND command.project_id=photo.project_id AND command.album_id=photo.album_id
      AND command.version_id=version.id
      AND json_extract(result.result_json,'$.changed')=1
  ) THEN 1 ELSE 0 END AS published
FROM workspaces workspace
JOIN owners owner ON owner.user_id=workspace.owner_user_id AND owner.enabled=1
JOIN projects project ON project.workspace_id=workspace.id
  AND project.status NOT IN('archived','deleting','deleted')
JOIN albums album ON album.project_id=project.id AND album.workspace_id=workspace.id
  AND album.state='active'
JOIN photos photo ON photo.workspace_id=workspace.id
  AND photo.project_id=project.id AND photo.album_id=album.id
JOIN photo_version_heads head ON head.photo_id=photo.id
  AND head.workspace_id=photo.workspace_id AND head.project_id=photo.project_id
  AND head.album_id=photo.album_id
JOIN photo_versions version ON version.workspace_id=photo.workspace_id
  AND version.photo_id=photo.id
JOIN photo_assets original ON original.version_id=version.id
  AND original.photo_id=photo.id AND original.workspace_id=photo.workspace_id
  AND original.asset_kind='original' AND original.state='private'
  AND original.byte_size=version.byte_size AND original.mime=version.mime
  AND original.checksum_sha256=version.source_hash_sha256
LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
  AND source_v1.photo_id=photo.id AND source_v1.version_id=version.id
  AND source_v1.workspace_id=photo.workspace_id
  AND source_v1.project_id=photo.project_id AND source_v1.album_id=photo.album_id
  AND source_v1.actor_id=owner.user_id
LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
  AND source_v2.photo_id=photo.id AND source_v2.version_id=version.id
  AND source_v2.workspace_id=photo.workspace_id
  AND source_v2.project_id=photo.project_id AND source_v2.album_id=photo.album_id
  AND source_v2.actor_id=owner.user_id
JOIN upload_sessions source_upload
  ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
  AND source_upload.workspace_id=photo.workspace_id
  AND source_upload.project_id=photo.project_id AND source_upload.album_id=photo.album_id
  AND source_upload.actor_id=owner.user_id AND source_upload.object_key=original.object_key
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
WHERE source_upload.original_filename IS NOT NULL
  AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
    OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL));

CREATE TRIGGER client_album_browser_receipts_insert_guard
BEFORE INSERT ON client_album_browser_receipts BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM client_album_browser_receipts prior
    WHERE prior.album_id=NEW.album_id AND prior.browser_digest=NEW.browser_digest)
    THEN RAISE(ABORT,'IMMUTABLE_CLIENT_BROWSER_RECEIPT') END;
  SELECT CASE WHEN NEW.first_seen_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.first_seen_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+1000
    THEN RAISE(ABORT,'CLIENT_ACTIVITY_TIMESTAMP_INVALID') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM client_browse_events event
    WHERE event.event_id=NEW.first_event_id
      AND event.workspace_id=NEW.workspace_id AND event.project_id=NEW.project_id
      AND event.album_id=NEW.album_id AND event.browser_digest=NEW.browser_digest
      AND event.guest_id=NEW.guest_id AND event.guest_session_id=NEW.guest_session_id
      AND event.invite_id=NEW.invite_id AND event.viewed_at_ms=NEW.first_seen_at_ms
  ) THEN RAISE(ABORT,'CLIENT_ACTIVITY_EVENT_WITNESS_REQUIRED') END;
END;
CREATE TRIGGER client_album_browser_receipts_no_update BEFORE UPDATE
ON client_album_browser_receipts BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_CLIENT_BROWSER_RECEIPT');
END;
CREATE TRIGGER client_album_browser_receipts_no_delete BEFORE DELETE
ON client_album_browser_receipts BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_CLIENT_BROWSER_RECEIPT');
END;

CREATE TRIGGER client_browse_events_insert_guard
BEFORE INSERT ON client_browse_events BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM client_browse_events prior
    WHERE prior.event_id=NEW.event_id)
    THEN RAISE(ABORT,'IMMUTABLE_CLIENT_BROWSE_EVENT') END;
  SELECT CASE WHEN NEW.viewed_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+1000
    THEN RAISE(ABORT,'CLIENT_ACTIVITY_TIMESTAMP_INVALID') END;
  -- shortcut: cap each invitation session at 120 events per five minutes; upgrade if cross-session abuse control is required.
  SELECT CASE WHEN (SELECT count(*) FROM client_browse_events recent
    WHERE recent.guest_session_id=NEW.guest_session_id
      AND recent.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)-300000)>=120
    THEN RAISE(ABORT,'CLIENT_ACTIVITY_WRITE_LIMIT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM client_activity_ready_versions ready
    JOIN guest_sessions session ON session.id=NEW.guest_session_id
      AND session.guest_id=NEW.guest_id AND session.invite_id=NEW.invite_id
    JOIN guest_identities guest ON guest.id=session.guest_id
      AND guest.invite_id=session.invite_id
    JOIN guest_invites invite ON invite.id=session.invite_id
    JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
    JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
      AND invite_album.workspace_id=invite.workspace_id
      AND invite_album.project_id=invite.project_id AND invite_album.album_id=NEW.album_id
    JOIN workspaces workspace ON workspace.id=invite.workspace_id
    JOIN owners owner ON owner.user_id=workspace.owner_user_id AND owner.enabled=1
      AND invite.created_by=owner.user_id
    JOIN projects project ON project.id=invite.project_id
      AND project.workspace_id=invite.workspace_id
      AND project.status NOT IN('archived','deleting','deleted')
    JOIN albums album ON album.id=invite_album.album_id
      AND album.workspace_id=invite.workspace_id AND album.project_id=invite.project_id
      AND album.state='active'
    WHERE ready.workspace_id=NEW.workspace_id AND ready.project_id=NEW.project_id
      AND ready.album_id=NEW.album_id AND ready.photo_id=NEW.photo_id
      AND ready.version_id=NEW.version_id AND invite.workspace_id=NEW.workspace_id
      AND invite.project_id=NEW.project_id AND album.id=NEW.album_id
      AND (invite.permissions_mask & 1)=1
      AND (NEW.version_id=ready.head_version_id OR (
        (invite.permissions_mask & 2048)=2048 AND ready.published=1))
      AND session.expires_at_ms>unixepoch('subsec')*1000
      AND invite.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=invite.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
        WHERE revoked.session_id=session.id)
  ) THEN RAISE(ABORT,'CLIENT_ACTIVITY_GUEST_SCOPE_REQUIRED') END;
END;
CREATE TRIGGER client_browse_events_no_update BEFORE UPDATE ON client_browse_events BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_CLIENT_BROWSE_EVENT');
END;
CREATE TRIGGER client_browse_events_no_delete BEFORE DELETE ON client_browse_events BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_CLIENT_BROWSE_EVENT');
END;

CREATE TABLE guest_download_ip_sidecars(
  request_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(request_id)=36 AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
    AND replace(request_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  audit_event_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  guest_session_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  raw_ip TEXT CHECK(raw_ip IS NULL OR length(raw_ip) BETWEEN 3 AND 45),
  recorded_at_ms INTEGER NOT NULL CHECK(typeof(recorded_at_ms)='integer' AND recorded_at_ms>=0),
  FOREIGN KEY(audit_event_id) REFERENCES audit_events(event_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(guest_session_id,guest_id,invite_id)
    REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,album_id) REFERENCES guest_invite_albums(invite_id,album_id)
);
CREATE INDEX guest_download_ip_sidecars_owner
  ON guest_download_ip_sidecars(workspace_id,project_id,album_id,recorded_at_ms DESC,request_id DESC);

CREATE TRIGGER guest_download_ip_sidecars_insert_guard
BEFORE INSERT ON guest_download_ip_sidecars BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_download_ip_sidecars prior
    WHERE prior.request_id=NEW.request_id OR prior.audit_event_id=NEW.audit_event_id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_DOWNLOAD_IP') END;
  SELECT CASE WHEN NEW.recorded_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.recorded_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+1000
    THEN RAISE(ABORT,'CLIENT_ACTIVITY_TIMESTAMP_INVALID') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM audit_events requested
    JOIN guest_sessions session ON session.id=requested.guest_session_id
      AND session.guest_id=requested.actor_id
    JOIN guest_identities guest ON guest.id=session.guest_id
      AND guest.invite_id=session.invite_id
    JOIN guest_invites invite ON invite.id=session.invite_id
    JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
    JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
      AND invite_album.workspace_id=invite.workspace_id
      AND invite_album.project_id=invite.project_id AND invite_album.album_id=NEW.album_id
    JOIN workspaces workspace ON workspace.id=invite.workspace_id
    JOIN owners owner ON owner.user_id=workspace.owner_user_id AND owner.enabled=1
      AND invite.created_by=owner.user_id
    JOIN projects project ON project.id=requested.project_id
      AND project.workspace_id=requested.workspace_id
      AND project.workspace_id=invite.workspace_id AND project.id=invite.project_id
      AND project.status NOT IN('archived','deleting','deleted')
    JOIN albums album ON album.id=requested.album_id
      AND album.workspace_id=requested.workspace_id
      AND album.project_id=requested.project_id AND album.state='active'
    WHERE requested.event_id=NEW.audit_event_id
      AND requested.request_id=NEW.request_id
      AND requested.action='download.requested'
      AND requested.actor_type='guest' AND requested.actor_id=NEW.guest_id
      AND requested.guest_session_id=NEW.guest_session_id
      AND requested.workspace_id=NEW.workspace_id AND requested.project_id=NEW.project_id
      AND requested.album_id=NEW.album_id AND requested.photo_id=NEW.photo_id
      AND requested.version_id=NEW.version_id AND requested.session_id IS NULL
      AND requested.before_json IS NULL AND invite.id=NEW.invite_id
      AND session.invite_id=NEW.invite_id AND session.id=NEW.guest_session_id
      AND session.expires_at_ms>unixepoch('subsec')*1000
      AND invite.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=invite.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
        WHERE revoked.session_id=session.id)
      AND ((json_extract(requested.after_json,'$.assetKind')='preview'
          AND (invite.permissions_mask & 2)=2)
        OR (json_extract(requested.after_json,'$.assetKind')='original'
          AND (invite.permissions_mask & 4)=4))
  ) THEN RAISE(ABORT,'GUEST_DOWNLOAD_IP_AUDIT_REQUIRED') END;
END;
CREATE TRIGGER guest_download_ip_sidecars_no_update
BEFORE UPDATE ON guest_download_ip_sidecars BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_DOWNLOAD_IP');
END;
CREATE TRIGGER guest_download_ip_sidecars_no_delete
BEFORE DELETE ON guest_download_ip_sidecars BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_DOWNLOAD_IP');
END;
