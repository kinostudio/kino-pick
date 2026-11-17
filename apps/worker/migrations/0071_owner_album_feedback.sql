-- Canonical Owner-authored feedback belongs to an album/photo/version, not an invite.
-- Guest-authored content remains in the existing invite-scoped tables.
PRAGMA foreign_keys=ON;

CREATE TABLE album_owner_feedback_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND length(replace(id,'-',''))=32
  ),
  actor_id TEXT NOT NULL REFERENCES users(id),
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
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  feedback_id TEXT NOT NULL CHECK(
    length(feedback_id)=36 AND feedback_id=lower(feedback_id)
    AND feedback_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(feedback_id,9,1)='-' AND substr(feedback_id,14,1)='-'
    AND substr(feedback_id,19,1)='-' AND substr(feedback_id,24,1)='-'
    AND length(replace(feedback_id,'-',''))=32
  ),
  kind TEXT NOT NULL CHECK(kind IN('comment','annotation')),
  operation TEXT NOT NULL CHECK(operation IN(
    'create_comment','update_comment','delete_comment',
    'create_annotation','update_annotation','delete_annotation'
  )),
  expected_revision INTEGER CHECK(
    expected_revision IS NULL OR (typeof(expected_revision)='integer'
      AND expected_revision BETWEEN 1 AND 9007199254740991)
  ),
  body TEXT,
  geometry_json TEXT CHECK(geometry_json IS NULL OR json_valid(geometry_json)),
  style_json TEXT CHECK(style_json IS NULL OR json_valid(style_json)),
  request_json TEXT NOT NULL CHECK(
    json_valid(request_json) AND json_type(request_json)='object'
    AND length(request_json)<=20000
  ),
  created_at_ms INTEGER NOT NULL
    DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(actor_id,request_id),
  UNIQUE(id,feedback_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  CHECK(
    (operation='create_comment' AND kind='comment' AND expected_revision IS NULL
      AND body IS NOT NULL AND geometry_json IS NULL AND style_json IS NULL)
    OR (operation='update_comment' AND kind='comment'
      AND typeof(expected_revision)='integer' AND body IS NOT NULL
      AND geometry_json IS NULL AND style_json IS NULL)
    OR (operation='delete_comment' AND kind='comment'
      AND typeof(expected_revision)='integer' AND body IS NULL
      AND geometry_json IS NULL AND style_json IS NULL)
    OR (operation='create_annotation' AND kind='annotation' AND expected_revision IS NULL
      AND body IS NULL AND geometry_json IS NOT NULL AND style_json IS NOT NULL)
    OR (operation='update_annotation' AND kind='annotation'
      AND typeof(expected_revision)='integer' AND body IS NULL
      AND geometry_json IS NOT NULL AND style_json IS NOT NULL)
    OR (operation='delete_annotation' AND kind='annotation'
      AND typeof(expected_revision)='integer' AND body IS NULL
      AND geometry_json IS NULL AND style_json IS NULL)
  )
);
CREATE UNIQUE INDEX album_owner_feedback_commands_request_ci
  ON album_owner_feedback_commands(actor_id,lower(request_id));

CREATE TABLE album_owner_feedback(
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('comment','annotation')),
  author_user_id TEXT NOT NULL REFERENCES users(id),
  author_label TEXT NOT NULL CHECK(author_label='攝影師'),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  body TEXT,
  geometry_json TEXT CHECK(geometry_json IS NULL OR json_valid(geometry_json)),
  style_json TEXT CHECK(style_json IS NULL OR json_valid(style_json)),
  state TEXT NOT NULL CHECK(state IN('open','deleted')),
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
    (kind='comment' AND ((state='deleted' AND body IS NULL)
      OR (state='open' AND body IS NOT NULL AND geometry_json IS NULL AND style_json IS NULL)))
    OR (kind='annotation' AND ((state='deleted' AND geometry_json IS NULL
      AND style_json IS NULL AND body IS NULL)
      OR (state='open' AND body IS NULL AND geometry_json IS NOT NULL AND style_json IS NOT NULL)))
  ),
  UNIQUE(id,author_user_id,workspace_id,project_id,album_id,photo_id,version_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id),
  FOREIGN KEY(created_command_id,id) REFERENCES album_owner_feedback_commands(id,feedback_id),
  FOREIGN KEY(last_command_id,id) REFERENCES album_owner_feedback_commands(id,feedback_id)
);
CREATE INDEX album_owner_feedback_page
  ON album_owner_feedback(album_id,photo_id,version_id,created_at_ms,id);

