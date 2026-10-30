-- M2o: independent Guest tags. Catalog labels are project-scoped and append-only;
-- each Guest membership has its own version witness and predecessor-guarded state.
PRAGMA foreign_keys=ON;

CREATE TABLE guest_tag_labels(
  tag_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL COLLATE BINARY CHECK(length(label) BETWEEN 1 AND 40),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(workspace_id,project_id,label),
  UNIQUE(tag_id,workspace_id,project_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id)
);
CREATE INDEX guest_tag_labels_project ON guest_tag_labels(workspace_id,project_id,label);

CREATE TABLE guest_tag_commands(
  id TEXT PRIMARY KEY NOT NULL,
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  expected_guest_id TEXT NOT NULL CHECK(expected_guest_id=guest_id),
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 40),
  present INTEGER NOT NULL CHECK(typeof(present)='integer' AND present IN(0,1)),
  payload_json TEXT NOT NULL CHECK(COALESCE(json_valid(payload_json)
    AND json_type(payload_json,'$.requestId')='text'
    AND json_extract(payload_json,'$.requestId')=request_id
    AND json_type(payload_json,'$.expectedGuestId')='text'
    AND json_extract(payload_json,'$.expectedGuestId')=expected_guest_id
    AND json_type(payload_json,'$.versionId')='text'
    AND json_extract(payload_json,'$.versionId')=version_id
    AND json_type(payload_json,'$.label')='text'
    AND json_extract(payload_json,'$.label')=label
    AND json_type(payload_json,'$.present') IN('true','false')
    AND json_extract(payload_json,'$.present')=present
    AND payload_json=json_object('requestId',request_id,'expectedGuestId',expected_guest_id,
      'versionId',version_id,'label',label,
      'present',json(CASE WHEN present=1 THEN 'true' ELSE 'false' END)),0)),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer'),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_tag_commands_photo
  ON guest_tag_commands(invite_id,guest_id,photo_id,created_at_ms);

CREATE TABLE guest_tag_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES guest_tag_commands(id),
  previous_command_id TEXT REFERENCES guest_tag_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL
);

CREATE TABLE guest_tag_state(
  invite_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  present INTEGER NOT NULL CHECK(typeof(present)='integer' AND present IN(0,1)),
  last_version_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer'),
  last_command_id TEXT NOT NULL REFERENCES guest_tag_commands(id),
  PRIMARY KEY(invite_id,guest_id,photo_id,tag_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
    REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(tag_id,workspace_id,project_id)
    REFERENCES guest_tag_labels(tag_id,workspace_id,project_id),
  FOREIGN KEY(last_version_id,workspace_id,photo_id)
    REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_tag_state_page
  ON guest_tag_state(invite_id,guest_id,album_id,photo_id,present,tag_id);

-- A single BEFORE trigger orders current ACL, cross-ledger conflicts, exact replay,
-- and new-command checks explicitly. Exact replay cannot depend on trigger order.
CREATE TRIGGER guest_tag_command_guard BEFORE INSERT ON guest_tag_commands BEGIN
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
      AND g.id=NEW.expected_guest_id AND NEW.expected_guest_id=NEW.guest_id
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND (i.permissions_mask & 64)=64
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
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
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_guest_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.label<>NEW.label
        OR c.present<>NEW.present OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_TAG_COMMAND') END;

  SELECT CASE WHEN NEW.present=1
    AND NOT EXISTS(
      SELECT 1 FROM guest_tag_labels l
      JOIN guest_tag_state st ON st.tag_id=l.tag_id
      WHERE l.workspace_id=NEW.workspace_id AND l.project_id=NEW.project_id
        AND l.label=NEW.label COLLATE BINARY
        AND st.invite_id=NEW.invite_id AND st.guest_id=NEW.guest_id
        AND st.photo_id=NEW.photo_id AND st.present=1
    )
    AND (SELECT count(*) FROM guest_tag_state st
      WHERE st.invite_id=NEW.invite_id AND st.guest_id=NEW.guest_id
        AND st.photo_id=NEW.photo_id AND st.present=1)>=20
    THEN RAISE(ABORT,'TAG_LIMIT_REACHED') END;
END;

CREATE TRIGGER guest_tag_label_insert_guard BEFORE INSERT ON guest_tag_labels BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_labels l
      WHERE l.tag_id=NEW.tag_id
        OR (l.workspace_id=NEW.workspace_id AND l.project_id=NEW.project_id
          AND l.label=NEW.label COLLATE BINARY))
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_TAG_LABEL') END;
  SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM guest_tag_commands c
      WHERE c.id=NEW.tag_id AND c.workspace_id=NEW.workspace_id
        AND c.project_id=NEW.project_id AND c.label=NEW.label
        AND c.present=1 AND c.created_at_ms=NEW.created_at_ms
    ) THEN RAISE(ABORT,'INVALID_GUEST_TAG_LABEL') END;
  SELECT CASE WHEN (SELECT count(*) FROM guest_tag_labels l
      WHERE l.workspace_id=NEW.workspace_id AND l.project_id=NEW.project_id)>=1000
    THEN RAISE(ABORT,'TAG_CATALOG_LIMIT_REACHED') END;
