-- Owner-authored annotations are a separate immutable command namespace.
-- Owner access is retained by the exact sealed invitation scope, regardless of
-- Guest expiry, revocation, or permission changes. This migration is additive.
PRAGMA foreign_keys=ON;

-- Preserve case-folded lookup for the prior Owner command namespace. Historical
-- request IDs stay untouched; new commands are canonical lowercase UUIDs.
CREATE INDEX owner_annotation_ns_case_owner_comment_processing
  ON owner_comment_processing_commands(actor_id,lower(request_id));

CREATE TABLE owner_annotation_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32
  ),
  actor_id TEXT NOT NULL REFERENCES users(id),
  expected_owner_id TEXT NOT NULL CHECK(
    expected_owner_id=actor_id
    AND length(expected_owner_id)=36
    AND expected_owner_id NOT GLOB '*[^0-9A-Fa-f-]*'
    AND substr(expected_owner_id,9,1)='-'
    AND substr(expected_owner_id,14,1)='-'
    AND substr(expected_owner_id,19,1)='-'
    AND substr(expected_owner_id,24,1)='-'
    AND length(replace(expected_owner_id,'-',''))=32
  ),
  -- Owner session rows are transient authentication state, not durable provenance.
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND request_id=lower(request_id)
    AND request_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
  ),
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL CHECK(
    length(annotation_id)=36
    AND annotation_id NOT GLOB '*[^0-9A-Fa-f-]*'
    AND substr(annotation_id,9,1)='-' AND substr(annotation_id,14,1)='-'
    AND substr(annotation_id,19,1)='-' AND substr(annotation_id,24,1)='-'
    AND length(replace(annotation_id,'-',''))=32
  ),
  operation TEXT NOT NULL CHECK(operation IN('create','update','delete','resolve','reopen')),
  expected_revision INTEGER CHECK(
    expected_revision IS NULL OR (typeof(expected_revision)='integer'
      AND expected_revision BETWEEN 1 AND 9007199254740991)
  ),
  geometry_json TEXT CHECK(geometry_json IS NULL OR json_valid(geometry_json)),
  style_json TEXT CHECK(style_json IS NULL OR json_valid(style_json)),
  linked_comment_id TEXT CHECK(linked_comment_id IS NULL OR (
    length(linked_comment_id)=36
    AND linked_comment_id NOT GLOB '*[^0-9A-Fa-f-]*'
    AND substr(linked_comment_id,9,1)='-'
    AND substr(linked_comment_id,14,1)='-'
    AND substr(linked_comment_id,19,1)='-'
    AND substr(linked_comment_id,24,1)='-'
    AND length(replace(linked_comment_id,'-',''))=32
  )),
  request_json TEXT NOT NULL CHECK(
    json_valid(request_json) AND json_type(request_json)='object'
    AND length(request_json)<=20000
  ),
  created_at_ms INTEGER NOT NULL
    DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(actor_id,request_id),
  UNIQUE(id,annotation_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(linked_comment_id) REFERENCES guest_comments(id),
  CHECK(
    (operation='create' AND expected_revision IS NULL
      AND geometry_json IS NOT NULL AND style_json IS NOT NULL)
    OR (operation='update' AND typeof(expected_revision)='integer'
      AND expected_revision BETWEEN 1 AND 9007199254740991
      AND geometry_json IS NOT NULL AND style_json IS NOT NULL)
    OR (operation IN('delete','resolve','reopen')
      AND typeof(expected_revision)='integer'
      AND expected_revision BETWEEN 1 AND 9007199254740991
      AND geometry_json IS NULL AND style_json IS NULL
      AND linked_comment_id IS NULL)
  ),
  CHECK(
    (operation='create' AND request_json=json_object(
      'requestId',request_id,'expectedOwnerId',expected_owner_id,
      'operation','create','inviteId',invite_id,'photoId',photo_id,
      'versionId',version_id,'geometry',json(geometry_json),
      'style',json(style_json),'commentId',linked_comment_id))
    OR (operation='update' AND request_json=json_object(
      'requestId',request_id,'expectedOwnerId',expected_owner_id,
      'operation','update','inviteId',invite_id,'photoId',photo_id,
      'versionId',version_id,'annotationId',annotation_id,
      'expectedRevision',expected_revision,'geometry',json(geometry_json),
      'style',json(style_json),'commentId',linked_comment_id))
    OR (operation IN('delete','resolve','reopen') AND request_json=json_object(
      'requestId',request_id,'expectedOwnerId',expected_owner_id,
      'operation',operation,'inviteId',invite_id,'photoId',photo_id,
      'versionId',version_id,'annotationId',annotation_id,
      'expectedRevision',expected_revision))
  )
);
CREATE UNIQUE INDEX owner_annotation_commands_request_ci
  ON owner_annotation_commands(actor_id,lower(request_id));
CREATE INDEX owner_annotation_commands_target
  ON owner_annotation_commands(invite_id,album_id,photo_id,version_id,annotation_id,created_at_ms);

