-- Immutable Owner-authorized Guest confirmation for an exact photo version/head revision.
-- Rollback: disable VERSION_APPROVALS_ENABLED, keep request/receipt/audit history, and
-- prefer a forward fix. Never delete approval rows or rewrite the existing 4095 permission mask.
PRAGMA foreign_keys=ON;

CREATE TABLE version_approval_owner_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32
  ),
  actor_id TEXT NOT NULL REFERENCES users(id),
  expected_owner_id TEXT NOT NULL CHECK(expected_owner_id=actor_id),
  session_id TEXT NOT NULL CHECK(length(session_id) BETWEEN 1 AND 512),
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND request_id=lower(request_id)
    AND request_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
  ),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  head_revision INTEGER NOT NULL CHECK(
    typeof(head_revision)='integer' AND head_revision BETWEEN 0 AND 9007199254740991
  ),
  request_resource_id TEXT NOT NULL CHECK(
    length(request_resource_id)=36 AND request_resource_id=lower(request_resource_id)
    AND request_resource_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(request_resource_id,9,1)='-' AND substr(request_resource_id,14,1)='-'
    AND substr(request_resource_id,19,1)='-' AND substr(request_resource_id,24,1)='-'
    AND length(replace(request_resource_id,'-',''))=32
  ),
  invite_ids_json TEXT NOT NULL CHECK(
    json_valid(invite_ids_json) AND json_type(invite_ids_json)='array'
    AND length(invite_ids_json)<=8192
  ),
  confirm INTEGER NOT NULL CHECK(typeof(confirm)='integer' AND confirm=1),
  payload_json TEXT NOT NULL CHECK(COALESCE(
    CASE WHEN json_valid(payload_json) THEN
      json_type(payload_json)='object'
      AND json_type(payload_json,'$.requestId')='text'
      AND json_extract(payload_json,'$.requestId')=request_id
      AND json_type(payload_json,'$.expectedOwnerId')='text'
      AND json_extract(payload_json,'$.expectedOwnerId')=expected_owner_id
      AND json_type(payload_json,'$.expectedHead')='object'
      AND json_type(payload_json,'$.expectedHead.versionId')='text'
      AND json_extract(payload_json,'$.expectedHead.versionId')=version_id
      AND json_type(payload_json,'$.expectedHead.revision')='integer'
      AND json_extract(payload_json,'$.expectedHead.revision')=head_revision
      AND json_type(payload_json,'$.inviteIds')='array'
      AND json_extract(payload_json,'$.inviteIds')=json(invite_ids_json)
      AND json_type(payload_json,'$.confirm')='true'
      AND payload_json=json_object(
        'requestId',request_id,
        'expectedOwnerId',expected_owner_id,
        'expectedHead',json_object('versionId',version_id,'revision',head_revision),
        'inviteIds',json(invite_ids_json),
        'confirm',json('true'))
    ELSE 0 END,0)=1),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE UNIQUE INDEX version_approval_owner_commands_request_ci
  ON version_approval_owner_commands(actor_id,lower(request_id));
CREATE INDEX version_approval_owner_commands_scope
  ON version_approval_owner_commands(actor_id,album_id,photo_id,created_at_ms DESC,id DESC);

