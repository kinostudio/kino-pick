-- Add explicit, sealed shared review subjects. Private Guest state is not imported.
PRAGMA foreign_keys=ON;
CREATE UNIQUE INDEX guest_invite_album_shared_scope
  ON guest_invite_albums(invite_id,workspace_id,project_id,album_id);

CREATE TABLE shared_review_owner_commands(
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN('create','reopen')),
  review_id TEXT NOT NULL,
  title TEXT,
  invite_ids_json TEXT NOT NULL CHECK(json_valid(invite_ids_json) AND json_type(invite_ids_json)='array' AND length(invite_ids_json)<=8192),
  expected_round_no INTEGER,
  minimum INTEGER NOT NULL CHECK(typeof(minimum)='integer' AND minimum BETWEEN 1 AND 100000),
  maximum INTEGER CHECK(maximum IS NULL OR (typeof(maximum)='integer' AND maximum BETWEEN 1 AND 100000)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=8192),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER)) CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(review_id) REFERENCES shared_reviews(id),
  CHECK(maximum IS NULL OR minimum<=maximum),
  CHECK(COALESCE((action='create' AND title IS NOT NULL AND length(title) BETWEEN 1 AND 120
      AND expected_round_no IS NULL AND json_array_length(invite_ids_json) BETWEEN 1 AND 24
      AND json_extract(payload_json,'$.requestId')=request_id
      AND json_extract(payload_json,'$.albumId')=album_id
      AND json_extract(payload_json,'$.title')=title
      AND json_extract(payload_json,'$.minimum')=minimum
      AND json_extract(payload_json,'$.maximum') IS maximum
      AND json_type(payload_json,'$.inviteIds')='array'
      AND json_extract(payload_json,'$.inviteIds')=json(invite_ids_json)
      AND json_type(payload_json,'$.confirmShared')='true')
    OR (action='reopen' AND title IS NULL AND json_array_length(invite_ids_json)=0
      AND typeof(expected_round_no)='integer' AND expected_round_no>0
      AND json_extract(payload_json,'$.requestId')=request_id
      AND json_extract(payload_json,'$.albumId')=album_id
      AND json_extract(payload_json,'$.reviewId')=review_id
      AND json_extract(payload_json,'$.expectedRoundNo')=expected_round_no
      AND json_extract(payload_json,'$.minimum')=minimum
      AND json_extract(payload_json,'$.maximum') IS maximum
      AND json_type(payload_json,'$.confirmShared')='true'),0))
);
CREATE INDEX shared_review_owner_commands_album ON shared_review_owner_commands(actor_id,album_id,created_at_ms);
CREATE TABLE shared_review_owner_results(
  command_id TEXT PRIMARY KEY REFERENCES shared_review_owner_commands(id),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT NOT NULL UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE shared_reviews(
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_command_id TEXT NOT NULL UNIQUE REFERENCES shared_review_owner_commands(id),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id)
);
CREATE INDEX shared_reviews_album ON shared_reviews(album_id,created_at_ms,id);
CREATE TABLE shared_review_invites(
  review_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  PRIMARY KEY(review_id,invite_id),
  UNIQUE(review_id,invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(review_id,workspace_id,project_id,album_id)
    REFERENCES shared_reviews(id,workspace_id,project_id,album_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id)
);
CREATE INDEX shared_review_invites_invite ON shared_review_invites(invite_id,album_id,review_id);
CREATE TABLE shared_review_seals(
  review_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  member_count INTEGER NOT NULL CHECK(typeof(member_count)='integer' AND member_count BETWEEN 1 AND 24),
  sealed_at_ms INTEGER NOT NULL CHECK(typeof(sealed_at_ms)='integer'),
  FOREIGN KEY(review_id,workspace_id,project_id,album_id)
    REFERENCES shared_reviews(id,workspace_id,project_id,album_id)
);

CREATE TABLE shared_review_rounds(
  review_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  round_no INTEGER NOT NULL CHECK(typeof(round_no)='integer' AND round_no>0),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=0),
  status TEXT NOT NULL CHECK(status IN('open','submitted')),
  minimum INTEGER NOT NULL CHECK(typeof(minimum)='integer' AND minimum BETWEEN 1 AND 100000),
  maximum INTEGER CHECK(maximum IS NULL OR (typeof(maximum)='integer' AND maximum BETWEEN 1 AND 100000)),
  submitted_at_ms INTEGER CHECK(submitted_at_ms IS NULL OR typeof(submitted_at_ms)='integer'),
  last_command_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  PRIMARY KEY(review_id,round_no),
  UNIQUE(review_id,round_no,workspace_id,project_id,album_id),
  FOREIGN KEY(review_id,workspace_id,project_id,album_id)
    REFERENCES shared_reviews(id,workspace_id,project_id,album_id),
  CHECK(maximum IS NULL OR minimum<=maximum),
  CHECK((status='open' AND submitted_at_ms IS NULL) OR (status='submitted' AND submitted_at_ms IS NOT NULL))
);
CREATE INDEX shared_review_rounds_latest ON shared_review_rounds(review_id,round_no DESC);

