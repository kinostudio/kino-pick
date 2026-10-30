-- Recovery: disable external-effect writes, retain immutable receipts/certificates/audit and repair forward.
-- M3d: claims linearize Owner request IDs before R2 fences.
-- This migration deliberately does not backfill or rewrite historical ledgers.
PRAGMA foreign_keys=ON;

CREATE TABLE owner_external_intents(
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL CHECK(length(request_id)=36
    AND request_id GLOB '????????-????-????-????-????????????'
    AND request_id NOT GLOB '*[^0-9A-Fa-f-]*'
    AND length(replace(request_id,'-',''))=32),
  operation TEXT NOT NULL CHECK(operation IN('upload.cancelled','processing.abandoned')),
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  upload_session_id TEXT REFERENCES upload_sessions(id),
  job_id TEXT REFERENCES image_processing_jobs(id),
  photo_id TEXT REFERENCES photos(id),
  version_id TEXT REFERENCES photo_versions(id),
  expected_epoch INTEGER,
  storage_node_id TEXT NOT NULL REFERENCES storage_nodes(id),
  original_object_key TEXT,
  thumbnail_key TEXT,
  preview_key TEXT,
  payload_json TEXT NOT NULL CHECK(COALESCE(CASE WHEN json_valid(payload_json)
    THEN json_type(payload_json)='object' ELSE 0 END,0)),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'
    AND created_at_ms BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,project_id,workspace_id)
    REFERENCES albums(id,project_id,workspace_id),
  CHECK(
    (operation='upload.cancelled'
      AND upload_session_id IS NOT NULL
      AND job_id IS NULL AND photo_id IS NULL AND version_id IS NULL
      AND expected_epoch IS NULL
      AND original_object_key IS NOT NULL
      AND thumbnail_key IS NULL AND preview_key IS NULL)
    OR
    (operation='processing.abandoned'
      AND upload_session_id IS NULL
      AND job_id IS NOT NULL AND photo_id IS NOT NULL AND version_id IS NOT NULL
      AND typeof(expected_epoch)='integer'
      AND expected_epoch BETWEEN 1 AND 9007199254740991
      AND original_object_key IS NULL
      AND thumbnail_key IS NOT NULL AND preview_key IS NOT NULL)
  )
) WITHOUT ROWID;
CREATE INDEX owner_external_intents_upload_scope ON owner_external_intents(upload_session_id,created_at_ms);
CREATE INDEX owner_external_intents_job_scope ON owner_external_intents(job_id,expected_epoch);
CREATE INDEX owner_external_intents_scope
  ON owner_external_intents(workspace_id,project_id,album_id,created_at_ms);

-- One ordered guard keeps ACL/target identity ahead of replay, and replay ahead
-- of mutable state/epoch checks. Session/time are intentionally not part of the
-- intent equality so an identical retry may use a later valid Owner session.
CREATE INDEX owner_external_intents_legacy_fence_namespace
  ON upload_key_fences(actor_id,request_id) WHERE actor_type='user';

