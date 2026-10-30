-- Guest annotations are version-bound and independently permissioned.
-- Recovery is forward-only: retain command receipts, projection, changes, and audit rows.
-- This migration is additive and does not rewrite prior Guest ledgers.
PRAGMA foreign_keys=ON;

-- Reuse the exact published-ready immutable version definition used by Guest comments.
CREATE VIEW guest_annotation_eligible_versions AS
SELECT version_id,photo_id,workspace_id,project_id,album_id,version_no
FROM guest_comment_eligible_versions;

-- Case-folded lookup indexes preserve historical request UUID aliases in every prior Guest ledger.
CREATE INDEX guest_annotation_ns_guest_selection ON guest_selection_commands(guest_id,lower(request_id));
CREATE INDEX guest_annotation_ns_guest_submissions ON guest_selection_submissions(guest_id,lower(request_id));
CREATE INDEX guest_annotation_ns_guest_logout ON guest_logout_commands(guest_id,lower(request_id));
CREATE INDEX guest_annotation_ns_guest_exchange ON guest_exchange_commands(invite_id,lower(request_id));
CREATE INDEX guest_annotation_ns_guest_feedback ON guest_feedback_commands(guest_id,lower(request_id));
CREATE INDEX guest_annotation_ns_shared_review ON shared_review_guest_commands(guest_id,lower(request_id));
CREATE INDEX guest_annotation_ns_guest_tags ON guest_tag_commands(guest_id,lower(request_id));
CREATE INDEX guest_annotation_ns_guest_comments ON guest_comment_commands(guest_id,lower(request_id));

CREATE TABLE guest_annotation_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-'
    AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32
  ),
  guest_id TEXT NOT NULL,
  expected_guest_id TEXT NOT NULL CHECK(expected_guest_id=guest_id),
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND request_id=lower(request_id) AND request_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
  ),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL CHECK(
    length(annotation_id)=36 AND annotation_id=lower(annotation_id)
    AND annotation_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(annotation_id,9,1)='-' AND substr(annotation_id,14,1)='-'
    AND substr(annotation_id,19,1)='-' AND substr(annotation_id,24,1)='-'
    AND length(replace(annotation_id,'-',''))=32
  ),
  operation TEXT NOT NULL CHECK(operation IN('create','update','delete','resolve','reopen')),
  expected_revision INTEGER,
  geometry_json TEXT CHECK(geometry_json IS NULL OR json_valid(geometry_json)),
  style_json TEXT CHECK(style_json IS NULL OR json_valid(style_json)),
  linked_comment_id TEXT CHECK(linked_comment_id IS NULL OR (
    length(linked_comment_id)=36 AND linked_comment_id NOT GLOB '*[^0-9a-fA-F-]*'
    AND substr(linked_comment_id,9,1)='-' AND substr(linked_comment_id,14,1)='-'
    AND substr(linked_comment_id,19,1)='-' AND substr(linked_comment_id,24,1)='-'
    AND length(replace(linked_comment_id,'-',''))=32
  )),
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json)<=20000),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 9007199254740991),
  UNIQUE(guest_id,request_id),
  UNIQUE(id,annotation_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id),
  CHECK(
    (operation='create' AND expected_revision IS NULL AND geometry_json IS NOT NULL AND style_json IS NOT NULL)
    OR (operation='update' AND typeof(expected_revision)='integer'
      AND expected_revision BETWEEN 1 AND 9007199254740991 AND geometry_json IS NOT NULL AND style_json IS NOT NULL)
    OR (operation IN('delete','resolve','reopen') AND typeof(expected_revision)='integer'
      AND expected_revision BETWEEN 1 AND 9007199254740991 AND geometry_json IS NULL AND style_json IS NULL)
  )
);
CREATE UNIQUE INDEX guest_annotation_commands_request_ci
  ON guest_annotation_commands(guest_id,lower(request_id));
CREATE INDEX guest_annotation_commands_target
  ON guest_annotation_commands(invite_id,album_id,photo_id,version_id,annotation_id,created_at_ms);

