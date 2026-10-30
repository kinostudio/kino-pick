-- M3g5: immutable Owner processing decisions for Guest-authored annotations.
-- Processing state is independent from Guest geometry and Guest lifecycle.
PRAGMA foreign_keys=ON;

CREATE TABLE owner_annotation_processing_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32
  ),
  actor_id TEXT NOT NULL REFERENCES users(id),
  expected_owner_id TEXT NOT NULL CHECK(
    expected_owner_id=actor_id AND length(expected_owner_id)=36
    AND expected_owner_id NOT GLOB '*[^0-9A-Fa-f-]*'
    AND substr(expected_owner_id,9,1)='-'
    AND substr(expected_owner_id,14,1)='-'
    AND substr(expected_owner_id,19,1)='-'
    AND substr(expected_owner_id,24,1)='-'
    AND length(replace(expected_owner_id,'-',''))=32
  ),
  -- Owner sessions are transient authentication state, not durable provenance.
  session_id TEXT NOT NULL,
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
  invite_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL CHECK(
    length(annotation_id)=36
    AND annotation_id NOT GLOB '*[^0-9A-Fa-f-]*'
    AND substr(annotation_id,9,1)='-' AND substr(annotation_id,14,1)='-'
    AND substr(annotation_id,19,1)='-' AND substr(annotation_id,24,1)='-'
    AND length(replace(annotation_id,'-',''))=32
  ),
  operation TEXT NOT NULL CHECK(operation='set_processing_state'),
  expected_annotation_revision INTEGER NOT NULL CHECK(
    typeof(expected_annotation_revision)='integer'
    AND expected_annotation_revision BETWEEN 1 AND 9007199254740991
  ),
  expected_processing_revision INTEGER NOT NULL CHECK(
    typeof(expected_processing_revision)='integer'
    AND expected_processing_revision BETWEEN 0 AND 9007199254740991
  ),
  state TEXT NOT NULL CHECK(state IN('open','in_progress','resolved')),
  -- Internal source watermark. This value is derived by the Worker and excluded
  -- from request_json; it pins content history without retaining Guest geometry.
  content_revision INTEGER NOT NULL CHECK(
    typeof(content_revision)='integer'
    AND content_revision BETWEEN 1 AND expected_annotation_revision
  ),
  request_json TEXT NOT NULL CHECK(
    json_valid(request_json) AND json_type(request_json)='object'
    AND length(request_json)<=20000
  ),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(actor_id,request_id),
  UNIQUE(id,annotation_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(annotation_id) REFERENCES guest_annotations(id),
  CHECK(request_json=json_object(
    'requestId',request_id,'expectedOwnerId',expected_owner_id,
    'operation','set_processing_state','inviteId',invite_id,
    'photoId',photo_id,'versionId',version_id,'annotationId',annotation_id,
    'expectedAnnotationRevision',expected_annotation_revision,
    'expectedProcessingRevision',expected_processing_revision,'state',state
  ))
);
CREATE UNIQUE INDEX owner_annotation_processing_commands_request_ci
  ON owner_annotation_processing_commands(actor_id,lower(request_id));
CREATE INDEX owner_annotation_processing_commands_scope
  ON owner_annotation_processing_commands(invite_id,album_id,photo_id,version_id,created_at_ms);