CREATE TRIGGER owner_external_intents_insert_guard
BEFORE INSERT ON owner_external_intents BEGIN
  SELECT CASE WHEN NEW.actor_id IS NULL OR NEW.request_id IS NULL
    OR NEW.operation IS NULL OR NEW.session_id IS NULL
    OR NEW.workspace_id IS NULL OR NEW.project_id IS NULL OR NEW.album_id IS NULL
    OR NEW.storage_node_id IS NULL OR NEW.payload_json IS NULL
    OR NEW.created_at_ms IS NULL
    OR (NEW.operation='upload.cancelled' AND (NEW.upload_session_id IS NULL
      OR NEW.original_object_key IS NULL OR NEW.job_id IS NOT NULL
      OR NEW.photo_id IS NOT NULL OR NEW.version_id IS NOT NULL
      OR NEW.expected_epoch IS NOT NULL OR NEW.thumbnail_key IS NOT NULL
      OR NEW.preview_key IS NOT NULL))
    OR (NEW.operation='processing.abandoned' AND (NEW.job_id IS NULL
      OR NEW.photo_id IS NULL OR NEW.version_id IS NULL
      OR NEW.expected_epoch IS NULL OR NEW.storage_node_id IS NULL
      OR NEW.thumbnail_key IS NULL OR NEW.preview_key IS NULL
      OR NEW.upload_session_id IS NOT NULL OR NEW.original_object_key IS NOT NULL))
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND COALESCE(CASE WHEN json_valid(NEW.payload_json)
      THEN NEW.payload_json=json_object('uploadSessionId',NEW.upload_session_id)
      ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='processing.abandoned'
    AND COALESCE(CASE WHEN json_valid(NEW.payload_json)
      THEN NEW.payload_json=json_object('photoId',NEW.photo_id,
        'versionId',NEW.version_id,'expectedLeaseEpoch',NEW.expected_epoch,
        'confirmAbandon',json('true'))
      ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  -- Current owner/scope/node/target identity is checked on every replay. These
  -- clauses deliberately omit mutable upload/job status and lease epoch.
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND NOT EXISTS(
    SELECT 1 FROM upload_sessions u
    JOIN workspaces w ON w.id=u.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN projects p ON p.id=u.project_id AND p.workspace_id=u.workspace_id
    JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id
      AND a.workspace_id=u.workspace_id
    JOIN storage_nodes n ON n.id=u.storage_node_id AND n.status='active'
    WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id
      AND u.workspace_id=NEW.workspace_id AND u.project_id=NEW.project_id
      AND u.album_id=NEW.album_id AND u.storage_node_id=NEW.storage_node_id
      AND u.object_key=NEW.original_object_key
      AND u.object_key=u.workspace_id||'/'||u.project_id||'/'||u.album_id||'/'||u.id||'/original'
      AND a.state NOT IN('archived','deleting','deleted')
      AND p.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='processing.abandoned' AND NOT EXISTS(
    SELECT 1 FROM image_processing_jobs j
    JOIN photo_assets src ON src.id=j.id AND src.asset_kind='original'
      AND src.state='private'
    JOIN photo_versions v ON v.id=src.version_id
      AND v.workspace_id=src.workspace_id AND v.photo_id=src.photo_id
    JOIN photos ph ON ph.id=src.photo_id
      AND ph.workspace_id=src.workspace_id
    JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
    JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
      AND a.workspace_id=ph.workspace_id
    JOIN storage_nodes n ON n.id=src.storage_node_id AND n.status='active'
    JOIN image_processing_outputs t ON t.job_id=j.id AND t.kind='thumbnail'
    JOIN image_processing_outputs pr ON pr.job_id=j.id AND pr.kind='preview'
    WHERE j.id=NEW.job_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
      AND ph.album_id=NEW.album_id AND src.storage_node_id=NEW.storage_node_id
      AND t.object_key=NEW.thumbnail_key AND pr.object_key=NEW.preview_key
      AND a.state NOT IN('archived','deleting','deleted')
      AND p.status NOT IN('archived','deleting','deleted')
      AND (SELECT count(*) FROM image_processing_outputs x WHERE x.job_id=j.id)=2
  ) THEN RAISE(ABORT,'PROCESSING_SOURCE_UNAVAILABLE') END;

  -- Exact retries of this claim do not depend on the original session, timestamp,
  -- mutable status, or processing epoch. Altered intent reusing the actor ID conflicts.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.upload_session_id IS NOT NEW.upload_session_id
        OR c.job_id IS NOT NEW.job_id OR c.photo_id IS NOT NEW.photo_id
        OR c.version_id IS NOT NEW.version_id
        OR c.expected_epoch IS NOT NEW.expected_epoch
        OR c.storage_node_id<>NEW.storage_node_id
        OR c.original_object_key IS NOT NEW.original_object_key
        OR c.thumbnail_key IS NOT NEW.thumbnail_key
        OR c.preview_key IS NOT NEW.preview_key
        OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(IGNORE) END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND e.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id
      AND NOT (NEW.operation='upload.cancelled' AND f.reason='cancel'
        AND f.upload_session_id=NEW.upload_session_id
        AND f.object_key=NEW.original_object_key))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND EXISTS(
    SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND (u.expires_at_ms<=NEW.created_at_ms
        OR u.expires_at_ms<=unixepoch('subsec')*1000)
  ) THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND NOT EXISTS(
    SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status='reserved'
  ) THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND (
      EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=NEW.upload_session_id)
      OR EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=NEW.upload_session_id)
    ) THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND EXISTS(
    SELECT 1 FROM upload_review_flags f WHERE f.upload_session_id=NEW.upload_session_id
  ) THEN RAISE(ABORT,'UPLOAD_NEEDS_REVIEW') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND EXISTS(
    SELECT 1 FROM upload_key_fences f
    WHERE f.upload_session_id=NEW.upload_session_id
      AND f.object_key<>NEW.original_object_key
  ) THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;  SELECT CASE WHEN NEW.operation='processing.abandoned' AND (
      EXISTS(SELECT 1 FROM image_processing_jobs j
        WHERE j.id=NEW.job_id AND (j.status<>'needs_review'
          OR j.lease_epoch<>NEW.expected_epoch OR j.reserved_bytes<>16777216))
      OR NOT EXISTS(SELECT 1 FROM image_processing_jobs j
        WHERE j.id=NEW.job_id AND j.status='needs_review'
          AND j.lease_epoch=NEW.expected_epoch AND j.reserved_bytes=16777216)
    ) THEN RAISE(ABORT,'PROCESSING_REVIEW_CONFLICT') END;