CREATE TABLE guest_annotations(
  id TEXT PRIMARY KEY NOT NULL CHECK(
    length(id)=36 AND id=lower(id) AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-'
    AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32
  ),
  author_guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  author_label TEXT NOT NULL CHECK(length(author_label) BETWEEN 1 AND 80),
  geometry_json TEXT CHECK(geometry_json IS NULL OR json_valid(geometry_json)),
  style_json TEXT CHECK(style_json IS NULL OR json_valid(style_json)),
  linked_comment_id TEXT REFERENCES guest_comments(id),
  state TEXT NOT NULL CHECK(state IN('open','resolved','deleted')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'
    AND updated_at_ms BETWEEN created_at_ms AND 9007199254740991),
  last_session_id TEXT NOT NULL,
  last_request_id TEXT NOT NULL,
  last_command_id TEXT NOT NULL,
  CHECK((state='deleted' AND geometry_json IS NULL AND style_json IS NULL AND linked_comment_id IS NULL)
    OR (state<>'deleted' AND geometry_json IS NOT NULL AND style_json IS NOT NULL)),
  UNIQUE(id,invite_id,author_guest_id,workspace_id,project_id,album_id,photo_id,version_id),
  FOREIGN KEY(author_guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(last_session_id,author_guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(last_command_id,id) REFERENCES guest_annotation_commands(id,annotation_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_annotations_page
  ON guest_annotations(invite_id,album_id,photo_id,version_id,created_at_ms,id);
CREATE INDEX guest_annotations_author
  ON guest_annotations(invite_id,author_guest_id,created_at_ms DESC,id DESC);
-- Own-only lists must not scan another photo's or another Guest's history.
CREATE INDEX guest_annotations_own_page
  ON guest_annotations(author_guest_id,invite_id,album_id,photo_id,version_id,created_at_ms,id);

CREATE TABLE guest_annotation_changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  annotation_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('create','update','delete','resolve','reopen')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  occurred_at_ms INTEGER NOT NULL CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 0 AND 9007199254740991),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  UNIQUE(annotation_id,revision),
  FOREIGN KEY(command_id,annotation_id) REFERENCES guest_annotation_commands(id,annotation_id),
  FOREIGN KEY(annotation_id,invite_id,guest_id,workspace_id,project_id,album_id,photo_id,version_id)
    REFERENCES guest_annotations(id,invite_id,author_guest_id,workspace_id,project_id,album_id,photo_id,version_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_annotation_changes_scope
  ON guest_annotation_changes(invite_id,album_id,photo_id,version_id,seq);
-- Empty-author reads must not walk every peer's unbounded revision history.
CREATE INDEX guest_annotation_changes_own_scope
  ON guest_annotation_changes(guest_id,invite_id,album_id,photo_id,version_id,seq);
CREATE INDEX guest_annotation_changes_command
  ON guest_annotation_changes(command_id,seq);

CREATE TABLE guest_annotation_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES guest_annotation_commands(id),
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=20000),
  occurred_at_ms INTEGER NOT NULL CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 0 AND 9007199254740991),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id)
);
CREATE UNIQUE INDEX guest_annotation_results_request_ci
  ON guest_annotation_results(guest_id,lower(request_id));