CREATE TABLE owner_annotations(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32
  ),
  author_user_id TEXT NOT NULL REFERENCES users(id),
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  author_label TEXT NOT NULL CHECK(author_label='攝影師'),
  geometry_json TEXT CHECK(geometry_json IS NULL OR json_valid(geometry_json)),
  style_json TEXT CHECK(style_json IS NULL OR json_valid(style_json)),
  linked_comment_id TEXT REFERENCES guest_comments(id),
  state TEXT NOT NULL CHECK(state IN('open','resolved','deleted')),
  revision INTEGER NOT NULL CHECK(
    typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  created_at_ms INTEGER NOT NULL CHECK(
    typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991
  ),
  updated_at_ms INTEGER NOT NULL CHECK(
    typeof(updated_at_ms)='integer'
    AND updated_at_ms BETWEEN created_at_ms AND 9007199254740991
  ),
  created_session_id TEXT NOT NULL,
  created_request_id TEXT NOT NULL,
  created_command_id TEXT NOT NULL,
  last_session_id TEXT NOT NULL,
  last_request_id TEXT NOT NULL,
  last_command_id TEXT NOT NULL,
  CHECK(
    (state='deleted' AND geometry_json IS NULL AND style_json IS NULL
      AND linked_comment_id IS NULL)
    OR (state<>'deleted' AND geometry_json IS NOT NULL AND style_json IS NOT NULL)
  ),
  UNIQUE(id,invite_id,author_user_id,workspace_id,project_id,album_id,photo_id,version_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(created_command_id,id) REFERENCES owner_annotation_commands(id,annotation_id),
  FOREIGN KEY(last_command_id,id) REFERENCES owner_annotation_commands(id,annotation_id)
);
CREATE INDEX owner_annotations_shared_page
  ON owner_annotations(invite_id,album_id,photo_id,version_id,created_at_ms,id);
CREATE INDEX owner_annotations_own_page
  ON owner_annotations(author_user_id,invite_id,album_id,photo_id,version_id,created_at_ms,id);

CREATE TABLE owner_annotation_changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  expected_owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('create','update','delete','resolve','reopen')),
  revision INTEGER NOT NULL CHECK(
    typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  occurred_at_ms INTEGER NOT NULL CHECK(
    typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991
  ),
  before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'),
  after_json TEXT NOT NULL CHECK(json_valid(after_json) AND json_type(after_json)='object'),
  UNIQUE(annotation_id,revision),
  FOREIGN KEY(command_id,annotation_id)
    REFERENCES owner_annotation_commands(id,annotation_id),
  FOREIGN KEY(annotation_id,invite_id,actor_id,workspace_id,project_id,album_id,photo_id,version_id)
    REFERENCES owner_annotations(id,invite_id,author_user_id,workspace_id,project_id,album_id,photo_id,version_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX owner_annotation_changes_scope
  ON owner_annotation_changes(invite_id,album_id,photo_id,version_id,seq);
CREATE INDEX owner_annotation_changes_own_scope
  ON owner_annotation_changes(actor_id,invite_id,album_id,photo_id,version_id,seq);
CREATE INDEX owner_annotation_changes_command
  ON owner_annotation_changes(command_id,seq);

CREATE TABLE owner_annotation_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES owner_annotation_commands(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  expected_owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('create','update','delete','resolve','reopen')),
  result_json TEXT NOT NULL CHECK(
    json_valid(result_json) AND json_type(result_json)='object' AND length(result_json)<=50000
  ),
  occurred_at_ms INTEGER NOT NULL CHECK(
    typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991
  ),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE UNIQUE INDEX owner_annotation_results_request_ci
  ON owner_annotation_results(actor_id,lower(request_id));

CREATE TRIGGER owner_annotation_command_insert_guard
BEFORE INSERT ON owner_annotation_commands BEGIN
  SELECT CASE WHEN NEW.expected_owner_id<>NEW.actor_id
    THEN RAISE(ABORT,'OWNER_IDENTITY_CHANGED') END;
  SELECT CASE WHEN NEW.id IS NULL OR length(NEW.id)<>36 OR NEW.id<>lower(NEW.id)
      OR NEW.id GLOB '*[^0-9a-f-]*'
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.request_id IS NULL OR length(NEW.request_id)<>36
      OR NEW.request_id<>lower(NEW.request_id)
      OR NEW.request_id GLOB '*[^0-9a-f-]*'
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation NOT IN('create','update','delete','resolve','reopen')
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.request_json IS NULL OR NOT json_valid(NEW.request_json)
      OR json_type(NEW.request_json)<>'object' OR length(NEW.request_json)>20000
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Current Owner identity, active project/album, sealed invite ownership,
  -- exact album membership, photo and any owned version are required for replay too.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.workspace_id=w.id AND p.id=NEW.project_id
    JOIN albums a ON a.workspace_id=w.id AND a.project_id=p.id AND a.id=NEW.album_id
    JOIN guest_invites i ON i.workspace_id=w.id AND i.project_id=p.id
      AND i.id=NEW.invite_id AND i.created_by=o.user_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
      AND ia.project_id=p.id AND ia.album_id=a.id
    JOIN photos ph ON ph.workspace_id=w.id AND ph.project_id=p.id
      AND ph.album_id=a.id AND ph.id=NEW.photo_id
    JOIN photo_versions v ON v.workspace_id=w.id AND v.photo_id=ph.id
      AND v.id=NEW.version_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND i.id=NEW.invite_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.workspace_id=w.id AND p.id=NEW.project_id
    JOIN albums a ON a.workspace_id=w.id AND a.project_id=p.id AND a.id=NEW.album_id
    JOIN guest_invites i ON i.workspace_id=w.id AND i.project_id=p.id
      AND i.id=NEW.invite_id AND i.created_by=o.user_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
      AND ia.project_id=p.id AND ia.album_id=a.id
    JOIN photos ph ON ph.workspace_id=w.id AND ph.project_id=p.id
      AND ph.album_id=a.id AND ph.id=NEW.photo_id
    JOIN photo_versions v ON v.workspace_id=w.id AND v.photo_id=ph.id
      AND v.id=NEW.version_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND i.id=NEW.invite_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN NEW.operation<>'create' AND NOT EXISTS(
    SELECT 1 FROM owner_annotations a
    WHERE a.id=NEW.annotation_id AND a.author_user_id=NEW.actor_id
      AND a.invite_id=NEW.invite_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND a.album_id=NEW.album_id
      AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  -- Validate the exact command body and nested schemas before replay lookup.
  SELECT CASE WHEN NOT (
    (NEW.operation IN('create','update') AND (
      (json_type(NEW.geometry_json)='object'
        AND json_extract(NEW.geometry_json,'$.type')='point'
        AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
        AND json_type(NEW.geometry_json,'$.x')='integer'
        AND json_type(NEW.geometry_json,'$.y')='integer'
        AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
        AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
        AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
        AND NEW.geometry_json=json_object('type','point','coordinateSpace','normalized_1e6',
          'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y')))
      OR (json_type(NEW.geometry_json)='object'
        AND json_extract(NEW.geometry_json,'$.type')='rectangle'
        AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
        AND json_type(NEW.geometry_json,'$.x')='integer'
        AND json_type(NEW.geometry_json,'$.y')='integer'
        AND json_type(NEW.geometry_json,'$.width')='integer'
        AND json_type(NEW.geometry_json,'$.height')='integer'
        AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
        AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
        AND json_extract(NEW.geometry_json,'$.width') BETWEEN 1 AND 1000000
        AND json_extract(NEW.geometry_json,'$.height') BETWEEN 1 AND 1000000
        AND json_extract(NEW.geometry_json,'$.x')+json_extract(NEW.geometry_json,'$.width')<=1000000
        AND json_extract(NEW.geometry_json,'$.y')+json_extract(NEW.geometry_json,'$.height')<=1000000
        AND (SELECT count(*) FROM json_each(NEW.geometry_json))=6
        AND NEW.geometry_json=json_object('type','rectangle','coordinateSpace','normalized_1e6',
          'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y'),
          'width',json_extract(NEW.geometry_json,'$.width'),
          'height',json_extract(NEW.geometry_json,'$.height')))
    )
    AND json_type(NEW.style_json)='object'
    AND (SELECT count(*) FROM json_each(NEW.style_json))=1
    AND json_type(NEW.style_json,'$.color')='text'
    AND json_extract(NEW.style_json,'$.color') IN('amber','red','blue')
    AND NEW.style_json=json_object('color',json_extract(NEW.style_json,'$.color'))
    AND (
      (NEW.operation='create' AND NEW.request_json=json_object(
        'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
        'operation','create','inviteId',NEW.invite_id,'photoId',NEW.photo_id,
        'versionId',NEW.version_id,'geometry',json(NEW.geometry_json),
        'style',json(NEW.style_json),'commentId',NEW.linked_comment_id))
      OR (NEW.operation='update' AND NEW.request_json=json_object(
        'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
        'operation','update','inviteId',NEW.invite_id,'photoId',NEW.photo_id,
        'versionId',NEW.version_id,'annotationId',NEW.annotation_id,
        'expectedRevision',NEW.expected_revision,'geometry',json(NEW.geometry_json),
        'style',json(NEW.style_json),'commentId',NEW.linked_comment_id))
    )
    OR (NEW.operation IN('delete','resolve','reopen') AND NEW.request_json=json_object(
      'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
      'operation',NEW.operation,'inviteId',NEW.invite_id,'photoId',NEW.photo_id,
      'versionId',NEW.version_id,'annotationId',NEW.annotation_id,
      'expectedRevision',NEW.expected_revision))
  )) THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  -- Reauthorize base scope above, but permit a fresh opaque session to recover the
  -- exact original command/result without requiring its historical session row.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.expected_owner_id<>NEW.expected_owner_id
        OR c.operation<>NEW.operation OR c.invite_id<>NEW.invite_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.request_json<>NEW.request_json
        OR c.expected_revision IS NOT NEW.expected_revision
        OR c.geometry_json IS NOT NEW.geometry_json OR c.style_json IS NOT NEW.style_json
        OR c.linked_comment_id IS NOT NEW.linked_comment_id
        OR (NEW.operation<>'create' AND c.annotation_id<>NEW.annotation_id))
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  -- Preserve the 17-ledger case-insensitive Owner request namespace.
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
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_commands c WHERE c.id=NEW.id
  ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_COMMAND') END;
  SELECT CASE WHEN NEW.operation='create' AND (
    EXISTS(SELECT 1 FROM owner_annotations a WHERE a.id=NEW.annotation_id)
    OR EXISTS(SELECT 1 FROM guest_annotations g WHERE g.id=NEW.annotation_id)
  ) THEN RAISE(ABORT,'ANNOTATION_ID_COLLISION') END;

  SELECT CASE WHEN NEW.operation IN('create','update') AND NEW.linked_comment_id IS NOT NULL
      AND NOT EXISTS(
        SELECT 1 FROM guest_comments g WHERE g.id=NEW.linked_comment_id
          AND g.invite_id=NEW.invite_id AND g.workspace_id=NEW.workspace_id
          AND g.project_id=NEW.project_id AND g.album_id=NEW.album_id
          AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
          AND g.state='open' AND g.body IS NOT NULL
      )
    THEN RAISE(ABORT,'ANNOTATION_COMMENT_UNAVAILABLE') END;

  SELECT CASE WHEN NEW.operation='create'
      AND (SELECT count(*) FROM guest_annotations g
        WHERE g.invite_id=NEW.invite_id AND g.photo_id=NEW.photo_id
          AND g.version_id=NEW.version_id)
        + (SELECT count(*) FROM owner_annotations a
        WHERE a.invite_id=NEW.invite_id AND a.photo_id=NEW.photo_id
          AND a.version_id=NEW.version_id)>=1000
    THEN RAISE(ABORT,'ANNOTATION_LIMIT_REACHED') END;

  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen')
      AND EXISTS(SELECT 1 FROM owner_annotations a WHERE a.id=NEW.annotation_id
        AND a.revision=NEW.expected_revision AND a.revision>=9007199254740991)
    THEN RAISE(ABORT,'ANNOTATION_REVISION_EXHAUSTED') END;
  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen')
      AND NOT EXISTS(
        SELECT 1 FROM owner_annotations a WHERE a.id=NEW.annotation_id
          AND a.author_user_id=NEW.actor_id AND a.invite_id=NEW.invite_id
          AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
          AND a.album_id=NEW.album_id AND a.photo_id=NEW.photo_id
          AND a.version_id=NEW.version_id AND a.revision=NEW.expected_revision
          AND a.revision<9007199254740991
          AND ((NEW.operation='update' AND a.state='open')
            OR (NEW.operation='delete' AND a.state IN('open','resolved'))
            OR (NEW.operation='resolve' AND a.state='open')
            OR (NEW.operation='reopen' AND a.state='resolved'))
      )
    THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_annotation_insert_guard
