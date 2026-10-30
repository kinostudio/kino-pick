-- M3c2b2 resolved reservations. Additive payload guards; preserve old commands,
-- targets, results, audit and quota semantics. The two named0038 guards
-- remove only the mode prohibition; the0037 upload guard additionally allows
-- exactly one resolution field, validated by the supplemental guard below.
-- Worker gates remain OFF/hard-local. No data backfill or historical rewrite.
-- Recovery: disable resolved/configuration writes, keep new guards and immutable
-- payloads/targets, repair forward; never downgrade to a handler that discards
-- resolution dimensions or allocates a replacement after an unknown result.
PRAGMA foreign_keys=ON;

DROP TRIGGER project_versioning_command_guard;
CREATE TRIGGER project_versioning_command_guard
BEFORE INSERT ON project_versioning_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN NEW.id IS NULL OR NEW.request_id IS NULL
      OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_COMMAND') END;

  -- Owner actor/request IDs share one namespace across all Owner command ledgers.
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
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e
      WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
        AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Ignore captured before-state/session fields for canonical intent comparison:
  -- a retry may arrive in a later live Owner session and after newer mode changes.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation
        OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id
        OR c.expected_revision<>NEW.expected_revision
        OR c.mode<>NEW.mode OR c.confirm<>NEW.confirm
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Current Owner/session and project scope above still apply to exact retries.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN COALESCE(
      CASE WHEN json_valid(NEW.payload_json) THEN
        json_type(NEW.payload_json)='object'
        AND json_type(NEW.payload_json,'$.projectId')='text'
        AND json_extract(NEW.payload_json,'$.projectId')=NEW.project_id
        AND json_type(NEW.payload_json,'$.expectedRevision')='integer'
        AND json_extract(NEW.payload_json,'$.expectedRevision')=NEW.expected_revision
        AND json_type(NEW.payload_json,'$.mode')='text'
        AND json_extract(NEW.payload_json,'$.mode')=NEW.mode
        AND json_type(NEW.payload_json,'$.confirm')='true'
        AND json_extract(NEW.payload_json,'$.confirm')=1
        AND NEW.payload_json=json_object(
          'projectId',NEW.project_id,
          'expectedRevision',NEW.expected_revision,
          'mode',NEW.mode,
          'confirm',json('true'))
      ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;


  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
      AND p.revision=NEW.expected_revision
      AND p.versioning_mode=NEW.before_mode
      AND p.versioning_command_id IS NEW.previous_command_id
  ) THEN RAISE(ABORT,'PROJECT_VERSIONING_REVISION_CONFLICT') END;

  SELECT CASE WHEN NEW.mode<>NEW.before_mode
      AND NEW.expected_revision=2147483647
    THEN RAISE(ABORT,'PROJECT_VERSIONING_REVISION_EXHAUSTED') END;
END;

DROP TRIGGER projects_versioning_transition_guard;
CREATE TRIGGER projects_versioning_transition_guard
BEFORE UPDATE ON projects
WHEN NEW.versioning_mode IS NOT OLD.versioning_mode
  OR NEW.versioning_command_id IS NOT OLD.versioning_command_id BEGIN
  SELECT CASE WHEN NEW.versioning_mode NOT IN('off','manual','auto_filename','assisted')
      OR NEW.versioning_command_id IS NULL
      OR NEW.revision<>OLD.revision+1
      OR NOT EXISTS(
        SELECT 1 FROM project_versioning_commands c
        JOIN project_versioning_results r ON r.command_id=c.id
        JOIN audit_events e ON e.event_id=r.event_id
        WHERE c.id=NEW.versioning_command_id
          AND c.operation='project.versioning_mode.set'
          AND c.actor_id IS NOT NULL
          AND c.workspace_id=OLD.workspace_id AND c.project_id=OLD.id
          AND c.expected_revision=OLD.revision
          AND c.before_mode=OLD.versioning_mode
          AND c.mode=NEW.versioning_mode
          AND c.previous_command_id IS OLD.versioning_command_id
          AND c.confirm=1
          AND r.previous_command_id IS OLD.versioning_command_id
          AND r.event_id=c.id
          AND r.before_json=json_object(
            'mode',OLD.versioning_mode,'revision',OLD.revision)
          AND r.after_json=json_object(
            'mode',NEW.versioning_mode,'revision',NEW.revision)
          AND e.actor_type='user' AND e.actor_id=c.actor_id
          AND e.session_id=c.session_id
          AND e.workspace_id=OLD.workspace_id AND e.project_id=OLD.id
          AND e.action='project.versioning_mode_changed'
          AND e.request_id=c.request_id
          AND e.occurred_at_utc=r.occurred_at_utc
      )
    THEN RAISE(ABORT,'INVALID_PROJECT_VERSIONING_TRANSITION') END;