END;

CREATE TRIGGER owner_external_intents_audit
AFTER INSERT ON owner_external_intents BEGIN
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id
  ) VALUES(
    'owner-external-intent:'||NEW.actor_id||':'||NEW.request_id,
    'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    NEW.photo_id,NEW.version_id,'owner.external_intent_claimed',NULL,
    CASE WHEN NEW.operation='upload.cancelled'
      THEN json_object('operation',NEW.operation,'uploadSessionId',NEW.upload_session_id)
      ELSE json_object('operation',NEW.operation,'jobId',NEW.job_id,
        'expectedEpoch',NEW.expected_epoch) END,
    NEW.request_id
  );
END;
CREATE TRIGGER owner_external_intents_no_update
BEFORE UPDATE ON owner_external_intents BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_EXTERNAL_INTENT');
END;
CREATE TRIGGER owner_external_intents_no_delete
BEFORE DELETE ON owner_external_intents BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_EXTERNAL_INTENT');
END;

-- Every Owner writer rejects a prior external claim and every claimed request
-- rejects a later writer. The two physical finalizers are the only allowed rows.
CREATE TRIGGER owner_external_intents_workspace_commands_namespace
AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_request_commands_namespace
AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_upload_requests_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
        AND NOT (NEW.operation='upload.cancelled' AND c.operation='upload.cancelled'
          AND c.upload_session_id=NEW.upload_session_id AND c.payload_json=NEW.payload_json
          AND EXISTS(SELECT 1 FROM upload_sessions u
            WHERE u.id=NEW.upload_session_id AND c.workspace_id=u.workspace_id
              AND c.project_id=u.project_id AND c.album_id=u.album_id
              AND c.storage_node_id=u.storage_node_id
              AND c.original_object_key=u.object_key)))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id
        AND f.request_id=NEW.request_id
        AND NOT (NEW.operation='upload.cancelled' AND f.reason='cancel'
          AND f.upload_session_id=NEW.upload_session_id
          AND f.object_key=(SELECT u.object_key FROM upload_sessions u
            WHERE u.id=NEW.upload_session_id)))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND NOT EXISTS(
    SELECT 1 FROM owner_external_intents c
    JOIN upload_sessions u ON u.id=NEW.upload_session_id
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.operation='upload.cancelled' AND c.payload_json=NEW.payload_json
      AND c.upload_session_id=NEW.upload_session_id
      AND c.workspace_id=u.workspace_id AND c.project_id=u.project_id
      AND c.album_id=u.album_id AND c.storage_node_id=u.storage_node_id
      AND c.original_object_key=u.object_key
  ) THEN RAISE(ABORT,'OWNER_EXTERNAL_INTENT_REQUIRED') END;
