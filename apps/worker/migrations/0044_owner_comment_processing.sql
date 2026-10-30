-- M3f2b: independently recorded Owner processing status for Guest-authored comments.
-- This is a forward-only projection: never rewrite Guest comments or their history.
PRAGMA foreign_keys=ON;

-- Guest resolution/reopening/deletion are not content edits. This index supplies the
-- authoritative source watermark using only Guest creation and body-edit revisions.
CREATE INDEX guest_comment_changes_content_revision
 ON guest_comment_changes(comment_id,revision DESC)
 WHERE operation IN('create','edit');

-- 0043 replies are a new legacy witness; match case-folded UUIDs without scanning an Owner's full history.
CREATE INDEX owner_comment_processing_ns_owner_replies
 ON owner_comment_commands(actor_id,lower(request_id));

CREATE TABLE owner_comment_processing_commands(
 id TEXT PRIMARY KEY NOT NULL
  CHECK(length(id)=36 AND id GLOB '????????-????-????-????-????????????'
   AND id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(id,'-',''))=32),
 actor_id TEXT NOT NULL REFERENCES users(id),
 -- Owner sessions are transient; retain their historical identity without an FK.
 session_id TEXT NOT NULL,
 request_id TEXT NOT NULL
  CHECK(request_id=lower(request_id) AND length(request_id)=36
   AND request_id GLOB '????????-????-????-????-????????????'
   AND request_id NOT GLOB '*[^0-9a-f-]*' AND length(replace(request_id,'-',''))=32),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 project_id TEXT NOT NULL,
 album_id TEXT NOT NULL,
 invite_id TEXT NOT NULL,
 photo_id TEXT NOT NULL,
 version_id TEXT NOT NULL,
 comment_id TEXT NOT NULL
  CHECK(length(comment_id)=36 AND comment_id GLOB '????????-????-????-????-????????????'
   AND comment_id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(comment_id,'-',''))=32),
 operation TEXT NOT NULL CHECK(operation='set_processing_state'),
 target_state TEXT NOT NULL CHECK(target_state IN('open','in_progress','resolved')),
 expected_comment_revision INTEGER NOT NULL
  CHECK(typeof(expected_comment_revision)='integer'
   AND expected_comment_revision BETWEEN 1 AND 9007199254740991),
 expected_processing_revision INTEGER NOT NULL
  CHECK(typeof(expected_processing_revision)='integer'
   AND expected_processing_revision BETWEEN 0 AND 9007199254740991),
 -- Internal source watermark; intentionally absent from the public request contract.
 content_revision INTEGER NOT NULL
  CHECK(typeof(content_revision)='integer'
   AND content_revision BETWEEN 1 AND expected_comment_revision),
 request_json TEXT NOT NULL
  CHECK(json_valid(request_json) AND json_type(request_json)='object' AND length(request_json)<=20000),
 created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
  CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
 UNIQUE(actor_id,request_id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
 FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
  REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
 FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
  REFERENCES photos(id,workspace_id,project_id,album_id),
 FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id),
 FOREIGN KEY(comment_id) REFERENCES guest_comments(id),
 CHECK(request_json=json_object(
  'requestId',request_id,'operation','set_processing_state','inviteId',invite_id,
  'photoId',photo_id,'versionId',version_id,'commentId',comment_id,
  'expectedCommentRevision',expected_comment_revision,
  'expectedProcessingRevision',expected_processing_revision,'state',target_state))
);
CREATE INDEX owner_comment_processing_commands_scope
 ON owner_comment_processing_commands(invite_id,album_id,photo_id,version_id,created_at_ms);