END;

CREATE TRIGGER upload_resolved_reservation_guard
BEFORE INSERT ON upload_requests
WHEN NEW.operation='upload.reserved'
  AND json_valid(NEW.payload_json)
  AND json_type(NEW.payload_json,'$.resolution') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN COALESCE(CASE WHEN
    json_type(NEW.payload_json,'$.resolution')='object' THEN
      (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution'))=6
      AND json_type(NEW.payload_json,'$.resolution.expectedChangeSequence')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.expectedChangeSequence') BETWEEN 0 AND 9007199254740991
      AND json_type(NEW.payload_json,'$.resolution.expectedProjectRevision')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.expectedProjectRevision') BETWEEN 1 AND 2147483647
      AND json_extract(NEW.payload_json,'$.resolution.expectedMode') IN('auto_filename','assisted')
      AND json_type(NEW.payload_json,'$.resolution.confirm')='true'
      AND json_type(NEW.payload_json,'$.resolution.dimensions')='object'
      AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.dimensions'))=2
      AND json_type(NEW.payload_json,'$.resolution.dimensions.width')='integer'
      AND json_type(NEW.payload_json,'$.resolution.dimensions.height')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.width') BETWEEN 1 AND 32768
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.height') BETWEEN 1 AND 32768
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.width')*json_extract(NEW.payload_json,'$.resolution.dimensions.height')<=80000000
      AND json_type(NEW.payload_json,'$.resolution.choice')='object'
      AND ((json_extract(NEW.payload_json,'$.resolution.choice.kind')='new_photo'
          AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.choice'))=1
          AND json_type(NEW.payload_json,'$.versionTarget') IS NULL)
        OR (json_extract(NEW.payload_json,'$.resolution.choice.kind')='new_version'
          AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.choice'))=4
          AND json_type(NEW.payload_json,'$.versionTarget')='object'
          AND json_extract(NEW.payload_json,'$.resolution.choice.photoId')=json_extract(NEW.payload_json,'$.versionTarget.photoId')
          AND json_extract(NEW.payload_json,'$.resolution.choice.parentVersionId')=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId')
          AND json_extract(NEW.payload_json,'$.resolution.choice.expectedRevision')=json_extract(NEW.payload_json,'$.versionTarget.expectedRevision')
          AND json_extract(NEW.payload_json,'$.versionTarget.changeType')='new_retouch'))
    ELSE 0 END,0)<>1 THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN
    json_extract(NEW.payload_json,'$.resolution.expectedChangeSequence')<>
      COALESCE((SELECT MAX(m.sequence) FROM album_matching_changes m
        WHERE m.workspace_id=NEW.workspace_id AND m.project_id=NEW.project_id AND m.album_id=NEW.album_id),0)
    OR NOT EXISTS(SELECT 1 FROM projects p
      WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
        AND p.revision=json_extract(NEW.payload_json,'$.resolution.expectedProjectRevision')
        AND p.versioning_mode=json_extract(NEW.payload_json,'$.resolution.expectedMode')
        AND p.status NOT IN('archived','deleting','deleted'))
    THEN RAISE(ABORT,'RESOLUTION_STALE') END;
END;

CREATE TRIGGER upload_resolved_completion_dimensions_guard
BEFORE INSERT ON upload_workflow_requests
WHEN NEW.operation='upload.completed'
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM upload_requests r WHERE r.upload_session_id=NEW.upload_session_id
      AND r.operation='upload.reserved' AND json_type(r.payload_json,'$.resolution')='object'
      AND (NEW.image_width IS NOT json_extract(r.payload_json,'$.resolution.dimensions.width')
        OR NEW.image_height IS NOT json_extract(r.payload_json,'$.resolution.dimensions.height')))
    THEN RAISE(ABORT,'UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH') END;