CREATE TABLE owner_annotation_processing_states(
  annotation_id TEXT PRIMARY KEY NOT NULL REFERENCES guest_annotations(id),
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('open','in_progress','resolved')),
  -- Processing revision is independent from the Guest annotation revision.
  revision INTEGER NOT NULL CHECK(
    typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  annotation_revision INTEGER NOT NULL CHECK(
    typeof(annotation_revision)='integer'
    AND annotation_revision BETWEEN 1 AND 9007199254740991
  ),
  content_revision INTEGER NOT NULL CHECK(
    typeof(content_revision)='integer'
    AND content_revision BETWEEN 1 AND annotation_revision
  ),
  updated_at_ms INTEGER NOT NULL CHECK(
    typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 1 AND 9007199254740991
  ),
  last_command_id TEXT NOT NULL UNIQUE REFERENCES owner_annotation_processing_commands(id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX owner_annotation_processing_states_scope
  ON owner_annotation_processing_states(invite_id,album_id,photo_id,version_id,annotation_id);

-- Processing freshness only depends on Guest creates and content updates. Keep
-- the watermark lookup bounded to those immutable rows and ordered by revision.
CREATE INDEX guest_annotation_changes_processing_content
  ON guest_annotation_changes(annotation_id,revision DESC)
  WHERE operation IN('create','update');

CREATE TABLE owner_annotation_processing_changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  expected_owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL REFERENCES guest_annotations(id),
  state TEXT NOT NULL CHECK(state IN('open','in_progress','resolved')),
  revision INTEGER NOT NULL CHECK(
    typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  annotation_revision INTEGER NOT NULL CHECK(
    typeof(annotation_revision)='integer'
    AND annotation_revision BETWEEN 1 AND 9007199254740991
  ),
  content_revision INTEGER NOT NULL CHECK(
    typeof(content_revision)='integer'
    AND content_revision BETWEEN 1 AND annotation_revision
  ),
  occurred_at_ms INTEGER NOT NULL CHECK(
    typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991
  ),
  before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'),
  after_json TEXT NOT NULL CHECK(json_valid(after_json) AND json_type(after_json)='object'),
  UNIQUE(annotation_id,revision),
  FOREIGN KEY(command_id,annotation_id)
    REFERENCES owner_annotation_processing_commands(id,annotation_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX owner_annotation_processing_changes_scope
  ON owner_annotation_processing_changes(invite_id,album_id,photo_id,version_id,seq);
CREATE INDEX owner_annotation_processing_changes_annotation
  ON owner_annotation_processing_changes(annotation_id,revision);

CREATE TABLE owner_annotation_processing_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES owner_annotation_processing_commands(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  expected_owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL REFERENCES guest_annotations(id),
  result_json TEXT NOT NULL CHECK(
    json_valid(result_json) AND json_type(result_json)='object' AND length(result_json)<=20000
  ),
  occurred_at_ms INTEGER NOT NULL CHECK(
    typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991
  ),
  UNIQUE(actor_id,request_id)
);
CREATE UNIQUE INDEX owner_annotation_processing_results_request_ci
  ON owner_annotation_processing_results(actor_id,lower(request_id));

-- A missing Owner row is the synthetic open/revision-zero snapshot. Source content
-- advances on Guest create/update only; Guest resolve/reopen/delete do not stale it.
CREATE VIEW owner_annotation_processing_snapshots AS
SELECT g.id AS annotation_id,g.invite_id,g.workspace_id,g.project_id,g.album_id,
  g.photo_id,g.version_id,COALESCE(s.state,'open') AS state,
  COALESCE(s.revision,0) AS revision,s.annotation_revision,s.content_revision,
  s.updated_at_ms,COALESCE((
    SELECT MAX(ch.revision) FROM guest_annotation_changes ch
    WHERE ch.annotation_id=g.id AND ch.operation IN('create','update')
  ),0) AS current_content_revision,
  CASE WHEN s.annotation_id IS NULL THEN 0
    WHEN s.content_revision<>COALESCE((
      SELECT MAX(ch.revision) FROM guest_annotation_changes ch
      WHERE ch.annotation_id=g.id AND ch.operation IN('create','update')
    ),0) THEN 1 ELSE 0 END AS stale
FROM guest_annotations g
LEFT JOIN owner_annotation_processing_states s ON s.annotation_id=g.id;

CREATE TRIGGER owner_annotation_processing_commands_insert_guard
BEFORE INSERT ON owner_annotation_processing_commands BEGIN
  SELECT CASE WHEN NEW.expected_owner_id<>NEW.actor_id
      OR NEW.id IS NULL OR length(NEW.id)<>36 OR NEW.id<>lower(NEW.id)
      OR NEW.id GLOB '*[^0-9a-f-]*'
      OR NEW.request_id IS NULL OR length(NEW.request_id)<>36
      OR NEW.request_id<>lower(NEW.request_id)
      OR NEW.request_id GLOB '*[^0-9a-f-]*'
      OR NEW.operation<>'set_processing_state'
      OR NEW.state NOT IN('open','in_progress','resolved')
      OR NEW.request_json IS NULL OR NOT json_valid(NEW.request_json)
      OR json_type(NEW.request_json)<>'object' OR length(NEW.request_json)>20000
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.request_json<>json_object(
      'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
      'operation','set_processing_state','inviteId',NEW.invite_id,
      'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'annotationId',NEW.annotation_id,
      'expectedAnnotationRevision',NEW.expected_annotation_revision,
      'expectedProcessingRevision',NEW.expected_processing_revision,'state',NEW.state
    )
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Reauthorize the current Owner session and retained sealed resource scope before
  -- replay. Invitation expiry/revocation and Guest grant bits are intentionally absent.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id
      AND i.project_id=p.id AND i.created_by=o.user_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
      AND ia.project_id=p.id AND ia.album_id=a.id
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=w.id
      AND ph.project_id=p.id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=w.id
      AND v.photo_id=ph.id
    JOIN guest_annotations g ON g.id=NEW.annotation_id AND g.invite_id=i.id
      AND g.workspace_id=w.id AND g.project_id=p.id AND g.album_id=a.id
      AND g.photo_id=ph.id AND g.version_id=v.id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND i.id=NEW.invite_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND g.id=NEW.annotation_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  -- Replay happens before Guest tombstone and either mutable revision check. A fresh
  -- current Owner session can recover the original receipt without the old session row.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_processing_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.expected_owner_id<>NEW.expected_owner_id
        OR c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.invite_id<>NEW.invite_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.annotation_id<>NEW.annotation_id
        OR c.expected_annotation_revision<>NEW.expected_annotation_revision
        OR c.expected_processing_revision<>NEW.expected_processing_revision
        OR c.state<>NEW.state OR c.content_revision<>NEW.content_revision
        OR c.request_json<>NEW.request_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_processing_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  -- Preserve the case-folded namespace across all 18 previous Owner ledgers.
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
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_annotations g
    WHERE g.id=NEW.annotation_id AND g.invite_id=NEW.invite_id
      AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
      AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id
      AND g.version_id=NEW.version_id AND g.state='deleted'
  ) THEN RAISE(ABORT,'ANNOTATION_NOT_EDITABLE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_annotations g
    WHERE g.id=NEW.annotation_id AND g.invite_id=NEW.invite_id
      AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
      AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id
      AND g.version_id=NEW.version_id AND g.revision=NEW.expected_annotation_revision
      AND g.state<>'deleted'
  ) THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
  SELECT CASE WHEN COALESCE((
    SELECT s.revision FROM owner_annotation_processing_states s
    WHERE s.annotation_id=NEW.annotation_id AND s.invite_id=NEW.invite_id
      AND s.workspace_id=NEW.workspace_id AND s.project_id=NEW.project_id
      AND s.album_id=NEW.album_id AND s.photo_id=NEW.photo_id
      AND s.version_id=NEW.version_id
  ),0)<>NEW.expected_processing_revision
    THEN RAISE(ABORT,'ANNOTATION_PROCESSING_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.expected_processing_revision>=9007199254740991
    THEN RAISE(ABORT,'PROCESSING_REVISION_EXHAUSTED') END;
  SELECT CASE WHEN NEW.content_revision<>COALESCE((
      SELECT MAX(ch.revision) FROM guest_annotation_changes ch
      WHERE ch.annotation_id=NEW.annotation_id AND ch.operation IN('create','update')
        AND ch.revision<=NEW.expected_annotation_revision
    ),0)
    OR NEW.content_revision<1 OR NEW.content_revision>NEW.expected_annotation_revision
    THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_annotation_processing_states_insert_guard
BEFORE INSERT ON owner_annotation_processing_states BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_processing_states s WHERE s.annotation_id=NEW.annotation_id
  ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_STATE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_annotation_processing_commands c
    JOIN guest_annotations g ON g.id=c.annotation_id
    WHERE c.id=NEW.last_command_id AND c.operation='set_processing_state'
      AND c.expected_processing_revision=0 AND c.expected_annotation_revision=NEW.annotation_revision
      AND c.content_revision=NEW.content_revision AND c.state=NEW.state
      AND c.created_at_ms=NEW.updated_at_ms AND NEW.revision=1
      AND c.annotation_id=NEW.annotation_id AND c.invite_id=NEW.invite_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND g.invite_id=c.invite_id AND g.workspace_id=c.workspace_id
      AND g.project_id=c.project_id AND g.album_id=c.album_id
      AND g.photo_id=c.photo_id AND g.version_id=c.version_id
      AND g.state<>'deleted' AND g.revision=c.expected_annotation_revision
      AND c.content_revision=COALESCE((
        SELECT MAX(ch.revision) FROM guest_annotation_changes ch
        WHERE ch.annotation_id=c.annotation_id AND ch.operation IN('create','update')
          AND ch.revision<=c.expected_annotation_revision
      ),0)
  ) THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_PROCESSING_STATE') END;
END;

CREATE TRIGGER owner_annotation_processing_states_update_guard
BEFORE UPDATE ON owner_annotation_processing_states BEGIN
  SELECT CASE WHEN NEW.annotation_id<>OLD.annotation_id OR NEW.invite_id<>OLD.invite_id
      OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
      OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id OR NEW.version_id<>OLD.version_id
    THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_SCOPE') END;
  SELECT CASE WHEN OLD.revision>=9007199254740991
      OR NEW.revision<>OLD.revision+1 OR NEW.updated_at_ms<OLD.updated_at_ms
      OR NOT EXISTS(
        SELECT 1 FROM owner_annotation_processing_commands c
        JOIN guest_annotations g ON g.id=c.annotation_id
        WHERE c.id=NEW.last_command_id AND c.operation='set_processing_state'
          AND c.expected_processing_revision=OLD.revision
          AND c.expected_annotation_revision=NEW.annotation_revision
          AND c.content_revision=NEW.content_revision AND c.state=NEW.state
          AND c.created_at_ms=NEW.updated_at_ms AND NEW.revision=c.expected_processing_revision+1
          AND c.annotation_id=NEW.annotation_id AND c.invite_id=NEW.invite_id
          AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
          AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
          AND g.invite_id=c.invite_id AND g.workspace_id=c.workspace_id
          AND g.project_id=c.project_id AND g.album_id=c.album_id
          AND g.photo_id=c.photo_id AND g.version_id=c.version_id
          AND g.state<>'deleted' AND g.revision=c.expected_annotation_revision
          AND c.content_revision=COALESCE((
            SELECT MAX(ch.revision) FROM guest_annotation_changes ch
            WHERE ch.annotation_id=c.annotation_id AND ch.operation IN('create','update')
              AND ch.revision<=c.expected_annotation_revision
          ),0)
      )
    THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_PROCESSING_PREDECESSOR') END;
END;
CREATE TRIGGER owner_annotation_processing_states_no_delete
BEFORE DELETE ON owner_annotation_processing_states BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_STATE');
END;

CREATE TRIGGER owner_annotation_processing_changes_insert_guard
BEFORE INSERT ON owner_annotation_processing_changes BEGIN
  SELECT CASE WHEN NEW.event_id IS NULL OR EXISTS(
    SELECT 1 FROM owner_annotation_processing_changes x
    WHERE x.event_id=NEW.event_id OR (NEW.seq IS NOT NULL AND x.seq=NEW.seq)
      OR (x.annotation_id=NEW.annotation_id AND x.revision=NEW.revision)
  ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_CHANGE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_annotation_processing_commands c
    JOIN owner_annotation_processing_states s ON s.annotation_id=NEW.annotation_id
    JOIN guest_annotations g ON g.id=NEW.annotation_id
    WHERE c.id=NEW.command_id AND c.annotation_id=NEW.annotation_id
      AND c.actor_id=NEW.actor_id AND c.expected_owner_id=NEW.expected_owner_id
      AND c.session_id=NEW.session_id AND c.request_id=NEW.request_id
      AND c.invite_id=NEW.invite_id AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND c.operation='set_processing_state' AND c.state=NEW.state
      AND c.created_at_ms=NEW.occurred_at_ms
      AND s.last_command_id=c.id AND s.invite_id=NEW.invite_id
      AND s.workspace_id=NEW.workspace_id AND s.project_id=NEW.project_id
      AND s.album_id=NEW.album_id AND s.photo_id=NEW.photo_id AND s.version_id=NEW.version_id
      AND s.revision=NEW.revision AND s.revision=c.expected_processing_revision+1
      AND s.annotation_revision=NEW.annotation_revision
      AND s.annotation_revision=c.expected_annotation_revision
      AND s.content_revision=NEW.content_revision AND s.content_revision=c.content_revision
      AND g.invite_id=c.invite_id AND g.workspace_id=c.workspace_id
      AND g.project_id=c.project_id AND g.album_id=c.album_id
      AND g.photo_id=c.photo_id AND g.version_id=c.version_id
      AND g.revision=c.expected_annotation_revision AND g.state<>'deleted'
      AND NEW.event_id='owner-annotation-processing:'||NEW.annotation_id||':'||NEW.revision
      AND NEW.after_json=json_object(
        'ownerId',c.actor_id,'annotationId',s.annotation_id,
        'inviteId',s.invite_id,'workspaceId',s.workspace_id,'projectId',s.project_id,
        'albumId',s.album_id,'photoId',s.photo_id,'versionId',s.version_id,
        'state',s.state,'revision',s.revision,
        'annotationRevision',s.annotation_revision,'contentRevision',s.content_revision,
        'updatedAtMs',s.updated_at_ms)
      AND (
        (c.expected_processing_revision=0 AND s.revision=1
          AND NOT EXISTS(SELECT 1 FROM owner_annotation_processing_changes p
            WHERE p.annotation_id=s.annotation_id)
          AND NEW.before_json=json_object(
            'ownerId',c.actor_id,'annotationId',s.annotation_id,
            'inviteId',s.invite_id,'workspaceId',s.workspace_id,'projectId',s.project_id,
            'albumId',s.album_id,'photoId',s.photo_id,'versionId',s.version_id,
            'state','open','revision',0,'annotationRevision',NULL,
            'contentRevision',NULL,'updatedAtMs',NULL))
        OR (c.expected_processing_revision>0
          AND NEW.before_json=(SELECT p.after_json
            FROM owner_annotation_processing_changes p
            WHERE p.annotation_id=s.annotation_id AND p.revision=s.revision-1))
      )
  ) THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_PROCESSING_CHANGE') END;
END;
CREATE TRIGGER owner_annotation_processing_changes_no_update
BEFORE UPDATE ON owner_annotation_processing_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_CHANGE');
END;
CREATE TRIGGER owner_annotation_processing_changes_no_delete
BEFORE DELETE ON owner_annotation_processing_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_CHANGE');
END;

CREATE TRIGGER owner_annotation_processing_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action='owner.annotation_processing_changed' BEGIN
  SELECT CASE WHEN NEW.actor_type<>'user' OR NEW.session_id IS NULL
      OR NEW.guest_session_id IS NOT NULL OR NOT EXISTS(
        SELECT 1 FROM owner_annotation_processing_changes ch
        WHERE ch.event_id=NEW.event_id
          AND NEW.actor_id=ch.actor_id AND NEW.session_id=ch.session_id
          AND NEW.workspace_id=ch.workspace_id AND NEW.project_id=ch.project_id
          AND NEW.album_id=ch.album_id AND NEW.photo_id=ch.photo_id
          AND NEW.version_id=ch.version_id
          AND NEW.action='owner.annotation_processing_changed'
          AND NEW.before_json=ch.before_json AND NEW.after_json=ch.after_json
          AND NEW.request_id=ch.request_id
          AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
      )
    THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_PROCESSING_AUDIT') END;
END;

CREATE TRIGGER owner_annotation_processing_results_insert_guard
BEFORE INSERT ON owner_annotation_processing_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM owner_annotation_processing_results r
    WHERE r.command_id=NEW.command_id
      OR (r.actor_id=NEW.actor_id AND lower(r.request_id)=lower(NEW.request_id))
  ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_annotation_processing_commands c
    JOIN owner_annotation_processing_states s ON s.annotation_id=c.annotation_id
      AND s.last_command_id=c.id
    JOIN owner_annotation_processing_changes ch ON ch.command_id=c.id
      AND ch.annotation_id=c.annotation_id AND ch.revision=s.revision
    WHERE c.id=NEW.command_id AND c.actor_id=NEW.actor_id
      AND c.expected_owner_id=NEW.expected_owner_id AND c.request_id=NEW.request_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.invite_id=NEW.invite_id
      AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND c.annotation_id=NEW.annotation_id AND c.operation='set_processing_state'
      AND c.created_at_ms=NEW.occurred_at_ms
      AND s.revision=c.expected_processing_revision+1
      AND s.annotation_revision=c.expected_annotation_revision
      AND s.content_revision=c.content_revision AND s.state=c.state
      AND ch.actor_id=c.actor_id AND ch.session_id=c.session_id
      AND ch.request_id=c.request_id AND ch.occurred_at_ms=c.created_at_ms
      AND NEW.result_json=json_object(
        'ownerId',c.actor_id,'requestId',c.request_id,'operation',c.operation,
        'inviteId',c.invite_id,'photoId',c.photo_id,'versionId',c.version_id,
        'annotationId',c.annotation_id,
        'processing',json_object('state',s.state,'revision',s.revision,
          'annotationRevision',s.annotation_revision,'contentRevision',s.content_revision,
          'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch'),
          'stale',json('false')),
        'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'))
  ) THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_PROCESSING_RESULT') END;