BEFORE INSERT ON owner_annotations BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_annotations a WHERE a.id=NEW.id)
      OR EXISTS(SELECT 1 FROM guest_annotations g WHERE g.id=NEW.id)
    THEN RAISE(ABORT,'ANNOTATION_ID_COLLISION') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_annotation_commands c
    WHERE c.id=NEW.created_command_id AND c.id=NEW.last_command_id
      AND c.annotation_id=NEW.id AND c.operation='create'
      AND c.actor_id=NEW.author_user_id AND c.expected_owner_id=NEW.author_user_id
      AND c.invite_id=NEW.invite_id AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND NEW.author_label='攝影師'
      AND NEW.created_at_ms=c.created_at_ms AND NEW.updated_at_ms=c.created_at_ms
      AND NEW.created_session_id=c.session_id AND NEW.created_request_id=c.request_id
      AND NEW.last_session_id=c.session_id AND NEW.last_request_id=c.request_id
      AND NEW.revision=1 AND NEW.state='open'
      AND NEW.geometry_json=c.geometry_json AND NEW.style_json=c.style_json
      AND NEW.linked_comment_id IS c.linked_comment_id
  ) THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_PROJECTION') END;
  SELECT CASE WHEN
    (SELECT count(*) FROM guest_annotations g WHERE g.invite_id=NEW.invite_id
      AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id)
    + (SELECT count(*) FROM owner_annotations a WHERE a.invite_id=NEW.invite_id
      AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id)>=1000
    THEN RAISE(ABORT,'ANNOTATION_LIMIT_REACHED') END;