CREATE TABLE album_owner_feedback_changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  feedback_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('comment','annotation')),
  operation TEXT NOT NULL CHECK(operation IN(
    'create_comment','update_comment','delete_comment',
    'create_annotation','update_annotation','delete_annotation'
  )),
  revision INTEGER NOT NULL CHECK(
    typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  occurred_at_ms INTEGER NOT NULL CHECK(
    typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991
  ),
  before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'),
  after_json TEXT NOT NULL CHECK(json_valid(after_json) AND json_type(after_json)='object'),
  UNIQUE(feedback_id,revision),
  FOREIGN KEY(command_id,feedback_id)
    REFERENCES album_owner_feedback_commands(id,feedback_id),
  FOREIGN KEY(feedback_id,actor_id,workspace_id,project_id,album_id,photo_id,version_id)
    REFERENCES album_owner_feedback(id,author_user_id,workspace_id,project_id,album_id,photo_id,version_id)
);
CREATE INDEX album_owner_feedback_changes_scope
  ON album_owner_feedback_changes(album_id,photo_id,version_id,seq);

CREATE TABLE album_owner_feedback_results(
  command_id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  feedback_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN(
    'create_comment','update_comment','delete_comment',
    'create_annotation','update_annotation','delete_annotation'
  )),
  result_json TEXT NOT NULL CHECK(
    json_valid(result_json) AND json_type(result_json)='object' AND length(result_json)<=50000
  ),
  occurred_at_ms INTEGER NOT NULL CHECK(
    typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991
  ),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(command_id,feedback_id)
    REFERENCES album_owner_feedback_commands(id,feedback_id)
);
CREATE UNIQUE INDEX album_owner_feedback_results_request_ci
  ON album_owner_feedback_results(actor_id,lower(request_id));

