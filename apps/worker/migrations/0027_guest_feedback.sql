-- Add independent Guest rating and favorite feedback.
-- Existing selection/submission snapshots and audit rows remain unchanged.
PRAGMA foreign_keys=ON;

CREATE TABLE guest_feedback_commands(
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('rating','favorite')),
  value_integer INTEGER,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND (
    (kind='rating' AND json_type(payload_json,'$.versionId')='text'
      AND json_extract(payload_json,'$.versionId')=version_id AND (
      (value_integer IS NULL AND json_type(payload_json,'$.stars')='null')
      OR (typeof(value_integer)='integer' AND value_integer BETWEEN 1 AND 5
        AND json_type(payload_json,'$.stars')='integer'
        AND json_extract(payload_json,'$.stars')=value_integer)
    ) AND payload_json=json_object('versionId',version_id,'stars',value_integer))
    OR
    (kind='favorite' AND typeof(value_integer)='integer' AND value_integer IN(0,1)
      AND json_type(payload_json,'$.versionId')='text'
      AND json_extract(payload_json,'$.versionId')=version_id
      AND json_type(payload_json,'$.favored') IN('true','false')
      AND json_extract(payload_json,'$.favored')=value_integer
      AND payload_json=json_object('versionId',version_id,'favored',json(CASE WHEN value_integer=1 THEN 'true' ELSE 'false' END)))
  )),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER)) CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_feedback_commands_photo ON guest_feedback_commands(invite_id,guest_id,photo_id,kind,created_at_ms);