END;
CREATE TRIGGER owner_annotation_processing_results_no_update
BEFORE UPDATE ON owner_annotation_processing_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_RESULT');
END;
CREATE TRIGGER owner_annotation_processing_results_no_delete
BEFORE DELETE ON owner_annotation_processing_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_RESULT');
END;

CREATE TRIGGER owner_annotation_processing_states_insert_witness
AFTER INSERT ON owner_annotation_processing_states BEGIN
  INSERT INTO owner_annotation_processing_changes(
    event_id,command_id,actor_id,expected_owner_id,session_id,request_id,
    invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    annotation_id,state,revision,annotation_revision,content_revision,
    occurred_at_ms,before_json,after_json
  )
  SELECT 'owner-annotation-processing:'||NEW.annotation_id||':'||NEW.revision,
    c.id,c.actor_id,c.expected_owner_id,c.session_id,c.request_id,
    c.invite_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,
    NEW.annotation_id,NEW.state,NEW.revision,NEW.annotation_revision,NEW.content_revision,
    c.created_at_ms,
    json_object('ownerId',c.actor_id,'annotationId',NEW.annotation_id,
      'inviteId',NEW.invite_id,'workspaceId',NEW.workspace_id,'projectId',NEW.project_id,
      'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'state','open','revision',0,'annotationRevision',NULL,
      'contentRevision',NULL,'updatedAtMs',NULL),
    json_object('ownerId',c.actor_id,'annotationId',NEW.annotation_id,
      'inviteId',NEW.invite_id,'workspaceId',NEW.workspace_id,'projectId',NEW.project_id,
      'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'state',NEW.state,'revision',NEW.revision,
      'annotationRevision',NEW.annotation_revision,'contentRevision',NEW.content_revision,
      'updatedAtMs',NEW.updated_at_ms)
  FROM owner_annotation_processing_commands c WHERE c.id=NEW.last_command_id;
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,
    workspace_id,project_id,album_id,photo_id,version_id,
    action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'user',ch.actor_id,NULL,ch.session_id,
    ch.workspace_id,ch.project_id,ch.album_id,ch.photo_id,ch.version_id,
    'owner.annotation_processing_changed',ch.before_json,ch.after_json,
    ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM owner_annotation_processing_changes ch
  WHERE ch.annotation_id=NEW.annotation_id AND ch.revision=NEW.revision;