CREATE TRIGGER album_owner_feedback_command_guard
BEFORE INSERT ON album_owner_feedback_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s
      ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM album_owner_feedback_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
      AND (c.request_json<>NEW.request_json OR c.album_id<>NEW.album_id
        OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id
        OR c.feedback_id<>NEW.feedback_id AND c.operation NOT LIKE 'create_%')
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM album_owner_feedback_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN NEW.operation IN('create_comment','create_annotation') AND EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
      AND a.state IN('draft','active')
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=w.id
      AND ph.project_id=p.id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=w.id AND v.photo_id=ph.id
    JOIN photo_version_heads h ON h.photo_id=ph.id AND h.workspace_id=w.id
      AND h.project_id=p.id AND h.album_id=a.id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND h.version_id<>NEW.version_id
  ) THEN RAISE(ABORT,'CURRENT_VERSION_CHANGED') END;

  SELECT CASE WHEN NEW.request_json IS NULL OR NOT json_valid(NEW.request_json)
      OR json_type(NEW.request_json)<>'object'
      OR length(NEW.request_json)>20000
      OR NEW.request_json<>CASE NEW.operation
        WHEN 'create_comment' THEN json_object('requestId',NEW.request_id,'operation',NEW.operation,
          'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,'body',NEW.body)
        WHEN 'update_comment' THEN json_object('requestId',NEW.request_id,'operation',NEW.operation,
          'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
          'feedbackId',NEW.feedback_id,'expectedRevision',NEW.expected_revision,'body',NEW.body)
        WHEN 'delete_comment' THEN json_object('requestId',NEW.request_id,'operation',NEW.operation,
          'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
          'feedbackId',NEW.feedback_id,'expectedRevision',NEW.expected_revision)
        WHEN 'create_annotation' THEN json_object('requestId',NEW.request_id,'operation',NEW.operation,
          'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
          'geometry',json(NEW.geometry_json),'style',json(NEW.style_json))
        WHEN 'update_annotation' THEN json_object('requestId',NEW.request_id,'operation',NEW.operation,
          'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
          'feedbackId',NEW.feedback_id,'expectedRevision',NEW.expected_revision,
          'geometry',json(NEW.geometry_json),'style',json(NEW.style_json))
        ELSE json_object('requestId',NEW.request_id,'operation',NEW.operation,
          'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
          'feedbackId',NEW.feedback_id,'expectedRevision',NEW.expected_revision)
      END
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.operation IN('create_comment','update_comment') AND (
      NEW.body IS NULL OR length(NEW.body) NOT BETWEEN 1 AND 2000
      OR NEW.body<>trim(NEW.body)
      OR instr(NEW.body,char(0))<>0
      OR NEW.body GLOB '*[' || char(1) || '-' || char(8) || char(11) || char(12)
        || char(14) || '-' || char(31) || char(127) || '-' || char(159) || ']*'
    ) THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.operation IN('create_annotation','update_annotation') AND
      COALESCE((
    (
      json_type(NEW.geometry_json)='object'
      AND json_extract(NEW.geometry_json,'$.type')='point'
      AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
      AND json_type(NEW.geometry_json,'$.x')='integer'
      AND json_type(NEW.geometry_json,'$.y')='integer'
      AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
      AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
      AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
    ) OR (
      json_type(NEW.geometry_json)='object'
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
    ) OR (
      json_type(NEW.geometry_json)='object'
      AND json_extract(NEW.geometry_json,'$.type')='freehand'
      AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
      AND json_type(NEW.geometry_json,'$.version')='integer'
      AND json_extract(NEW.geometry_json,'$.version')=1
      AND json_type(NEW.geometry_json,'$.points')='array'
      AND json_array_length(NEW.geometry_json,'$.points') BETWEEN 2 AND 256
      AND length(CAST(NEW.geometry_json AS BLOB))<=8192
      AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
      AND NOT EXISTS(
        SELECT 1 FROM json_each(NEW.geometry_json,'$.points') AS point
        WHERE point.type<>'object' OR (SELECT count(*) FROM json_each(point.value))<>2
          OR json_type(point.value,'$.x')<>'integer' OR json_type(point.value,'$.y')<>'integer'
          OR COALESCE(json_extract(point.value,'$.x'),-1) NOT BETWEEN 0 AND 1000000
          OR COALESCE(json_extract(point.value,'$.y'),-1) NOT BETWEEN 0 AND 1000000
      )
      AND NOT EXISTS(
        SELECT 1 FROM json_each(NEW.geometry_json,'$.points') AS next_point
        JOIN json_each(NEW.geometry_json,'$.points') AS previous_point
          ON CAST(previous_point.key AS INTEGER)=CAST(next_point.key AS INTEGER)-1
        WHERE json_extract(previous_point.value,'$.x')=json_extract(next_point.value,'$.x')
          AND json_extract(previous_point.value,'$.y')=json_extract(next_point.value,'$.y')
      )
    )
  ),0)=0 THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation IN('create_annotation','update_annotation') AND
      COALESCE((
      json_type(NEW.style_json)='object' AND (SELECT count(*) FROM json_each(NEW.style_json))=1
      AND json_type(NEW.style_json,'$.color')='text'
      AND json_extract(NEW.style_json,'$.color') IN('amber','red','blue')
    ),0)=0 THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM workspaces w
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
      AND a.state IN('draft','active')
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=w.id
      AND ph.project_id=p.id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=w.id
      AND v.photo_id=ph.id
    JOIN guest_comment_eligible_versions ev ON ev.version_id=v.id
      AND ev.workspace_id=w.id AND ev.photo_id=ph.id AND ev.project_id=p.id AND ev.album_id=a.id
    WHERE w.owner_user_id=NEW.actor_id AND w.id=NEW.workspace_id
      AND p.id=NEW.project_id AND a.id=NEW.album_id AND ph.id=NEW.photo_id
      AND v.id=NEW.version_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN NEW.operation IN('create_comment','create_annotation') AND NOT EXISTS(
    SELECT 1 FROM photo_version_heads h WHERE h.photo_id=NEW.photo_id
      AND h.workspace_id=NEW.workspace_id AND h.project_id=NEW.project_id
      AND h.album_id=NEW.album_id AND h.version_id=NEW.version_id
  ) THEN RAISE(ABORT,'CURRENT_VERSION_CHANGED') END;

  SELECT CASE WHEN NEW.operation IN('update_comment','delete_comment',
      'update_annotation','delete_annotation') AND NOT EXISTS(
    SELECT 1 FROM album_owner_feedback f
    WHERE f.id=NEW.feedback_id AND f.author_user_id=NEW.actor_id
      AND f.workspace_id=NEW.workspace_id AND f.project_id=NEW.project_id
      AND f.album_id=NEW.album_id AND f.photo_id=NEW.photo_id
      AND f.version_id=NEW.version_id AND f.kind=NEW.kind
      AND f.revision=NEW.expected_revision AND f.revision<9007199254740991
      AND f.state='open'
  ) THEN RAISE(ABORT,'FEEDBACK_REVISION_CONFLICT') END;
END;

CREATE TRIGGER album_owner_feedback_insert_guard
BEFORE INSERT ON album_owner_feedback BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM album_owner_feedback_commands c
    WHERE c.id=NEW.created_command_id AND c.id=NEW.last_command_id
      AND c.feedback_id=NEW.id AND c.actor_id=NEW.author_user_id
      AND c.kind=NEW.kind AND c.operation IN('create_comment','create_annotation')
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND NEW.author_label='攝影師' AND NEW.state='open' AND NEW.revision=1
      AND NEW.created_at_ms=c.created_at_ms AND NEW.updated_at_ms=c.created_at_ms
      AND NEW.created_session_id=c.session_id AND NEW.last_session_id=c.session_id
      AND NEW.created_request_id=c.request_id AND NEW.last_request_id=c.request_id
      AND ((c.kind='comment' AND NEW.body=c.body
          AND NEW.geometry_json IS NULL AND NEW.style_json IS NULL)
        OR (c.kind='annotation' AND NEW.body IS NULL
          AND NEW.geometry_json=c.geometry_json AND NEW.style_json=c.style_json))
  ) THEN RAISE(ABORT,'FEEDBACK_NOT_AUTHORIZED') END;