CREATE TABLE version_approval_requests(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32
  ),
  owner_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  head_revision INTEGER NOT NULL CHECK(
    typeof(head_revision)='integer' AND head_revision BETWEEN 0 AND 9007199254740991
  ),
  version_no INTEGER NOT NULL CHECK(typeof(version_no)='integer' AND version_no BETWEEN 1 AND 9007199254740991),
  created_command_id TEXT NOT NULL UNIQUE REFERENCES version_approval_owner_commands(id),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(id,workspace_id,project_id,album_id,photo_id,version_id,head_revision),
  UNIQUE(id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX version_approval_requests_album
  ON version_approval_requests(workspace_id,project_id,album_id,photo_id,created_at_ms DESC,id DESC);
CREATE INDEX version_approval_requests_version
  ON version_approval_requests(workspace_id,photo_id,version_id,head_revision,created_at_ms DESC);

CREATE TABLE version_approval_request_invites(
  approval_request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  PRIMARY KEY(approval_request_id,invite_id),
  UNIQUE(approval_request_id,invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(approval_request_id,workspace_id,project_id,album_id)
    REFERENCES version_approval_requests(id,workspace_id,project_id,album_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id)
);
CREATE INDEX version_approval_request_invites_invite
  ON version_approval_request_invites(invite_id,album_id,approval_request_id);

CREATE TABLE version_approval_request_seals(
  approval_request_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  member_count INTEGER NOT NULL CHECK(typeof(member_count)='integer' AND member_count BETWEEN 1 AND 24),
  sealed_at_ms INTEGER NOT NULL CHECK(typeof(sealed_at_ms)='integer' AND sealed_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(approval_request_id,workspace_id,project_id,album_id),
  FOREIGN KEY(approval_request_id,workspace_id,project_id,album_id)
    REFERENCES version_approval_requests(id,workspace_id,project_id,album_id)
);

CREATE TABLE version_approval_owner_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES version_approval_owner_commands(id),
  result_json TEXT NOT NULL CHECK(COALESCE(json_valid(result_json),0)=1),
  event_id TEXT NOT NULL UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE version_approval_guest_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32
  ),
  guest_id TEXT NOT NULL,
  expected_guest_id TEXT NOT NULL CHECK(expected_guest_id=guest_id),
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL CHECK(length(session_id) BETWEEN 1 AND 512),
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND request_id=lower(request_id)
    AND request_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
  ),
  approval_request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  head_revision INTEGER NOT NULL CHECK(
    typeof(head_revision)='integer' AND head_revision BETWEEN 0 AND 9007199254740991
  ),
  payload_json TEXT NOT NULL CHECK(COALESCE(
    CASE WHEN json_valid(payload_json) THEN
      json_type(payload_json)='object'
      AND json_type(payload_json,'$.requestId')='text'
      AND json_extract(payload_json,'$.requestId')=request_id
      AND json_type(payload_json,'$.expectedGuestId')='text'
      AND json_extract(payload_json,'$.expectedGuestId')=expected_guest_id
      AND json_type(payload_json,'$.confirm')='true'
      AND payload_json=json_object(
        'requestId',request_id,'expectedGuestId',expected_guest_id,'confirm',json('true'))
    ELSE 0 END,0)=1),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(approval_request_id,workspace_id,project_id,album_id,photo_id,version_id,head_revision)
    REFERENCES version_approval_requests(id,workspace_id,project_id,album_id,photo_id,version_id,head_revision)
);
CREATE UNIQUE INDEX version_approval_guest_commands_request_ci
  ON version_approval_guest_commands(guest_id,lower(request_id));
CREATE INDEX version_approval_guest_commands_request
  ON version_approval_guest_commands(approval_request_id,guest_id,created_at_ms DESC,id DESC);

CREATE TABLE version_approval_receipts(
  approval_request_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  head_revision INTEGER NOT NULL CHECK(
    typeof(head_revision)='integer' AND head_revision BETWEEN 0 AND 9007199254740991
  ),
  occurred_at_utc TEXT NOT NULL,
  PRIMARY KEY(approval_request_id,guest_id),
  FOREIGN KEY(approval_request_id,workspace_id,project_id,album_id,photo_id,version_id,head_revision)
    REFERENCES version_approval_requests(id,workspace_id,project_id,album_id,photo_id,version_id,head_revision),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id)
);
CREATE INDEX version_approval_receipts_request
  ON version_approval_receipts(approval_request_id,occurred_at_utc,event_id);

CREATE TABLE version_approval_guest_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES version_approval_guest_commands(id),
  result_json TEXT NOT NULL CHECK(COALESCE(json_valid(result_json),0)=1),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TRIGGER version_approval_owner_command_guard