END;

-- Retain every0037 ACL/CAS/quota/namespace/replay guard; only payload key counts
-- allow the strict resolution field. Supplemental guards run before effects.
DROP TRIGGER upload_request_guard;
CREATE TRIGGER upload_request_guard BEFORE INSERT ON upload_requests BEGIN
  SELECT CASE WHEN NEW.actor_id IS NULL OR NEW.request_id IS NULL
    OR NEW.session_id IS NULL OR NEW.upload_session_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      WHERE o.user_id=NEW.actor_id AND o.enabled=1
        AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)
    THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Only V2 reservations require the existing photo to be live before replay.
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_valid(NEW.payload_json)
    AND json_type(NEW.payload_json,'$.versionTarget')='object'
    AND NOT EXISTS(
      SELECT 1 FROM photos ph
      JOIN photo_versions parent
        ON parent.id=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId')
        AND parent.workspace_id=ph.workspace_id AND parent.photo_id=ph.id
      JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
      JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
      JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
        AND a.workspace_id=ph.workspace_id
      WHERE ph.id=json_extract(NEW.payload_json,'$.versionTarget.photoId')
        AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
        AND ph.album_id=NEW.album_id
        AND a.state NOT IN('archived','deleting','deleted')
        AND p.status NOT IN('archived','deleting','deleted'))
    THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c
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
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
      AND (r.operation<>NEW.operation OR r.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
    THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN NEW.operation='upload.reserved' AND (
    NEW.workspace_id IS NULL OR NEW.project_id IS NULL OR NEW.album_id IS NULL
    OR NEW.storage_node_id<>'primary'
    OR NEW.object_key<>NEW.workspace_id||'/'||NEW.project_id||'/'||NEW.album_id||'/'||NEW.upload_session_id||'/original'
    OR NEW.original_filename IS NULL OR length(NEW.original_filename) NOT BETWEEN 1 AND 255
    OR NEW.expected_bytes IS NULL OR NEW.expected_bytes<=0
    OR NEW.expected_bytes>5363466240
    OR NOT json_valid(NEW.payload_json) OR json_type(NEW.payload_json)<>'object')
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved' AND (
    json_type(NEW.payload_json,'$.workspaceId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.workspaceId')<>NEW.workspace_id
    OR json_type(NEW.payload_json,'$.projectId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.projectId')<>NEW.project_id
    OR json_type(NEW.payload_json,'$.albumId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.albumId')<>NEW.album_id
    OR json_type(NEW.payload_json,'$.originalFilename') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.originalFilename')<>NEW.original_filename
    OR json_type(NEW.payload_json,'$.expectedBytes') IS NOT 'integer'
    OR json_extract(NEW.payload_json,'$.expectedBytes')<>NEW.expected_bytes
    OR json_type(NEW.payload_json,'$.contentType') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.contentType') NOT IN('image/jpeg','image/png','image/webp')
    OR json_type(NEW.payload_json,'$.sha256') IS NOT 'text'
    OR length(json_extract(NEW.payload_json,'$.sha256'))<>64
    OR json_extract(NEW.payload_json,'$.sha256') GLOB '*[^0-9a-f]*')
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NULL
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>7+CASE WHEN json_type(NEW.payload_json,'$.resolution') IS NOT NULL THEN 1 ELSE 0 END
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>8+CASE WHEN json_type(NEW.payload_json,'$.resolution') IS NOT NULL THEN 1 ELSE 0 END
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND (
      json_type(NEW.payload_json,'$.versionTarget')<>'object'
      OR (SELECT count(*) FROM json_each(NEW.payload_json,'$.versionTarget'))<>7
      OR json_type(NEW.payload_json,'$.versionTarget.photoId') IS NOT 'text'
      OR json_type(NEW.payload_json,'$.versionTarget.parentVersionId') IS NOT 'text'
      OR json_type(NEW.payload_json,'$.versionTarget.expectedRevision') IS NOT 'integer'
      OR json_extract(NEW.payload_json,'$.versionTarget.expectedRevision') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(NEW.payload_json,'$.versionTarget.confirm') IS NOT 'true'
      OR json_extract(NEW.payload_json,'$.versionTarget.confirm')<>1
      OR json_type(NEW.payload_json,'$.versionTarget.changeType') IS NOT 'text'
      OR json_extract(NEW.payload_json,'$.versionTarget.changeType') NOT IN('new_retouch','replace_current')
      OR json_type(NEW.payload_json,'$.versionTarget.changeNote') IS NOT 'text'
      OR length(json_extract(NEW.payload_json,'$.versionTarget.changeNote'))>2000
      OR json_type(NEW.payload_json,'$.versionTarget.labels') IS NOT 'array'
      OR json_array_length(NEW.payload_json,'$.versionTarget.labels')>16
      OR EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.versionTarget.labels') l
        WHERE l.type<>'text' OR length(l.value) NOT BETWEEN 1 AND 40 OR l.value<>trim(l.value))
      OR (SELECT count(*) FROM json_each(NEW.payload_json,'$.versionTarget.labels'))
        <>(SELECT count(DISTINCT value COLLATE BINARY)
          FROM json_each(NEW.payload_json,'$.versionTarget.labels')))
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  -- New reservation CAS; an exact retry returned above keeps its original parent.
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM photos ph
      JOIN photo_version_heads h ON h.photo_id=ph.id
        AND h.workspace_id=ph.workspace_id AND h.project_id=ph.project_id
        AND h.album_id=ph.album_id
      WHERE ph.id=json_extract(NEW.payload_json,'$.versionTarget.photoId')
        AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
        AND ph.album_id=NEW.album_id
        AND h.revision=json_extract(NEW.payload_json,'$.versionTarget.expectedRevision')
        AND h.version_id=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId'))
    THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND json_extract(NEW.payload_json,'$.versionTarget.changeType')='new_retouch'
    AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id
      AND p.workspace_id=NEW.workspace_id
      AND p.versioning_mode IN('manual','auto_filename','assisted'))
    THEN RAISE(ABORT,'VERSIONING_MODE_DISABLED') END;

  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NULL
    AND NOT EXISTS(
      SELECT 1 FROM albums a JOIN projects p
        ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      JOIN workspaces w ON w.id=p.workspace_id
      JOIN storage_nodes n ON n.id=NEW.storage_node_id AND n.status='active'
      WHERE a.id=NEW.album_id AND a.project_id=NEW.project_id
        AND a.workspace_id=NEW.workspace_id
        AND p.status IN('draft','uploading') AND a.state IN('draft','active')
        AND w.owner_user_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND EXISTS(SELECT 1 FROM workspace_storage_usage u
      JOIN workspaces w ON w.id=u.workspace_id
      WHERE u.workspace_id=NEW.workspace_id
        AND u.used_bytes+u.reserved_bytes+NEW.expected_bytes>w.quota_bytes)
    THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND NOT EXISTS(SELECT 1 FROM workspace_storage_usage u
      WHERE u.workspace_id=NEW.workspace_id)
    THEN RAISE(ABORT,'STORAGE_LEDGER_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND NOT EXISTS(SELECT 1 FROM storage_nodes n WHERE n.id=NEW.storage_node_id
      AND n.status='active'
      AND n.used_bytes+n.reserved_bytes+NEW.expected_bytes<=n.quota_bytes)
    THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;

  SELECT CASE WHEN NEW.operation='upload.cancelled' AND (
    NEW.workspace_id IS NOT NULL OR NEW.project_id IS NOT NULL OR NEW.album_id IS NOT NULL
    OR NEW.storage_node_id IS NOT NULL OR NEW.object_key IS NOT NULL
    OR NEW.original_filename IS NOT NULL OR NEW.expected_bytes IS NOT NULL)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status<>'reserved')
    THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status='reserved'
      AND u.expires_at_ms<=NEW.created_at_ms)
    THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND (EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=NEW.upload_session_id)
      OR EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=NEW.upload_session_id))
    THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_authorizations a WHERE a.upload_session_id=NEW.upload_session_id)
    AND NOT EXISTS(SELECT 1 FROM upload_key_fences f JOIN upload_sessions u
      ON u.id=f.upload_session_id WHERE f.upload_session_id=NEW.upload_session_id
      AND f.object_key=u.object_key)
    THEN RAISE(ABORT,'UPLOAD_KEY_NOT_FENCED') END;
END;