END;

CREATE TRIGGER owner_annotation_processing_states_update_witness
AFTER UPDATE ON owner_annotation_processing_states BEGIN
  INSERT INTO owner_annotation_processing_changes(
    event_id,command_id,actor_id,expected_owner_id,session_id,request_id,
    invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    annotation_id,state,revision,annotation_revision,content_revision,
    occurred_at_ms,before_json,after_json
  )
  SELECT 'owner-annotation-processing:'||NEW.annotation_id||':'||NEW.revision,
    c.id,c.actor_id,c.expected_owner_id,c.session_id,c.request_id,
    c.invite_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,
    NEW.annotation_id,NEW.state,NEW.revision,NEW.annotation_revision,NEW.content_revision,
    c.created_at_ms,
    json_object('ownerId',c.actor_id,'annotationId',OLD.annotation_id,
      'inviteId',OLD.invite_id,'workspaceId',OLD.workspace_id,'projectId',OLD.project_id,
      'albumId',OLD.album_id,'photoId',OLD.photo_id,'versionId',OLD.version_id,
      'state',OLD.state,'revision',OLD.revision,
      'annotationRevision',OLD.annotation_revision,'contentRevision',OLD.content_revision,
      'updatedAtMs',OLD.updated_at_ms),
    json_object('ownerId',c.actor_id,'annotationId',NEW.annotation_id,
      'inviteId',NEW.invite_id,'workspaceId',NEW.workspace_id,'projectId',NEW.project_id,
      'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'state',NEW.state,'revision',NEW.revision,
      'annotationRevision',NEW.annotation_revision,'contentRevision',NEW.content_revision,
      'updatedAtMs',NEW.updated_at_ms)
  FROM owner_annotation_processing_commands c WHERE c.id=NEW.last_command_id;
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,
    workspace_id,project_id,album_id,photo_id,version_id,
    action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'user',ch.actor_id,NULL,ch.session_id,
    ch.workspace_id,ch.project_id,ch.album_id,ch.photo_id,ch.version_id,
    'owner.annotation_processing_changed',ch.before_json,ch.after_json,
    ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM owner_annotation_processing_changes ch
  WHERE ch.annotation_id=NEW.annotation_id AND ch.revision=NEW.revision;