CREATE TABLE owner_comment_processing_state(
 comment_id TEXT PRIMARY KEY NOT NULL REFERENCES guest_comments(id),
 invite_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 album_id TEXT NOT NULL,
 photo_id TEXT NOT NULL,
 version_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('open','in_progress','resolved')),
 revision INTEGER NOT NULL
  CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 comment_revision INTEGER NOT NULL
  CHECK(typeof(comment_revision)='integer' AND comment_revision BETWEEN 1 AND 9007199254740991),
 content_revision INTEGER NOT NULL
  CHECK(typeof(content_revision)='integer' AND content_revision BETWEEN 1 AND comment_revision),
 updated_at_ms INTEGER NOT NULL
  CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 1 AND 9007199254740991),
 last_command_id TEXT NOT NULL REFERENCES owner_comment_processing_commands(id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
 FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
  REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
 FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
  REFERENCES photos(id,workspace_id,project_id,album_id),
 FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);

CREATE TABLE owner_comment_processing_changes(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE,
 command_id TEXT NOT NULL REFERENCES owner_comment_processing_commands(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 session_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 invite_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 album_id TEXT NOT NULL,
 photo_id TEXT NOT NULL,
 version_id TEXT NOT NULL,
 comment_id TEXT NOT NULL REFERENCES guest_comments(id),
 revision INTEGER NOT NULL
  CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 occurred_at_ms INTEGER NOT NULL
  CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991),
 before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'),
 after_json TEXT NOT NULL CHECK(json_valid(after_json) AND json_type(after_json)='object'),
 UNIQUE(comment_id,revision),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
 FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
  REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
 FOREIGN KEY(photo_id,workspace_id,project_id,album_id)
  REFERENCES photos(id,workspace_id,project_id,album_id),
 FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX owner_comment_processing_changes_scope
 ON owner_comment_processing_changes(invite_id,album_id,photo_id,version_id,seq);

CREATE TABLE owner_comment_processing_results(
 command_id TEXT PRIMARY KEY NOT NULL REFERENCES owner_comment_processing_commands(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 result_json TEXT NOT NULL
  CHECK(json_valid(result_json) AND json_type(result_json)='object' AND length(result_json)<=10000),
 occurred_at_ms INTEGER NOT NULL
  CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991),
 UNIQUE(actor_id,request_id)
);

-- One row per Guest comment. Missing state is the unrecorded open/revision-zero snapshot.
-- Only create/edit revisions advance the source-content watermark; resolve/reopen/delete
-- remain Guest-authored lifecycle events and do not make Owner status stale.
CREATE VIEW comment_processing_snapshots AS
SELECT g.id AS comment_id,g.invite_id,g.workspace_id,g.project_id,g.album_id,g.photo_id,g.version_id,
 COALESCE(s.state,'open') AS state,COALESCE(s.revision,0) AS revision,
 s.comment_revision,s.content_revision,s.updated_at_ms,
 CASE WHEN s.comment_id IS NULL THEN 0
  WHEN s.content_revision<>COALESCE((
   SELECT MAX(ch.revision) FROM guest_comment_changes ch
   WHERE ch.comment_id=g.id AND ch.operation IN('create','edit')
  ),0) THEN 1 ELSE 0 END AS stale
FROM guest_comments g
LEFT JOIN owner_comment_processing_state s ON s.comment_id=g.id;

CREATE TRIGGER owner_comment_processing_commands_insert_guard
BEFORE INSERT ON owner_comment_processing_commands BEGIN
 SELECT CASE WHEN NEW.id IS NULL OR length(NEW.id)<>36
  OR NEW.id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.id GLOB '*[^0-9A-Fa-f-]*' OR length(replace(NEW.id,'-',''))<>32
  OR NEW.request_id IS NULL OR length(NEW.request_id)<>36
  OR NEW.request_id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.request_id GLOB '*[^0-9a-f-]*' OR length(replace(NEW.request_id,'-',''))<>32
  OR NEW.request_id<>lower(NEW.request_id)
  OR NEW.operation<>'set_processing_state'
  OR NEW.target_state NOT IN('open','in_progress','resolved')
  OR NEW.request_json IS NULL OR NOT json_valid(NEW.request_json)
  OR json_type(NEW.request_json)<>'object' OR length(NEW.request_json)>20000
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN json_type(NEW.request_json,'$.requestId')<>'text'
  OR json_extract(NEW.request_json,'$.requestId')<>NEW.request_id
  OR json_type(NEW.request_json,'$.operation')<>'text'
  OR json_extract(NEW.request_json,'$.operation')<>'set_processing_state'
  OR json_type(NEW.request_json,'$.inviteId')<>'text'
  OR json_extract(NEW.request_json,'$.inviteId')<>NEW.invite_id
  OR json_type(NEW.request_json,'$.photoId')<>'text'
  OR json_extract(NEW.request_json,'$.photoId')<>NEW.photo_id
  OR json_type(NEW.request_json,'$.versionId')<>'text'
  OR json_extract(NEW.request_json,'$.versionId')<>NEW.version_id
  OR json_type(NEW.request_json,'$.commentId')<>'text'
  OR json_extract(NEW.request_json,'$.commentId')<>NEW.comment_id
  OR json_type(NEW.request_json,'$.expectedCommentRevision')<>'integer'
  OR json_extract(NEW.request_json,'$.expectedCommentRevision')<>NEW.expected_comment_revision
  OR json_type(NEW.request_json,'$.expectedProcessingRevision')<>'integer'
  OR json_extract(NEW.request_json,'$.expectedProcessingRevision')<>NEW.expected_processing_revision
  OR json_type(NEW.request_json,'$.state')<>'text'
  OR json_extract(NEW.request_json,'$.state')<>NEW.target_state
  OR NEW.request_json<>json_object(
   'requestId',NEW.request_id,'operation','set_processing_state','inviteId',NEW.invite_id,
   'photoId',NEW.photo_id,'versionId',NEW.version_id,'commentId',NEW.comment_id,
   'expectedCommentRevision',NEW.expected_comment_revision,
   'expectedProcessingRevision',NEW.expected_processing_revision,'state',NEW.target_state)
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
  OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
  THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
  WHERE o.user_id=NEW.actor_id AND o.enabled=1
   AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
 ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 -- Check live Owner ownership, the exact sealed invitation/grant and eligible version
 -- before replay. Invitation expiry/revocation deliberately do not block Owner history.
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM workspaces w
  JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id
   AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
   AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id
   AND ev.album_id=a.id AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  JOIN guest_comments g ON g.id=NEW.comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
   AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
 ) THEN RAISE(ABORT,'NOT_FOUND') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM workspaces w
  JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id
   AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
   AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id
   AND ev.album_id=a.id AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
   AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
 ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

 -- Exact canonical replay uses the newly authenticated session but preserves the old
 -- command/session/receipt. It precedes parent tombstone and mutable revision checks.
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM owner_comment_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
   AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
    OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.invite_id<>NEW.invite_id
    OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id OR c.comment_id<>NEW.comment_id
    OR c.target_state<>NEW.target_state
    OR c.expected_comment_revision<>NEW.expected_comment_revision
    OR c.expected_processing_revision<>NEW.expected_processing_revision
    OR c.request_json<>NEW.request_json)
 ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM owner_comment_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
 ) THEN RAISE(IGNORE) END;

 -- Symmetric actor/request namespace with every existing Owner ledger and witness.
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
  OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
   AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
   AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.id=NEW.id)
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_COMMAND') END;
 -- Guest tombstones block a new command, but the exact replay above remains recoverable.
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM guest_comments g WHERE g.id=NEW.comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
   AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
   AND g.state<>'deleted'
 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM guest_comments g WHERE g.id=NEW.comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
   AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
   AND g.state<>'deleted' AND g.revision=NEW.expected_comment_revision
 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
 SELECT CASE WHEN COALESCE((
  SELECT s.revision FROM owner_comment_processing_state s WHERE s.comment_id=NEW.comment_id
 ),0)<>NEW.expected_processing_revision
  THEN RAISE(ABORT,'COMMENT_PROCESSING_REVISION_CONFLICT') END;
 SELECT CASE WHEN NEW.expected_processing_revision>=9007199254740991
  THEN RAISE(ABORT,'COMMENT_PROCESSING_REVISION_EXHAUSTED') END;
 SELECT CASE WHEN NEW.content_revision<>COALESCE((
  SELECT MAX(ch.revision) FROM guest_comment_changes ch
  WHERE ch.comment_id=NEW.comment_id AND ch.operation IN('create','edit')
 ),0) OR NEW.content_revision<1 OR NEW.content_revision>NEW.expected_comment_revision
  THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_comment_processing_state_insert_guard