CREATE TABLE shared_review_guest_commands(
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN('set','submit')),
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  round_no INTEGER NOT NULL CHECK(typeof(round_no)='integer' AND round_no>0),
  photo_id TEXT,
  version_id TEXT,
  selected INTEGER CHECK(selected IS NULL OR selected IN(0,1)),
  expected_revision INTEGER CHECK(expected_revision IS NULL OR (typeof(expected_revision)='integer' AND expected_revision>=0)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=2048),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER)) CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(review_id,invite_id,workspace_id,project_id,album_id)
    REFERENCES shared_review_invites(review_id,invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id),
  CHECK(COALESCE((action='set' AND photo_id IS NOT NULL AND version_id IS NOT NULL AND selected IS NOT NULL AND expected_revision IS NULL
      AND json_extract(payload_json,'$.requestId')=request_id AND json_extract(payload_json,'$.albumId')=album_id
      AND json_extract(payload_json,'$.reviewId')=review_id AND json_extract(payload_json,'$.roundNo')=round_no
      AND json_extract(payload_json,'$.photoId')=photo_id AND json_extract(payload_json,'$.versionId')=version_id
      AND json_extract(payload_json,'$.selected')=selected)
    OR (action='submit' AND photo_id IS NULL AND version_id IS NULL AND selected IS NULL AND expected_revision IS NOT NULL
      AND json_extract(payload_json,'$.requestId')=request_id AND json_extract(payload_json,'$.albumId')=album_id
      AND json_extract(payload_json,'$.reviewId')=review_id AND json_extract(payload_json,'$.roundNo')=round_no
      AND json_extract(payload_json,'$.expectedRevision')=expected_revision),0))
);
ALTER TABLE shared_review_guest_commands ADD COLUMN expected_guest_id TEXT NOT NULL DEFAULT '' CHECK(expected_guest_id=guest_id);
CREATE INDEX shared_review_guest_commands_photo ON shared_review_guest_commands(review_id,round_no,photo_id,created_at_ms);
CREATE TABLE shared_review_guest_results(
  command_id TEXT PRIMARY KEY REFERENCES shared_review_guest_commands(id),
  previous_command_id TEXT REFERENCES shared_review_guest_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);