CREATE TRIGGER guest_annotation_command_guard BEFORE INSERT ON guest_annotation_commands BEGIN
  -- Current session, sealed grant, enabled Owner, active scope, independent annotation right,
  -- and exact immutable published-ready version are checked before every replay lookup.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id
      AND s.secret_hash=NEW.secret_hash AND g.id=NEW.expected_guest_id
      AND NEW.expected_guest_id=NEW.guest_id AND i.workspace_id=NEW.workspace_id
      AND i.project_id=NEW.project_id AND a.id=NEW.album_id
      AND (i.permissions_mask & 128)=128
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
      AND (
        (NEW.operation='create' AND EXISTS(
          SELECT 1 FROM guest_annotation_eligible_versions ev
          WHERE ev.version_id=NEW.version_id AND ev.photo_id=NEW.photo_id
            AND ev.workspace_id=NEW.workspace_id AND ev.project_id=NEW.project_id
            AND ev.album_id=NEW.album_id))
        OR (NEW.operation<>'create' AND EXISTS(
          SELECT 1 FROM guest_annotations current
          JOIN guest_annotation_eligible_versions ev ON ev.version_id=current.version_id
            AND ev.photo_id=current.photo_id AND ev.workspace_id=current.workspace_id
            AND ev.project_id=current.project_id AND ev.album_id=current.album_id
          WHERE current.id=NEW.annotation_id AND current.author_guest_id=NEW.guest_id
            AND current.invite_id=NEW.invite_id AND current.workspace_id=NEW.workspace_id
            AND current.project_id=NEW.project_id AND current.album_id=NEW.album_id
            AND current.photo_id=NEW.photo_id AND current.version_id=NEW.version_id)
        )
      )
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;

  -- Existing ledgers remain authoritative for their guest/request namespace, including
  -- historical uppercase UUID aliases. Authorization above intentionally precedes this check.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c
      WHERE c.invite_id=NEW.invite_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_guest_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_tag_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_comment_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Exact same-session/canonical replay returns the original immutable receipt before
  -- mutable revision, tombstone, or lifetime-cap checks. A different session conflicts.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id
        OR c.annotation_id<>NEW.annotation_id OR c.operation<>NEW.operation
        OR c.expected_revision IS NOT NEW.expected_revision
        OR c.geometry_json IS NOT NEW.geometry_json OR c.style_json IS NOT NEW.style_json
        OR c.linked_comment_id IS NOT NEW.linked_comment_id OR c.request_json<>NEW.request_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_COMMAND') END;

  -- Canonical request key order and exact normalized geometry/style schemas are immutable.
  SELECT CASE WHEN NOT (
    (NEW.operation IN('create','update')
      AND (
        (json_type(NEW.geometry_json)='object'
          AND json_type(NEW.geometry_json,'$.type')='text'
          AND json_type(NEW.geometry_json,'$.coordinateSpace')='text'
          AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
          AND json_type(NEW.geometry_json,'$.x')='integer'
          AND json_type(NEW.geometry_json,'$.y')='integer'
          AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
          AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
          AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
          AND json_extract(NEW.geometry_json,'$.type')='point'
          AND NEW.geometry_json=json_object('type','point','coordinateSpace','normalized_1e6',
            'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y')))
        OR (json_type(NEW.geometry_json)='object'
          AND json_type(NEW.geometry_json,'$.type')='text'
          AND json_type(NEW.geometry_json,'$.coordinateSpace')='text'
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
          AND json_extract(NEW.geometry_json,'$.type')='rectangle'
          AND NEW.geometry_json=json_object('type','rectangle','coordinateSpace','normalized_1e6',
            'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y'),
            'width',json_extract(NEW.geometry_json,'$.width'),'height',json_extract(NEW.geometry_json,'$.height')))
      )
      AND json_type(NEW.style_json)='object'
      AND (SELECT count(*) FROM json_each(NEW.style_json))=1
      AND json_type(NEW.style_json,'$.color')='text'
      AND json_extract(NEW.style_json,'$.color') IN('amber','red','blue')
      AND NEW.style_json=json_object('color',json_extract(NEW.style_json,'$.color'))
      AND NEW.linked_comment_id IS json_extract(NEW.request_json,'$.commentId')
      AND (
        (NEW.operation='create' AND NEW.request_json=json_object(
          'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,'operation','create',
          'photoId',NEW.photo_id,'versionId',NEW.version_id,'geometry',json(NEW.geometry_json),
          'style',json(NEW.style_json),'commentId',NEW.linked_comment_id))
        OR (NEW.operation='update' AND NEW.request_json=json_object(
          'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,'operation','update',
          'annotationId',NEW.annotation_id,'expectedRevision',NEW.expected_revision,
          'geometry',json(NEW.geometry_json),'style',json(NEW.style_json),
          'commentId',NEW.linked_comment_id))
      )
    )
    OR (NEW.operation IN('delete','resolve','reopen')
      AND NEW.geometry_json IS NULL AND NEW.style_json IS NULL AND NEW.linked_comment_id IS NULL AND NEW.request_json=json_object(
        'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,
        'operation',NEW.operation,'annotationId',NEW.annotation_id,
        'expectedRevision',NEW.expected_revision))
  ) THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  -- Linking a Guest comment is optional and independent: only a new nonnull create/update link
  -- requires can_comment and a nondeleted comment by this same Guest in this exact version/scope.
  SELECT CASE WHEN NEW.operation IN('create','update') AND NEW.linked_comment_id IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM guest_invites i
      WHERE i.id=NEW.invite_id AND (i.permissions_mask & 256)=256
        AND EXISTS(SELECT 1 FROM guest_comments c
          WHERE c.id=NEW.linked_comment_id AND c.author_guest_id=NEW.guest_id
            AND c.invite_id=NEW.invite_id AND c.workspace_id=NEW.workspace_id
            AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
            AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
            AND c.state<>'deleted')
    ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;

  SELECT CASE WHEN NEW.operation='create' AND (SELECT count(*) FROM guest_annotations a WHERE a.invite_id=NEW.invite_id AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id)>=1000 THEN RAISE(ABORT,'ANNOTATION_LIMIT_REACHED') END;

  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen') AND EXISTS(
    SELECT 1 FROM guest_annotations a
    WHERE a.id=NEW.annotation_id AND a.invite_id=NEW.invite_id
      AND a.author_guest_id=NEW.guest_id AND a.revision=NEW.expected_revision
      AND a.revision>=9007199254740991 AND (
        (NEW.operation='update' AND a.state='open')
        OR (NEW.operation='delete' AND a.state IN('open','resolved')) OR (NEW.operation='resolve' AND a.state='open') OR (NEW.operation='reopen' AND a.state='resolved'))
  ) THEN RAISE(ABORT,'ANNOTATION_REVISION_EXHAUSTED') END;

  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen') AND NOT EXISTS(
    SELECT 1 FROM guest_annotations a
    WHERE a.id=NEW.annotation_id AND a.invite_id=NEW.invite_id
      AND a.author_guest_id=NEW.guest_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND a.album_id=NEW.album_id
      AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id
      AND a.revision=NEW.expected_revision AND a.revision<9007199254740991
      AND ((NEW.operation='update' AND a.state='open')
        OR (NEW.operation='delete' AND a.state IN('open','resolved')) OR (NEW.operation='resolve' AND a.state='open') OR (NEW.operation='reopen' AND a.state='resolved'))
  ) THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