END;

CREATE TRIGGER guest_tag_labels_no_update BEFORE UPDATE ON guest_tag_labels BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_TAG_LABEL');
END;
CREATE TRIGGER guest_tag_labels_no_delete BEFORE DELETE ON guest_tag_labels BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_TAG_LABEL');
END;

CREATE TRIGGER guest_tag_result_insert_guard BEFORE INSERT ON guest_tag_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
      SELECT 1 FROM guest_tag_results r
      WHERE r.command_id=NEW.command_id
        OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
    ) THEN RAISE(ABORT,'IMMUTABLE_GUEST_TAG_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_tag_commands c
    LEFT JOIN guest_tag_labels l ON l.workspace_id=c.workspace_id
      AND l.project_id=c.project_id AND l.label=c.label COLLATE BINARY
    LEFT JOIN guest_tag_state st ON st.invite_id=c.invite_id
      AND st.guest_id=c.guest_id AND st.photo_id=c.photo_id AND st.tag_id=l.tag_id
    WHERE c.id=NEW.command_id
      AND NEW.previous_command_id IS st.last_command_id
      AND NEW.before_json=json_object(
        'tagId',CASE WHEN c.present=1 OR st.tag_id IS NOT NULL THEN l.tag_id ELSE NULL END,'label',c.label,
        'present',json(CASE WHEN COALESCE(st.present,0)=1 THEN 'true' ELSE 'false' END),
        'versionId',st.last_version_id,
        'updatedAt',CASE WHEN st.tag_id IS NULL THEN NULL
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ',st.updated_at_ms/1000.0,'unixepoch') END)
      AND NEW.after_json=json_object(
        'tagId',CASE WHEN c.present=1 OR st.tag_id IS NOT NULL THEN l.tag_id ELSE NULL END,'label',c.label,
        'present',json(CASE WHEN c.present=1 THEN 'true' ELSE 'false' END),
        'versionId',CASE WHEN COALESCE(st.present,0)<>c.present
          THEN c.version_id ELSE st.last_version_id END,
        'updatedAt',CASE WHEN COALESCE(st.present,0)<>c.present
          THEN strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
          WHEN st.tag_id IS NULL THEN NULL
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ',st.updated_at_ms/1000.0,'unixepoch') END)
      AND NEW.result_json=json_object(
        'guestId',c.guest_id,'photoId',c.photo_id,
        'tagId',CASE WHEN c.present=1 OR st.tag_id IS NOT NULL THEN l.tag_id ELSE NULL END,
        'label',c.label,'present',json(CASE WHEN c.present=1 THEN 'true' ELSE 'false' END),
        'versionId',c.version_id,
        'changed',json(CASE WHEN COALESCE(st.present,0)<>c.present THEN 'true' ELSE 'false' END),
        'eventId',CASE WHEN COALESCE(st.present,0)<>c.present
          THEN 'guest-tag:'||c.id ELSE NULL END,
        'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'))
      AND NEW.event_id IS CASE WHEN COALESCE(st.present,0)<>c.present
        THEN 'guest-tag:'||c.id ELSE NULL END
      AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
  ) THEN RAISE(ABORT,'INVALID_GUEST_TAG_RESULT') END;
END;

CREATE TRIGGER guest_tag_state_insert_guard BEFORE INSERT ON guest_tag_state BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_state st
      WHERE st.invite_id=NEW.invite_id AND st.guest_id=NEW.guest_id
        AND st.photo_id=NEW.photo_id AND st.tag_id=NEW.tag_id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_TAG_STATE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_tag_commands c
    JOIN guest_tag_results r ON r.command_id=c.id
    JOIN guest_tag_labels l ON l.tag_id=NEW.tag_id AND l.workspace_id=NEW.workspace_id
      AND l.project_id=NEW.project_id AND l.label=c.label
    WHERE c.id=NEW.last_command_id AND c.present=1
      AND c.invite_id=NEW.invite_id AND c.guest_id=NEW.guest_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.last_version_id AND c.created_at_ms=NEW.updated_at_ms
      AND r.previous_command_id IS NULL AND r.event_id='guest-tag:'||c.id
      AND json_extract(r.after_json,'$.tagId')=NEW.tag_id
      AND json_extract(r.after_json,'$.present')=1
      AND json_extract(r.after_json,'$.versionId')=NEW.last_version_id
  ) THEN RAISE(ABORT,'INVALID_GUEST_TAG_STATE_WITNESS') END;