CREATE TABLE guest_feedback_results(
  command_id TEXT PRIMARY KEY REFERENCES guest_feedback_commands(id),
  kind TEXT NOT NULL CHECK(kind IN('rating','favorite')),
  previous_command_id TEXT REFERENCES guest_feedback_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE guest_rating_state(
  invite_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  stars INTEGER CHECK(stars IS NULL OR (typeof(stars)='integer' AND stars BETWEEN 1 AND 5)),
  last_version_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  last_command_id TEXT NOT NULL REFERENCES guest_feedback_commands(id),
  PRIMARY KEY(invite_id,guest_id,photo_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(last_version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_rating_state_album ON guest_rating_state(invite_id,guest_id,album_id,photo_id);

CREATE TABLE guest_favorite_state(
  invite_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  favored INTEGER NOT NULL CHECK(typeof(favored)='integer' AND favored IN(0,1)),
  last_version_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  last_command_id TEXT NOT NULL REFERENCES guest_feedback_commands(id),
  PRIMARY KEY(invite_id,guest_id,photo_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(last_version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_favorite_state_album ON guest_favorite_state(invite_id,guest_id,album_id,photo_id);

CREATE TRIGGER guest_feedback_command_guard BEFORE INSERT ON guest_feedback_commands BEGIN
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
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=i.workspace_id
      AND ph.project_id=i.project_id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=ph.workspace_id
      AND v.photo_id=ph.id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id
      AND s.invite_id=NEW.invite_id AND s.secret_hash=NEW.secret_hash
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND ((NEW.kind='rating' AND (i.permissions_mask & 16)=16)
        OR (NEW.kind='favorite' AND (i.permissions_mask & 32)=32))
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c
      WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id
        OR c.kind<>NEW.kind OR c.value_integer IS NOT NEW.value_integer
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
END;

CREATE TRIGGER guest_rating_state_insert_guard BEFORE INSERT ON guest_rating_state BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    JOIN guest_feedback_results r ON r.command_id=c.id AND r.kind='rating'
    WHERE c.id=NEW.last_command_id AND c.kind='rating'
      AND c.invite_id=NEW.invite_id AND c.guest_id=NEW.guest_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.last_version_id AND c.created_at_ms=NEW.updated_at_ms
      AND c.value_integer IS NEW.stars
      AND r.previous_command_id IS (
        SELECT prior.last_command_id FROM guest_rating_state prior
        WHERE prior.invite_id=NEW.invite_id AND prior.guest_id=NEW.guest_id
          AND prior.photo_id=NEW.photo_id
      )
      AND r.event_id='guest-feedback:'||c.id
      AND json_extract(r.after_json,'$.photoId')=NEW.photo_id
      AND json_extract(r.after_json,'$.stars') IS NEW.stars
      AND json_extract(r.after_json,'$.versionId')=NEW.last_version_id
  ) THEN RAISE(ABORT,'INVALID_GUEST_RATING_WITNESS') END;
END;
CREATE TRIGGER guest_rating_state_update_guard BEFORE UPDATE ON guest_rating_state BEGIN
  SELECT CASE WHEN NEW.invite_id<>OLD.invite_id OR NEW.guest_id<>OLD.guest_id
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_RATING_SCOPE') END;
  SELECT CASE WHEN NEW.last_command_id=OLD.last_command_id OR NOT EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    JOIN guest_feedback_results r ON r.command_id=c.id AND r.kind='rating'
    WHERE c.id=NEW.last_command_id AND c.kind='rating'
      AND c.invite_id=NEW.invite_id AND c.guest_id=NEW.guest_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.last_version_id AND c.created_at_ms=NEW.updated_at_ms
      AND c.value_integer IS NEW.stars
      AND r.previous_command_id=OLD.last_command_id
      AND r.event_id='guest-feedback:'||c.id
      AND json_extract(r.after_json,'$.photoId')=NEW.photo_id
      AND json_extract(r.after_json,'$.stars') IS NEW.stars
      AND json_extract(r.after_json,'$.versionId')=NEW.last_version_id
  ) THEN RAISE(ABORT,'INVALID_GUEST_RATING_WITNESS') END;
END;
CREATE TRIGGER guest_rating_state_no_delete BEFORE DELETE ON guest_rating_state BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_RATING_STATE');
END;

CREATE TRIGGER guest_favorite_state_insert_guard BEFORE INSERT ON guest_favorite_state BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    JOIN guest_feedback_results r ON r.command_id=c.id AND r.kind='favorite'
    WHERE c.id=NEW.last_command_id AND c.kind='favorite'
      AND c.invite_id=NEW.invite_id AND c.guest_id=NEW.guest_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.last_version_id AND c.created_at_ms=NEW.updated_at_ms
      AND c.value_integer=NEW.favored
      AND r.previous_command_id IS (
        SELECT prior.last_command_id FROM guest_favorite_state prior
        WHERE prior.invite_id=NEW.invite_id AND prior.guest_id=NEW.guest_id
          AND prior.photo_id=NEW.photo_id
      )
      AND r.event_id='guest-feedback:'||c.id
      AND json_extract(r.after_json,'$.photoId')=NEW.photo_id
      AND json_extract(r.after_json,'$.favored')=NEW.favored
      AND json_extract(r.after_json,'$.versionId')=NEW.last_version_id
  ) THEN RAISE(ABORT,'INVALID_GUEST_FAVORITE_WITNESS') END;
END;
CREATE TRIGGER guest_favorite_state_update_guard BEFORE UPDATE ON guest_favorite_state BEGIN
  SELECT CASE WHEN NEW.invite_id<>OLD.invite_id OR NEW.guest_id<>OLD.guest_id
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_FAVORITE_SCOPE') END;
  SELECT CASE WHEN NEW.last_command_id=OLD.last_command_id OR NOT EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    JOIN guest_feedback_results r ON r.command_id=c.id AND r.kind='favorite'
    WHERE c.id=NEW.last_command_id AND c.kind='favorite'
      AND c.invite_id=NEW.invite_id AND c.guest_id=NEW.guest_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.last_version_id AND c.created_at_ms=NEW.updated_at_ms
      AND c.value_integer=NEW.favored
      AND r.previous_command_id=OLD.last_command_id
      AND r.event_id='guest-feedback:'||c.id
      AND json_extract(r.after_json,'$.photoId')=NEW.photo_id
      AND json_extract(r.after_json,'$.favored')=NEW.favored
      AND json_extract(r.after_json,'$.versionId')=NEW.last_version_id
  ) THEN RAISE(ABORT,'INVALID_GUEST_FAVORITE_WITNESS') END;
END;
CREATE TRIGGER guest_favorite_state_no_delete BEFORE DELETE ON guest_favorite_state BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_FAVORITE_STATE');
END;

CREATE TRIGGER guest_feedback_rating_apply AFTER INSERT ON guest_feedback_commands
WHEN NEW.kind='rating' BEGIN
  INSERT INTO guest_feedback_results(command_id,kind,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,'rating',s.last_command_id,
    json_object('photoId',NEW.photo_id,'stars',s.stars,'versionId',s.last_version_id,
      'updatedAt',CASE WHEN s.photo_id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch') END),
    json_object('photoId',NEW.photo_id,
      'stars',CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
        OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer) THEN NEW.value_integer ELSE s.stars END,
      'versionId',CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
        OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer) THEN NEW.version_id ELSE s.last_version_id END,
      'updatedAt',CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
        OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer)
        THEN strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
        WHEN s.photo_id IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch') END),
    json_object('photoId',NEW.photo_id,
      'stars',CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
        OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer) THEN NEW.value_integer ELSE s.stars END,
      'versionId',CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
        OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer) THEN NEW.version_id ELSE s.last_version_id END,
      'updatedAt',CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
        OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer)
        THEN strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
        WHEN s.photo_id IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch') END,
      'eventId',CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
        OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer)
        THEN 'guest-feedback:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
      OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer)
      THEN 'guest-feedback:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM (SELECT 1) seed
  LEFT JOIN guest_rating_state s ON s.invite_id=NEW.invite_id
    AND s.guest_id=NEW.guest_id AND s.photo_id=NEW.photo_id;

  INSERT INTO guest_rating_state(invite_id,guest_id,workspace_id,project_id,album_id,photo_id,stars,last_version_id,updated_at_ms,last_command_id)
  SELECT NEW.invite_id,NEW.guest_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,
    NEW.value_integer,NEW.version_id,NEW.created_at_ms,NEW.id
  FROM (SELECT 1) seed LEFT JOIN guest_rating_state s
    ON s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.photo_id=NEW.photo_id
  WHERE (s.photo_id IS NULL AND NEW.value_integer IS NOT NULL)
    OR (s.photo_id IS NOT NULL AND s.stars IS NOT NEW.value_integer)
  ON CONFLICT(invite_id,guest_id,photo_id) DO UPDATE SET
    stars=excluded.stars,last_version_id=excluded.last_version_id,
    updated_at_ms=excluded.updated_at_ms,last_command_id=excluded.last_command_id
  WHERE guest_rating_state.stars IS NOT excluded.stars;

  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,
    NEW.album_id,NEW.photo_id,NEW.version_id,
    CASE WHEN NEW.value_integer IS NULL THEN 'rating.cleared' ELSE 'rating.set' END,
    r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM guest_feedback_results r WHERE r.command_id=NEW.id AND r.event_id IS NOT NULL;