END;

-- An immutable Owner command atomically changes only the processing projection,
-- writes its independent history/audit witness, and records the public receipt.
CREATE TRIGGER owner_annotation_processing_command_apply
AFTER INSERT ON owner_annotation_processing_commands BEGIN
  UPDATE owner_annotation_processing_states SET
    state=NEW.state,revision=NEW.expected_processing_revision+1,
    annotation_revision=NEW.expected_annotation_revision,
    content_revision=NEW.content_revision,updated_at_ms=NEW.created_at_ms,
    last_command_id=NEW.id
  WHERE NEW.expected_processing_revision>0
    AND annotation_id=NEW.annotation_id AND revision=NEW.expected_processing_revision;
  INSERT INTO owner_annotation_processing_states(
    annotation_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    state,revision,annotation_revision,content_revision,updated_at_ms,last_command_id
  )
  SELECT NEW.annotation_id,NEW.invite_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    NEW.photo_id,NEW.version_id,NEW.state,1,NEW.expected_annotation_revision,
    NEW.content_revision,NEW.created_at_ms,NEW.id
  WHERE NEW.expected_processing_revision=0 AND NOT EXISTS(
    SELECT 1 FROM owner_annotation_processing_states s
    WHERE s.annotation_id=NEW.annotation_id
  );
  INSERT INTO owner_annotation_processing_results(
    command_id,actor_id,expected_owner_id,request_id,workspace_id,project_id,
    album_id,invite_id,photo_id,version_id,annotation_id,result_json,occurred_at_ms
  )
  SELECT NEW.id,NEW.actor_id,NEW.expected_owner_id,NEW.request_id,NEW.workspace_id,
    NEW.project_id,NEW.album_id,NEW.invite_id,NEW.photo_id,NEW.version_id,
    NEW.annotation_id,
    json_object('ownerId',NEW.actor_id,'requestId',NEW.request_id,
      'operation',NEW.operation,'inviteId',NEW.invite_id,'photoId',NEW.photo_id,
      'versionId',NEW.version_id,'annotationId',NEW.annotation_id,
      'processing',json_object('state',s.state,'revision',s.revision,
        'annotationRevision',s.annotation_revision,'contentRevision',s.content_revision,
        'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch'),
        'stale',json('false')),
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    NEW.created_at_ms
  FROM owner_annotation_processing_states s
  WHERE s.annotation_id=NEW.annotation_id AND s.last_command_id=NEW.id;