END;
CREATE TRIGGER guest_annotation_insert_guard BEFORE INSERT ON guest_annotations BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotations a WHERE a.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_annotation_commands c
    JOIN guest_identities g ON g.id=c.guest_id AND g.invite_id=c.invite_id
    WHERE c.id=NEW.last_command_id AND c.annotation_id=NEW.id AND c.operation='create'
      AND c.guest_id=NEW.author_guest_id AND c.invite_id=NEW.invite_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND NEW.author_label=g.display_name AND c.created_at_ms=NEW.created_at_ms
      AND c.created_at_ms=NEW.updated_at_ms AND c.session_id=NEW.last_session_id
      AND c.request_id=NEW.last_request_id AND NEW.revision=1 AND NEW.state='open'
      AND NEW.geometry_json=c.geometry_json AND NEW.style_json=c.style_json
      AND NEW.linked_comment_id IS c.linked_comment_id
  ) THEN RAISE(ABORT,'INVALID_GUEST_ANNOTATION_PROJECTION') END;
  SELECT CASE WHEN (SELECT count(*) FROM guest_annotations a
      WHERE a.invite_id=NEW.invite_id AND a.photo_id=NEW.photo_id
        AND a.version_id=NEW.version_id)>=1000
    THEN RAISE(ABORT,'ANNOTATION_LIMIT_REACHED') END;
END;