END;

CREATE TRIGGER owner_annotation_change_insert_guard
BEFORE INSERT ON owner_annotation_changes BEGIN
  SELECT CASE WHEN NEW.event_id IS NULL OR EXISTS(
    SELECT 1 FROM owner_annotation_changes x
    WHERE x.event_id=NEW.event_id OR (NEW.seq IS NOT NULL AND x.seq=NEW.seq)
      OR (x.annotation_id=NEW.annotation_id AND x.revision=NEW.revision)
  ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_CHANGE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_annotation_commands cmd
    JOIN owner_annotations a ON a.id=NEW.annotation_id
    WHERE cmd.id=NEW.command_id AND cmd.annotation_id=NEW.annotation_id
      AND cmd.actor_id=NEW.actor_id AND cmd.expected_owner_id=NEW.expected_owner_id
      AND cmd.session_id=NEW.session_id AND cmd.request_id=NEW.request_id
      AND cmd.invite_id=NEW.invite_id AND cmd.workspace_id=NEW.workspace_id
      AND cmd.project_id=NEW.project_id AND cmd.album_id=NEW.album_id
      AND cmd.photo_id=NEW.photo_id AND cmd.version_id=NEW.version_id
      AND cmd.operation=NEW.operation AND cmd.created_at_ms=NEW.occurred_at_ms
      AND a.author_user_id=NEW.actor_id AND a.invite_id=NEW.invite_id
      AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
      AND a.album_id=NEW.album_id AND a.photo_id=NEW.photo_id
      AND a.version_id=NEW.version_id
      AND NEW.event_id='owner-annotation:'||NEW.annotation_id||':'||NEW.revision
      AND (
        (cmd.operation='create' AND NEW.revision=1 AND a.revision=1
          AND a.last_command_id=cmd.id AND a.state='open'
          AND NEW.before_json=json_object(
            'annotationId',a.id,'ownerId',a.author_user_id,
            'inviteId',a.invite_id,'workspaceId',a.workspace_id,
            'projectId',a.project_id,'albumId',a.album_id,
            'photoId',a.photo_id,'versionId',a.version_id,
            'revision',0,'state',NULL,'geometry',NULL,'style',NULL,'commentId',NULL,
            'authorType','owner','authorLabel','攝影師',
            'createdAtMs',NULL,'updatedAtMs',NULL)
          AND NEW.after_json=json_object(
            'annotationId',a.id,'ownerId',a.author_user_id,
            'inviteId',a.invite_id,'workspaceId',a.workspace_id,
            'projectId',a.project_id,'albumId',a.album_id,
            'photoId',a.photo_id,'versionId',a.version_id,
            'revision',a.revision,'state',a.state,'geometry',json(a.geometry_json),
            'style',json(a.style_json),'commentId',a.linked_comment_id,
            'authorType','owner','authorLabel',a.author_label,
            'createdAtMs',a.created_at_ms,'updatedAtMs',a.updated_at_ms))
        OR (cmd.operation<>'create' AND NEW.revision=a.revision+1
          AND cmd.expected_revision=a.revision AND a.last_command_id<>cmd.id
          AND NEW.before_json=json_object(
            'annotationId',a.id,'ownerId',a.author_user_id,
            'inviteId',a.invite_id,'workspaceId',a.workspace_id,
            'projectId',a.project_id,'albumId',a.album_id,
            'photoId',a.photo_id,'versionId',a.version_id,
            'revision',a.revision,'state',a.state,'geometry',json(a.geometry_json),
            'style',json(a.style_json),'commentId',a.linked_comment_id,
            'authorType','owner','authorLabel',a.author_label,
            'createdAtMs',a.created_at_ms,'updatedAtMs',a.updated_at_ms)
          AND NEW.after_json=json_object(
            'annotationId',a.id,'ownerId',a.author_user_id,
            'inviteId',a.invite_id,'workspaceId',a.workspace_id,
            'projectId',a.project_id,'albumId',a.album_id,
            'photoId',a.photo_id,'versionId',a.version_id,
            'revision',a.revision+1,
            'state',CASE WHEN cmd.operation='delete' THEN 'deleted'
              WHEN cmd.operation='resolve' THEN 'resolved'
              WHEN cmd.operation='reopen' THEN 'open' ELSE a.state END,
            'geometry',json(CASE WHEN cmd.operation='delete' THEN 'null'
              WHEN cmd.operation='update' THEN cmd.geometry_json ELSE a.geometry_json END),
            'style',json(CASE WHEN cmd.operation='delete' THEN 'null'
              WHEN cmd.operation='update' THEN cmd.style_json ELSE a.style_json END),
            'commentId',CASE WHEN cmd.operation='delete' THEN NULL
              WHEN cmd.operation='update' THEN cmd.linked_comment_id ELSE a.linked_comment_id END,
            'authorType','owner','authorLabel',a.author_label,
            'createdAtMs',a.created_at_ms,'updatedAtMs',cmd.created_at_ms)
          AND ((cmd.operation='update' AND a.state='open'
              AND cmd.geometry_json IS NOT NULL AND cmd.style_json IS NOT NULL)
            OR (cmd.operation='delete' AND a.state IN('open','resolved')
              AND a.geometry_json IS NOT NULL AND a.style_json IS NOT NULL)
            OR (cmd.operation='resolve' AND a.state='open'
              AND a.geometry_json IS NOT NULL AND a.style_json IS NOT NULL)
            OR (cmd.operation='reopen' AND a.state='resolved'
              AND a.geometry_json IS NOT NULL AND a.style_json IS NOT NULL)))
      )
  ) THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_CHANGE') END;