BEFORE INSERT ON owner_comment_processing_state BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_processing_state s
  WHERE s.comment_id=NEW.comment_id)
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_STATE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owner_comment_processing_commands c
  JOIN guest_comments g ON g.id=c.comment_id
  WHERE c.id=NEW.last_command_id AND c.operation='set_processing_state'
   AND c.expected_processing_revision=0 AND c.expected_comment_revision=NEW.comment_revision
   AND c.content_revision=NEW.content_revision AND c.target_state=NEW.state
   AND c.created_at_ms=NEW.updated_at_ms AND c.actor_id IS NOT NULL
   AND c.comment_id=NEW.comment_id AND c.invite_id=NEW.invite_id
   AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
   AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id AND NEW.revision=1
   AND g.state<>'deleted' AND g.revision=c.expected_comment_revision
   AND g.invite_id=c.invite_id AND g.workspace_id=c.workspace_id AND g.project_id=c.project_id
   AND g.album_id=c.album_id AND g.photo_id=c.photo_id AND g.version_id=c.version_id
   AND c.content_revision=COALESCE((
    SELECT MAX(ch.revision) FROM guest_comment_changes ch
    WHERE ch.comment_id=c.comment_id AND ch.operation IN('create','edit')
   ),0)
 ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_PROCESSING_STATE') END;