END;

CREATE TRIGGER guest_feedback_favorite_apply AFTER INSERT ON guest_feedback_commands
WHEN NEW.kind='favorite' BEGIN
  INSERT INTO guest_feedback_results(command_id,kind,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,'favorite',s.last_command_id,
    json_object('photoId',NEW.photo_id,'favored',json(CASE WHEN COALESCE(s.favored,0)=1 THEN 'true' ELSE 'false' END),
      'versionId',s.last_version_id,
      'updatedAt',CASE WHEN s.photo_id IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch') END),
    json_object('photoId',NEW.photo_id,
      'favored',json(CASE WHEN COALESCE(s.favored,0)=1 AND COALESCE(s.favored,0)=NEW.value_integer
        THEN 'true' WHEN COALESCE(s.favored,0)<>NEW.value_integer AND NEW.value_integer=1
        THEN 'true' ELSE 'false' END),
      'versionId',CASE WHEN COALESCE(s.favored,0)<>NEW.value_integer THEN NEW.version_id ELSE s.last_version_id END,
      'updatedAt',CASE WHEN COALESCE(s.favored,0)<>NEW.value_integer
        THEN strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
        WHEN s.photo_id IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch') END),
    json_object('photoId',NEW.photo_id,
      'favored',json(CASE WHEN COALESCE(s.favored,0)<>NEW.value_integer AND NEW.value_integer=1
        THEN 'true' WHEN COALESCE(s.favored,0)=NEW.value_integer AND COALESCE(s.favored,0)=1
        THEN 'true' ELSE 'false' END),
      'versionId',CASE WHEN COALESCE(s.favored,0)<>NEW.value_integer THEN NEW.version_id ELSE s.last_version_id END,
      'updatedAt',CASE WHEN COALESCE(s.favored,0)<>NEW.value_integer
        THEN strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
        WHEN s.photo_id IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch') END,
      'eventId',CASE WHEN COALESCE(s.favored,0)<>NEW.value_integer
        THEN 'guest-feedback:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN COALESCE(s.favored,0)<>NEW.value_integer
      THEN 'guest-feedback:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM (SELECT 1) seed
  LEFT JOIN guest_favorite_state s ON s.invite_id=NEW.invite_id
    AND s.guest_id=NEW.guest_id AND s.photo_id=NEW.photo_id;

  INSERT INTO guest_favorite_state(invite_id,guest_id,workspace_id,project_id,album_id,photo_id,favored,last_version_id,updated_at_ms,last_command_id)
  SELECT NEW.invite_id,NEW.guest_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,
    NEW.value_integer,NEW.version_id,NEW.created_at_ms,NEW.id
  FROM (SELECT 1) seed LEFT JOIN guest_favorite_state s
    ON s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.photo_id=NEW.photo_id
  WHERE COALESCE(s.favored,0)<>NEW.value_integer
  ON CONFLICT(invite_id,guest_id,photo_id) DO UPDATE SET
    favored=excluded.favored,last_version_id=excluded.last_version_id,
    updated_at_ms=excluded.updated_at_ms,last_command_id=excluded.last_command_id
  WHERE guest_favorite_state.favored<>excluded.favored;

  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,
    NEW.album_id,NEW.photo_id,NEW.version_id,
    CASE WHEN NEW.value_integer=1 THEN 'favorite.added' ELSE 'favorite.removed' END,
    r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM guest_feedback_results r WHERE r.command_id=NEW.id AND r.event_id IS NOT NULL;
END;

CREATE TRIGGER guest_feedback_commands_no_update BEFORE UPDATE ON guest_feedback_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_FEEDBACK_COMMAND');
END;
CREATE TRIGGER guest_feedback_commands_no_delete BEFORE DELETE ON guest_feedback_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_FEEDBACK_COMMAND');
END;
CREATE TRIGGER guest_feedback_results_no_update BEFORE UPDATE ON guest_feedback_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_FEEDBACK_RESULT');
END;
CREATE TRIGGER guest_feedback_results_no_delete BEFORE DELETE ON guest_feedback_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_FEEDBACK_RESULT');
END;

-- Enforce request namespace symmetry after existing ledger BEFORE guards run.
-- Aborting here rolls any legacy state, result, or audit trigger work back too.
CREATE TRIGGER guest_selection_feedback_request_guard AFTER INSERT ON guest_selection_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_feedback_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_selection_submission_feedback_request_guard AFTER INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_feedback_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_logout_feedback_request_guard AFTER INSERT ON guest_logout_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_feedback_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_exchange_feedback_request_guard AFTER INSERT ON guest_exchange_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_feedback_commands c
    WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER guest_feedback_read_rating_scope
BEFORE INSERT ON guest_feedback_results
WHEN NEW.kind='rating' BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    WHERE c.id=NEW.command_id AND c.kind='rating'
      AND NEW.previous_command_id IS (
        SELECT s.last_command_id FROM guest_rating_state s
        WHERE s.invite_id=c.invite_id AND s.guest_id=c.guest_id AND s.photo_id=c.photo_id
      )
      AND json_type(NEW.result_json,'$.photoId')='text'
      AND json_extract(NEW.result_json,'$.photoId')=c.photo_id
      AND ((c.value_integer IS NULL AND json_type(NEW.result_json,'$.stars')='null')
        OR (c.value_integer IS NOT NULL AND json_type(NEW.result_json,'$.stars')='integer'
          AND json_extract(NEW.result_json,'$.stars')=c.value_integer))
      AND json_type(NEW.result_json,'$.versionId') IN('text','null')
      AND json_extract(NEW.result_json,'$.versionId') IS (
        CASE WHEN NEW.event_id IS NOT NULL THEN c.version_id
          ELSE json_extract(NEW.before_json,'$.versionId') END
      )
      AND ((NEW.event_id IS NULL AND json_type(NEW.result_json,'$.eventId')='null')
        OR (NEW.event_id IS NOT NULL AND json_type(NEW.result_json,'$.eventId')='text'
          AND json_extract(NEW.result_json,'$.eventId')=NEW.event_id))
      AND json_type(NEW.result_json,'$.occurredAt')='text'
      AND json_extract(NEW.result_json,'$.occurredAt')=NEW.occurred_at_utc
  ) THEN RAISE(ABORT,'INVALID_GUEST_FEEDBACK_RESULT') END;
END;
CREATE TRIGGER guest_feedback_read_favorite_scope
BEFORE INSERT ON guest_feedback_results
WHEN NEW.kind='favorite' BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    WHERE c.id=NEW.command_id AND c.kind='favorite'
      AND NEW.previous_command_id IS (
        SELECT s.last_command_id FROM guest_favorite_state s
        WHERE s.invite_id=c.invite_id AND s.guest_id=c.guest_id AND s.photo_id=c.photo_id
      )
      AND json_type(NEW.result_json,'$.photoId')='text'
      AND json_extract(NEW.result_json,'$.photoId')=c.photo_id
      AND json_type(NEW.result_json,'$.favored') IN('true','false')
      AND json_extract(NEW.result_json,'$.favored')=c.value_integer
      AND json_type(NEW.result_json,'$.versionId') IN('text','null')
      AND json_extract(NEW.result_json,'$.versionId') IS (
        CASE WHEN NEW.event_id IS NOT NULL THEN c.version_id
          ELSE json_extract(NEW.before_json,'$.versionId') END
      )
      AND ((NEW.event_id IS NULL AND json_type(NEW.result_json,'$.eventId')='null')
        OR (NEW.event_id IS NOT NULL AND json_type(NEW.result_json,'$.eventId')='text'
          AND json_extract(NEW.result_json,'$.eventId')=NEW.event_id))
      AND json_type(NEW.result_json,'$.occurredAt')='text'
      AND json_extract(NEW.result_json,'$.occurredAt')=NEW.occurred_at_utc
  ) THEN RAISE(ABORT,'INVALID_GUEST_FEEDBACK_RESULT') END;
END;