-- Each history entry is an exact command-bound predecessor witness in full scope.
CREATE TRIGGER guest_annotation_change_insert_guard BEFORE INSERT ON guest_annotation_changes BEGIN
  SELECT CASE WHEN NEW.event_id IS NULL OR EXISTS(
    SELECT 1 FROM guest_annotation_changes x
    WHERE x.event_id=NEW.event_id OR (NEW.seq IS NOT NULL AND x.seq=NEW.seq)
      OR (x.annotation_id=NEW.annotation_id AND x.revision=NEW.revision)
  ) THEN RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_CHANGE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_annotation_commands cmd
    JOIN guest_annotations a ON a.id=NEW.annotation_id
    WHERE cmd.id=NEW.command_id AND cmd.annotation_id=NEW.annotation_id
      AND cmd.guest_id=NEW.guest_id AND cmd.invite_id=NEW.invite_id
      AND cmd.session_id=NEW.session_id AND cmd.request_id=NEW.request_id
      AND cmd.workspace_id=NEW.workspace_id AND cmd.project_id=NEW.project_id
      AND cmd.album_id=NEW.album_id AND cmd.photo_id=NEW.photo_id AND cmd.version_id=NEW.version_id
      AND cmd.operation=NEW.operation AND cmd.created_at_ms=NEW.occurred_at_ms
      AND a.invite_id=NEW.invite_id AND a.author_guest_id=NEW.guest_id
      AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
      AND a.album_id=NEW.album_id AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id
      AND NEW.event_id='guest-annotation:'||NEW.annotation_id||':'||NEW.revision
      AND (
        (cmd.operation='create' AND NEW.revision=1 AND a.revision=1
          AND a.last_command_id=cmd.id AND a.state='open'
          AND NEW.before_json=json_object('annotationId',NEW.annotation_id,'revision',0,
            'state',NULL,'geometry',NULL,'style',NULL,'commentId',NULL)
          AND NEW.after_json=json_object('annotationId',a.id,'revision',1,'state','open',
            'geometry',json(a.geometry_json),'style',json(a.style_json),
            'commentId',a.linked_comment_id))
        OR (cmd.operation<>'create' AND NEW.revision=a.revision+1
          AND NEW.revision=json_extract(cmd.request_json,'$.expectedRevision')+1
          AND cmd.expected_revision=a.revision AND a.last_command_id<>cmd.id
          AND NEW.before_json=json_object('annotationId',a.id,'revision',a.revision,
            'state',a.state,'geometry',json(a.geometry_json),'style',json(a.style_json),
            'commentId',a.linked_comment_id)
          AND NEW.after_json=json_object('annotationId',a.id,'revision',a.revision+1,
            'state',CASE WHEN cmd.operation='delete' THEN 'deleted'
              WHEN cmd.operation='resolve' THEN 'resolved'
              WHEN cmd.operation='reopen' THEN 'open' ELSE a.state END,
            'geometry',json(CASE WHEN cmd.operation='delete' THEN 'null'
              WHEN cmd.operation='update' THEN cmd.geometry_json ELSE a.geometry_json END),
            'style',json(CASE WHEN cmd.operation='delete' THEN 'null'
              WHEN cmd.operation='update' THEN cmd.style_json ELSE a.style_json END),
            'commentId',CASE WHEN cmd.operation='delete' THEN NULL
              WHEN cmd.operation='update' THEN cmd.linked_comment_id ELSE a.linked_comment_id END)
          AND ((cmd.operation='update' AND a.state='open'
              AND cmd.geometry_json IS NOT NULL AND cmd.style_json IS NOT NULL)
            OR (cmd.operation='delete' AND a.state IN('open','resolved')
              AND a.geometry_json IS NOT NULL AND a.style_json IS NOT NULL)
            OR (cmd.operation='resolve' AND a.state='open'
              AND a.geometry_json IS NOT NULL AND a.style_json IS NOT NULL)
            OR (cmd.operation='reopen' AND a.state='resolved'
              AND a.geometry_json IS NOT NULL AND a.style_json IS NOT NULL)))
      )
  ) THEN RAISE(ABORT,'INVALID_GUEST_ANNOTATION_CHANGE') END;
END;

CREATE TRIGGER guest_annotation_changes_no_update BEFORE UPDATE ON guest_annotation_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_CHANGE');
END;
CREATE TRIGGER guest_annotation_changes_no_delete BEFORE DELETE ON guest_annotation_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_CHANGE');
END;
CREATE TRIGGER guest_annotation_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action IN('annotation.created','annotation.updated','annotation.deleted',
  'annotation.resolved','annotation.reopened') BEGIN
  SELECT CASE WHEN NEW.actor_type<>'guest' OR NEW.session_id IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM guest_annotation_changes ch
    WHERE ch.event_id=NEW.event_id
      AND NEW.action=CASE ch.operation WHEN 'create' THEN 'annotation.created'
        WHEN 'update' THEN 'annotation.updated' WHEN 'delete' THEN 'annotation.deleted'
        WHEN 'resolve' THEN 'annotation.resolved' WHEN 'reopen' THEN 'annotation.reopened' END
      AND NEW.actor_id=ch.guest_id AND NEW.guest_session_id=ch.session_id
      AND NEW.workspace_id=ch.workspace_id AND NEW.project_id=ch.project_id
      AND NEW.album_id=ch.album_id AND NEW.photo_id=ch.photo_id AND NEW.version_id=ch.version_id
      AND NEW.before_json=ch.before_json AND NEW.after_json=ch.after_json
      AND NEW.request_id=ch.request_id
      AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  ) THEN RAISE(ABORT,'INVALID_GUEST_ANNOTATION_AUDIT') END;