BEFORE INSERT ON version_approval_owner_commands BEGIN
  -- Current Owner and route scope are checked before request-ID lookup/replay.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND NEW.expected_owner_id=o.user_id
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM workspaces w
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=w.id
      AND ph.project_id=p.id AND ph.album_id=a.id
    WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p JOIN albums a
      ON a.project_id=p.id AND a.workspace_id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND a.id=NEW.album_id AND (p.status IN('archived','deleting','deleted')
        OR a.state<>'active')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
  SELECT CASE WHEN NEW.id IS NULL OR EXISTS(
      SELECT 1 FROM version_approval_owner_commands c WHERE c.id=NEW.id
    ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_OWNER_COMMAND') END;

  -- Share the case-folded Owner request namespace with every existing ledger/claim.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences c WHERE c.actor_type='user' AND c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- A changed body or session conflicts. An exact replay returns the immutable original
  -- result after the same live Owner session and owned active scope above are revalidated.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
      AND (c.expected_owner_id<>NEW.expected_owner_id OR c.session_id<>NEW.session_id OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id
        OR c.head_revision<>NEW.head_revision OR c.invite_ids_json<>NEW.invite_ids_json
        OR c.confirm<>NEW.confirm OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.request_id IS NULL OR NEW.confirm<>1
      OR NEW.request_resource_id IS NULL OR NEW.invite_ids_json IS NULL
      OR NEW.payload_json IS NULL
      OR NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photos ph
    JOIN photo_version_heads head ON head.photo_id=ph.id
      AND head.workspace_id=ph.workspace_id AND head.project_id=ph.project_id
      AND head.album_id=ph.album_id
    JOIN photo_versions v ON v.id=head.version_id AND v.photo_id=ph.id
      AND v.workspace_id=ph.workspace_id
    JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN photo_assets original ON original.version_id=v.id
      AND original.photo_id=ph.id AND original.workspace_id=ph.workspace_id
      AND original.asset_kind='original' AND original.state='private'
      AND original.byte_size=v.byte_size AND original.mime=v.mime
      AND original.checksum_sha256=v.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=ph.id AND source_v1.version_id=v.id
      AND source_v1.workspace_id=ph.workspace_id AND source_v1.project_id=ph.project_id
      AND source_v1.album_id=ph.album_id AND source_v1.actor_id=w.owner_user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=ph.id AND source_v2.version_id=v.id
      AND source_v2.workspace_id=ph.workspace_id AND source_v2.project_id=ph.project_id
      AND source_v2.album_id=ph.album_id AND source_v2.actor_id=w.owner_user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=ph.workspace_id
      AND source_upload.project_id=ph.project_id AND source_upload.album_id=ph.album_id
      AND source_upload.actor_id=w.owner_user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key AND thumbnail.version_id=v.id
      AND thumbnail.photo_id=ph.id AND thumbnail.workspace_id=ph.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private' AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id
      AND preview.photo_id=ph.id AND preview.workspace_id=ph.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
      AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id
      AND head.version_id=NEW.version_id AND head.revision=NEW.head_revision
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
  ) THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_CONFLICT') END;

  SELECT CASE WHEN json_array_length(NEW.invite_ids_json) NOT BETWEEN 1 AND 24
      OR (SELECT count(*) FROM json_each(NEW.invite_ids_json)
        WHERE type<>'text' OR length(value)<>36 OR value<>lower(value)
          OR value NOT GLOB '*[^0-9a-f-]*' OR substr(value,9,1)<>'-'
          OR substr(value,14,1)<>'-' OR substr(value,19,1)<>'-'
          OR substr(value,24,1)<>'-' OR length(replace(value,'-',''))<>32)
        <>json_array_length(NEW.invite_ids_json)
      OR (SELECT count(DISTINCT value) FROM json_each(NEW.invite_ids_json))
        <>json_array_length(NEW.invite_ids_json)
      OR EXISTS(
        SELECT 1 FROM json_each(NEW.invite_ids_json) member
        WHERE NOT EXISTS(
          SELECT 1 FROM guest_invites invite
          JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=invite.id
          JOIN guest_invite_albums ia ON ia.invite_id=invite.id
            AND ia.workspace_id=invite.workspace_id AND ia.project_id=invite.project_id
            AND ia.album_id=NEW.album_id
          WHERE invite.id=member.value AND invite.workspace_id=NEW.workspace_id
            AND invite.project_id=NEW.project_id AND invite.created_by=NEW.actor_id
            AND invite.expires_at_ms>unixepoch('subsec')*1000
            AND (invite.permissions_mask & 1)=1
            AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
              WHERE revoked.invite_id=invite.id)
        )
      )
    THEN RAISE(ABORT,'VERSION_APPROVAL_INVALID_INVITES') END;
END;

CREATE TRIGGER version_approval_request_insert_guard
BEFORE INSERT ON version_approval_requests BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_requests r WHERE r.id=NEW.id
      OR r.created_command_id=NEW.created_command_id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_REQUEST') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_owner_commands c
    JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=c.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id
    JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=c.album_id AND a.workspace_id=w.id
      AND a.project_id=p.id AND a.state='active'
    JOIN photos ph ON ph.id=c.photo_id AND ph.workspace_id=w.id
      AND ph.project_id=p.id AND ph.album_id=a.id
    JOIN photo_version_heads head ON head.photo_id=ph.id
      AND head.workspace_id=ph.workspace_id AND head.project_id=ph.project_id
      AND head.album_id=ph.album_id AND head.version_id=c.version_id
      AND head.revision=c.head_revision
    JOIN photo_versions v ON v.id=c.version_id AND v.workspace_id=ph.workspace_id
      AND v.photo_id=ph.id
    WHERE c.id=NEW.created_command_id AND c.actor_id=NEW.owner_id
      AND c.request_resource_id=NEW.id AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND c.head_revision=NEW.head_revision AND v.version_no=NEW.version_no
      AND c.created_at_ms=NEW.created_at_ms
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_REQUEST') END;
END;

CREATE TRIGGER version_approval_request_invite_insert_guard
BEFORE INSERT ON version_approval_request_invites BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_request_invites m
    WHERE m.approval_request_id=NEW.approval_request_id AND m.invite_id=NEW.invite_id
  ) OR EXISTS(
    SELECT 1 FROM version_approval_request_seals s WHERE s.approval_request_id=NEW.approval_request_id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_MEMBERSHIP') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_requests r
    JOIN version_approval_owner_commands c ON c.id=r.created_command_id
    JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=NEW.workspace_id
      AND i.project_id=NEW.project_id AND i.created_by=r.owner_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    WHERE r.id=NEW.approval_request_id AND r.workspace_id=NEW.workspace_id
      AND r.project_id=NEW.project_id AND r.album_id=NEW.album_id
      AND EXISTS(SELECT 1 FROM json_each(c.invite_ids_json) member
        WHERE member.type='text' AND member.value=NEW.invite_id)
      AND i.expires_at_ms>unixepoch('subsec')*1000 AND (i.permissions_mask & 1)=1
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=i.id)
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_MEMBER') END;
END;