END;

CREATE TRIGGER owner_annotation_processing_commands_no_update
BEFORE UPDATE ON owner_annotation_processing_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_COMMAND');
END;
CREATE TRIGGER owner_annotation_processing_commands_no_delete
BEFORE DELETE ON owner_annotation_processing_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_PROCESSING_COMMAND');
END;

-- New processing request IDs are checked against all 18 earlier Owner ledgers.
-- These lookups use the existing case-folded indexes from 0043-0046.
CREATE TRIGGER owner_annotation_processing_ns_workspace_commands AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_request_commands AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_upload_requests AFTER INSERT ON upload_requests
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_upload_workflow_requests AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_processing_review_commands AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_invite_revocation_commands AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_invite_creation_commands AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_selection_policy_commands AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_selection_policy_configuration_commands AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_shared_review_owner_commands AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_photo_version_head_commands AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_project_versioning_commands AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_owner_comment_commands AFTER INSERT ON owner_comment_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_owner_comment_processing_commands AFTER INSERT ON owner_comment_processing_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_owner_external_intents AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_upload_key_fences AFTER INSERT ON upload_key_fences
WHEN NEW.actor_type='user' AND EXISTS(
  SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_selection_reopened AFTER INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' AND EXISTS(
  SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_processing_ns_owner_annotation_commands AFTER INSERT ON owner_annotation_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