END;

CREATE TRIGGER guest_annotation_update_guard BEFORE UPDATE ON guest_annotations BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.author_guest_id<>OLD.author_guest_id
    OR NEW.invite_id<>OLD.invite_id OR NEW.author_label<>OLD.author_label
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id OR NEW.version_id<>OLD.version_id
    OR NEW.created_at_ms<>OLD.created_at_ms
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_SCOPE') END;
  SELECT CASE WHEN NEW.revision<>OLD.revision+1 OR NEW.revision>9007199254740991
    OR NEW.updated_at_ms<OLD.updated_at_ms
    OR NOT EXISTS(
      SELECT 1 FROM guest_annotation_changes ch
      JOIN guest_annotation_commands cmd ON cmd.id=ch.command_id
      WHERE ch.annotation_id=OLD.id AND ch.revision=NEW.revision
        AND ch.command_id=NEW.last_command_id AND cmd.annotation_id=OLD.id
        AND cmd.operation<>'create' AND cmd.request_json=json(cmd.request_json)
        AND json_extract(cmd.request_json,'$.annotationId')=OLD.id
        AND json_extract(cmd.request_json,'$.expectedRevision')=OLD.revision
        AND ch.session_id=NEW.last_session_id AND ch.request_id=NEW.last_request_id
        AND ch.invite_id=NEW.invite_id AND ch.guest_id=NEW.author_guest_id
        AND ch.workspace_id=NEW.workspace_id AND ch.project_id=NEW.project_id
        AND ch.album_id=NEW.album_id AND ch.photo_id=NEW.photo_id AND ch.version_id=NEW.version_id
        AND ch.occurred_at_ms=NEW.updated_at_ms
        AND ch.before_json=json_object('annotationId',OLD.id,'revision',OLD.revision,
          'state',OLD.state,'geometry',json(OLD.geometry_json),'style',json(OLD.style_json),
          'commentId',OLD.linked_comment_id)
        AND ch.after_json=json_object('annotationId',NEW.id,'revision',NEW.revision,
          'state',NEW.state,'geometry',json(NEW.geometry_json),'style',json(NEW.style_json),
          'commentId',NEW.linked_comment_id)
        AND ((cmd.operation='update' AND OLD.state='open' AND NEW.state=OLD.state
              AND NEW.geometry_json=cmd.geometry_json AND NEW.style_json=cmd.style_json
              AND NEW.linked_comment_id IS cmd.linked_comment_id)
          OR (cmd.operation='delete' AND OLD.state IN('open','resolved')
              AND NEW.state='deleted' AND NEW.geometry_json IS NULL
              AND NEW.style_json IS NULL AND NEW.linked_comment_id IS NULL)
          OR (cmd.operation='resolve' AND OLD.state='open' AND NEW.state='resolved'
              AND NEW.geometry_json IS OLD.geometry_json AND NEW.style_json IS OLD.style_json
              AND NEW.linked_comment_id IS OLD.linked_comment_id)
          OR (cmd.operation='reopen' AND OLD.state='resolved' AND NEW.state='open'
              AND NEW.geometry_json IS OLD.geometry_json AND NEW.style_json IS OLD.style_json
              AND NEW.linked_comment_id IS OLD.linked_comment_id))
    ) THEN RAISE(ABORT,'INVALID_GUEST_ANNOTATION_PREDECESSOR') END;
END;
CREATE TRIGGER guest_annotations_no_delete BEFORE DELETE ON guest_annotations BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION');
END;