END;
CREATE TRIGGER owner_annotation_changes_no_update
BEFORE UPDATE ON owner_annotation_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_CHANGE');
END;
CREATE TRIGGER owner_annotation_changes_no_delete
BEFORE DELETE ON owner_annotation_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_CHANGE');
END;

CREATE TRIGGER owner_annotation_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action IN('owner.annotation_created','owner.annotation_updated',
  'owner.annotation_deleted','owner.annotation_resolved','owner.annotation_reopened')
BEGIN
  SELECT CASE WHEN NEW.actor_type<>'user' OR NEW.session_id IS NULL
      OR NEW.guest_session_id IS NOT NULL OR NOT EXISTS(
        SELECT 1 FROM owner_annotation_changes ch
        WHERE ch.event_id=NEW.event_id
          AND NEW.action=CASE ch.operation
            WHEN 'create' THEN 'owner.annotation_created'
            WHEN 'update' THEN 'owner.annotation_updated'
            WHEN 'delete' THEN 'owner.annotation_deleted'
            WHEN 'resolve' THEN 'owner.annotation_resolved'
            WHEN 'reopen' THEN 'owner.annotation_reopened' END
          AND NEW.actor_id=ch.actor_id AND NEW.session_id=ch.session_id
          AND NEW.workspace_id=ch.workspace_id AND NEW.project_id=ch.project_id
          AND NEW.album_id=ch.album_id AND NEW.photo_id=ch.photo_id
          AND NEW.version_id=ch.version_id
          AND NEW.before_json=ch.before_json AND NEW.after_json=ch.after_json
          AND NEW.request_id=ch.request_id
          AND NEW.occurred_at_utc=strftime(
            '%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
      )
    THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_AUDIT') END;
END;

CREATE TRIGGER owner_annotation_update_guard
BEFORE UPDATE ON owner_annotations BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.author_user_id<>OLD.author_user_id
      OR NEW.invite_id<>OLD.invite_id OR NEW.author_label<>OLD.author_label
      OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
      OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id
      OR NEW.version_id<>OLD.version_id OR NEW.created_at_ms<>OLD.created_at_ms
      OR NEW.created_session_id<>OLD.created_session_id
      OR NEW.created_request_id<>OLD.created_request_id
      OR NEW.created_command_id<>OLD.created_command_id
    THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_SCOPE') END;
  SELECT CASE WHEN NEW.revision<>OLD.revision+1
      OR NEW.revision>9007199254740991 OR NEW.updated_at_ms<OLD.updated_at_ms
      OR NOT EXISTS(
        SELECT 1 FROM owner_annotation_changes ch
        JOIN owner_annotation_commands cmd ON cmd.id=ch.command_id
        WHERE ch.annotation_id=OLD.id AND ch.revision=NEW.revision
          AND ch.command_id=NEW.last_command_id AND cmd.annotation_id=OLD.id
          AND cmd.actor_id=OLD.author_user_id AND cmd.expected_owner_id=OLD.author_user_id
          AND cmd.operation<>'create' AND cmd.request_json=json(cmd.request_json)
          AND json_extract(cmd.request_json,'$.annotationId')=OLD.id
          AND json_extract(cmd.request_json,'$.expectedRevision')=OLD.revision
          AND ch.session_id=NEW.last_session_id AND ch.request_id=NEW.last_request_id
          AND ch.invite_id=NEW.invite_id AND ch.actor_id=NEW.author_user_id
          AND ch.workspace_id=NEW.workspace_id AND ch.project_id=NEW.project_id
          AND ch.album_id=NEW.album_id AND ch.photo_id=NEW.photo_id
          AND ch.version_id=NEW.version_id AND ch.occurred_at_ms=NEW.updated_at_ms
          AND ch.before_json=json_object(
            'annotationId',OLD.id,'ownerId',OLD.author_user_id,
            'inviteId',OLD.invite_id,'workspaceId',OLD.workspace_id,
            'projectId',OLD.project_id,'albumId',OLD.album_id,
            'photoId',OLD.photo_id,'versionId',OLD.version_id,
            'revision',OLD.revision,'state',OLD.state,
            'geometry',json(OLD.geometry_json),'style',json(OLD.style_json),
            'commentId',OLD.linked_comment_id,'authorType','owner',
            'authorLabel',OLD.author_label,'createdAtMs',OLD.created_at_ms,
            'updatedAtMs',OLD.updated_at_ms)
          AND ch.after_json=json_object(
            'annotationId',NEW.id,'ownerId',NEW.author_user_id,
            'inviteId',NEW.invite_id,'workspaceId',NEW.workspace_id,
            'projectId',NEW.project_id,'albumId',NEW.album_id,
            'photoId',NEW.photo_id,'versionId',NEW.version_id,
            'revision',NEW.revision,'state',NEW.state,
            'geometry',json(NEW.geometry_json),'style',json(NEW.style_json),
            'commentId',NEW.linked_comment_id,'authorType','owner',
            'authorLabel',NEW.author_label,'createdAtMs',NEW.created_at_ms,
            'updatedAtMs',NEW.updated_at_ms)
          AND ((cmd.operation='update' AND OLD.state='open'
              AND NEW.state='open' AND NEW.geometry_json=cmd.geometry_json
              AND NEW.style_json=cmd.style_json
              AND NEW.linked_comment_id IS cmd.linked_comment_id)
            OR (cmd.operation='delete' AND OLD.state IN('open','resolved')
              AND NEW.state='deleted' AND NEW.geometry_json IS NULL
              AND NEW.style_json IS NULL AND NEW.linked_comment_id IS NULL)
            OR (cmd.operation='resolve' AND OLD.state='open' AND NEW.state='resolved'
              AND NEW.geometry_json IS OLD.geometry_json
              AND NEW.style_json IS OLD.style_json
              AND NEW.linked_comment_id IS OLD.linked_comment_id)
            OR (cmd.operation='reopen' AND OLD.state='resolved' AND NEW.state='open'
              AND NEW.geometry_json IS OLD.geometry_json
              AND NEW.style_json IS OLD.style_json
              AND NEW.linked_comment_id IS OLD.linked_comment_id))
      )
    THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_PREDECESSOR') END;
END;
CREATE TRIGGER owner_annotations_no_delete
BEFORE DELETE ON owner_annotations BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION');
END;

CREATE TRIGGER owner_annotation_result_insert_guard
BEFORE INSERT ON owner_annotation_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM owner_annotation_results r WHERE r.command_id=NEW.command_id
      OR (r.actor_id=NEW.actor_id AND lower(r.request_id)=lower(NEW.request_id))
  ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_annotation_commands c
    JOIN owner_annotations a ON a.id=c.annotation_id AND a.last_command_id=c.id
    JOIN owner_annotation_changes ch ON ch.command_id=c.id
      AND ch.annotation_id=a.id AND ch.revision=a.revision
    WHERE c.id=NEW.command_id AND c.actor_id=NEW.actor_id
      AND c.expected_owner_id=NEW.expected_owner_id
      AND c.request_id=NEW.request_id AND c.invite_id=NEW.invite_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.version_id AND c.annotation_id=NEW.annotation_id
      AND c.operation=NEW.operation AND NEW.occurred_at_ms=c.created_at_ms
      AND a.author_user_id=c.actor_id AND a.invite_id=c.invite_id
      AND a.workspace_id=c.workspace_id AND a.project_id=c.project_id
      AND a.album_id=c.album_id AND a.photo_id=c.photo_id
      AND a.version_id=c.version_id
      AND a.revision=CASE WHEN c.operation='create' THEN 1 ELSE c.expected_revision+1 END
      AND ch.request_id=c.request_id AND ch.actor_id=c.actor_id
      AND ch.expected_owner_id=c.expected_owner_id AND ch.session_id=c.session_id
      AND ch.operation=c.operation AND ch.occurred_at_ms=c.created_at_ms
      AND NEW.result_json=json_object(
        'ownerId',c.actor_id,'requestId',c.request_id,'operation',c.operation,
        'item',json_object('annotationId',a.id,'inviteId',a.invite_id,
          'photoId',a.photo_id,'versionId',a.version_id,'revision',a.revision,
          'geometry',json(a.geometry_json),'style',json(a.style_json),
          'commentId',a.linked_comment_id,'state',a.state,
          'authorType','owner','authorLabel',a.author_label,'canEdit',json('true'),
          'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at_ms/1000.0,'unixepoch'),
          'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.updated_at_ms/1000.0,'unixepoch')),
        'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'))
  ) THEN RAISE(ABORT,'INVALID_OWNER_ANNOTATION_RESULT') END;
