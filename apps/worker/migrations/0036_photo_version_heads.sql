-- M3a: immutable Owner commands drive a separate, predecessor-guarded current-version head.
-- V1 is seeded without changing immutable photo_versions status or existing audit data.
PRAGMA foreign_keys=ON;

CREATE TABLE photo_version_head_commands(
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation='photo.version.current.set'),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL
    CHECK(typeof(expected_revision)='integer' AND expected_revision BETWEEN 0 AND 9007199254740991),
  expected_current_version_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  confirm INTEGER NOT NULL CHECK(typeof(confirm)='integer' AND confirm=1),
  payload_json TEXT NOT NULL CHECK(COALESCE(
    CASE WHEN json_valid(payload_json) THEN
      json_type(payload_json)='object'
      AND json_type(payload_json,'$.requestId')='text'
      AND json_extract(payload_json,'$.requestId')=request_id
      AND json_type(payload_json,'$.expectedRevision')='integer'
      AND json_extract(payload_json,'$.expectedRevision')=expected_revision
      AND json_type(payload_json,'$.expectedCurrentVersionId')='text'
      AND json_extract(payload_json,'$.expectedCurrentVersionId')=expected_current_version_id
      AND json_type(payload_json,'$.versionId')='text'
      AND json_extract(payload_json,'$.versionId')=version_id
      AND json_type(payload_json,'$.confirm')='true'
      AND json_extract(payload_json,'$.confirm')=1
      AND payload_json=json_object(
        'requestId',request_id,
        'expectedRevision',expected_revision,
        'expectedCurrentVersionId',expected_current_version_id,
        'versionId',version_id,
        'confirm',json('true'))
    ELSE 0 END,0)=1),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(expected_current_version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);

CREATE TABLE photo_version_head_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES photo_version_head_commands(id),
  previous_command_id TEXT REFERENCES photo_version_head_commands(id),
  before_json TEXT NOT NULL CHECK(COALESCE(json_valid(before_json),0)=1),
  after_json TEXT NOT NULL CHECK(COALESCE(json_valid(after_json),0)=1),
  result_json TEXT NOT NULL CHECK(COALESCE(json_valid(result_json),0)=1),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE photo_version_heads(
  photo_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
  last_command_id TEXT UNIQUE REFERENCES photo_version_head_commands(id),
  CHECK((revision=0 AND last_command_id IS NULL) OR
    (revision>0 AND last_command_id IS NOT NULL)),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);

CREATE INDEX photo_version_heads_page
  ON photo_version_heads(photo_id,workspace_id,project_id,album_id,revision);

CREATE INDEX photo_version_head_commands_photo
  ON photo_version_head_commands(photo_id,created_at_ms DESC,id DESC);

CREATE INDEX photo_version_head_commands_actor
  ON photo_version_head_commands(actor_id,created_at_ms DESC,id DESC);

-- Preserve current V1 metadata for every existing logical photo; do not infer a
-- current head from a later version or rewrite any immutable version row.
INSERT INTO photo_version_heads(
  photo_id,workspace_id,project_id,album_id,version_id,revision,last_command_id
)
SELECT p.id,p.workspace_id,p.project_id,p.album_id,v.id,0,NULL
FROM photos p
JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id
WHERE v.version_no=1;

CREATE TRIGGER photo_version_head_insert_guard
BEFORE INSERT ON photo_version_heads BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_version_heads h WHERE h.photo_id=NEW.photo_id
  ) THEN RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD') END;
  SELECT CASE WHEN NEW.revision<>0 OR NEW.last_command_id IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM photo_versions v
    JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
    WHERE v.id=NEW.version_id AND v.photo_id=NEW.photo_id
      AND v.workspace_id=NEW.workspace_id AND v.version_no=1
      AND p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id
      AND p.project_id=NEW.project_id AND p.album_id=NEW.album_id
  ) THEN RAISE(ABORT,'INVALID_PHOTO_VERSION_HEAD_SEED') END;
END;

CREATE TRIGGER photo_version_head_seed_v1
AFTER INSERT ON photo_versions WHEN NEW.version_no=1 BEGIN
  INSERT INTO photo_version_heads(
    photo_id,workspace_id,project_id,album_id,version_id,revision,last_command_id
  )
  SELECT p.id,p.workspace_id,p.project_id,p.album_id,NEW.id,0,NULL
  FROM photos p
  WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id
    AND NOT EXISTS(
      SELECT 1 FROM photo_version_heads h WHERE h.photo_id=NEW.photo_id
    );