CREATE TRIGGER guest_annotation_result_insert_guard BEFORE INSERT ON guest_annotation_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM guest_annotation_results r WHERE r.command_id=NEW.command_id
      OR (r.guest_id=NEW.guest_id AND lower(r.request_id)=lower(NEW.request_id))
  ) THEN RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_annotation_commands c
    JOIN guest_annotations a ON a.id=c.annotation_id AND a.last_command_id=c.id
    WHERE c.id=NEW.command_id AND c.guest_id=NEW.guest_id AND c.invite_id=NEW.invite_id
      AND c.request_id=NEW.request_id AND NEW.occurred_at_ms=c.created_at_ms
      AND a.author_guest_id=c.guest_id AND a.invite_id=c.invite_id
      AND a.workspace_id=c.workspace_id AND a.project_id=c.project_id
      AND a.album_id=c.album_id AND a.photo_id=c.photo_id AND a.version_id=c.version_id
      AND NEW.result_json=json_object(
        'requestId',c.request_id,'operation',c.operation,
        'item',json_object('annotationId',a.id,'photoId',a.photo_id,'versionId',a.version_id,
          'revision',a.revision,'geometry',json(a.geometry_json),'style',json(a.style_json),
          'commentId',a.linked_comment_id,'state',a.state,'authorLabel',a.author_label,
          'isMine',json('true'),
          'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at_ms/1000.0,'unixepoch'),
          'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.updated_at_ms/1000.0,'unixepoch')),
        'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'))
  ) THEN RAISE(ABORT,'INVALID_GUEST_ANNOTATION_RESULT') END;
END;
CREATE TRIGGER guest_annotation_results_no_update BEFORE UPDATE ON guest_annotation_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_RESULT');
END;
CREATE TRIGGER guest_annotation_results_no_delete BEFORE DELETE ON guest_annotation_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_RESULT');
END;
CREATE TRIGGER guest_annotations_insert_audit AFTER INSERT ON guest_annotations BEGIN
  INSERT INTO guest_annotation_changes(
    event_id,command_id,request_id,guest_id,invite_id,session_id,workspace_id,project_id,
    album_id,photo_id,version_id,annotation_id,operation,revision,occurred_at_ms,before_json,after_json
  )
  SELECT 'guest-annotation:'||NEW.id||':1',c.id,c.request_id,c.guest_id,c.invite_id,c.session_id,
    c.workspace_id,c.project_id,c.album_id,NEW.photo_id,NEW.version_id,NEW.id,'create',1,c.created_at_ms,
    json_object('annotationId',NEW.id,'revision',0,'state',NULL,'geometry',NULL,'style',NULL,'commentId',NULL),
    json_object('annotationId',NEW.id,'revision',1,'state',NEW.state,
      'geometry',json(NEW.geometry_json),'style',json(NEW.style_json),'commentId',NEW.linked_comment_id)
  FROM guest_annotation_commands c WHERE c.id=NEW.last_command_id
    AND c.annotation_id=NEW.id AND c.operation='create';

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'guest',ch.guest_id,ch.session_id,ch.workspace_id,ch.project_id,
    ch.album_id,ch.photo_id,ch.version_id,'annotation.created',ch.before_json,ch.after_json,
    ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM guest_annotation_changes ch WHERE ch.command_id=NEW.last_command_id
    AND ch.annotation_id=NEW.id AND ch.revision=1;
END;

CREATE TRIGGER guest_annotations_update_audit AFTER UPDATE ON guest_annotations BEGIN
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'guest',ch.guest_id,ch.session_id,ch.workspace_id,ch.project_id,
    ch.album_id,ch.photo_id,ch.version_id,
    CASE ch.operation WHEN 'update' THEN 'annotation.updated'
      WHEN 'delete' THEN 'annotation.deleted' WHEN 'resolve' THEN 'annotation.resolved'
      WHEN 'reopen' THEN 'annotation.reopened' END,
    ch.before_json,ch.after_json,ch.request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM guest_annotation_changes ch WHERE ch.command_id=NEW.last_command_id
    AND ch.annotation_id=NEW.id AND ch.revision=NEW.revision;
END;