END;
CREATE TRIGGER owner_annotation_results_no_update
BEFORE UPDATE ON owner_annotation_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_RESULT');
END;
CREATE TRIGGER owner_annotation_results_no_delete
BEFORE DELETE ON owner_annotation_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_RESULT');
END;

CREATE TRIGGER owner_annotations_insert_witness AFTER INSERT ON owner_annotations BEGIN
  INSERT INTO owner_annotation_changes(
    event_id,command_id,request_id,actor_id,expected_owner_id,session_id,
    invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    annotation_id,operation,revision,occurred_at_ms,before_json,after_json
  )
  SELECT 'owner-annotation:'||NEW.id||':1',c.id,c.request_id,c.actor_id,
    c.expected_owner_id,c.session_id,c.invite_id,c.workspace_id,c.project_id,
    c.album_id,c.photo_id,c.version_id,NEW.id,'create',1,c.created_at_ms,
    json_object('annotationId',NEW.id,'ownerId',NEW.author_user_id,
      'inviteId',NEW.invite_id,'workspaceId',NEW.workspace_id,
      'projectId',NEW.project_id,'albumId',NEW.album_id,
      'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'revision',0,'state',NULL,'geometry',NULL,'style',NULL,'commentId',NULL,
      'authorType','owner','authorLabel','攝影師',
      'createdAtMs',NULL,'updatedAtMs',NULL),
    json_object('annotationId',NEW.id,'ownerId',NEW.author_user_id,
      'inviteId',NEW.invite_id,'workspaceId',NEW.workspace_id,
      'projectId',NEW.project_id,'albumId',NEW.album_id,
      'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'revision',1,'state',NEW.state,'geometry',json(NEW.geometry_json),
      'style',json(NEW.style_json),'commentId',NEW.linked_comment_id,
      'authorType','owner','authorLabel',NEW.author_label,
      'createdAtMs',NEW.created_at_ms,'updatedAtMs',NEW.updated_at_ms)
  FROM owner_annotation_commands c
  WHERE c.id=NEW.last_command_id AND c.annotation_id=NEW.id
    AND c.operation='create';

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,
    workspace_id,project_id,album_id,photo_id,version_id,
    action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'user',ch.actor_id,NULL,ch.session_id,
    ch.workspace_id,ch.project_id,ch.album_id,ch.photo_id,ch.version_id,
    'owner.annotation_created',ch.before_json,ch.after_json,ch.request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM owner_annotation_changes ch
  WHERE ch.command_id=NEW.last_command_id AND ch.annotation_id=NEW.id AND ch.revision=1;