END;

CREATE TRIGGER guest_tag_state_update_guard BEFORE UPDATE ON guest_tag_state BEGIN
  SELECT CASE WHEN NEW.invite_id<>OLD.invite_id OR NEW.guest_id<>OLD.guest_id
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id OR NEW.tag_id<>OLD.tag_id
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_TAG_STATE_SCOPE') END;
  SELECT CASE WHEN NEW.present=OLD.present OR NEW.last_command_id=OLD.last_command_id
    OR NOT EXISTS(
      SELECT 1 FROM guest_tag_commands c
      JOIN guest_tag_results r ON r.command_id=c.id
      JOIN guest_tag_labels l ON l.tag_id=NEW.tag_id AND l.workspace_id=NEW.workspace_id
        AND l.project_id=NEW.project_id AND l.label=c.label
      WHERE c.id=NEW.last_command_id AND c.present=NEW.present
        AND c.invite_id=NEW.invite_id AND c.guest_id=NEW.guest_id
        AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
        AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
        AND c.version_id=NEW.last_version_id AND c.created_at_ms=NEW.updated_at_ms
        AND r.previous_command_id=OLD.last_command_id
        AND r.event_id='guest-tag:'||c.id
        AND json_extract(r.before_json,'$.tagId')=OLD.tag_id
        AND json_extract(r.before_json,'$.present')=OLD.present
        AND json_extract(r.after_json,'$.tagId')=NEW.tag_id
        AND json_extract(r.after_json,'$.present')=NEW.present
        AND json_extract(r.after_json,'$.versionId')=NEW.last_version_id
    ) THEN RAISE(ABORT,'INVALID_GUEST_TAG_STATE_WITNESS') END;
END;
CREATE TRIGGER guest_tag_state_no_delete BEFORE DELETE ON guest_tag_state BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_TAG_STATE');
END;