END;
CREATE TRIGGER owner_external_intents_upload_workflow_namespace
AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_processing_review_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
        AND NOT EXISTS(
          SELECT 1 FROM image_processing_jobs j
          JOIN photo_assets src ON src.id=j.id AND src.asset_kind='original'
          JOIN photos ph ON ph.id=src.photo_id
          JOIN image_processing_outputs t ON t.job_id=j.id AND t.kind='thumbnail'
          JOIN image_processing_outputs pr ON pr.job_id=j.id AND pr.kind='preview'
          WHERE c.operation='processing.abandoned' AND c.job_id=NEW.job_id
            AND c.expected_epoch=NEW.expected_epoch AND c.payload_json=NEW.payload_json
            AND c.photo_id=ph.id AND c.version_id=src.version_id
            AND c.workspace_id=ph.workspace_id AND c.project_id=ph.project_id
            AND c.album_id=ph.album_id AND c.storage_node_id=src.storage_node_id
            AND c.thumbnail_key=t.object_key AND c.preview_key=pr.object_key
        )) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id
        AND f.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_external_intents c
    JOIN image_processing_jobs j ON j.id=NEW.job_id
    JOIN photo_assets src ON src.id=j.id AND src.asset_kind='original'
    JOIN photos ph ON ph.id=src.photo_id
    JOIN image_processing_outputs t ON t.job_id=j.id AND t.kind='thumbnail'
    JOIN image_processing_outputs pr ON pr.job_id=j.id AND pr.kind='preview'
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.operation='processing.abandoned' AND c.job_id=NEW.job_id
      AND c.expected_epoch=NEW.expected_epoch AND c.payload_json=NEW.payload_json
      AND c.photo_id=ph.id AND c.version_id=src.version_id
      AND c.workspace_id=ph.workspace_id AND c.project_id=ph.project_id
      AND c.album_id=ph.album_id AND c.storage_node_id=src.storage_node_id
      AND c.thumbnail_key=t.object_key AND c.preview_key=pr.object_key
  ) THEN RAISE(ABORT,'OWNER_EXTERNAL_INTENT_REQUIRED') END;