END;

CREATE TRIGGER photo_version_head_command_guard
BEFORE INSERT ON photo_version_head_commands BEGIN
  -- Authorization is deliberately checked before scope, conflicts, or replay.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Bind the current request and both version witnesses to the same live photo
  -- before allowing a stored request to replay.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photos p
    JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN photo_versions expected
      ON expected.id=NEW.expected_current_version_id
      AND expected.workspace_id=p.workspace_id AND expected.photo_id=p.id
    JOIN photo_versions target
      ON target.id=NEW.version_id
      AND target.workspace_id=p.workspace_id AND target.photo_id=p.id
    JOIN photo_version_heads h
      ON h.photo_id=p.id AND h.workspace_id=p.workspace_id
      AND h.project_id=p.project_id AND h.album_id=p.album_id
    WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id
      AND p.project_id=NEW.project_id AND p.album_id=NEW.album_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photos p
    JOIN albums a ON a.id=p.album_id AND a.workspace_id=p.workspace_id
      AND a.project_id=p.project_id
    JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id
    WHERE p.id=NEW.photo_id
      AND (a.state IN('archived','deleting','deleted')
        OR pr.status IN('archived','deleting','deleted'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN NEW.id IS NULL OR EXISTS(
    SELECT 1 FROM photo_version_head_commands c WHERE c.id=NEW.id
  ) THEN RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND') END;

  -- Owner actor/request IDs are shared across all existing Owner ledgers.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e
      WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
        AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.photo_id<>NEW.photo_id
        OR c.expected_revision<>NEW.expected_revision
        OR c.expected_current_version_id<>NEW.expected_current_version_id
        OR c.version_id<>NEW.version_id OR c.confirm<>NEW.confirm
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Exact intent replays the original immutable result. Session validity and
  -- photo scope above still apply, but a newly authenticated session may retry.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_version_heads h
    WHERE h.photo_id=NEW.photo_id AND h.workspace_id=NEW.workspace_id
      AND h.project_id=NEW.project_id AND h.album_id=NEW.album_id
      AND h.revision=NEW.expected_revision
      AND h.version_id=NEW.expected_current_version_id
  ) THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_CONFLICT') END;

  SELECT CASE WHEN NEW.version_id<>NEW.expected_current_version_id
      AND NEW.expected_revision=9007199254740991
    THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_EXHAUSTED') END;

  -- A no-op does not switch versions and therefore does not need a derivative.
  -- A changed head may point only at a private source with the exact two
  -- successful, immutable JPEG derivative slots available to gallery routes.
  SELECT CASE WHEN NEW.version_id<>NEW.expected_current_version_id AND NOT EXISTS(
    SELECT 1 FROM photo_versions v
    JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
    JOIN photo_assets original
      ON original.version_id=v.id AND original.photo_id=p.id
      AND original.workspace_id=p.workspace_id AND original.asset_kind='original'
      AND original.state='private' AND original.byte_size=v.byte_size
      AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
    JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded'
    JOIN image_processing_outputs thumb_slot
      ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'
    JOIN photo_assets thumb
      ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key
      AND thumb.version_id=v.id AND thumb.photo_id=p.id
      AND thumb.workspace_id=p.workspace_id AND thumb.asset_kind='thumbnail'
      AND thumb.state='private' AND thumb.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=j.id AND preview_slot.kind='preview'
    JOIN photo_assets preview
      ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key
      AND preview.version_id=v.id AND preview.photo_id=p.id
      AND preview.workspace_id=p.workspace_id AND preview.asset_kind='preview'
      AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE v.id=NEW.version_id AND v.photo_id=NEW.photo_id
      AND v.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'PHOTO_VERSION_NOT_READY') END;
END;

CREATE TRIGGER photo_version_head_results_insert_guard
BEFORE INSERT ON photo_version_head_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM photo_version_head_results r
    WHERE r.command_id=NEW.command_id
      OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
  ) THEN RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_RESULT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_version_head_commands c
    JOIN photo_version_heads h ON h.photo_id=c.photo_id
      AND h.workspace_id=c.workspace_id AND h.project_id=c.project_id
      AND h.album_id=c.album_id
    WHERE c.id=NEW.command_id
      AND NEW.previous_command_id IS h.last_command_id
      AND c.expected_revision=h.revision
      AND c.expected_current_version_id=h.version_id
      AND NEW.before_json=json_object('versionId',h.version_id,'revision',h.revision)
      AND NEW.occurred_at_utc=strftime(
        '%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND (
        (
          c.version_id=h.version_id
          AND NEW.event_id IS NULL
          AND NEW.after_json=json_object('versionId',h.version_id,'revision',h.revision)
          AND NEW.result_json=json_object(
            'photoId',c.photo_id,
            'current',json_object('versionId',h.version_id,'revision',h.revision),
            'changed',json('false'),'eventId',NULL,
            'occurredAt',NEW.occurred_at_utc)
        )
        OR
        (
          c.version_id<>h.version_id
          AND NEW.event_id='photo-version-current:'||c.id
          AND NEW.after_json=json_object('versionId',c.version_id,'revision',h.revision+1)
          AND NEW.result_json=json_object(
            'photoId',c.photo_id,
            'current',json_object('versionId',c.version_id,'revision',h.revision+1),
            'changed',json('true'),'eventId','photo-version-current:'||c.id,
            'occurredAt',NEW.occurred_at_utc)
          AND EXISTS(
            SELECT 1 FROM photo_versions v
            JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
            JOIN photo_assets original
              ON original.version_id=v.id AND original.photo_id=p.id
              AND original.workspace_id=p.workspace_id
              AND original.asset_kind='original' AND original.state='private'
              AND original.byte_size=v.byte_size AND original.mime=v.mime
              AND original.checksum_sha256=v.source_hash_sha256
            JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded'
            JOIN image_processing_outputs thumb_slot
              ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'
            JOIN photo_assets thumb
              ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key
              AND thumb.version_id=v.id AND thumb.photo_id=p.id
              AND thumb.workspace_id=p.workspace_id
              AND thumb.asset_kind='thumbnail' AND thumb.state='private'
              AND thumb.mime='image/jpeg'
            JOIN image_processing_outputs preview_slot
              ON preview_slot.job_id=j.id AND preview_slot.kind='preview'
            JOIN photo_assets preview
              ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key
              AND preview.version_id=v.id AND preview.photo_id=p.id
              AND preview.workspace_id=p.workspace_id
              AND preview.asset_kind='preview' AND preview.state='private'
              AND preview.mime='image/jpeg'
            WHERE v.id=c.version_id AND v.photo_id=c.photo_id
              AND v.workspace_id=c.workspace_id
          )
        )
      )
  ) THEN RAISE(ABORT,'INVALID_PHOTO_VERSION_HEAD_RESULT') END;