END;

CREATE TRIGGER owner_annotations_update_witness AFTER UPDATE ON owner_annotations BEGIN
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,
    workspace_id,project_id,album_id,photo_id,version_id,
    action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'user',ch.actor_id,NULL,ch.session_id,
    ch.workspace_id,ch.project_id,ch.album_id,ch.photo_id,ch.version_id,
    CASE ch.operation WHEN 'update' THEN 'owner.annotation_updated'
      WHEN 'delete' THEN 'owner.annotation_deleted'
      WHEN 'resolve' THEN 'owner.annotation_resolved'
      WHEN 'reopen' THEN 'owner.annotation_reopened' END,
    ch.before_json,ch.after_json,ch.request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM owner_annotation_changes ch
  WHERE ch.command_id=NEW.last_command_id
    AND ch.annotation_id=NEW.id AND ch.revision=NEW.revision;
END;

-- One immutable insert atomically applies the projection, witnesses, audit, and receipt.
CREATE TRIGGER owner_annotation_command_apply
AFTER INSERT ON owner_annotation_commands BEGIN
  INSERT INTO owner_annotations(
    id,author_user_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    author_label,geometry_json,style_json,linked_comment_id,state,revision,
    created_at_ms,updated_at_ms,created_session_id,created_request_id,created_command_id,
    last_session_id,last_request_id,last_command_id
  )
  SELECT NEW.annotation_id,NEW.actor_id,NEW.invite_id,NEW.workspace_id,NEW.project_id,
    NEW.album_id,NEW.photo_id,NEW.version_id,'攝影師',NEW.geometry_json,NEW.style_json,
    NEW.linked_comment_id,'open',1,NEW.created_at_ms,NEW.created_at_ms,
    NEW.session_id,NEW.request_id,NEW.id,NEW.session_id,NEW.request_id,NEW.id
  WHERE NEW.operation='create';

  INSERT INTO owner_annotation_changes(
    event_id,command_id,request_id,actor_id,expected_owner_id,session_id,
    invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    annotation_id,operation,revision,occurred_at_ms,before_json,after_json
  )
  SELECT 'owner-annotation:'||a.id||':'||(a.revision+1),NEW.id,NEW.request_id,
    NEW.actor_id,NEW.expected_owner_id,NEW.session_id,NEW.invite_id,NEW.workspace_id,
    NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,a.id,NEW.operation,
    a.revision+1,NEW.created_at_ms,
    json_object('annotationId',a.id,'ownerId',a.author_user_id,
      'inviteId',a.invite_id,'workspaceId',a.workspace_id,
      'projectId',a.project_id,'albumId',a.album_id,
      'photoId',a.photo_id,'versionId',a.version_id,
      'revision',a.revision,'state',a.state,'geometry',json(a.geometry_json),
      'style',json(a.style_json),'commentId',a.linked_comment_id,
      'authorType','owner','authorLabel',a.author_label,
      'createdAtMs',a.created_at_ms,'updatedAtMs',a.updated_at_ms),
    json_object('annotationId',a.id,'ownerId',a.author_user_id,
      'inviteId',a.invite_id,'workspaceId',a.workspace_id,
      'projectId',a.project_id,'albumId',a.album_id,
      'photoId',a.photo_id,'versionId',a.version_id,
      'revision',a.revision+1,
      'state',CASE WHEN NEW.operation='delete' THEN 'deleted'
        WHEN NEW.operation='resolve' THEN 'resolved'
        WHEN NEW.operation='reopen' THEN 'open' ELSE a.state END,
      'geometry',json(CASE WHEN NEW.operation='delete' THEN 'null'
        WHEN NEW.operation='update' THEN NEW.geometry_json ELSE a.geometry_json END),
      'style',json(CASE WHEN NEW.operation='delete' THEN 'null'
        WHEN NEW.operation='update' THEN NEW.style_json ELSE a.style_json END),
      'commentId',CASE WHEN NEW.operation='delete' THEN NULL
        WHEN NEW.operation='update' THEN NEW.linked_comment_id ELSE a.linked_comment_id END,
      'authorType','owner','authorLabel',a.author_label,
      'createdAtMs',a.created_at_ms,'updatedAtMs',NEW.created_at_ms)
  FROM owner_annotations a WHERE NEW.operation<>'create' AND a.id=NEW.annotation_id;

  UPDATE owner_annotations
  SET geometry_json=CASE WHEN NEW.operation='delete' THEN NULL
        WHEN NEW.operation='update' THEN NEW.geometry_json ELSE geometry_json END,
      style_json=CASE WHEN NEW.operation='delete' THEN NULL
        WHEN NEW.operation='update' THEN NEW.style_json ELSE style_json END,
      linked_comment_id=CASE WHEN NEW.operation='delete' THEN NULL
        WHEN NEW.operation='update' THEN NEW.linked_comment_id ELSE linked_comment_id END,
      state=CASE WHEN NEW.operation='delete' THEN 'deleted'
        WHEN NEW.operation='resolve' THEN 'resolved'
        WHEN NEW.operation='reopen' THEN 'open' ELSE state END,
      revision=revision+1,updated_at_ms=NEW.created_at_ms,
      last_session_id=NEW.session_id,last_request_id=NEW.request_id,
      last_command_id=NEW.id
  WHERE NEW.operation<>'create' AND id=NEW.annotation_id;

  INSERT INTO owner_annotation_results(
    command_id,actor_id,expected_owner_id,request_id,
    invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    annotation_id,operation,result_json,occurred_at_ms
  )
  SELECT c.id,c.actor_id,c.expected_owner_id,c.request_id,
    c.invite_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,
    c.annotation_id,c.operation,
    json_object('ownerId',c.actor_id,'requestId',c.request_id,'operation',c.operation,
      'item',json_object('annotationId',a.id,'inviteId',a.invite_id,
        'photoId',a.photo_id,'versionId',a.version_id,'revision',a.revision,
        'geometry',json(a.geometry_json),'style',json(a.style_json),
        'commentId',a.linked_comment_id,'state',a.state,'authorType','owner',
        'authorLabel',a.author_label,'canEdit',json('true'),
        'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at_ms/1000.0,'unixepoch'),
        'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.updated_at_ms/1000.0,'unixepoch')),
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')),
    c.created_at_ms
  FROM owner_annotation_commands c
  JOIN owner_annotations a ON a.id=c.annotation_id AND a.last_command_id=c.id
  WHERE c.id=NEW.id;
END;

CREATE TRIGGER owner_annotation_commands_no_update
BEFORE UPDATE ON owner_annotation_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_COMMAND');
END;
CREATE TRIGGER owner_annotation_commands_no_delete
BEFORE DELETE ON owner_annotation_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_COMMAND');
END;

-- The Owner projection and Guest projection share one lifetime cap, including
-- tombstones. AFTER INSERT checks close the Guest-side cross-table race atomically.
CREATE TRIGGER guest_annotation_owner_id_collision
AFTER INSERT ON guest_annotations
WHEN EXISTS(SELECT 1 FROM owner_annotations a WHERE a.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'ANNOTATION_ID_COLLISION'); END;
CREATE TRIGGER guest_annotations_combined_lifetime_cap
AFTER INSERT ON guest_annotations
WHEN (SELECT count(*) FROM guest_annotations g
        WHERE g.invite_id=NEW.invite_id AND g.photo_id=NEW.photo_id
          AND g.version_id=NEW.version_id)
    + (SELECT count(*) FROM owner_annotations a
        WHERE a.invite_id=NEW.invite_id AND a.photo_id=NEW.photo_id
          AND a.version_id=NEW.version_id)>1000
BEGIN SELECT RAISE(ABORT,'ANNOTATION_LIMIT_REACHED'); END;

-- Symmetric insertion guards preserve the Owner actor/request namespace if a
-- legacy writer races or inserts a case-variant UUID after a new command.
CREATE TRIGGER owner_annotation_ns_workspace_commands AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_request_commands AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_upload_requests AFTER INSERT ON upload_requests
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_upload_workflow_requests AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_processing_review_commands AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_invite_revocation_commands AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_invite_creation_commands AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_selection_policy_commands AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_selection_policy_configuration_commands AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_shared_review_owner_commands AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_photo_version_head_commands AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_project_versioning_commands AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_owner_comment_commands AFTER INSERT ON owner_comment_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_owner_comment_processing_commands AFTER INSERT ON owner_comment_processing_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_external_intents AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_upload_fences AFTER INSERT ON upload_key_fences
WHEN NEW.actor_type='user' AND EXISTS(
  SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_annotation_ns_selection_reopened AFTER INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' AND EXISTS(
  SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