END;
CREATE TRIGGER owner_external_intents_invite_revocation_namespace
AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_invite_creation_namespace
AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_selection_policy_namespace
AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_selection_policy_configuration_namespace
AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_shared_review_owner_namespace
AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_photo_version_head_namespace
AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_project_versioning_namespace
AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_external_intents_selection_reopened_namespace
BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened'
  AND (EXISTS(SELECT 1 FROM owner_external_intents c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

-- New user cancellation fences must carry their fixed claim. The existing system
-- expiry writer keeps its prior certification and quota behavior.
CREATE TRIGGER owner_external_intents_upload_fence_guard
BEFORE INSERT ON upload_key_fences BEGIN
  SELECT CASE WHEN NEW.upload_session_id IS NULL OR NEW.object_key IS NULL
    OR NEW.reason IS NULL OR NEW.actor_type IS NULL OR NEW.request_id IS NULL
    OR NEW.occurred_at_ms IS NULL
    OR (NEW.actor_type='user' AND (NEW.actor_id IS NULL OR NEW.session_id IS NULL))
    OR (NEW.actor_type='system' AND (NEW.actor_id IS NOT NULL OR NEW.session_id IS NOT NULL))
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.actor_type='user' AND NEW.reason<>'cancel'
    THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
  SELECT CASE WHEN NEW.actor_type='user' AND NEW.reason='cancel'
    AND NOT EXISTS(
      SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      JOIN owner_external_intents c ON c.actor_id=o.user_id
      JOIN upload_sessions u ON u.id=c.upload_session_id
      JOIN workspaces w ON w.id=u.workspace_id AND w.owner_user_id=NEW.actor_id
      JOIN projects p ON p.id=u.project_id AND p.workspace_id=u.workspace_id
      JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id
        AND a.workspace_id=u.workspace_id
      JOIN storage_nodes n ON n.id=u.storage_node_id AND n.status='active'
      WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
        AND s.expiresAt>unixepoch('subsec')*1000
        AND c.request_id=NEW.request_id AND c.operation='upload.cancelled'
        AND c.upload_session_id=NEW.upload_session_id
        AND c.workspace_id=u.workspace_id AND c.project_id=u.project_id
        AND c.album_id=u.album_id AND c.storage_node_id=u.storage_node_id
        AND c.original_object_key=u.object_key AND NEW.object_key=u.object_key
        AND a.state NOT IN('archived','deleting','deleted')
        AND p.status NOT IN('archived','deleting','deleted')
    ) THEN RAISE(ABORT,'OWNER_EXTERNAL_INTENT_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.upload_session_id=NEW.upload_session_id
        AND f.object_key<>NEW.object_key)
    OR EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.object_key=NEW.object_key AND f.upload_session_id<>NEW.upload_session_id)
    THEN RAISE(ABORT,'IMMUTABLE_UPLOAD_KEY_FENCE') END;
  -- Preserve the original physical fence certificate even when another valid
  -- receipt adopts its immutable object key.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.upload_session_id=NEW.upload_session_id AND f.object_key=NEW.object_key)
    THEN RAISE(IGNORE) END;
END;





-- Bind the trusted service's physical observations to the claim's immutable keys.
-- Old completed rows/certificates are not changed; exact legacy replay is ignored
-- by the existing BEFORE guard before this new INSERT guard is reached.
CREATE TRIGGER owner_external_intents_processing_certificate_guard
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN COALESCE(CASE WHEN json_valid(NEW.fences_json) THEN
    json_type(NEW.fences_json)='array' AND json_array_length(NEW.fences_json)=2
    AND (SELECT count(DISTINCT json_extract(e.value,'$.kind'))
      FROM json_each(NEW.fences_json) e WHERE e.type='object')=2
    AND NOT EXISTS(SELECT 1 FROM json_each(NEW.fences_json) e
      WHERE CASE WHEN e.type='object' THEN
        json_type(e.value,'$.kind') IS NOT 'text'
        OR json_extract(e.value,'$.kind') NOT IN('thumbnail','preview')
        OR json_type(e.value,'$.key') IS NOT 'text'
        OR json_extract(e.value,'$.state') IS NOT 'fenced'
        OR json_extract(e.value,'$.key') IS NOT (
          SELECT CASE json_extract(e.value,'$.kind')
            WHEN 'thumbnail' THEN c.thumbnail_key ELSE c.preview_key END
          FROM owner_external_intents c
          WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
            AND c.operation='processing.abandoned' AND c.job_id=NEW.job_id
            AND c.expected_epoch=NEW.expected_epoch)
        OR (SELECT count(*) FROM json_each(e.value))<>3
        OR (SELECT count(DISTINCT k.key) FROM json_each(e.value) k)<>3
        OR EXISTS(SELECT 1 FROM json_each(e.value) k
          WHERE k.key NOT IN('kind','key','state'))
      ELSE 1 END)
    ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'PROCESSING_FENCES_REQUIRED') END;
END;