-- One immutable command INSERT atomically applies projection, history, audit, and receipt.
CREATE TRIGGER guest_annotation_command_apply AFTER INSERT ON guest_annotation_commands BEGIN
  INSERT INTO guest_annotations(
    id,author_guest_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,
    author_label,geometry_json,style_json,linked_comment_id,state,revision,
    created_at_ms,updated_at_ms,last_session_id,last_request_id,last_command_id
  )
  SELECT NEW.annotation_id,NEW.guest_id,NEW.invite_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    NEW.photo_id,NEW.version_id,g.display_name,NEW.geometry_json,NEW.style_json,
    NEW.linked_comment_id,'open',1,NEW.created_at_ms,NEW.created_at_ms,
    NEW.session_id,NEW.request_id,NEW.id
  FROM guest_identities g WHERE NEW.operation='create'
    AND g.id=NEW.guest_id AND g.invite_id=NEW.invite_id;

  INSERT INTO guest_annotation_changes(
    event_id,command_id,request_id,guest_id,invite_id,session_id,workspace_id,project_id,
    album_id,photo_id,version_id,annotation_id,operation,revision,occurred_at_ms,before_json,after_json
  )
  SELECT 'guest-annotation:'||a.id||':'||(a.revision+1),NEW.id,NEW.request_id,NEW.guest_id,
    NEW.invite_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    NEW.photo_id,NEW.version_id,a.id,NEW.operation,a.revision+1,NEW.created_at_ms,
    json_object('annotationId',a.id,'revision',a.revision,'state',a.state,
      'geometry',json(a.geometry_json),'style',json(a.style_json),'commentId',a.linked_comment_id),
    json_object('annotationId',a.id,'revision',a.revision+1,
      'state',CASE WHEN NEW.operation='delete' THEN 'deleted'
        WHEN NEW.operation='resolve' THEN 'resolved'
        WHEN NEW.operation='reopen' THEN 'open' ELSE a.state END,
      'geometry',json(CASE WHEN NEW.operation='delete' THEN 'null'
        WHEN NEW.operation='update' THEN NEW.geometry_json ELSE a.geometry_json END),
      'style',json(CASE WHEN NEW.operation='delete' THEN 'null'
        WHEN NEW.operation='update' THEN NEW.style_json ELSE a.style_json END),
      'commentId',CASE WHEN NEW.operation='delete' THEN NULL
        WHEN NEW.operation='update' THEN NEW.linked_comment_id ELSE a.linked_comment_id END)
  FROM guest_annotations a
  WHERE NEW.operation<>'create' AND a.id=NEW.annotation_id;

  UPDATE guest_annotations
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
      last_session_id=NEW.session_id,last_request_id=NEW.request_id,last_command_id=NEW.id
  WHERE NEW.operation<>'create' AND id=NEW.annotation_id;

  INSERT INTO guest_annotation_results(
    command_id,guest_id,invite_id,request_id,result_json,occurred_at_ms
  )
  SELECT NEW.id,NEW.guest_id,NEW.invite_id,NEW.request_id,
    json_object('requestId',NEW.request_id,'operation',NEW.operation,
      'item',json_object('annotationId',a.id,'photoId',a.photo_id,'versionId',a.version_id,
        'revision',a.revision,'geometry',json(a.geometry_json),'style',json(a.style_json),
        'commentId',a.linked_comment_id,'state',a.state,'authorLabel',a.author_label,
        'isMine',json('true'),
        'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at_ms/1000.0,'unixepoch'),
        'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',a.updated_at_ms/1000.0,'unixepoch')),
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    NEW.created_at_ms
  FROM guest_annotations a WHERE a.id=NEW.annotation_id;
END;

CREATE TRIGGER guest_annotation_commands_no_update BEFORE UPDATE ON guest_annotation_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_COMMAND');
END;
CREATE TRIGGER guest_annotation_commands_no_delete BEFORE DELETE ON guest_annotation_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_COMMAND');
END;

-- Inverse namespace witnesses abort the old statement atomically if an old ledger races
-- or is inserted with a case-variant UUID after a Guest annotation command.
CREATE TRIGGER guest_selection_annotation_namespace AFTER INSERT ON guest_selection_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_submission_annotation_namespace AFTER INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_logout_annotation_namespace AFTER INSERT ON guest_logout_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_exchange_annotation_namespace AFTER INSERT ON guest_exchange_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.invite_id=NEW.invite_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_feedback_annotation_namespace AFTER INSERT ON guest_feedback_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_annotation_namespace AFTER INSERT ON shared_review_guest_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_tag_annotation_namespace AFTER INSERT ON guest_tag_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_comment_annotation_namespace AFTER INSERT ON guest_comment_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;