END;

CREATE TRIGGER photo_version_head_command_apply
AFTER INSERT ON photo_version_head_commands BEGIN
  INSERT INTO photo_version_head_results(
    command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc
  )
  SELECT NEW.id,h.last_command_id,
    json_object('versionId',h.version_id,'revision',h.revision),
    json_object('versionId',NEW.version_id,
      'revision',h.revision+CASE WHEN NEW.version_id=h.version_id THEN 0 ELSE 1 END),
    json_object(
      'photoId',NEW.photo_id,
      'current',json_object('versionId',NEW.version_id,
        'revision',h.revision+CASE WHEN NEW.version_id=h.version_id THEN 0 ELSE 1 END),
      'changed',json(CASE WHEN NEW.version_id=h.version_id THEN 'false' ELSE 'true' END),
      'eventId',CASE WHEN NEW.version_id=h.version_id THEN NULL
        ELSE 'photo-version-current:'||NEW.id END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN NEW.version_id=h.version_id THEN NULL
      ELSE 'photo-version-current:'||NEW.id END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM photo_version_heads h
  WHERE h.photo_id=NEW.photo_id AND h.workspace_id=NEW.workspace_id
    AND h.project_id=NEW.project_id AND h.album_id=NEW.album_id;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT r.event_id,'user',c.actor_id,c.session_id,c.workspace_id,c.project_id,
    c.album_id,c.photo_id,c.version_id,'photo.version_current_changed',
    r.before_json,r.after_json,c.request_id,r.occurred_at_utc
  FROM photo_version_head_commands c
  JOIN photo_version_head_results r ON r.command_id=c.id
  WHERE c.id=NEW.id AND r.event_id IS NOT NULL;

  UPDATE photo_version_heads
  SET version_id=NEW.version_id,revision=revision+1,last_command_id=NEW.id
  WHERE photo_id=NEW.photo_id AND NEW.version_id<>NEW.expected_current_version_id;
END;

CREATE TRIGGER photo_version_head_update_guard
BEFORE UPDATE ON photo_version_heads BEGIN
  SELECT CASE WHEN NEW.photo_id<>OLD.photo_id OR NEW.workspace_id<>OLD.workspace_id
      OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id
    THEN RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_SCOPE') END;
  SELECT CASE WHEN NEW.version_id=OLD.version_id
      OR NEW.revision<>OLD.revision+1
      OR NEW.last_command_id IS NULL
    OR NOT EXISTS(
      SELECT 1 FROM photo_version_head_commands c
      JOIN photo_version_head_results r ON r.command_id=c.id
      JOIN audit_events e ON e.event_id=r.event_id
      WHERE c.id=NEW.last_command_id AND c.operation='photo.version.current.set'
        AND c.photo_id=OLD.photo_id AND c.workspace_id=OLD.workspace_id
        AND c.project_id=OLD.project_id AND c.album_id=OLD.album_id
        AND c.expected_revision=OLD.revision
        AND c.expected_current_version_id=OLD.version_id
        AND c.version_id=NEW.version_id AND c.confirm=1
        AND r.previous_command_id IS OLD.last_command_id
        AND r.event_id='photo-version-current:'||c.id
        AND r.before_json=json_object('versionId',OLD.version_id,'revision',OLD.revision)
        AND r.after_json=json_object('versionId',NEW.version_id,'revision',NEW.revision)
        AND e.actor_type='user' AND e.actor_id=c.actor_id AND e.session_id=c.session_id
        AND e.workspace_id=OLD.workspace_id AND e.project_id=OLD.project_id
        AND e.album_id=OLD.album_id AND e.photo_id=OLD.photo_id
        AND e.version_id=NEW.version_id
        AND e.action='photo.version_current_changed'
        AND e.request_id=c.request_id AND e.occurred_at_utc=r.occurred_at_utc
    ) THEN RAISE(ABORT,'INVALID_PHOTO_VERSION_HEAD_TRANSITION') END;
END;

CREATE TRIGGER photo_version_head_no_delete
BEFORE DELETE ON photo_version_heads BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD');
END;
CREATE TRIGGER photo_version_head_commands_no_update
BEFORE UPDATE ON photo_version_head_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND');
END;
CREATE TRIGGER photo_version_head_commands_no_delete
BEFORE DELETE ON photo_version_head_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND');
END;
CREATE TRIGGER photo_version_head_results_no_update
BEFORE UPDATE ON photo_version_head_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_RESULT');
END;
CREATE TRIGGER photo_version_head_results_no_delete
BEFORE DELETE ON photo_version_head_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_RESULT');
END;

-- A new Owner ledger must reject reuse in both directions, including the older
-- audit-only selection.reopened request witness.
CREATE TRIGGER workspace_commands_photo_version_head_namespace
AFTER INSERT ON workspace_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER request_commands_photo_version_head_namespace
AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_photo_version_head_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_requests_photo_version_head_namespace
AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_commands_photo_version_head_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_commands_photo_version_head_namespace
AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_commands_photo_version_head_namespace
AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_commands_photo_version_head_namespace
AFTER INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_configuration_commands_photo_version_head_namespace
AFTER INSERT ON selection_policy_configuration_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_owner_commands_photo_version_head_namespace
AFTER INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_reopened_photo_version_head_namespace
BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER photo_version_head_commands_no_replace
BEFORE INSERT ON photo_version_head_commands
WHEN NEW.id IS NULL OR EXISTS(
  SELECT 1 FROM photo_version_head_commands c WHERE c.id=NEW.id
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND');
END;
CREATE TRIGGER photo_version_head_results_no_replace
BEFORE INSERT ON photo_version_head_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM photo_version_head_results r
  WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_RESULT');
END;