CREATE TRIGGER version_approval_request_seal_insert_guard
BEFORE INSERT ON version_approval_request_seals BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_request_seals s
    WHERE s.approval_request_id=NEW.approval_request_id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_SEAL') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_requests r
    JOIN version_approval_owner_commands c ON c.id=r.created_command_id
    WHERE r.id=NEW.approval_request_id AND r.workspace_id=NEW.workspace_id
      AND r.project_id=NEW.project_id AND r.album_id=NEW.album_id
      AND NEW.member_count=json_array_length(c.invite_ids_json)
      AND NEW.member_count=(SELECT count(*) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
      AND NEW.member_count=(SELECT count(DISTINCT invite_id) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
      AND NEW.sealed_at_ms=c.created_at_ms
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_SEAL') END;
END;

CREATE TRIGGER version_approval_owner_result_insert_guard
BEFORE INSERT ON version_approval_owner_results BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_owner_results r
    WHERE r.command_id=NEW.command_id OR r.event_id=NEW.event_id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_OWNER_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_owner_commands c
    JOIN version_approval_requests r ON r.created_command_id=c.id
      AND r.id=c.request_resource_id
    JOIN version_approval_request_seals seal ON seal.approval_request_id=r.id
      AND seal.member_count=json_array_length(c.invite_ids_json)
      AND seal.member_count=(SELECT count(*) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
      AND seal.member_count=(SELECT count(DISTINCT invite_id) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
    WHERE c.id=NEW.command_id AND NEW.event_id=c.id
      AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND NEW.result_json=json_object(
        'requestId',c.request_id,
        'request',json_object(
          'id',r.id,'workspaceId',r.workspace_id,'projectId',r.project_id,
          'albumId',r.album_id,'photoId',r.photo_id,'versionId',r.version_id,
          'headRevision',r.head_revision,'versionNo',r.version_no,
          'inviteIds',json(c.invite_ids_json),'status','open','createdAt',
          strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch'),
          'confirmedAt',NULL),
        'eventId',c.id,'occurredAt',NEW.occurred_at_utc)
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_OWNER_RESULT') END;
END;

CREATE TRIGGER version_approval_owner_command_apply
AFTER INSERT ON version_approval_owner_commands BEGIN
  INSERT INTO version_approval_requests(
    id,owner_id,workspace_id,project_id,album_id,photo_id,version_id,
    head_revision,version_no,created_command_id,created_at_ms
  )
  SELECT NEW.request_resource_id,NEW.actor_id,NEW.workspace_id,NEW.project_id,
    NEW.album_id,NEW.photo_id,NEW.version_id,NEW.head_revision,v.version_no,NEW.id,NEW.created_at_ms
  FROM photo_versions v WHERE v.id=NEW.version_id
    AND v.workspace_id=NEW.workspace_id AND v.photo_id=NEW.photo_id;

  INSERT INTO version_approval_request_invites(
    approval_request_id,workspace_id,project_id,album_id,invite_id
  )
  SELECT NEW.request_resource_id,NEW.workspace_id,NEW.project_id,NEW.album_id,member.value
  FROM json_each(NEW.invite_ids_json) member;

  INSERT INTO version_approval_request_seals(
    approval_request_id,workspace_id,project_id,album_id,member_count,sealed_at_ms
  ) VALUES(
    NEW.request_resource_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    json_array_length(NEW.invite_ids_json),NEW.created_at_ms
  );

  INSERT INTO version_approval_owner_results(command_id,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,
    json_object(
      'requestId',NEW.request_id,
      'request',json_object(
        'id',r.id,'workspaceId',r.workspace_id,'projectId',r.project_id,
        'albumId',r.album_id,'photoId',r.photo_id,'versionId',r.version_id,
        'headRevision',r.head_revision,'versionNo',r.version_no,
        'inviteIds',json(NEW.invite_ids_json),'status','open','createdAt',
        strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch'),
        'confirmedAt',NULL),
      'eventId',NEW.id,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM version_approval_requests r WHERE r.id=NEW.request_resource_id;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT c.id,'user',c.actor_id,c.session_id,c.workspace_id,c.project_id,c.album_id,
    c.photo_id,c.version_id,'version_approval.requested',NULL,
    json_object('approvalRequestId',c.request_resource_id,'photoId',c.photo_id,
      'versionId',c.version_id,'headRevision',c.head_revision,
      'inviteCount',json_array_length(c.invite_ids_json)),
    c.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
  FROM version_approval_owner_commands c WHERE c.id=NEW.id;
END;

CREATE TRIGGER version_approval_guest_command_guard
BEFORE INSERT ON version_approval_guest_commands BEGIN
  -- Resolve current cookie-derived session, invitation, request membership, target, and
  -- visible-version permission before looking up an idempotency key.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN version_approval_requests r ON r.id=NEW.approval_request_id
      AND r.workspace_id=i.workspace_id AND r.project_id=i.project_id AND r.album_id=a.id
      AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
      AND r.head_revision=NEW.head_revision
    JOIN version_approval_request_seals seal ON seal.approval_request_id=r.id
      AND seal.workspace_id=r.workspace_id AND seal.project_id=r.project_id
      AND seal.album_id=r.album_id
      AND seal.member_count=(SELECT count(*) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
    JOIN version_approval_request_invites member ON member.approval_request_id=r.id
      AND member.invite_id=i.id AND member.workspace_id=r.workspace_id
      AND member.project_id=r.project_id AND member.album_id=r.album_id
    JOIN photos ph ON ph.id=r.photo_id AND ph.workspace_id=r.workspace_id
      AND ph.project_id=r.project_id AND ph.album_id=r.album_id
    JOIN photo_version_heads head ON head.photo_id=ph.id
      AND head.workspace_id=ph.workspace_id AND head.project_id=ph.project_id
      AND head.album_id=ph.album_id
    JOIN photo_versions v ON v.id=r.version_id AND v.photo_id=ph.id
      AND v.workspace_id=ph.workspace_id AND v.version_no=r.version_no
    JOIN workspaces owner_workspace ON owner_workspace.id=ph.workspace_id
      AND owner_workspace.owner_user_id=o.user_id
    JOIN photo_assets original ON original.version_id=v.id
      AND original.photo_id=ph.id AND original.workspace_id=ph.workspace_id
      AND original.asset_kind='original' AND original.state='private'
      AND original.byte_size=v.byte_size AND original.mime=v.mime
      AND original.checksum_sha256=v.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=ph.id AND source_v1.version_id=v.id
      AND source_v1.workspace_id=ph.workspace_id AND source_v1.project_id=ph.project_id
      AND source_v1.album_id=ph.album_id AND source_v1.actor_id=o.user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=ph.id AND source_v2.version_id=v.id
      AND source_v2.workspace_id=ph.workspace_id AND source_v2.project_id=ph.project_id
      AND source_v2.album_id=ph.album_id AND source_v2.actor_id=o.user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=ph.workspace_id
      AND source_upload.project_id=ph.project_id AND source_upload.album_id=ph.album_id
      AND source_upload.actor_id=o.user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key AND thumbnail.version_id=v.id
      AND thumbnail.photo_id=ph.id AND thumbnail.workspace_id=ph.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private' AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id
      AND preview.photo_id=ph.id AND preview.workspace_id=ph.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id
      AND NEW.expected_guest_id=NEW.guest_id
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND a.id=NEW.album_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND i.expires_at_ms>unixepoch('subsec')*1000
      AND (i.permissions_mask & 1)=1
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
        WHERE revoked.session_id=s.id)
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
      -- The request is explicitly authorized by this sealed invitation, but its fixed
      -- version must also remain actually visible under the existing Guest gallery rules.
      AND (v.id=head.version_id OR (
        (i.permissions_mask & 2048)=2048
        AND (v.version_no=1 OR EXISTS(
          SELECT 1 FROM photo_version_head_commands head_command
          JOIN photo_version_head_results head_result ON head_result.command_id=head_command.id
          WHERE head_command.photo_id=ph.id AND head_command.workspace_id=ph.workspace_id
            AND head_command.project_id=ph.project_id AND head_command.album_id=ph.album_id
            AND head_command.version_id=v.id
            AND json_extract(head_result.result_json,'$.changed')=1
        ))
      ))
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.id IS NULL OR EXISTS(
    SELECT 1 FROM version_approval_guest_commands c WHERE c.id=NEW.id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_GUEST_COMMAND') END;

  -- Preserve the full case-folded Guest request namespace, including invite-keyed exchange.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_guest_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_tag_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_comment_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_annotation_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
      AND (c.expected_guest_id<>NEW.expected_guest_id OR c.session_id<>NEW.session_id OR c.invite_id<>NEW.invite_id
        OR c.approval_request_id<>NEW.approval_request_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.head_revision<>NEW.head_revision
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  -- Only the same currently live Guest session may replay this exact immutable result.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

CREATE TRIGGER version_approval_receipt_insert_guard
BEFORE INSERT ON version_approval_receipts BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_receipts r
    WHERE r.approval_request_id=NEW.approval_request_id AND r.guest_id=NEW.guest_id
      OR r.event_id=NEW.event_id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_RECEIPT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    JOIN guest_sessions s ON s.id=c.session_id AND s.guest_id=c.guest_id
      AND s.invite_id=c.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=c.album_id
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN version_approval_requests r ON r.id=c.approval_request_id
      AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id
      AND r.album_id=c.album_id AND r.photo_id=c.photo_id
      AND r.version_id=c.version_id AND r.head_revision=c.head_revision
    JOIN version_approval_request_seals seal ON seal.approval_request_id=r.id
      AND seal.member_count=(SELECT count(*) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
    JOIN version_approval_request_invites member ON member.approval_request_id=r.id
      AND member.invite_id=i.id AND member.workspace_id=r.workspace_id
      AND member.project_id=r.project_id AND member.album_id=r.album_id
    JOIN photos ph ON ph.id=r.photo_id AND ph.workspace_id=r.workspace_id
      AND ph.project_id=r.project_id AND ph.album_id=r.album_id
    JOIN photo_version_heads head ON head.photo_id=ph.id AND head.workspace_id=ph.workspace_id
      AND head.project_id=ph.project_id AND head.album_id=ph.album_id
    JOIN photo_versions v ON v.id=r.version_id AND v.workspace_id=ph.workspace_id
      AND v.photo_id=ph.id AND v.version_no=r.version_no
    JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=ph.id
      AND original.workspace_id=ph.workspace_id AND original.asset_kind='original'
      AND original.state='private' AND original.byte_size=v.byte_size
      AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=ph.id AND source_v1.version_id=v.id
      AND source_v1.workspace_id=ph.workspace_id AND source_v1.project_id=ph.project_id
      AND source_v1.album_id=ph.album_id AND source_v1.actor_id=o.user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=ph.id AND source_v2.version_id=v.id
      AND source_v2.workspace_id=ph.workspace_id AND source_v2.project_id=ph.project_id
      AND source_v2.album_id=ph.album_id AND source_v2.actor_id=o.user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=ph.workspace_id
      AND source_upload.project_id=ph.project_id AND source_upload.album_id=ph.album_id
      AND source_upload.actor_id=o.user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key AND thumbnail.version_id=v.id
      AND thumbnail.photo_id=ph.id AND thumbnail.workspace_id=ph.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private' AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id
      AND preview.photo_id=ph.id AND preview.workspace_id=ph.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE c.id=NEW.event_id AND c.guest_id=NEW.guest_id
      AND c.invite_id=NEW.invite_id AND c.session_id=NEW.session_id
      AND c.request_id=NEW.request_id AND c.approval_request_id=NEW.approval_request_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.version_id AND c.head_revision=NEW.head_revision
      AND NEW.event_id=c.id AND NEW.occurred_at_utc=
        strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND i.expires_at_ms>unixepoch('subsec')*1000
      AND (i.permissions_mask & 1)=1
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked WHERE revoked.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked WHERE revoked.session_id=s.id)
      AND ((v.id=head.version_id) OR (
        (i.permissions_mask & 2048)=2048
        AND (v.version_no=1 OR EXISTS(
          SELECT 1 FROM photo_version_head_commands head_command
          JOIN photo_version_head_results head_result ON head_result.command_id=head_command.id
          WHERE head_command.photo_id=ph.id AND head_command.workspace_id=ph.workspace_id
            AND head_command.project_id=ph.project_id AND head_command.album_id=ph.album_id
            AND head_command.version_id=v.id
            AND json_extract(head_result.result_json,'$.changed')=1
        ))
      ))
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_RECEIPT') END;
END;

CREATE TRIGGER version_approval_guest_result_insert_guard
BEFORE INSERT ON version_approval_guest_results BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_guest_results r
    WHERE r.command_id=NEW.command_id OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_GUEST_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    JOIN version_approval_requests approval ON approval.id=c.approval_request_id
    WHERE c.id=NEW.command_id
      AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND (
        (NEW.event_id=c.id AND EXISTS(
          SELECT 1 FROM version_approval_receipts receipt
          WHERE receipt.approval_request_id=c.approval_request_id
            AND receipt.guest_id=c.guest_id AND receipt.invite_id=c.invite_id
            AND receipt.session_id=c.session_id AND receipt.request_id=c.request_id
            AND receipt.event_id=c.id AND receipt.workspace_id=c.workspace_id
            AND receipt.project_id=c.project_id AND receipt.album_id=c.album_id
            AND receipt.photo_id=c.photo_id AND receipt.version_id=c.version_id
            AND receipt.head_revision=c.head_revision AND receipt.occurred_at_utc=NEW.occurred_at_utc
        ) AND NEW.result_json=json_object(
          'requestId',c.request_id,'approvalRequestId',c.approval_request_id,
          'guestId',c.guest_id,'photoId',c.photo_id,'versionId',c.version_id,
          'headRevision',approval.head_revision,'versionNo',approval.version_no,
          'recorded',json('true'),'eventId',c.id,'occurredAt',NEW.occurred_at_utc))
        OR
        (NEW.event_id IS NULL AND EXISTS(
          SELECT 1 FROM version_approval_receipts prior
          WHERE prior.approval_request_id=c.approval_request_id AND prior.guest_id=c.guest_id
        ) AND NEW.result_json=json_object(
          'requestId',c.request_id,'approvalRequestId',c.approval_request_id,
          'guestId',c.guest_id,'photoId',c.photo_id,'versionId',c.version_id,
          'headRevision',approval.head_revision,'versionNo',approval.version_no,
          'recorded',json('false'),'eventId',NULL,'occurredAt',NEW.occurred_at_utc))
      )
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_GUEST_RESULT') END;
END;

CREATE TRIGGER version_approval_guest_command_apply
AFTER INSERT ON version_approval_guest_commands BEGIN
  INSERT INTO version_approval_receipts(
    approval_request_id,guest_id,invite_id,session_id,request_id,event_id,
    workspace_id,project_id,album_id,photo_id,version_id,head_revision,occurred_at_utc
  )
  SELECT NEW.approval_request_id,NEW.guest_id,NEW.invite_id,NEW.session_id,NEW.request_id,NEW.id,
    NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,
    NEW.head_revision,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  WHERE NOT EXISTS(
    SELECT 1 FROM version_approval_receipts prior
    WHERE prior.approval_request_id=NEW.approval_request_id AND prior.guest_id=NEW.guest_id
  );

  INSERT INTO version_approval_guest_results(command_id,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,
    json_object(
      'requestId',NEW.request_id,'approvalRequestId',NEW.approval_request_id,
      'guestId',NEW.guest_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'headRevision',approval.head_revision,'versionNo',approval.version_no,
      'recorded',json(CASE WHEN receipt.event_id=NEW.id THEN 'true' ELSE 'false' END),
      'eventId',CASE WHEN receipt.event_id=NEW.id THEN NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN receipt.event_id=NEW.id THEN NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM version_approval_requests approval
  LEFT JOIN version_approval_receipts receipt
    ON receipt.approval_request_id=approval.id AND receipt.guest_id=NEW.guest_id
  WHERE approval.id=NEW.approval_request_id;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT c.id,'guest',c.guest_id,c.session_id,c.workspace_id,c.project_id,c.album_id,
    c.photo_id,c.version_id,'version_approval.confirmed',NULL,
    json_object('approvalRequestId',c.approval_request_id,'photoId',c.photo_id,'versionId',c.version_id),
    c.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
  FROM version_approval_guest_commands c
  JOIN version_approval_receipts receipt ON receipt.approval_request_id=c.approval_request_id
    AND receipt.guest_id=c.guest_id AND receipt.event_id=c.id
  WHERE c.id=NEW.id;
END;

CREATE TRIGGER version_approval_guest_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action='version_approval.confirmed' BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    JOIN version_approval_guest_results result ON result.command_id=c.id
      AND result.event_id=c.id
    JOIN version_approval_receipts receipt ON receipt.approval_request_id=c.approval_request_id
      AND receipt.guest_id=c.guest_id AND receipt.event_id=c.id
    WHERE NEW.event_id=c.id AND NEW.actor_type='guest' AND NEW.actor_id=c.guest_id
      AND NEW.guest_session_id=c.session_id AND NEW.session_id IS NULL
      AND NEW.workspace_id=c.workspace_id AND NEW.project_id=c.project_id
      AND NEW.album_id=c.album_id AND NEW.photo_id=c.photo_id AND NEW.version_id=c.version_id
      AND NEW.before_json IS NULL
      AND NEW.after_json=json_object('approvalRequestId',c.approval_request_id,
        'photoId',c.photo_id,'versionId',c.version_id)
      AND NEW.request_id=c.request_id
      AND NEW.occurred_at_utc=result.occurred_at_utc
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_AUDIT') END;
END;


CREATE TRIGGER version_approval_owner_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action='version_approval.requested' BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_owner_commands c
    JOIN version_approval_owner_results result ON result.command_id=c.id
    JOIN version_approval_requests r ON r.created_command_id=c.id
      AND r.id=c.request_resource_id
    JOIN version_approval_request_seals seal ON seal.approval_request_id=r.id
      AND seal.member_count=json_array_length(c.invite_ids_json)
    WHERE NEW.event_id=c.id AND NEW.actor_type='user'
      AND NEW.actor_id=c.actor_id AND NEW.session_id=c.session_id
      AND NEW.guest_session_id IS NULL
      AND NEW.workspace_id=c.workspace_id AND NEW.project_id=c.project_id
      AND NEW.album_id=c.album_id AND NEW.photo_id=c.photo_id AND NEW.version_id=c.version_id
      AND NEW.before_json IS NULL
      AND NEW.after_json=json_object('approvalRequestId',r.id,'photoId',r.photo_id,
        'versionId',r.version_id,'headRevision',r.head_revision,
        'inviteCount',seal.member_count)
      AND NEW.request_id=c.request_id
      AND NEW.occurred_at_utc=result.occurred_at_utc
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_AUDIT') END;
END;

CREATE TRIGGER version_approval_owner_commands_no_update
BEFORE UPDATE ON version_approval_owner_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_OWNER_COMMAND');
END;
CREATE TRIGGER version_approval_owner_commands_no_delete
BEFORE DELETE ON version_approval_owner_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_OWNER_COMMAND');
END;
CREATE TRIGGER version_approval_requests_no_update
BEFORE UPDATE ON version_approval_requests BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_REQUEST');
END;
CREATE TRIGGER version_approval_requests_no_delete
BEFORE DELETE ON version_approval_requests BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_REQUEST');
END;
CREATE TRIGGER version_approval_request_invites_no_update
BEFORE UPDATE ON version_approval_request_invites BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_MEMBERSHIP');
END;
CREATE TRIGGER version_approval_request_invites_no_delete
BEFORE DELETE ON version_approval_request_invites BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_MEMBERSHIP');
END;
CREATE TRIGGER version_approval_request_seals_no_update
BEFORE UPDATE ON version_approval_request_seals BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_SEAL');
END;
CREATE TRIGGER version_approval_request_seals_no_delete
BEFORE DELETE ON version_approval_request_seals BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_SEAL');
END;
CREATE TRIGGER version_approval_owner_results_no_update
BEFORE UPDATE ON version_approval_owner_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_OWNER_RESULT');
END;
CREATE TRIGGER version_approval_owner_results_no_delete
BEFORE DELETE ON version_approval_owner_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_OWNER_RESULT');
END;
CREATE TRIGGER version_approval_guest_commands_no_update
BEFORE UPDATE ON version_approval_guest_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_GUEST_COMMAND');
END;
CREATE TRIGGER version_approval_guest_commands_no_delete
BEFORE DELETE ON version_approval_guest_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_GUEST_COMMAND');
END;
CREATE TRIGGER version_approval_receipts_no_update
BEFORE UPDATE ON version_approval_receipts BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_RECEIPT');
END;
CREATE TRIGGER version_approval_receipts_no_delete
BEFORE DELETE ON version_approval_receipts BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_RECEIPT');
END;
CREATE TRIGGER version_approval_guest_results_no_update
BEFORE UPDATE ON version_approval_guest_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_GUEST_RESULT');
END;
CREATE TRIGGER version_approval_guest_results_no_delete
BEFORE DELETE ON version_approval_guest_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_GUEST_RESULT');
END;

-- Inverse Owner namespace witnesses: an older command/claim inserted later must roll back
-- its full statement (including any audit/projection side effects) if it reuses this ID.
CREATE TRIGGER version_approval_workspace_commands_namespace AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_request_commands_namespace AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_upload_requests_namespace AFTER INSERT ON upload_requests
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_upload_workflow_requests_namespace AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_processing_review_commands_namespace AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_invite_revocation_commands_namespace AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_invite_creation_commands_namespace AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_selection_policy_commands_namespace AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_selection_policy_configuration_commands_namespace AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_shared_review_owner_commands_namespace AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_photo_version_head_commands_namespace AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_project_versioning_commands_namespace AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_owner_comment_commands_namespace AFTER INSERT ON owner_comment_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_owner_comment_processing_commands_namespace AFTER INSERT ON owner_comment_processing_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_owner_external_intents_namespace AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_upload_key_fences_namespace AFTER INSERT ON upload_key_fences
WHEN NEW.actor_type='user' AND EXISTS(
  SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_owner_annotation_processing_commands_namespace AFTER INSERT ON owner_annotation_processing_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_owner_annotation_commands_namespace AFTER INSERT ON owner_annotation_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_project_matching_rule_commands_namespace AFTER INSERT ON project_matching_rule_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_selection_reopened_namespace BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

-- Inverse Guest namespace witnesses include the invite-scoped exchange ledger.
CREATE TRIGGER version_approval_guest_selection_commands_namespace AFTER INSERT ON guest_selection_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_guest_selection_submissions_namespace AFTER INSERT ON guest_selection_submissions
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_guest_logout_commands_namespace AFTER INSERT ON guest_logout_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_guest_exchange_commands_namespace AFTER INSERT ON guest_exchange_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.invite_id=NEW.invite_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_guest_feedback_commands_namespace AFTER INSERT ON guest_feedback_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_shared_review_guest_commands_namespace AFTER INSERT ON shared_review_guest_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_guest_tag_commands_namespace AFTER INSERT ON guest_tag_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_guest_comment_commands_namespace AFTER INSERT ON guest_comment_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER version_approval_guest_annotation_commands_namespace AFTER INSERT ON guest_annotation_commands
WHEN EXISTS(SELECT 1 FROM version_approval_guest_commands c
  WHERE c.guest_id=NEW.guest_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;