END;

CREATE TRIGGER album_owner_feedback_update_guard
BEFORE UPDATE ON album_owner_feedback BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind
      OR NEW.author_user_id<>OLD.author_user_id OR NEW.workspace_id<>OLD.workspace_id
      OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id
      OR NEW.photo_id<>OLD.photo_id OR NEW.version_id<>OLD.version_id
      OR NEW.author_label<>OLD.author_label
      OR NEW.created_at_ms<>OLD.created_at_ms OR NEW.created_session_id<>OLD.created_session_id
      OR NEW.created_request_id<>OLD.created_request_id OR NEW.created_command_id<>OLD.created_command_id
      OR NEW.revision<>OLD.revision+1 OR NEW.updated_at_ms<OLD.updated_at_ms
    THEN RAISE(ABORT,'IMMUTABLE_FEEDBACK_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM album_owner_feedback_commands c
    WHERE c.id=NEW.last_command_id AND c.feedback_id=NEW.id
      AND c.actor_id=NEW.author_user_id AND c.expected_revision=OLD.revision
      AND c.kind=NEW.kind AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND NEW.last_session_id=c.session_id AND NEW.last_request_id=c.request_id
      AND NEW.updated_at_ms=c.created_at_ms
      AND ((c.operation='update_comment' AND c.kind='comment'
          AND NEW.state='open' AND NEW.body=c.body
          AND NEW.geometry_json IS NULL AND NEW.style_json IS NULL)
        OR (c.operation='delete_comment' AND c.kind='comment'
          AND NEW.state='deleted' AND NEW.body IS NULL
          AND NEW.geometry_json IS NULL AND NEW.style_json IS NULL)
        OR (c.operation='update_annotation' AND c.kind='annotation'
          AND NEW.state='open' AND NEW.body IS NULL
          AND NEW.geometry_json=c.geometry_json AND NEW.style_json=c.style_json)
        OR (c.operation='delete_annotation' AND c.kind='annotation'
          AND NEW.state='deleted' AND NEW.body IS NULL
          AND NEW.geometry_json IS NULL AND NEW.style_json IS NULL))
  ) THEN RAISE(ABORT,'FEEDBACK_NOT_AUTHORIZED') END;
END;
CREATE TRIGGER album_owner_feedback_no_delete
BEFORE DELETE ON album_owner_feedback BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FEEDBACK_TOMBSTONE');
END;