CREATE TABLE shared_review_state(
  review_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  selected INTEGER NOT NULL CHECK(selected IN(0,1)),
  version_id TEXT NOT NULL,
  selected_at_ms INTEGER NOT NULL CHECK(typeof(selected_at_ms)='integer'),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  last_command_id TEXT NOT NULL REFERENCES shared_review_guest_commands(id),
  PRIMARY KEY(review_id,photo_id),
  FOREIGN KEY(review_id,workspace_id,project_id,album_id)
    REFERENCES shared_reviews(id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX shared_review_state_selected ON shared_review_state(review_id,selected,selected_at_ms,photo_id);

CREATE TABLE shared_review_submissions(
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  submitted_by_guest_id TEXT NOT NULL,
  round_no INTEGER NOT NULL CHECK(typeof(round_no)='integer' AND round_no>0),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
  selected_count INTEGER NOT NULL CHECK(typeof(selected_count)='integer' AND selected_count>0),
  guest_command_id TEXT NOT NULL UNIQUE REFERENCES shared_review_guest_commands(id),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(review_id,round_no),
  UNIQUE(id,review_id,workspace_id,project_id,album_id),
  FOREIGN KEY(review_id,round_no,workspace_id,project_id,album_id)
    REFERENCES shared_review_rounds(review_id,round_no,workspace_id,project_id,album_id),
  FOREIGN KEY(review_id,invite_id,workspace_id,project_id,album_id)
    REFERENCES shared_review_invites(review_id,invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(submitted_by_guest_id,invite_id) REFERENCES guest_identities(id,invite_id)
);
CREATE INDEX shared_review_submissions_history ON shared_review_submissions(review_id,round_no DESC);
CREATE TABLE shared_review_submission_items(
  submission_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  selected_at_ms INTEGER NOT NULL CHECK(typeof(selected_at_ms)='integer'),
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
  version_no INTEGER NOT NULL CHECK(typeof(version_no)='integer' AND version_no>0),
  PRIMARY KEY(submission_id,photo_id),
  FOREIGN KEY(submission_id,review_id,workspace_id,project_id,album_id)
    REFERENCES shared_review_submissions(id,review_id,workspace_id,project_id,album_id),
  FOREIGN KEY(review_id,workspace_id,project_id,album_id)
    REFERENCES shared_reviews(id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX shared_review_submission_items_page ON shared_review_submission_items(submission_id,selected_at_ms,photo_id);
CREATE TABLE shared_review_submission_seals(
  submission_id TEXT PRIMARY KEY REFERENCES shared_review_submissions(id),
  item_count INTEGER NOT NULL CHECK(typeof(item_count)='integer' AND item_count>0),
  sealed_at_ms INTEGER NOT NULL CHECK(typeof(sealed_at_ms)='integer')
);
-- Legacy commands retain their own auth/conflict guard order. These AFTER guards make
-- collisions with the new namespace atomic even when sibling trigger order varies.
CREATE TRIGGER request_commands_shared_review_namespace AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_shared_review_namespace AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_shared_review_namespace AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_shared_review_namespace AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_shared_review_namespace AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_shared_review_namespace AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_shared_review_namespace AFTER INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_reopened_shared_review_namespace AFTER INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_selection_shared_review_namespace AFTER INSERT ON guest_selection_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_submission_shared_review_namespace AFTER INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_feedback_shared_review_namespace AFTER INSERT ON guest_feedback_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_logout_shared_review_namespace AFTER INSERT ON guest_logout_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_exchange_shared_review_namespace AFTER INSERT ON guest_exchange_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER shared_review_owner_command_guard BEFORE INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000 AND w.id=NEW.workspace_id
      AND p.status NOT IN('archived','deleting','deleted') AND a.state='active'
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.session_id<>NEW.session_id OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.action<>NEW.action
        OR (c.action='reopen' AND c.review_id<>NEW.review_id) OR c.title IS NOT NEW.title
        OR c.invite_ids_json<>NEW.invite_ids_json OR c.expected_round_no IS NOT NEW.expected_round_no
        OR c.minimum<>NEW.minimum OR c.maximum IS NOT NEW.maximum OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NEW.action='create' AND EXISTS(
    SELECT 1 FROM json_each(NEW.invite_ids_json) m
    WHERE NOT EXISTS(
      SELECT 1 FROM guest_invites i JOIN guest_invite_seals seal ON seal.invite_id=i.id
      JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
        AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
      JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=NEW.actor_id
      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
        AND a.project_id=i.project_id AND a.state='active'
      WHERE i.id=m.value AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
        AND i.created_by=NEW.actor_id AND i.expires_at_ms>unixepoch('subsec')*1000
        AND (i.permissions_mask & 520)<>0
        AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
        AND p.status NOT IN('archived','deleting','deleted')
    )
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_MEMBERS') END;
  SELECT CASE WHEN NEW.action='create' AND (
      json_array_length(NEW.invite_ids_json) NOT BETWEEN 1 AND 24
      OR (SELECT count(DISTINCT value) FROM json_each(NEW.invite_ids_json))<>json_array_length(NEW.invite_ids_json))
    THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_MEMBERS') END;
  SELECT CASE WHEN NEW.action='create' AND EXISTS(SELECT 1 FROM shared_reviews r WHERE r.id=NEW.review_id)
    THEN RAISE(ABORT,'SHARED_REVIEW_ID_CONFLICT') END;
  SELECT CASE WHEN NEW.action='create' AND (SELECT count(*) FROM shared_reviews r WHERE r.album_id=NEW.album_id)>=20
    THEN RAISE(ABORT,'SHARED_REVIEW_LIMIT_REACHED') END;
  SELECT CASE WHEN NEW.action='reopen' AND NOT EXISTS(
      SELECT 1 FROM shared_reviews r WHERE r.id=NEW.review_id AND r.album_id=NEW.album_id
        AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.created_by=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.action='reopen' AND NOT EXISTS(
      SELECT 1 FROM shared_review_rounds r WHERE r.review_id=NEW.review_id
        AND r.round_no=NEW.expected_round_no AND r.status='submitted'
        AND r.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=NEW.review_id))
    AND EXISTS(SELECT 1 FROM shared_review_rounds r WHERE r.review_id=NEW.review_id
      AND r.round_no=NEW.expected_round_no AND r.status<>'submitted')
    THEN RAISE(ABORT,'ROUND_NOT_SUBMITTED') END;
  SELECT CASE WHEN NEW.action='reopen' AND NOT EXISTS(
      SELECT 1 FROM shared_review_rounds r WHERE r.review_id=NEW.review_id
        AND r.round_no=NEW.expected_round_no AND r.status='submitted'
        AND r.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=NEW.review_id))
    THEN RAISE(ABORT,'ROUND_CONFLICT') END;
END;
CREATE TRIGGER shared_reviews_insert_guard BEFORE INSERT ON shared_reviews BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_review_owner_commands c JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=c.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id
    JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=c.album_id AND a.workspace_id=w.id AND a.project_id=p.id AND a.state='active'
    WHERE c.id=NEW.created_command_id AND c.action='create' AND c.review_id=NEW.id
      AND c.actor_id=NEW.created_by AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.title=NEW.title AND c.created_at_ms=NEW.created_at_ms
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_SUBJECT') END;
END;
CREATE TRIGGER shared_review_invites_insert_guard BEFORE INSERT ON shared_review_invites BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_seals s WHERE s.review_id=NEW.review_id)
    THEN RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_MEMBERSHIP') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_reviews r JOIN shared_review_owner_commands c ON c.id=r.created_command_id
    JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
    JOIN guest_invite_seals isea ON isea.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
    JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
    WHERE r.id=NEW.review_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
      AND r.album_id=NEW.album_id AND c.action='create'
      AND EXISTS(SELECT 1 FROM json_each(c.invite_ids_json) j WHERE j.value=NEW.invite_id)
      AND i.created_by=o.user_id AND i.expires_at_ms>unixepoch('subsec')*1000
      AND (i.permissions_mask & 520)<>0
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_MEMBER') END;
END;
CREATE TRIGGER shared_review_seals_guard BEFORE INSERT ON shared_review_seals BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_reviews r JOIN shared_review_owner_commands c ON c.id=r.created_command_id
    WHERE r.id=NEW.review_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
      AND r.album_id=NEW.album_id AND c.action='create'
      AND NEW.sealed_at_ms=c.created_at_ms
      AND NEW.member_count=json_array_length(c.invite_ids_json)
      AND NEW.member_count=(SELECT count(*) FROM shared_review_invites m WHERE m.review_id=r.id)
      AND NEW.member_count=(SELECT count(DISTINCT invite_id) FROM shared_review_invites m WHERE m.review_id=r.id)
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_SEAL') END;
END;
CREATE TRIGGER shared_review_round_insert_guard BEFORE INSERT ON shared_review_rounds BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_review_seals seal JOIN shared_review_owner_commands c ON c.id=NEW.last_command_id
    JOIN shared_reviews r ON r.id=seal.review_id AND r.workspace_id=seal.workspace_id
      AND r.project_id=seal.project_id AND r.album_id=seal.album_id
    WHERE seal.review_id=NEW.review_id AND seal.workspace_id=NEW.workspace_id
      AND seal.project_id=NEW.project_id AND seal.album_id=NEW.album_id
      AND ((c.action='create' AND NEW.round_no=1 AND NEW.revision=0 AND NEW.status='open'
          AND NEW.submitted_at_ms IS NULL AND c.review_id=NEW.review_id
          AND c.minimum=NEW.minimum AND c.maximum IS NEW.maximum
          AND NEW.updated_at_ms=c.created_at_ms)
        OR (c.action='reopen' AND c.review_id=NEW.review_id
          AND c.expected_round_no+1=NEW.round_no AND NEW.revision=1 AND NEW.status='open'
          AND NEW.submitted_at_ms IS NULL AND c.minimum=NEW.minimum AND c.maximum IS NEW.maximum
          AND EXISTS(SELECT 1 FROM shared_review_rounds prior WHERE prior.review_id=NEW.review_id
            AND prior.round_no=c.expected_round_no AND prior.status='submitted'
            AND prior.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=NEW.review_id))))
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_ROUND_INSERT') END;
END;
CREATE TRIGGER shared_review_round_update_guard BEFORE UPDATE ON shared_review_rounds BEGIN
  SELECT CASE WHEN NEW.review_id<>OLD.review_id OR NEW.workspace_id<>OLD.workspace_id
    OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id OR NEW.round_no<>OLD.round_no
    OR NEW.minimum<>OLD.minimum OR NEW.maximum IS NOT OLD.maximum
    THEN RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_ROUND_SCOPE') END;
  SELECT CASE WHEN NOT (
    (OLD.status='open' AND NEW.status='open' AND NEW.revision=OLD.revision+1
      AND NEW.submitted_at_ms IS NULL AND EXISTS(
        SELECT 1 FROM shared_review_guest_commands c JOIN shared_review_guest_results r ON r.command_id=c.id
        WHERE c.id=NEW.last_command_id AND c.review_id=NEW.review_id AND c.round_no=NEW.round_no
          AND c.action='set' AND r.event_id IS NOT NULL
          AND json_extract(r.result_json,'$.revision')=NEW.revision
          AND json_extract(r.result_json,'$.eventId')=r.event_id
      ))
    OR (OLD.status='open' AND NEW.status='submitted' AND NEW.revision=OLD.revision
      AND NEW.submitted_at_ms IS NOT NULL AND EXISTS(
        SELECT 1 FROM shared_review_submissions sub WHERE sub.review_id=NEW.review_id
          AND sub.round_no=NEW.round_no AND sub.revision=NEW.revision
          AND sub.created_at_ms=NEW.submitted_at_ms AND sub.guest_command_id=NEW.last_command_id
      ))
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_ROUND_TRANSITION') END;
END;
CREATE TRIGGER shared_review_round_no_delete BEFORE DELETE ON shared_review_rounds BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_ROUND');
END;

CREATE TRIGGER shared_review_owner_command_apply AFTER INSERT ON shared_review_owner_commands BEGIN
  INSERT INTO shared_reviews(id,workspace_id,project_id,album_id,title,created_by,created_command_id,created_at_ms)
  SELECT NEW.review_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.title,NEW.actor_id,NEW.id,NEW.created_at_ms
  WHERE NEW.action='create';
  INSERT INTO shared_review_invites(review_id,workspace_id,project_id,album_id,invite_id)
  SELECT NEW.review_id,NEW.workspace_id,NEW.project_id,NEW.album_id,j.value
  FROM json_each(NEW.invite_ids_json) j WHERE NEW.action='create';
  INSERT INTO shared_review_seals(review_id,workspace_id,project_id,album_id,member_count,sealed_at_ms)
  SELECT NEW.review_id,NEW.workspace_id,NEW.project_id,NEW.album_id,json_array_length(NEW.invite_ids_json),NEW.created_at_ms
  WHERE NEW.action='create';
  INSERT INTO shared_review_rounds(review_id,workspace_id,project_id,album_id,round_no,revision,status,minimum,maximum,submitted_at_ms,last_command_id,updated_at_ms)
  SELECT NEW.review_id,NEW.workspace_id,NEW.project_id,NEW.album_id,1,0,'open',NEW.minimum,NEW.maximum,NULL,NEW.id,NEW.created_at_ms
  WHERE NEW.action='create';
  INSERT INTO shared_review_rounds(review_id,workspace_id,project_id,album_id,round_no,revision,status,minimum,maximum,submitted_at_ms,last_command_id,updated_at_ms)
  SELECT NEW.review_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.expected_round_no+1,1,'open',NEW.minimum,NEW.maximum,NULL,NEW.id,NEW.created_at_ms
  WHERE NEW.action='reopen';
  INSERT INTO shared_review_owner_results(command_id,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,
    json_object('review',json_object('id',r.id,'albumId',r.album_id,'title',r.title,
      'inviteIds',json((SELECT json_group_array(invite_id) FROM (SELECT invite_id FROM shared_review_invites m WHERE m.review_id=r.id ORDER BY invite_id))),
      'roundNo',rd.round_no,'revision',rd.revision,'status',rd.status,'minimum',rd.minimum,'maximum',rd.maximum,
      'selectedCount',(SELECT count(*) FROM shared_review_state st WHERE st.review_id=r.id AND st.selected=1),
      'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch'),
      'submittedAt',CASE WHEN rd.submitted_at_ms IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',rd.submitted_at_ms/1000.0,'unixepoch') END),
      'eventId',CASE WHEN NEW.action='create' THEN 'shared-review-created:'||NEW.id ELSE 'shared-review-reopened:'||NEW.id END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN NEW.action='create' THEN 'shared-review-created:'||NEW.id ELSE 'shared-review-reopened:'||NEW.id END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM shared_reviews r JOIN shared_review_rounds rd ON rd.review_id=r.id
    AND rd.round_no=CASE WHEN NEW.action='create' THEN 1 ELSE NEW.expected_round_no+1 END
  WHERE NEW.action IN('create','reopen') AND r.id=NEW.review_id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT x.event_id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    CASE WHEN NEW.action='create' THEN 'shared_review.created' ELSE 'shared_review.reopened' END,
    CASE WHEN NEW.action='create' THEN NULL ELSE json_object('status','submitted','roundNo',NEW.expected_round_no) END,
    CASE WHEN NEW.action='create'
      THEN json_object('reviewId',NEW.review_id,'title',NEW.title,'memberCount',json_array_length(NEW.invite_ids_json),'roundNo',1,'revision',0,'status','open')
      ELSE json_object('reviewId',NEW.review_id,'roundNo',NEW.expected_round_no+1,'revision',1,'status','open','minimum',NEW.minimum,'maximum',NEW.maximum,
        'selectedCount',(SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1)) END,
    NEW.request_id,x.occurred_at_utc
  FROM shared_review_owner_results x WHERE x.command_id=NEW.id;
END;
CREATE TRIGGER shared_review_owner_commands_no_update BEFORE UPDATE ON shared_review_owner_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_OWNER_COMMAND'); END;
CREATE TRIGGER shared_review_owner_commands_no_delete BEFORE DELETE ON shared_review_owner_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_OWNER_COMMAND'); END;
CREATE TRIGGER shared_review_owner_results_no_update BEFORE UPDATE ON shared_review_owner_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_OWNER_RESULT'); END;
CREATE TRIGGER shared_review_owner_results_no_delete BEFORE DELETE ON shared_review_owner_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_OWNER_RESULT'); END;
CREATE TRIGGER shared_reviews_no_update BEFORE UPDATE ON shared_reviews BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW'); END;
CREATE TRIGGER shared_reviews_no_delete BEFORE DELETE ON shared_reviews BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW'); END;
CREATE TRIGGER shared_review_invites_no_update BEFORE UPDATE ON shared_review_invites BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_MEMBERSHIP'); END;
CREATE TRIGGER shared_review_invites_no_delete BEFORE DELETE ON shared_review_invites BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_MEMBERSHIP'); END;
CREATE TRIGGER shared_review_seals_no_update BEFORE UPDATE ON shared_review_seals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SEAL'); END;
CREATE TRIGGER shared_review_seals_no_delete BEFORE DELETE ON shared_review_seals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SEAL'); END;CREATE TRIGGER shared_review_guest_command_guard BEFORE INSERT ON shared_review_guest_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN shared_reviews r ON r.id=NEW.review_id AND r.workspace_id=i.workspace_id
      AND r.project_id=i.project_id AND r.album_id=a.id
    JOIN shared_review_seals review_seal ON review_seal.review_id=r.id
      AND review_seal.workspace_id=r.workspace_id AND review_seal.project_id=r.project_id
      AND review_seal.album_id=r.album_id
    JOIN shared_review_invites member ON member.review_id=r.id AND member.invite_id=i.id
      AND member.workspace_id=i.workspace_id AND member.project_id=i.project_id AND member.album_id=a.id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id
      AND NEW.expected_guest_id=NEW.guest_id AND json_extract(NEW.payload_json,'$.expectedGuestId')=NEW.expected_guest_id
      AND s.secret_hash=NEW.secret_hash AND i.workspace_id=NEW.workspace_id
      AND i.project_id=NEW.project_id AND a.id=NEW.album_id
      AND ((NEW.action='set' AND (i.permissions_mask & 8)=8)
        OR (NEW.action='submit' AND (i.permissions_mask & 512)=512))
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.review_id<>NEW.review_id OR c.round_no<>NEW.round_no
        OR c.action<>NEW.action OR c.photo_id IS NOT NEW.photo_id
        OR c.version_id IS NOT NEW.version_id OR c.selected IS NOT NEW.selected
        OR c.expected_revision IS NOT NEW.expected_revision OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shared_review_rounds rd
    WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no AND rd.status='open'
      AND rd.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=NEW.review_id))
    THEN RAISE(ABORT,'SHARED_ROUND_CONFLICT') END;
  SELECT CASE WHEN NEW.action='set' AND NOT EXISTS(
    SELECT 1 FROM photos ph JOIN photo_versions v ON v.id=NEW.version_id
      AND v.workspace_id=ph.workspace_id AND v.photo_id=ph.id
    WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
      AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.action='set' AND NEW.selected=1 AND NOT EXISTS(
      SELECT 1 FROM shared_review_state st WHERE st.review_id=NEW.review_id
        AND st.photo_id=NEW.photo_id AND st.selected=1)
    AND EXISTS(SELECT 1 FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id
      AND rd.round_no=NEW.round_no AND rd.maximum IS NOT NULL
      AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1)>=rd.maximum)
    THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
  SELECT CASE WHEN NEW.action='submit' AND NEW.expected_revision<>
      (SELECT rd.revision FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no)
    THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.action='submit' AND (SELECT count(*) FROM shared_review_state st
      WHERE st.review_id=NEW.review_id AND st.selected=1)=0
    THEN RAISE(ABORT,'EMPTY_SELECTION') END;
  SELECT CASE WHEN NEW.action='submit' AND (SELECT count(*) FROM shared_review_state st
      WHERE st.review_id=NEW.review_id AND st.selected=1)<>
      (SELECT rd.minimum FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no)
    AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1)<
      (SELECT rd.minimum FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no)
    THEN RAISE(ABORT,'SELECTION_MINIMUM_NOT_MET') END;
  SELECT CASE WHEN NEW.action='submit' AND EXISTS(SELECT 1 FROM shared_review_rounds rd
      WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no AND rd.maximum IS NOT NULL
        AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1)>rd.maximum)
    THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
END;

CREATE TRIGGER shared_review_state_insert_guard BEFORE INSERT ON shared_review_state BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_review_guest_commands c JOIN shared_review_guest_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.action='set' AND c.selected=1
      AND c.review_id=NEW.review_id AND c.photo_id=NEW.photo_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.version_id=NEW.version_id AND c.created_at_ms=NEW.updated_at_ms
      AND r.previous_command_id IS NULL AND r.event_id IS NOT NULL
      AND json_extract(r.after_json,'$.selected')=1
      AND json_extract(r.after_json,'$.versionId')=NEW.version_id
      AND json_extract(r.after_json,'$.selectedAtMs')=NEW.selected_at_ms
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_STATE_WITNESS') END;
END;
CREATE TRIGGER shared_review_state_update_guard BEFORE UPDATE ON shared_review_state BEGIN
  SELECT CASE WHEN NEW.review_id<>OLD.review_id OR NEW.workspace_id<>OLD.workspace_id
    OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id
    THEN RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_STATE_SCOPE') END;
  SELECT CASE WHEN NEW.last_command_id=OLD.last_command_id OR NOT EXISTS(
    SELECT 1 FROM shared_review_guest_commands c JOIN shared_review_guest_results r ON r.command_id=c.id
    WHERE c.id=NEW.last_command_id AND c.action='set' AND c.review_id=NEW.review_id
      AND c.photo_id=NEW.photo_id AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.created_at_ms=NEW.updated_at_ms AND r.previous_command_id=OLD.last_command_id
      AND c.selected=NEW.selected
      AND ((NEW.selected=1 AND c.version_id=NEW.version_id) OR (NEW.selected=0 AND NEW.version_id=OLD.version_id))
      AND r.event_id IS NOT NULL AND json_extract(r.after_json,'$.selected')=NEW.selected
      AND json_extract(r.after_json,'$.versionId') IS NEW.version_id
      AND ((NEW.selected=1 AND json_extract(r.after_json,'$.selectedAtMs')=NEW.selected_at_ms)
        OR (NEW.selected=0 AND json_type(r.after_json,'$.selectedAtMs')='null' AND NEW.selected_at_ms=OLD.selected_at_ms))
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_STATE_WITNESS') END;
END;
CREATE TRIGGER shared_review_state_no_delete BEFORE DELETE ON shared_review_state BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_STATE');
END;
CREATE TRIGGER shared_review_submission_guard BEFORE INSERT ON shared_review_submissions BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_review_guest_commands c
    JOIN shared_review_rounds rd ON rd.review_id=c.review_id AND rd.round_no=c.round_no
      AND rd.workspace_id=c.workspace_id AND rd.project_id=c.project_id AND rd.album_id=c.album_id
    JOIN shared_review_invites member ON member.review_id=c.review_id AND member.invite_id=c.invite_id
      AND member.workspace_id=c.workspace_id AND member.project_id=c.project_id AND member.album_id=c.album_id
    WHERE c.id=NEW.guest_command_id AND c.action='submit'
      AND c.review_id=NEW.review_id AND c.invite_id=NEW.invite_id
      AND c.guest_id=NEW.submitted_by_guest_id AND c.round_no=NEW.round_no
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
      AND c.created_at_ms=NEW.created_at_ms AND c.expected_revision=NEW.revision
      AND rd.status='open' AND rd.revision=NEW.revision
      AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=c.review_id AND st.selected=1)=NEW.selected_count
      AND NEW.selected_count>=rd.minimum AND (rd.maximum IS NULL OR NEW.selected_count<=rd.maximum)
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_SUBMISSION') END;
END;
CREATE TRIGGER shared_review_submission_items_guard BEFORE INSERT ON shared_review_submission_items BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_submission_seals seal WHERE seal.submission_id=NEW.submission_id)
    THEN RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SNAPSHOT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_review_submissions sub
    JOIN shared_review_rounds rd ON rd.review_id=sub.review_id AND rd.round_no=sub.round_no
      AND rd.workspace_id=sub.workspace_id AND rd.project_id=sub.project_id AND rd.album_id=sub.album_id
    JOIN shared_review_state st ON st.review_id=sub.review_id AND st.workspace_id=sub.workspace_id
      AND st.project_id=sub.project_id AND st.album_id=sub.album_id AND st.photo_id=NEW.photo_id
      AND st.selected=1 AND st.version_id=NEW.version_id AND st.selected_at_ms=NEW.selected_at_ms
    JOIN photos ph ON ph.id=st.photo_id AND ph.workspace_id=st.workspace_id
      AND ph.project_id=st.project_id AND ph.album_id=st.album_id AND ph.original_filename=NEW.filename
    JOIN photo_versions v ON v.id=st.version_id AND v.workspace_id=st.workspace_id
      AND v.photo_id=st.photo_id AND v.version_no=NEW.version_no
    WHERE sub.id=NEW.submission_id AND sub.review_id=NEW.review_id
      AND sub.workspace_id=NEW.workspace_id AND sub.project_id=NEW.project_id
      AND sub.album_id=NEW.album_id AND rd.status='open'
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_SNAPSHOT_ITEM') END;
END;
CREATE TRIGGER shared_review_submission_seal_guard BEFORE INSERT ON shared_review_submission_seals BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_review_submissions sub
    JOIN shared_review_rounds rd ON rd.review_id=sub.review_id AND rd.round_no=sub.round_no
      AND rd.workspace_id=sub.workspace_id AND rd.project_id=sub.project_id AND rd.album_id=sub.album_id
    WHERE sub.id=NEW.submission_id AND rd.status='submitted' AND rd.revision=sub.revision
      AND rd.submitted_at_ms=sub.created_at_ms AND NEW.sealed_at_ms=sub.created_at_ms
      AND NEW.item_count=sub.selected_count
      AND NEW.item_count=(SELECT count(*) FROM shared_review_submission_items i WHERE i.submission_id=sub.id)
      AND NEW.item_count=(SELECT count(*) FROM shared_review_state st WHERE st.review_id=sub.review_id AND st.selected=1)
      AND NOT EXISTS(
        SELECT 1 FROM shared_review_submission_items i
        LEFT JOIN shared_review_state st ON st.review_id=i.review_id AND st.photo_id=i.photo_id
          AND st.selected=1 AND st.version_id=i.version_id AND st.selected_at_ms=i.selected_at_ms
        LEFT JOIN photos ph ON ph.id=i.photo_id AND ph.workspace_id=i.workspace_id
          AND ph.project_id=i.project_id AND ph.album_id=i.album_id AND ph.original_filename=i.filename
        LEFT JOIN photo_versions v ON v.id=i.version_id AND v.workspace_id=i.workspace_id
          AND v.photo_id=i.photo_id AND v.version_no=i.version_no
        WHERE i.submission_id=sub.id AND (st.photo_id IS NULL OR ph.id IS NULL OR v.id IS NULL)
      )
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_SNAPSHOT_SEAL') END;
END;
CREATE TRIGGER shared_review_submission_no_update BEFORE UPDATE ON shared_review_submissions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SUBMISSION'); END;
CREATE TRIGGER shared_review_submission_no_delete BEFORE DELETE ON shared_review_submissions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SUBMISSION'); END;
CREATE TRIGGER shared_review_submission_items_no_update BEFORE UPDATE ON shared_review_submission_items BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SNAPSHOT'); END;
CREATE TRIGGER shared_review_submission_items_no_delete BEFORE DELETE ON shared_review_submission_items BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SNAPSHOT'); END;
CREATE TRIGGER shared_review_submission_seals_no_update BEFORE UPDATE ON shared_review_submission_seals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SNAPSHOT_SEAL'); END;
CREATE TRIGGER shared_review_submission_seals_no_delete BEFORE DELETE ON shared_review_submission_seals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_SNAPSHOT_SEAL'); END;
CREATE TRIGGER shared_review_guest_commands_no_update BEFORE UPDATE ON shared_review_guest_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_GUEST_COMMAND'); END;
CREATE TRIGGER shared_review_guest_commands_no_delete BEFORE DELETE ON shared_review_guest_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_GUEST_COMMAND'); END;
CREATE TRIGGER shared_review_guest_results_no_update BEFORE UPDATE ON shared_review_guest_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_GUEST_RESULT'); END;
CREATE TRIGGER shared_review_guest_results_no_delete BEFORE DELETE ON shared_review_guest_results BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_GUEST_RESULT'); END;
CREATE TRIGGER shared_review_guest_command_apply AFTER INSERT ON shared_review_guest_commands BEGIN
  INSERT INTO shared_review_guest_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,st.last_command_id,
    json_object('selected',json(CASE WHEN st.selected=1 THEN 'true' ELSE 'false' END),
      'versionId',st.version_id,'selectedAtMs',CASE WHEN st.selected=1 THEN st.selected_at_ms ELSE NULL END),
    json_object('selected',json(CASE WHEN NEW.selected=1 THEN 'true' ELSE 'false' END),
      'versionId',CASE WHEN NEW.selected=1 THEN NEW.version_id ELSE st.version_id END,
      'selectedAtMs',CASE WHEN NEW.selected=1
        THEN CASE WHEN st.selected=1 AND st.version_id=NEW.version_id THEN st.selected_at_ms ELSE NEW.created_at_ms END
        ELSE NULL END),
    json_object('reviewId',NEW.review_id,'photoId',NEW.photo_id,'roundNo',NEW.round_no,
      'revision',rd.revision+CASE WHEN (NEW.selected=1 AND (st.photo_id IS NULL OR st.selected=0 OR st.version_id<>NEW.version_id))
        OR (NEW.selected=0 AND st.selected=1) THEN 1 ELSE 0 END,
      'selected',json(CASE WHEN NEW.selected=1 THEN 'true' ELSE 'false' END),
      'selectedVersionId',CASE WHEN NEW.selected=1 THEN NEW.version_id ELSE NULL END,
      'selectedAt',CASE WHEN NEW.selected=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ',
        (CASE WHEN st.selected=1 AND st.version_id=NEW.version_id THEN st.selected_at_ms ELSE NEW.created_at_ms END)/1000.0,'unixepoch') ELSE NULL END,
      'selectedCount',(SELECT count(*) FROM shared_review_state x WHERE x.review_id=NEW.review_id AND x.selected=1)
        +CASE WHEN NEW.selected=1 AND (st.photo_id IS NULL OR st.selected=0) THEN 1
          WHEN NEW.selected=0 AND st.selected=1 THEN -1 ELSE 0 END,
      'eventId',CASE WHEN (NEW.selected=1 AND (st.photo_id IS NULL OR st.selected=0 OR st.version_id<>NEW.version_id))
        OR (NEW.selected=0 AND st.selected=1) THEN 'shared-selection:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN (NEW.selected=1 AND (st.photo_id IS NULL OR st.selected=0 OR st.version_id<>NEW.version_id))
      OR (NEW.selected=0 AND st.selected=1) THEN 'shared-selection:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM shared_review_rounds rd
  LEFT JOIN shared_review_state st ON st.review_id=NEW.review_id AND st.photo_id=NEW.photo_id
  WHERE NEW.action='set' AND rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no;

  INSERT INTO shared_review_state(review_id,workspace_id,project_id,album_id,photo_id,selected,version_id,selected_at_ms,updated_at_ms,last_command_id)
  SELECT NEW.review_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,1,NEW.version_id,NEW.created_at_ms,NEW.created_at_ms,NEW.id
  WHERE NEW.action='set' AND NEW.selected=1
    AND NOT EXISTS(SELECT 1 FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.photo_id=NEW.photo_id);
  UPDATE shared_review_state SET selected=NEW.selected,
    version_id=CASE WHEN NEW.selected=1 THEN NEW.version_id ELSE shared_review_state.version_id END,
    selected_at_ms=CASE WHEN NEW.selected=1 AND (shared_review_state.selected=0 OR shared_review_state.version_id<>NEW.version_id)
      THEN NEW.created_at_ms ELSE shared_review_state.selected_at_ms END,
    updated_at_ms=NEW.created_at_ms,last_command_id=NEW.id
  WHERE NEW.action='set' AND shared_review_state.review_id=NEW.review_id
    AND shared_review_state.photo_id=NEW.photo_id
    AND ((NEW.selected=1 AND (shared_review_state.selected=0 OR shared_review_state.version_id<>NEW.version_id))
      OR (NEW.selected=0 AND shared_review_state.selected=1));
  UPDATE shared_review_rounds SET revision=revision+1,last_command_id=NEW.id,updated_at_ms=NEW.created_at_ms
  WHERE NEW.action='set' AND review_id=NEW.review_id AND round_no=NEW.round_no
    AND EXISTS(SELECT 1 FROM shared_review_guest_results x WHERE x.command_id=NEW.id AND x.event_id IS NOT NULL);
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,
    COALESCE(json_extract(r.after_json,'$.versionId'),json_extract(r.before_json,'$.versionId'),NEW.version_id),
    CASE WHEN json_extract(r.before_json,'$.selected')=0 AND json_extract(r.after_json,'$.selected')=1 THEN 'shared_selection.added'
      WHEN json_extract(r.before_json,'$.selected')=1 AND json_extract(r.after_json,'$.selected')=0 THEN 'shared_selection.removed'
      ELSE 'shared_selection.version_changed' END,
    r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM shared_review_guest_results r WHERE NEW.action='set' AND r.command_id=NEW.id AND r.event_id IS NOT NULL;

  INSERT INTO shared_review_submissions(id,review_id,workspace_id,project_id,album_id,invite_id,submitted_by_guest_id,round_no,revision,selected_count,guest_command_id,created_at_ms)
  SELECT NEW.id,NEW.review_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.invite_id,NEW.guest_id,
    NEW.round_no,rd.revision,(SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1),
    NEW.id,NEW.created_at_ms
  FROM shared_review_rounds rd WHERE NEW.action='submit' AND rd.review_id=NEW.review_id
    AND rd.round_no=NEW.round_no AND rd.status='open';
  INSERT INTO shared_review_submission_items(submission_id,review_id,workspace_id,project_id,album_id,photo_id,version_id,selected_at_ms,filename,version_no)
  SELECT NEW.id,st.review_id,st.workspace_id,st.project_id,st.album_id,st.photo_id,st.version_id,st.selected_at_ms,ph.original_filename,v.version_no
  FROM shared_review_state st JOIN photos ph ON ph.id=st.photo_id AND ph.workspace_id=st.workspace_id
    AND ph.project_id=st.project_id AND ph.album_id=st.album_id
  JOIN photo_versions v ON v.id=st.version_id AND v.workspace_id=st.workspace_id AND v.photo_id=st.photo_id
  WHERE NEW.action='submit' AND st.review_id=NEW.review_id AND st.selected=1;
  UPDATE shared_review_rounds SET status='submitted',submitted_at_ms=NEW.created_at_ms,
    last_command_id=NEW.id,updated_at_ms=NEW.created_at_ms
  WHERE NEW.action='submit' AND review_id=NEW.review_id AND round_no=NEW.round_no
    AND status='open' AND revision=NEW.expected_revision;
  INSERT INTO shared_review_submission_seals(submission_id,item_count,sealed_at_ms)
  SELECT s.id,count(i.photo_id),NEW.created_at_ms
  FROM shared_review_submissions s JOIN shared_review_submission_items i ON i.submission_id=s.id
  WHERE NEW.action='submit' AND s.id=NEW.id GROUP BY s.id;
  INSERT INTO shared_review_guest_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,NULL,
    json_object('roundNo',s.round_no,'revision',s.revision,'status','open','selectedCount',s.selected_count),
    json_object('roundNo',s.round_no,'revision',s.revision,'status','submitted','selectedCount',s.selected_count),
    json_object('submission',json_object('id',s.id,'reviewId',s.review_id,'roundNo',s.round_no,
      'revision',s.revision,'selectedCount',s.selected_count,
      'submittedAt',strftime('%Y-%m-%dT%H:%M:%fZ',s.created_at_ms/1000.0,'unixepoch'),
      'submittedByGuestId',s.submitted_by_guest_id),
      'eventId','shared-review-submit:'||NEW.id),
    'shared-review-submit:'||NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM shared_review_submissions s WHERE NEW.action='submit' AND s.id=NEW.id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    'shared_selection.submitted',r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM shared_review_guest_results r WHERE NEW.action='submit' AND r.command_id=NEW.id;
END;DROP TRIGGER selection_reopened_shared_review_namespace;
CREATE TRIGGER selection_reopened_shared_review_full_namespace BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;