END;

CREATE TRIGGER owner_comment_processing_state_update_guard
BEFORE UPDATE ON owner_comment_processing_state BEGIN
 SELECT CASE WHEN NEW.comment_id<>OLD.comment_id OR NEW.invite_id<>OLD.invite_id
  OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id
  OR NEW.photo_id<>OLD.photo_id OR NEW.version_id<>OLD.version_id
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_SCOPE') END;
 SELECT CASE WHEN OLD.revision>=9007199254740991
  OR NEW.revision<>OLD.revision+1 OR NEW.updated_at_ms<OLD.updated_at_ms
  OR NOT EXISTS(
   SELECT 1 FROM owner_comment_processing_commands c
   JOIN guest_comments g ON g.id=c.comment_id
   WHERE c.id=NEW.last_command_id AND c.operation='set_processing_state'
    AND c.expected_processing_revision=OLD.revision
    AND c.expected_comment_revision=NEW.comment_revision
    AND c.content_revision=NEW.content_revision AND c.target_state=NEW.state
    AND c.created_at_ms=NEW.updated_at_ms AND c.comment_id=NEW.comment_id
    AND c.invite_id=NEW.invite_id AND c.workspace_id=NEW.workspace_id
    AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
    AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
    AND NEW.revision=c.expected_processing_revision+1
    AND g.state<>'deleted' AND g.revision=c.expected_comment_revision
    AND g.invite_id=c.invite_id AND g.workspace_id=c.workspace_id AND g.project_id=c.project_id
    AND g.album_id=c.album_id AND g.photo_id=c.photo_id AND g.version_id=c.version_id
    AND c.content_revision=COALESCE((
     SELECT MAX(ch.revision) FROM guest_comment_changes ch
     WHERE ch.comment_id=c.comment_id AND ch.operation IN('create','edit')
    ),0)
  ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_PROCESSING_PREDECESSOR') END;
END;
CREATE TRIGGER owner_comment_processing_state_no_delete
BEFORE DELETE ON owner_comment_processing_state BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_STATE');
END;

CREATE TRIGGER owner_comment_processing_changes_insert_guard
BEFORE INSERT ON owner_comment_processing_changes BEGIN
 SELECT CASE WHEN NEW.event_id IS NULL OR EXISTS(
  SELECT 1 FROM owner_comment_processing_changes x WHERE x.event_id=NEW.event_id
   OR (NEW.seq IS NOT NULL AND x.seq=NEW.seq)
   OR (x.comment_id=NEW.comment_id AND x.revision=NEW.revision)
 ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_CHANGE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owner_comment_processing_commands cmd
  JOIN owner_comment_processing_state s ON s.comment_id=NEW.comment_id
  WHERE cmd.id=NEW.command_id AND cmd.actor_id=NEW.actor_id
   AND cmd.session_id=NEW.session_id AND cmd.request_id=NEW.request_id
   AND cmd.invite_id=NEW.invite_id AND cmd.workspace_id=NEW.workspace_id
   AND cmd.project_id=NEW.project_id AND cmd.album_id=NEW.album_id
   AND cmd.photo_id=NEW.photo_id AND cmd.version_id=NEW.version_id
   AND cmd.comment_id=NEW.comment_id AND cmd.operation='set_processing_state'
   AND cmd.created_at_ms=NEW.occurred_at_ms AND s.last_command_id=cmd.id
   AND s.invite_id=NEW.invite_id AND s.workspace_id=NEW.workspace_id
   AND s.project_id=NEW.project_id AND s.album_id=NEW.album_id
   AND s.photo_id=NEW.photo_id AND s.version_id=NEW.version_id
   AND s.revision=NEW.revision AND NEW.revision=cmd.expected_processing_revision+1
   AND s.comment_revision=cmd.expected_comment_revision
   AND s.content_revision=cmd.content_revision AND s.state=cmd.target_state
   AND NEW.event_id='owner-comment-processing:'||s.comment_id||':'||s.revision
   AND NEW.after_json=json_object('commentId',s.comment_id,'state',s.state,'revision',s.revision,
    'commentRevision',s.comment_revision,'contentRevision',s.content_revision)
   AND (
    (cmd.expected_processing_revision=0 AND NEW.revision=1
     AND NOT EXISTS(SELECT 1 FROM owner_comment_processing_changes p WHERE p.comment_id=s.comment_id)
     AND NEW.before_json=json_object('commentId',s.comment_id,'state','open','revision',0,
      'commentRevision',NULL,'contentRevision',NULL))
    OR (cmd.expected_processing_revision>0
     AND NEW.before_json=(SELECT p.after_json FROM owner_comment_processing_changes p
      WHERE p.comment_id=s.comment_id AND p.revision=s.revision-1))
   )
 ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_PROCESSING_CHANGE') END;
END;
CREATE TRIGGER owner_comment_processing_changes_no_update
BEFORE UPDATE ON owner_comment_processing_changes BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_CHANGE');
END;
CREATE TRIGGER owner_comment_processing_changes_no_delete
BEFORE DELETE ON owner_comment_processing_changes BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_CHANGE');
END;

CREATE TRIGGER owner_comment_processing_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action='owner.comment_processing_changed' BEGIN
 SELECT CASE WHEN NEW.actor_type<>'user' OR NEW.session_id IS NULL
  OR NEW.guest_session_id IS NOT NULL OR NOT EXISTS(
   SELECT 1 FROM owner_comment_processing_changes ch
   JOIN owner_comment_processing_commands cmd ON cmd.id=ch.command_id
   WHERE ch.event_id=NEW.event_id AND cmd.operation='set_processing_state'
    AND NEW.actor_id=ch.actor_id AND NEW.session_id=ch.session_id
    AND NEW.workspace_id=ch.workspace_id AND NEW.project_id=ch.project_id
    AND NEW.album_id=ch.album_id AND NEW.photo_id=ch.photo_id AND NEW.version_id=ch.version_id
    AND NEW.before_json=ch.before_json AND NEW.after_json=ch.after_json
    AND NEW.request_id=ch.request_id
    AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_PROCESSING_AUDIT') END;
END;

CREATE TRIGGER owner_comment_processing_changes_thread_marker
AFTER INSERT ON owner_comment_processing_changes BEGIN
 INSERT INTO comment_thread_changes(
  source_kind,source_event_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,occurred_at_ms
 )
 VALUES('owner',NEW.event_id,NEW.invite_id,NEW.workspace_id,NEW.project_id,
  NEW.album_id,NEW.photo_id,NEW.version_id,NEW.occurred_at_ms);
END;

-- The existing table and sequence are preserved. Extend only its insert witness:
-- Guest markers stay identical; Owner markers may prove either a reply or a status change.
DROP TRIGGER comment_thread_changes_insert_guard;
CREATE TRIGGER comment_thread_changes_insert_guard
BEFORE INSERT ON comment_thread_changes BEGIN
 SELECT CASE WHEN NEW.source_event_id IS NULL OR EXISTS(SELECT 1 FROM comment_thread_changes m
  WHERE (m.source_kind=NEW.source_kind AND m.source_event_id=NEW.source_event_id)
   OR (NEW.seq IS NOT NULL AND m.seq=NEW.seq))
  THEN RAISE(ABORT,'IMMUTABLE_COMMENT_THREAD_CHANGE') END;
 SELECT CASE WHEN NEW.source_kind='guest' AND NOT EXISTS(
  SELECT 1 FROM guest_comment_changes ch JOIN guest_comment_commands cmd ON cmd.id=ch.command_id
  WHERE ch.event_id=NEW.source_event_id AND ch.invite_id=NEW.invite_id
   AND ch.workspace_id=NEW.workspace_id AND ch.project_id=NEW.project_id AND ch.album_id=NEW.album_id
   AND ch.photo_id=NEW.photo_id AND ch.version_id=NEW.version_id AND ch.occurred_at_ms=NEW.occurred_at_ms
   AND cmd.invite_id=ch.invite_id AND cmd.workspace_id=ch.workspace_id AND cmd.project_id=ch.project_id
   AND cmd.album_id=ch.album_id AND ch.event_id='guest-comment:'||ch.comment_id||':'||ch.revision
 ) THEN RAISE(ABORT,'INVALID_COMMENT_THREAD_CHANGE') END;
 SELECT CASE WHEN NEW.source_kind='owner' AND NOT (
  EXISTS(
   SELECT 1 FROM owner_comment_changes ch JOIN owner_comment_commands cmd ON cmd.id=ch.command_id
   WHERE ch.event_id=NEW.source_event_id AND ch.invite_id=NEW.invite_id
    AND ch.workspace_id=NEW.workspace_id AND ch.project_id=NEW.project_id AND ch.album_id=NEW.album_id
    AND ch.photo_id=NEW.photo_id AND ch.version_id=NEW.version_id AND ch.occurred_at_ms=NEW.occurred_at_ms
    AND cmd.invite_id=ch.invite_id AND cmd.workspace_id=ch.workspace_id AND cmd.project_id=ch.project_id
    AND cmd.album_id=ch.album_id AND ch.event_id='owner-comment-reply:'||ch.reply_id||':'||ch.revision
  )
  OR EXISTS(
   SELECT 1 FROM owner_comment_processing_changes ch
   JOIN owner_comment_processing_commands cmd ON cmd.id=ch.command_id
   WHERE ch.event_id=NEW.source_event_id AND ch.invite_id=NEW.invite_id
    AND ch.workspace_id=NEW.workspace_id AND ch.project_id=NEW.project_id AND ch.album_id=NEW.album_id
    AND ch.photo_id=NEW.photo_id AND ch.version_id=NEW.version_id
    AND ch.occurred_at_ms=NEW.occurred_at_ms AND ch.command_id=cmd.id
    AND cmd.invite_id=ch.invite_id AND cmd.workspace_id=ch.workspace_id
    AND cmd.project_id=ch.project_id AND cmd.album_id=ch.album_id
    AND cmd.photo_id=ch.photo_id AND cmd.version_id=ch.version_id
    AND cmd.comment_id=ch.comment_id AND cmd.actor_id=ch.actor_id
    AND cmd.session_id=ch.session_id AND cmd.request_id=ch.request_id
    AND ch.event_id='owner-comment-processing:'||ch.comment_id||':'||ch.revision
  )
 ) THEN RAISE(ABORT,'INVALID_COMMENT_THREAD_CHANGE') END;
END;

CREATE TRIGGER owner_comment_processing_state_insert_change
AFTER INSERT ON owner_comment_processing_state BEGIN
 INSERT INTO owner_comment_processing_changes(
  event_id,command_id,actor_id,session_id,request_id,invite_id,workspace_id,project_id,album_id,
  photo_id,version_id,comment_id,revision,occurred_at_ms,before_json,after_json
 )
 SELECT 'owner-comment-processing:'||NEW.comment_id||':'||NEW.revision,c.id,c.actor_id,c.session_id,
  c.request_id,c.invite_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,
  NEW.comment_id,NEW.revision,c.created_at_ms,
  json_object('commentId',NEW.comment_id,'state','open','revision',0,'commentRevision',NULL,'contentRevision',NULL),
  json_object('commentId',NEW.comment_id,'state',NEW.state,'revision',NEW.revision,
   'commentRevision',NEW.comment_revision,'contentRevision',NEW.content_revision)
 FROM owner_comment_processing_commands c WHERE c.id=NEW.last_command_id;
 INSERT INTO audit_events(
  event_id,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,album_id,
  photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
 )
 SELECT ch.event_id,'user',ch.actor_id,ch.session_id,NULL,ch.workspace_id,ch.project_id,ch.album_id,
  ch.photo_id,ch.version_id,'owner.comment_processing_changed',ch.before_json,ch.after_json,
  ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
 FROM owner_comment_processing_changes ch
 WHERE ch.comment_id=NEW.comment_id AND ch.revision=NEW.revision;
END;

CREATE TRIGGER owner_comment_processing_state_update_change
AFTER UPDATE ON owner_comment_processing_state BEGIN
 INSERT INTO owner_comment_processing_changes(
  event_id,command_id,actor_id,session_id,request_id,invite_id,workspace_id,project_id,album_id,
  photo_id,version_id,comment_id,revision,occurred_at_ms,before_json,after_json
 )
 SELECT 'owner-comment-processing:'||NEW.comment_id||':'||NEW.revision,c.id,c.actor_id,c.session_id,
  c.request_id,c.invite_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,
  NEW.comment_id,NEW.revision,c.created_at_ms,
  json_object('commentId',OLD.comment_id,'state',OLD.state,'revision',OLD.revision,
   'commentRevision',OLD.comment_revision,'contentRevision',OLD.content_revision),
  json_object('commentId',NEW.comment_id,'state',NEW.state,'revision',NEW.revision,
   'commentRevision',NEW.comment_revision,'contentRevision',NEW.content_revision)
 FROM owner_comment_processing_commands c WHERE c.id=NEW.last_command_id;
 INSERT INTO audit_events(
  event_id,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,album_id,
  photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
 )
 SELECT ch.event_id,'user',ch.actor_id,ch.session_id,NULL,ch.workspace_id,ch.project_id,ch.album_id,
  ch.photo_id,ch.version_id,'owner.comment_processing_changed',ch.before_json,ch.after_json,
  ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
 FROM owner_comment_processing_changes ch
 WHERE ch.comment_id=NEW.comment_id AND ch.revision=NEW.revision;
END;

CREATE TRIGGER owner_comment_processing_results_insert_guard
BEFORE INSERT ON owner_comment_processing_results BEGIN
 SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM owner_comment_processing_results r WHERE r.command_id=NEW.command_id
   OR (r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
 ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_RESULT') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owner_comment_processing_commands c
  JOIN owner_comment_processing_state s ON s.comment_id=c.comment_id
  JOIN owner_comment_processing_changes ch ON ch.command_id=c.id
   AND ch.comment_id=c.comment_id AND ch.revision=s.revision
  WHERE c.id=NEW.command_id AND c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
   AND c.created_at_ms=NEW.occurred_at_ms AND s.last_command_id=c.id
   AND s.comment_revision=c.expected_comment_revision AND s.content_revision=c.content_revision
   AND s.state=c.target_state AND NEW.result_json=json_object(
    'requestId',c.request_id,'operation',c.operation,'commentId',c.comment_id,
    'photoId',c.photo_id,'versionId',c.version_id,
    'processing',json_object('state',s.state,'revision',s.revision,
     'commentRevision',s.comment_revision,'contentRevision',s.content_revision,
     'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch'),
     'stale',json('false')),
    'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'))
 ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_PROCESSING_RESULT') END;
END;
CREATE TRIGGER owner_comment_processing_results_no_update
BEFORE UPDATE ON owner_comment_processing_results BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_RESULT');
END;
CREATE TRIGGER owner_comment_processing_results_no_delete
BEFORE DELETE ON owner_comment_processing_results BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_RESULT');
END;

CREATE TRIGGER owner_comment_processing_command_apply
AFTER INSERT ON owner_comment_processing_commands BEGIN
 UPDATE owner_comment_processing_state SET
  state=NEW.target_state,revision=NEW.expected_processing_revision+1,
  comment_revision=NEW.expected_comment_revision,content_revision=NEW.content_revision,
  updated_at_ms=NEW.created_at_ms,last_command_id=NEW.id
 WHERE NEW.expected_processing_revision>0 AND comment_id=NEW.comment_id
  AND revision=NEW.expected_processing_revision;
 INSERT INTO owner_comment_processing_state(
  comment_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,
  state,revision,comment_revision,content_revision,updated_at_ms,last_command_id
 )
 SELECT NEW.comment_id,NEW.invite_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,
  NEW.target_state,1,NEW.expected_comment_revision,NEW.content_revision,NEW.created_at_ms,NEW.id
 WHERE NEW.expected_processing_revision=0 AND NOT EXISTS(
  SELECT 1 FROM owner_comment_processing_state s WHERE s.comment_id=NEW.comment_id
 );
 INSERT INTO owner_comment_processing_results(command_id,actor_id,request_id,result_json,occurred_at_ms)
 SELECT NEW.id,NEW.actor_id,NEW.request_id,
  json_object('requestId',NEW.request_id,'operation',NEW.operation,'commentId',NEW.comment_id,
   'photoId',NEW.photo_id,'versionId',NEW.version_id,
   'processing',json_object('state',s.state,'revision',s.revision,
    'commentRevision',s.comment_revision,'contentRevision',s.content_revision,
    'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',s.updated_at_ms/1000.0,'unixepoch'),
    'stale',json('false')),
   'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
  NEW.created_at_ms
 FROM owner_comment_processing_state s
 WHERE s.comment_id=NEW.comment_id AND s.last_command_id=NEW.id;
END;
CREATE TRIGGER owner_comment_processing_commands_no_update
BEFORE UPDATE ON owner_comment_processing_commands BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_COMMAND');
END;
CREATE TRIGGER owner_comment_processing_commands_no_delete
BEFORE DELETE ON owner_comment_processing_commands BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_COMMAND');
END;

-- Old Owner writers get an inverse transactional guard so a processing request can
-- never collide with a legacy command regardless of which side inserts first.
CREATE TRIGGER owner_comment_processing_ns_01 AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_02 AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_03 AFTER INSERT ON upload_requests
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_04 AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_05 AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_06 AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_07 AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_08 AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_09 AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_10 AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_11 AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_12 AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_owner_comment_commands AFTER INSERT ON owner_comment_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_external_intents AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_upload_fences AFTER INSERT ON upload_key_fences
WHEN NEW.actor_type='user' AND EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_processing_ns_selection_reopened AFTER INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' AND EXISTS(
 SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