CREATE TRIGGER guest_tag_command_apply AFTER INSERT ON guest_tag_commands BEGIN
  INSERT INTO guest_tag_labels(tag_id,workspace_id,project_id,label,created_at_ms)
  SELECT NEW.id,NEW.workspace_id,NEW.project_id,NEW.label,NEW.created_at_ms
  WHERE NEW.present=1 AND NOT EXISTS(
    SELECT 1 FROM guest_tag_labels l
    WHERE l.workspace_id=NEW.workspace_id AND l.project_id=NEW.project_id
      AND l.label=NEW.label COLLATE BINARY
  );

  INSERT INTO guest_tag_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,st.last_command_id,
    json_object('tagId',CASE WHEN NEW.present=1 OR st.tag_id IS NOT NULL THEN l.tag_id ELSE NULL END,'label',NEW.label,
      'present',json(CASE WHEN COALESCE(st.present,0)=1 THEN 'true' ELSE 'false' END),
      'versionId',st.last_version_id,
      'updatedAt',CASE WHEN st.tag_id IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',st.updated_at_ms/1000.0,'unixepoch') END),
    json_object('tagId',CASE WHEN NEW.present=1 OR st.tag_id IS NOT NULL THEN l.tag_id ELSE NULL END,'label',NEW.label,
      'present',json(CASE WHEN NEW.present=1 THEN 'true' ELSE 'false' END),
      'versionId',CASE WHEN COALESCE(st.present,0)<>NEW.present
        THEN NEW.version_id ELSE st.last_version_id END,
      'updatedAt',CASE WHEN COALESCE(st.present,0)<>NEW.present
        THEN strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
        WHEN st.tag_id IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',st.updated_at_ms/1000.0,'unixepoch') END),
    json_object('guestId',NEW.guest_id,'photoId',NEW.photo_id,
      'tagId',CASE WHEN NEW.present=1 OR st.tag_id IS NOT NULL THEN l.tag_id ELSE NULL END,
      'label',NEW.label,'present',json(CASE WHEN NEW.present=1 THEN 'true' ELSE 'false' END),
      'versionId',NEW.version_id,
      'changed',json(CASE WHEN COALESCE(st.present,0)<>NEW.present THEN 'true' ELSE 'false' END),
      'eventId',CASE WHEN COALESCE(st.present,0)<>NEW.present
        THEN 'guest-tag:'||NEW.id ELSE NULL END,
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    CASE WHEN COALESCE(st.present,0)<>NEW.present THEN 'guest-tag:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM (SELECT 1) seed
  LEFT JOIN guest_tag_labels l ON l.workspace_id=NEW.workspace_id
    AND l.project_id=NEW.project_id AND l.label=NEW.label COLLATE BINARY
  LEFT JOIN guest_tag_state st ON st.invite_id=NEW.invite_id
    AND st.guest_id=NEW.guest_id AND st.photo_id=NEW.photo_id AND st.tag_id=l.tag_id;

  INSERT INTO guest_tag_state(invite_id,guest_id,workspace_id,project_id,album_id,photo_id,
    tag_id,present,last_version_id,updated_at_ms,last_command_id)
  SELECT NEW.invite_id,NEW.guest_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,
    l.tag_id,1,NEW.version_id,NEW.created_at_ms,NEW.id
  FROM guest_tag_labels l
  WHERE NEW.present=1 AND l.workspace_id=NEW.workspace_id AND l.project_id=NEW.project_id
    AND l.label=NEW.label COLLATE BINARY
    AND NOT EXISTS(SELECT 1 FROM guest_tag_state st WHERE st.invite_id=NEW.invite_id
      AND st.guest_id=NEW.guest_id AND st.photo_id=NEW.photo_id AND st.tag_id=l.tag_id);

  UPDATE guest_tag_state SET present=NEW.present,last_version_id=NEW.version_id,
    updated_at_ms=NEW.created_at_ms,last_command_id=NEW.id
  WHERE invite_id=NEW.invite_id AND guest_id=NEW.guest_id AND photo_id=NEW.photo_id
    AND tag_id=(SELECT l.tag_id FROM guest_tag_labels l
      WHERE l.workspace_id=NEW.workspace_id AND l.project_id=NEW.project_id
        AND l.label=NEW.label COLLATE BINARY)
    AND present<>NEW.present;

  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,
    album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,
    NEW.album_id,NEW.photo_id,NEW.version_id,
    CASE WHEN NEW.present=1 THEN 'tag.added' ELSE 'tag.removed' END,
    r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM guest_tag_results r WHERE r.command_id=NEW.id AND r.event_id IS NOT NULL;
END;

CREATE TRIGGER guest_tag_commands_no_update BEFORE UPDATE ON guest_tag_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_TAG_COMMAND');
END;
CREATE TRIGGER guest_tag_commands_no_delete BEFORE DELETE ON guest_tag_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_TAG_COMMAND');
END;
CREATE TRIGGER guest_tag_results_no_update BEFORE UPDATE ON guest_tag_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_TAG_RESULT');
END;
CREATE TRIGGER guest_tag_results_no_delete BEFORE DELETE ON guest_tag_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_TAG_RESULT');
END;

-- Symmetric cross-ledger request namespace protection. Legacy after-insert guards
-- roll back the whole old command, state, result, and audit statement on conflict.
CREATE TRIGGER guest_selection_tags_namespace AFTER INSERT ON guest_selection_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_submission_tags_namespace AFTER INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_logout_tags_namespace AFTER INSERT ON guest_logout_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_exchange_tags_namespace AFTER INSERT ON guest_exchange_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c
    WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_feedback_tags_namespace AFTER INSERT ON guest_feedback_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_guest_tags_namespace AFTER INSERT ON shared_review_guest_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;