CREATE TRIGGER album_owner_feedback_command_apply
AFTER INSERT ON album_owner_feedback_commands BEGIN
  INSERT INTO album_owner_feedback(
    id,kind,author_user_id,author_label,workspace_id,project_id,album_id,photo_id,version_id,
    body,geometry_json,style_json,state,revision,created_at_ms,updated_at_ms,
    created_session_id,created_request_id,created_command_id,last_session_id,last_request_id,last_command_id
  ) SELECT NEW.feedback_id,NEW.kind,NEW.actor_id,'攝影師',NEW.workspace_id,NEW.project_id,
    NEW.album_id,NEW.photo_id,NEW.version_id,NEW.body,NEW.geometry_json,NEW.style_json,'open',1,
    NEW.created_at_ms,NEW.created_at_ms,NEW.session_id,NEW.request_id,NEW.id,
    NEW.session_id,NEW.request_id,NEW.id
  WHERE NEW.operation IN('create_comment','create_annotation');

  UPDATE album_owner_feedback SET
    body=CASE WHEN NEW.operation='update_comment' THEN NEW.body
      WHEN NEW.operation='delete_comment' THEN NULL ELSE body END,
    geometry_json=CASE WHEN NEW.operation='update_annotation' THEN NEW.geometry_json
      WHEN NEW.operation='delete_annotation' THEN NULL ELSE geometry_json END,
    style_json=CASE WHEN NEW.operation='update_annotation' THEN NEW.style_json
      WHEN NEW.operation='delete_annotation' THEN NULL ELSE style_json END,
    state=CASE WHEN NEW.operation IN('delete_comment','delete_annotation') THEN 'deleted' ELSE 'open' END,
    revision=revision+1,updated_at_ms=NEW.created_at_ms,
    last_session_id=NEW.session_id,last_request_id=NEW.request_id,last_command_id=NEW.id
  WHERE id=NEW.feedback_id AND NEW.operation IN(
    'update_comment','delete_comment','update_annotation','delete_annotation'
  );

  INSERT INTO album_owner_feedback_changes(
    event_id,command_id,request_id,actor_id,session_id,workspace_id,project_id,album_id,
    photo_id,version_id,feedback_id,kind,operation,revision,occurred_at_ms,before_json,after_json
  ) SELECT NEW.id,NEW.id,NEW.request_id,NEW.actor_id,NEW.session_id,NEW.workspace_id,
    NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,NEW.feedback_id,NEW.kind,
    NEW.operation,f.revision,NEW.created_at_ms,
    COALESCE((SELECT previous.after_json FROM album_owner_feedback_changes previous
      WHERE previous.feedback_id=NEW.feedback_id ORDER BY previous.revision DESC LIMIT 1),'{}'),
    CASE f.kind
      WHEN 'comment' THEN json_object('id',f.id,'kind',f.kind,'scope',json_object('kind','album'),
        'albumId',f.album_id,'photoId',f.photo_id,'versionId',f.version_id,'revision',f.revision,
        'state',f.state,'authorType','owner','authorLabel',f.author_label,'body',f.body,
        'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.created_at_ms/1000.0,'unixepoch'),
        'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.updated_at_ms/1000.0,'unixepoch'))
      ELSE json_object('id',f.id,'kind',f.kind,'scope',json_object('kind','album'),
        'albumId',f.album_id,'photoId',f.photo_id,'versionId',f.version_id,'revision',f.revision,
        'state',f.state,'authorType','owner','authorLabel',f.author_label,
        'geometry',json(f.geometry_json),'style',json(f.style_json),
        'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.created_at_ms/1000.0,'unixepoch'),
        'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.updated_at_ms/1000.0,'unixepoch'))
    END
  FROM album_owner_feedback f WHERE f.id=NEW.feedback_id;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,
    album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  ) SELECT NEW.id,'user',NEW.actor_id,NEW.session_id,NULL,NEW.workspace_id,NEW.project_id,
    NEW.album_id,NEW.photo_id,NEW.version_id,
    CASE WHEN NEW.operation LIKE 'create_%' THEN 'owner.album_feedback_created'
      WHEN NEW.operation LIKE 'delete_%' THEN 'owner.album_feedback_deleted'
      ELSE 'owner.album_feedback_updated' END,
    ch.before_json,ch.after_json,NEW.request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM album_owner_feedback_changes ch WHERE ch.command_id=NEW.id;

  INSERT INTO album_owner_feedback_results(
    command_id,actor_id,request_id,workspace_id,project_id,album_id,photo_id,version_id,
    feedback_id,operation,result_json,occurred_at_ms
  ) SELECT NEW.id,NEW.actor_id,NEW.request_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    NEW.photo_id,NEW.version_id,NEW.feedback_id,NEW.operation,
    json_object('requestId',NEW.request_id,'operation',NEW.operation,
      'item',json(ch.after_json),
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    NEW.created_at_ms
  FROM album_owner_feedback_changes ch WHERE ch.command_id=NEW.id;
END;

CREATE TRIGGER album_owner_feedback_commands_no_update
BEFORE UPDATE ON album_owner_feedback_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FEEDBACK_COMMAND');
END;
CREATE TRIGGER album_owner_feedback_commands_no_delete
BEFORE DELETE ON album_owner_feedback_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FEEDBACK_COMMAND');
END;
CREATE TRIGGER album_owner_feedback_changes_insert_guard
BEFORE INSERT ON album_owner_feedback_changes BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM album_owner_feedback_commands c
    JOIN album_owner_feedback f ON f.id=NEW.feedback_id AND f.last_command_id=c.id
    WHERE c.id=NEW.command_id AND c.feedback_id=NEW.feedback_id
      AND c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.session_id=NEW.session_id AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND c.kind=NEW.kind AND c.operation=NEW.operation
      AND f.revision=NEW.revision AND f.updated_at_ms=NEW.occurred_at_ms
      AND NEW.event_id=c.id
      AND NEW.before_json=COALESCE((SELECT previous.after_json
        FROM album_owner_feedback_changes previous
        WHERE previous.feedback_id=NEW.feedback_id AND previous.revision<NEW.revision
        ORDER BY previous.revision DESC LIMIT 1),'{}')
      AND NEW.after_json=CASE f.kind
        WHEN 'comment' THEN json_object('id',f.id,'kind',f.kind,'scope',json_object('kind','album'),
          'albumId',f.album_id,'photoId',f.photo_id,'versionId',f.version_id,'revision',f.revision,
          'state',f.state,'authorType','owner','authorLabel',f.author_label,'body',f.body,
          'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.created_at_ms/1000.0,'unixepoch'),
          'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.updated_at_ms/1000.0,'unixepoch'))
        ELSE json_object('id',f.id,'kind',f.kind,'scope',json_object('kind','album'),
          'albumId',f.album_id,'photoId',f.photo_id,'versionId',f.version_id,'revision',f.revision,
          'state',f.state,'authorType','owner','authorLabel',f.author_label,
          'geometry',json(f.geometry_json),'style',json(f.style_json),
          'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.created_at_ms/1000.0,'unixepoch'),
          'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',f.updated_at_ms/1000.0,'unixepoch'))
      END
  ) THEN RAISE(ABORT,'FEEDBACK_CHANGE_NOT_AUTHORIZED') END;
END;
CREATE TRIGGER album_owner_feedback_changes_no_update
BEFORE UPDATE ON album_owner_feedback_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FEEDBACK_CHANGE');
END;
CREATE TRIGGER album_owner_feedback_changes_no_delete
BEFORE DELETE ON album_owner_feedback_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FEEDBACK_CHANGE');
END;
CREATE TRIGGER album_owner_feedback_results_insert_guard
BEFORE INSERT ON album_owner_feedback_results BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM album_owner_feedback_commands c
    JOIN album_owner_feedback_changes ch ON ch.command_id=c.id AND ch.feedback_id=c.feedback_id
    WHERE c.id=NEW.command_id AND c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND c.feedback_id=NEW.feedback_id AND c.operation=NEW.operation
      AND c.created_at_ms=NEW.occurred_at_ms
      AND NEW.result_json=json_object('requestId',c.request_id,'operation',c.operation,
        'item',json(ch.after_json),
        'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'))
  ) THEN RAISE(ABORT,'FEEDBACK_RESULT_NOT_AUTHORIZED') END;
END;
CREATE TRIGGER album_owner_feedback_results_no_update
BEFORE UPDATE ON album_owner_feedback_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FEEDBACK_RESULT');
END;
CREATE TRIGGER album_owner_feedback_results_no_delete
BEFORE DELETE ON album_owner_feedback_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FEEDBACK_RESULT');
END;
