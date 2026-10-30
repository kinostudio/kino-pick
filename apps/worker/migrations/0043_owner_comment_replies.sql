-- M3f2 Owner replies: forward-only, no Guest history backfill.
PRAGMA foreign_keys=ON;

-- Existing accepted ledgers stay unchanged; canonical probes include old UUID case.
CREATE INDEX owner_comment_ns_case_workspace_commands ON workspace_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_request_commands ON request_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_upload_requests ON upload_requests(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_upload_workflow_requests ON upload_workflow_requests(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_processing_review_commands ON processing_review_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_invite_revocation_commands ON invite_revocation_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_invite_creation_commands ON invite_creation_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_selection_policy_commands ON selection_policy_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_selection_policy_configuration_commands ON selection_policy_configuration_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_shared_review_owner_commands ON shared_review_owner_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_photo_version_head_commands ON photo_version_head_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_project_versioning_commands ON project_versioning_commands(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_owner_external_intents ON owner_external_intents(actor_id,lower(request_id));
CREATE INDEX owner_comment_ns_case_fences ON upload_key_fences(actor_id,lower(request_id)) WHERE actor_type='user';
CREATE INDEX owner_comment_ns_case_reopened ON audit_events(actor_id,lower(request_id)) WHERE actor_type='user' AND action='selection.reopened';

CREATE TABLE owner_comment_commands(
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36 AND id GLOB '????????-????-????-????-????????????' AND id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(id,'-',''))=32),
 actor_id TEXT NOT NULL REFERENCES users(id),
 session_id TEXT NOT NULL,
 request_id TEXT NOT NULL CHECK(request_id=lower(request_id) AND length(request_id)=36 AND request_id GLOB '????????-????-????-????-????????????' AND request_id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(request_id,'-',''))=32),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT NOT NULL, album_id TEXT NOT NULL, invite_id TEXT NOT NULL,
 photo_id TEXT NOT NULL, version_id TEXT NOT NULL,
 parent_comment_id TEXT NOT NULL CHECK(length(parent_comment_id)=36 AND parent_comment_id GLOB '????????-????-????-????-????????????' AND parent_comment_id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(parent_comment_id,'-',''))=32),
 reply_id TEXT NOT NULL CHECK(length(reply_id)=36 AND reply_id GLOB '????????-????-????-????-????????????' AND reply_id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(reply_id,'-',''))=32),
 operation TEXT NOT NULL CHECK(operation IN('reply','edit_reply','delete_reply')),
 request_json TEXT NOT NULL CHECK(json_valid(request_json) AND json_type(request_json)='object' AND length(request_json)<=20000),
 created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER)) CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
 UNIQUE(actor_id,request_id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
 FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
 FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
 FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id),
 FOREIGN KEY(reply_id) REFERENCES owner_comment_replies(id),
 CHECK(
  (operation='reply' AND json_extract(request_json,'$.requestId')=request_id AND json_extract(request_json,'$.operation')='reply'
   AND json_extract(request_json,'$.inviteId')=invite_id AND json_extract(request_json,'$.photoId')=photo_id
   AND json_extract(request_json,'$.versionId')=version_id AND json_extract(request_json,'$.parentCommentId')=parent_comment_id
   AND json_type(request_json,'$.expectedParentRevision')='integer' AND json_type(request_json,'$.body')='text'
   AND request_json=json_object('requestId',request_id,'operation','reply','inviteId',invite_id,'photoId',photo_id,'versionId',version_id,
     'parentCommentId',parent_comment_id,'expectedParentRevision',json_extract(request_json,'$.expectedParentRevision'),'body',json_extract(request_json,'$.body')))
  OR (operation='edit_reply' AND json_extract(request_json,'$.requestId')=request_id AND json_extract(request_json,'$.operation')='edit_reply'
   AND json_extract(request_json,'$.replyId')=reply_id AND json_type(request_json,'$.expectedRevision')='integer' AND json_type(request_json,'$.body')='text'
   AND request_json=json_object('requestId',request_id,'operation','edit_reply','replyId',reply_id,
     'expectedRevision',json_extract(request_json,'$.expectedRevision'),'body',json_extract(request_json,'$.body')))
  OR (operation='delete_reply' AND json_extract(request_json,'$.requestId')=request_id AND json_extract(request_json,'$.operation')='delete_reply'
   AND json_extract(request_json,'$.replyId')=reply_id AND json_type(request_json,'$.expectedRevision')='integer'
   AND request_json=json_object('requestId',request_id,'operation','delete_reply','replyId',reply_id,
     'expectedRevision',json_extract(request_json,'$.expectedRevision')))
 )
);

CREATE TABLE owner_comment_replies(
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36 AND id GLOB '????????-????-????-????-????????????' AND id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(id,'-',''))=32),
 invite_id TEXT NOT NULL, author_user_id TEXT NOT NULL REFERENCES users(id),
 workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL, photo_id TEXT NOT NULL, version_id TEXT NOT NULL,
 parent_comment_id TEXT NOT NULL CHECK(length(parent_comment_id)=36 AND parent_comment_id GLOB '????????-????-????-????-????????????' AND parent_comment_id NOT GLOB '*[^0-9A-Fa-f-]*' AND length(replace(parent_comment_id,'-',''))=32),
 body TEXT, state TEXT NOT NULL CHECK(state IN('open','deleted')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 1 AND 9007199254740991),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN created_at_ms AND 9007199254740991),
 created_command_id TEXT NOT NULL REFERENCES owner_comment_commands(id), last_command_id TEXT NOT NULL REFERENCES owner_comment_commands(id),
 CHECK((state='deleted')=(body IS NULL)), CHECK(body IS NULL OR (length(body) BETWEEN 1 AND 2000 AND body=trim(body))),
 FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
 FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
 FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX owner_comment_replies_page ON owner_comment_replies(invite_id,album_id,photo_id,version_id,created_at_ms,id);
CREATE INDEX owner_comment_replies_parent ON owner_comment_replies(invite_id,parent_comment_id,created_at_ms,id);

CREATE TABLE owner_comment_changes(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
 command_id TEXT NOT NULL REFERENCES owner_comment_commands(id), request_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id), session_id TEXT NOT NULL,
 invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL,
 photo_id TEXT NOT NULL, version_id TEXT NOT NULL, reply_id TEXT NOT NULL REFERENCES owner_comment_replies(id),
 operation TEXT NOT NULL CHECK(operation IN('reply','edit_reply','delete_reply')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 occurred_at_ms INTEGER NOT NULL CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991),
 before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'),
 after_json TEXT NOT NULL CHECK(json_valid(after_json) AND json_type(after_json)='object'),
 UNIQUE(reply_id,revision),
 FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
 FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
 FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX owner_comment_changes_scope ON owner_comment_changes(invite_id,album_id,photo_id,version_id,seq);
CREATE TABLE owner_comment_results(
 command_id TEXT PRIMARY KEY NOT NULL REFERENCES owner_comment_commands(id),
 actor_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json)='object' AND length(result_json)<=100000),
 occurred_at_ms INTEGER NOT NULL CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 1 AND 9007199254740991),
 UNIQUE(actor_id,request_id)
);

CREATE TABLE comment_thread_changes(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 source_kind TEXT NOT NULL CHECK(source_kind IN('guest','owner')),
 source_event_id TEXT NOT NULL CHECK(length(source_event_id) BETWEEN 1 AND 200),
 invite_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, album_id TEXT NOT NULL, photo_id TEXT NOT NULL, version_id TEXT NOT NULL,
 occurred_at_ms INTEGER NOT NULL CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms BETWEEN 0 AND 9007199254740991),
 UNIQUE(source_kind,source_event_id),
 FOREIGN KEY(invite_id,workspace_id,project_id,album_id) REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
 FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
 FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
 FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX comment_thread_changes_scope ON comment_thread_changes(invite_id,album_id,photo_id,version_id,seq);

CREATE TRIGGER owner_comment_commands_insert_guard
BEFORE INSERT ON owner_comment_commands BEGIN
 SELECT CASE WHEN NEW.id IS NULL OR length(NEW.id)<>36 OR NEW.id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.id GLOB '*[^0-9A-Fa-f-]*' OR length(replace(NEW.id,'-',''))<>32
  OR NEW.request_id IS NULL OR length(NEW.request_id)<>36 OR NEW.request_id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.request_id GLOB '*[^0-9A-Fa-f-]*' OR length(replace(NEW.request_id,'-',''))<>32
  OR NEW.request_id<>lower(NEW.request_id)
  OR NEW.operation NOT IN('reply','edit_reply','delete_reply') OR NEW.request_json IS NULL
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
  WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
 ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM workspaces w JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id AND ev.album_id=a.id
   AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
 ) THEN RAISE(ABORT,'NOT_FOUND') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM workspaces w JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id AND ev.album_id=a.id
   AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
   AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
 ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
 -- Invitation expiry/revocation do not invalidate historical Owner threads.
 SELECT CASE WHEN NEW.operation='reply' AND NOT (
  EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.parent_comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id AND g.album_id=NEW.album_id
   AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id)

 ) THEN RAISE(ABORT,'NOT_FOUND') END;
 SELECT CASE WHEN NEW.operation IN('edit_reply','delete_reply') AND NOT EXISTS(
  SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id AND r.author_user_id=NEW.actor_id
   AND r.invite_id=NEW.invite_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
   AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
   AND r.parent_comment_id=NEW.parent_comment_id
 ) THEN RAISE(ABORT,'NOT_FOUND') END;

 -- Fresh valid sessions can recover exact actor/request claims; original session/result is retained.
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
   OR c.album_id<>NEW.album_id OR c.invite_id<>NEW.invite_id OR c.photo_id<>NEW.photo_id
   OR c.version_id<>NEW.version_id OR c.parent_comment_id<>NEW.parent_comment_id
   OR c.request_json<>NEW.request_json OR (NEW.operation<>'reply' AND c.reply_id<>NEW.reply_id))
 ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
 ) THEN RAISE(IGNORE) END;

 SELECT CASE WHEN COALESCE(CASE WHEN json_valid(NEW.request_json)
  THEN json_type(NEW.request_json)='object' ELSE 0 END,0)<>1
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NOT (
  (NEW.operation='reply' AND json_type(NEW.request_json,'$.requestId')='text'
   AND json_type(NEW.request_json,'$.operation')='text' AND json_extract(NEW.request_json,'$.requestId')=NEW.request_id
   AND json_extract(NEW.request_json,'$.operation')='reply' AND json_type(NEW.request_json,'$.inviteId')='text'
   AND json_extract(NEW.request_json,'$.inviteId')=NEW.invite_id AND json_type(NEW.request_json,'$.photoId')='text'
   AND json_extract(NEW.request_json,'$.photoId')=NEW.photo_id AND json_type(NEW.request_json,'$.versionId')='text'
   AND json_extract(NEW.request_json,'$.versionId')=NEW.version_id AND json_type(NEW.request_json,'$.parentCommentId')='text'
   AND json_extract(NEW.request_json,'$.parentCommentId')=NEW.parent_comment_id
   AND json_type(NEW.request_json,'$.expectedParentRevision')='integer'
   AND json_extract(NEW.request_json,'$.expectedParentRevision') BETWEEN 1 AND 9007199254740991
   AND json_type(NEW.request_json,'$.body')='text'
   AND NEW.request_json=json_object('requestId',NEW.request_id,'operation','reply','inviteId',NEW.invite_id,
    'photoId',NEW.photo_id,'versionId',NEW.version_id,'parentCommentId',NEW.parent_comment_id,
    'expectedParentRevision',json_extract(NEW.request_json,'$.expectedParentRevision'),'body',json_extract(NEW.request_json,'$.body')))
  OR (NEW.operation='edit_reply' AND json_type(NEW.request_json,'$.requestId')='text'
   AND json_type(NEW.request_json,'$.operation')='text' AND json_extract(NEW.request_json,'$.requestId')=NEW.request_id
   AND json_extract(NEW.request_json,'$.operation')='edit_reply' AND json_type(NEW.request_json,'$.replyId')='text'
   AND json_extract(NEW.request_json,'$.replyId')=NEW.reply_id AND json_type(NEW.request_json,'$.expectedRevision')='integer'
   AND json_extract(NEW.request_json,'$.expectedRevision') BETWEEN 1 AND 9007199254740991
   AND json_type(NEW.request_json,'$.body')='text'
   AND NEW.request_json=json_object('requestId',NEW.request_id,'operation','edit_reply','replyId',NEW.reply_id,
    'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision'),'body',json_extract(NEW.request_json,'$.body')))
  OR (NEW.operation='delete_reply' AND json_type(NEW.request_json,'$.requestId')='text'
   AND json_type(NEW.request_json,'$.operation')='text' AND json_extract(NEW.request_json,'$.requestId')=NEW.request_id
   AND json_extract(NEW.request_json,'$.operation')='delete_reply' AND json_type(NEW.request_json,'$.replyId')='text'
   AND json_extract(NEW.request_json,'$.replyId')=NEW.reply_id AND json_type(NEW.request_json,'$.expectedRevision')='integer'
   AND json_extract(NEW.request_json,'$.expectedRevision') BETWEEN 1 AND 9007199254740991
   AND NEW.request_json=json_object('requestId',NEW.request_id,'operation','delete_reply','replyId',NEW.reply_id,
    'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision')))
 ) THEN RAISE(ABORT,'INVALID_INPUT') END;

 SELECT CASE WHEN NEW.operation IN('reply','edit_reply') AND (
  length(json_extract(NEW.request_json,'$.body'))<1 OR length(json_extract(NEW.request_json,'$.body'))>2000
  OR json_extract(NEW.request_json,'$.body')<>trim(json_extract(NEW.request_json,'$.body'))
  OR instr(json_extract(NEW.request_json,'$.body'),char(0))>0 OR instr(json_extract(NEW.request_json,'$.body'),char(13))>0
  OR EXISTS(WITH RECURSIVE codepoints(body,pos,cp) AS (
   SELECT json_extract(NEW.request_json,'$.body'),1,unicode(substr(json_extract(NEW.request_json,'$.body'),1,1))
   UNION ALL SELECT body,pos+1,unicode(substr(body,pos+1,1)) FROM codepoints WHERE pos<length(body)
  ) SELECT 1 FROM codepoints WHERE cp IS NULL OR cp BETWEEN 1 AND 8 OR cp IN(11,12)
   OR cp BETWEEN 14 AND 31 OR cp BETWEEN 127 AND 159
   OR cp IN(173,1564,6158,8203,8204,8205,8206,8207,8234,8235,8236,8237,8238,8288,8289,8290,8291,8292,8294,8295,8296,8297,65279,65529,65530,65531)
   OR cp BETWEEN 1536 AND 1541 OR cp IN(1757,69821,69837,1807,2274,917505)
   OR cp BETWEEN 2192 AND 2193 OR cp BETWEEN 78896 AND 78911 OR cp BETWEEN 113824 AND 113827
   OR cp BETWEEN 119155 AND 119162 OR cp BETWEEN 917536 AND 917631)
 ) THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
   OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
   THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

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
  OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
   AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
   AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.id=NEW.id)
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_COMMAND') END;
 SELECT CASE WHEN NEW.operation='reply' AND (
  EXISTS(SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id)
  OR EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.reply_id)
 ) THEN RAISE(ABORT,'COMMENT_ID_COLLISION') END;
 SELECT CASE WHEN NEW.operation='reply' AND
  (SELECT count(*) FROM owner_comment_replies r WHERE r.invite_id=NEW.invite_id
   AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id)>=1000
  THEN RAISE(ABORT,'COMMENT_LIMIT_REACHED') END;
 SELECT CASE WHEN NEW.operation='reply' AND NOT (
  EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.parent_comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id AND g.album_id=NEW.album_id
   AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id AND g.state<>'deleted'
   AND g.revision=json_extract(NEW.request_json,'$.expectedParentRevision'))

 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
 SELECT CASE WHEN NEW.operation IN('edit_reply','delete_reply') AND EXISTS(
  SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id AND r.author_user_id=NEW.actor_id
   AND r.invite_id=NEW.invite_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
   AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
   AND r.parent_comment_id=NEW.parent_comment_id AND r.state='open'
   AND r.revision=json_extract(NEW.request_json,'$.expectedRevision')
   AND r.revision>=9007199254740991
 ) THEN RAISE(ABORT,'COMMENT_REVISION_EXHAUSTED') END; SELECT CASE WHEN NEW.operation IN('edit_reply','delete_reply') AND NOT EXISTS(
  SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id AND r.author_user_id=NEW.actor_id
   AND r.invite_id=NEW.invite_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
   AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
   AND r.parent_comment_id=NEW.parent_comment_id AND r.state='open' AND r.body IS NOT NULL
   AND r.revision=json_extract(NEW.request_json,'$.expectedRevision') AND r.revision<9007199254740991
   AND NEW.created_at_ms>=r.updated_at_ms
 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_comment_reply_insert_guard
BEFORE INSERT ON owner_comment_replies BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.id)
  OR EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.id)
  THEN RAISE(ABORT,'COMMENT_ID_COLLISION') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owner_comment_commands c WHERE c.id=NEW.created_command_id AND c.id=NEW.last_command_id
   AND c.operation='reply' AND c.actor_id=NEW.author_user_id AND c.invite_id=NEW.invite_id
   AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
   AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id AND c.parent_comment_id=NEW.parent_comment_id
   AND c.reply_id=NEW.id AND c.created_at_ms=NEW.created_at_ms AND NEW.updated_at_ms=NEW.created_at_ms
   AND NEW.revision=1 AND NEW.state='open' AND NEW.body=json_extract(c.request_json,'$.body')
   AND (EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.parent_comment_id
      AND g.invite_id=NEW.invite_id AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
      AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
      AND g.state<>'deleted' AND g.revision=json_extract(c.request_json,'$.expectedParentRevision'))
)
 ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_REPLY') END;
END;

CREATE TRIGGER owner_comment_reply_update_guard
BEFORE UPDATE ON owner_comment_replies BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.invite_id<>OLD.invite_id OR NEW.author_user_id<>OLD.author_user_id
  OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id
  OR NEW.photo_id<>OLD.photo_id OR NEW.version_id<>OLD.version_id OR NEW.parent_comment_id<>OLD.parent_comment_id
  OR NEW.created_at_ms<>OLD.created_at_ms OR NEW.created_command_id<>OLD.created_command_id
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_SCOPE') END;
 SELECT CASE WHEN OLD.state<>'open' OR OLD.body IS NULL OR OLD.revision>=9007199254740991
  OR NEW.revision<>OLD.revision+1 OR NEW.updated_at_ms<OLD.updated_at_ms
  OR NOT EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.id=NEW.last_command_id
   AND c.reply_id=OLD.id AND c.actor_id=OLD.author_user_id AND c.invite_id=OLD.invite_id
   AND c.workspace_id=OLD.workspace_id AND c.project_id=OLD.project_id AND c.album_id=OLD.album_id
   AND c.photo_id=OLD.photo_id AND c.version_id=OLD.version_id AND c.parent_comment_id=OLD.parent_comment_id
   AND c.created_at_ms=NEW.updated_at_ms AND json_extract(c.request_json,'$.replyId')=OLD.id
   AND json_extract(c.request_json,'$.expectedRevision')=OLD.revision
   AND ((c.operation='edit_reply' AND NEW.state='open' AND NEW.body=json_extract(c.request_json,'$.body'))
    OR (c.operation='delete_reply' AND NEW.state='deleted' AND NEW.body IS NULL))
  ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_PREDECESSOR') END;
END;
CREATE TRIGGER owner_comment_replies_no_delete BEFORE DELETE ON owner_comment_replies BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_REPLY');
END;

CREATE TRIGGER owner_comment_changes_insert_guard
BEFORE INSERT ON owner_comment_changes BEGIN
 SELECT CASE WHEN NEW.event_id IS NULL OR EXISTS(SELECT 1 FROM owner_comment_changes x
  WHERE x.event_id=NEW.event_id OR (NEW.seq IS NOT NULL AND x.seq=NEW.seq)
   OR (x.reply_id=NEW.reply_id AND x.revision=NEW.revision))
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_CHANGE') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owner_comment_commands cmd JOIN owner_comment_replies r ON r.id=NEW.reply_id
  WHERE cmd.id=NEW.command_id AND cmd.actor_id=NEW.actor_id AND cmd.session_id=NEW.session_id
   AND cmd.request_id=NEW.request_id AND cmd.invite_id=NEW.invite_id
   AND cmd.workspace_id=NEW.workspace_id AND cmd.project_id=NEW.project_id
   AND cmd.album_id=NEW.album_id AND cmd.photo_id=NEW.photo_id AND cmd.version_id=NEW.version_id
   AND cmd.parent_comment_id=r.parent_comment_id AND cmd.reply_id=r.id AND cmd.operation=NEW.operation
   AND cmd.created_at_ms=NEW.occurred_at_ms AND r.invite_id=NEW.invite_id
   AND r.author_user_id=NEW.actor_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
   AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
   AND r.last_command_id=cmd.id AND r.revision=NEW.revision
   AND NEW.event_id='owner-comment-reply:'||r.id||':'||r.revision
   AND NEW.after_json=json_object('commentId',r.id,'revision',r.revision,'state',r.state,'body',r.body,'parentCommentId',r.parent_comment_id)
   AND ((cmd.operation='reply' AND NEW.revision=1 AND r.created_command_id=cmd.id
     AND NEW.before_json=json_object('commentId',r.id,'revision',0,'state','absent','body',NULL,'parentCommentId',r.parent_comment_id))
    OR (cmd.operation IN('edit_reply','delete_reply')
     AND NEW.revision=json_extract(cmd.request_json,'$.expectedRevision')+1
     AND NEW.before_json=(SELECT p.after_json FROM owner_comment_changes p WHERE p.reply_id=r.id AND p.revision=r.revision-1)))
 ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_CHANGE') END;
END;
CREATE TRIGGER owner_comment_changes_no_update BEFORE UPDATE ON owner_comment_changes BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_CHANGE');
END;
CREATE TRIGGER owner_comment_changes_no_delete BEFORE DELETE ON owner_comment_changes BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_CHANGE');
END;

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
 SELECT CASE WHEN NEW.source_kind='owner' AND NOT EXISTS(
  SELECT 1 FROM owner_comment_changes ch JOIN owner_comment_commands cmd ON cmd.id=ch.command_id
  WHERE ch.event_id=NEW.source_event_id AND ch.invite_id=NEW.invite_id
   AND ch.workspace_id=NEW.workspace_id AND ch.project_id=NEW.project_id AND ch.album_id=NEW.album_id
   AND ch.photo_id=NEW.photo_id AND ch.version_id=NEW.version_id AND ch.occurred_at_ms=NEW.occurred_at_ms
   AND cmd.invite_id=ch.invite_id AND cmd.workspace_id=ch.workspace_id AND cmd.project_id=ch.project_id
   AND cmd.album_id=ch.album_id AND ch.event_id='owner-comment-reply:'||ch.reply_id||':'||ch.revision
 ) THEN RAISE(ABORT,'INVALID_COMMENT_THREAD_CHANGE') END;
END;
CREATE TRIGGER comment_thread_changes_no_update BEFORE UPDATE ON comment_thread_changes BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_COMMENT_THREAD_CHANGE');
END;
CREATE TRIGGER comment_thread_changes_no_delete BEFORE DELETE ON comment_thread_changes BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_COMMENT_THREAD_CHANGE');
END;

CREATE TRIGGER owner_comment_audit_insert_guard
BEFORE INSERT ON audit_events
WHEN NEW.action IN('owner.comment_reply_created','owner.comment_reply_edited','owner.comment_reply_deleted') BEGIN
 SELECT CASE WHEN NEW.actor_type<>'user' OR NEW.session_id IS NULL OR NEW.guest_session_id IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM owner_comment_changes ch WHERE ch.event_id=NEW.event_id
   AND NEW.action=CASE ch.operation WHEN 'reply' THEN 'owner.comment_reply_created'
    WHEN 'edit_reply' THEN 'owner.comment_reply_edited' WHEN 'delete_reply' THEN 'owner.comment_reply_deleted' END
   AND NEW.actor_id=ch.actor_id AND NEW.session_id=ch.session_id
   AND NEW.workspace_id=ch.workspace_id AND NEW.project_id=ch.project_id AND NEW.album_id=ch.album_id
   AND NEW.photo_id=ch.photo_id AND NEW.version_id=ch.version_id
   AND NEW.before_json=ch.before_json AND NEW.after_json=ch.after_json AND NEW.request_id=ch.request_id
   AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
 ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_AUDIT') END;
END;

CREATE TRIGGER guest_comment_owner_id_collision BEFORE INSERT ON guest_comments BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.id)
  THEN RAISE(ABORT,'COMMENT_ID_COLLISION') END;
END;

CREATE TRIGGER guest_comment_changes_thread_marker AFTER INSERT ON guest_comment_changes BEGIN
 INSERT INTO comment_thread_changes(source_kind,source_event_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,occurred_at_ms)
 VALUES('guest',NEW.event_id,NEW.invite_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,NEW.occurred_at_ms);
END;
CREATE TRIGGER owner_comment_changes_thread_marker AFTER INSERT ON owner_comment_changes BEGIN
 INSERT INTO comment_thread_changes(source_kind,source_event_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,occurred_at_ms)
 VALUES('owner',NEW.event_id,NEW.invite_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,NEW.occurred_at_ms);
END;

CREATE TRIGGER owner_comment_results_insert_guard BEFORE INSERT ON owner_comment_results BEGIN
 SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(SELECT 1 FROM owner_comment_results r
  WHERE r.command_id=NEW.command_id OR (r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id))
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_RESULT') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owner_comment_commands c JOIN owner_comment_replies r ON r.id=c.reply_id
  WHERE c.id=NEW.command_id AND c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
   AND c.created_at_ms=NEW.occurred_at_ms AND r.last_command_id=c.id AND r.author_user_id=c.actor_id
   AND NEW.result_json=json_object('requestId',c.request_id,'operation',c.operation,
    'item',json_object('commentId',r.id,'photoId',r.photo_id,'versionId',r.version_id,'revision',r.revision,
     'body',r.body,'state',r.state,'authorType','owner','parentCommentId',r.parent_comment_id,
     'authorLabel','攝影師','canEdit',json(CASE WHEN r.state='deleted' THEN 'false' ELSE 'true' END),
     'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch'),
     'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.updated_at_ms/1000.0,'unixepoch')),
    'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'))
 ) THEN RAISE(ABORT,'INVALID_OWNER_COMMENT_RESULT') END;
END;
CREATE TRIGGER owner_comment_results_no_update BEFORE UPDATE ON owner_comment_results BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_RESULT');
END;
CREATE TRIGGER owner_comment_results_no_delete BEFORE DELETE ON owner_comment_results BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_RESULT');
END;

CREATE TRIGGER owner_comment_reply_insert_change AFTER INSERT ON owner_comment_replies BEGIN
 INSERT INTO owner_comment_changes(event_id,command_id,request_id,actor_id,session_id,invite_id,workspace_id,
  project_id,album_id,photo_id,version_id,reply_id,operation,revision,occurred_at_ms,before_json,after_json)
 SELECT 'owner-comment-reply:'||NEW.id||':1',c.id,c.request_id,c.actor_id,c.session_id,c.invite_id,
  c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,NEW.id,'reply',1,c.created_at_ms,
  json_object('commentId',NEW.id,'revision',0,'state','absent','body',NULL,'parentCommentId',NEW.parent_comment_id),
  json_object('commentId',NEW.id,'revision',NEW.revision,'state',NEW.state,'body',NEW.body,'parentCommentId',NEW.parent_comment_id)
 FROM owner_comment_commands c WHERE c.id=NEW.created_command_id;
 INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,album_id,
  photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
 SELECT ch.event_id,'user',ch.actor_id,ch.session_id,NULL,ch.workspace_id,ch.project_id,ch.album_id,ch.photo_id,
  ch.version_id,'owner.comment_reply_created',ch.before_json,ch.after_json,ch.request_id,
  strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
 FROM owner_comment_changes ch WHERE ch.reply_id=NEW.id AND ch.revision=1;
END;

CREATE TRIGGER owner_comment_reply_update_change AFTER UPDATE ON owner_comment_replies BEGIN
 INSERT INTO owner_comment_changes(event_id,command_id,request_id,actor_id,session_id,invite_id,workspace_id,
  project_id,album_id,photo_id,version_id,reply_id,operation,revision,occurred_at_ms,before_json,after_json)
 SELECT 'owner-comment-reply:'||NEW.id||':'||NEW.revision,c.id,c.request_id,c.actor_id,c.session_id,
  c.invite_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,NEW.id,c.operation,NEW.revision,
  c.created_at_ms,json_object('commentId',OLD.id,'revision',OLD.revision,'state',OLD.state,
   'body',OLD.body,'parentCommentId',OLD.parent_comment_id),
  json_object('commentId',NEW.id,'revision',NEW.revision,'state',NEW.state,'body',NEW.body,
   'parentCommentId',NEW.parent_comment_id)
 FROM owner_comment_commands c WHERE c.id=NEW.last_command_id;
 INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,album_id,
  photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
 SELECT ch.event_id,'user',ch.actor_id,ch.session_id,NULL,ch.workspace_id,ch.project_id,ch.album_id,ch.photo_id,
  ch.version_id,CASE ch.operation WHEN 'edit_reply' THEN 'owner.comment_reply_edited'
   WHEN 'delete_reply' THEN 'owner.comment_reply_deleted' END,
  ch.before_json,ch.after_json,ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
 FROM owner_comment_changes ch WHERE ch.reply_id=NEW.id AND ch.revision=NEW.revision;
END;

CREATE TRIGGER owner_comment_command_apply AFTER INSERT ON owner_comment_commands BEGIN
 INSERT INTO owner_comment_replies(id,invite_id,author_user_id,workspace_id,project_id,album_id,photo_id,version_id,
  parent_comment_id,body,state,revision,created_at_ms,updated_at_ms,created_command_id,last_command_id)
 SELECT NEW.reply_id,NEW.invite_id,NEW.actor_id,NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,
  NEW.parent_comment_id,json_extract(NEW.request_json,'$.body'),'open',1,NEW.created_at_ms,NEW.created_at_ms,NEW.id,NEW.id
 WHERE NEW.operation='reply';
 UPDATE owner_comment_replies SET
  body=CASE WHEN NEW.operation='delete_reply' THEN NULL ELSE json_extract(NEW.request_json,'$.body') END,
  state=CASE WHEN NEW.operation='delete_reply' THEN 'deleted' ELSE 'open' END,
  revision=revision+1,updated_at_ms=NEW.created_at_ms,last_command_id=NEW.id
 WHERE NEW.operation IN('edit_reply','delete_reply') AND id=NEW.reply_id;
 INSERT INTO owner_comment_results(command_id,actor_id,request_id,result_json,occurred_at_ms)
 SELECT NEW.id,NEW.actor_id,NEW.request_id,
  json_object('requestId',NEW.request_id,'operation',NEW.operation,
   'item',json_object('commentId',r.id,'photoId',r.photo_id,'versionId',r.version_id,'revision',r.revision,
    'body',r.body,'state',r.state,'authorType','owner','parentCommentId',r.parent_comment_id,
    'authorLabel','攝影師','canEdit',json(CASE WHEN r.state='deleted' THEN 'false' ELSE 'true' END),
    'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch'),
    'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',r.updated_at_ms/1000.0,'unixepoch')),
   'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
  NEW.created_at_ms
 FROM owner_comment_replies r WHERE r.id=NEW.reply_id;
END;
CREATE TRIGGER owner_comment_commands_no_update BEFORE UPDATE ON owner_comment_commands BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_COMMAND');
END;
CREATE TRIGGER owner_comment_commands_no_delete BEFORE DELETE ON owner_comment_commands BEGIN
 SELECT RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_COMMAND');
END;

-- Symmetric actor/request namespace guards. AFTER INSERT preserves prior writers' replay
-- behavior, while abort rolls back the entire conflicting legacy statement.
CREATE TRIGGER owner_comment_ns_01 AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_02 AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_03 AFTER INSERT ON upload_requests
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_04 AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_05 AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_06 AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_07 AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_08 AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_09 AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_10 AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_11 AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
CREATE TRIGGER owner_comment_ns_12 AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_comment_external_intent_ns AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_comment_upload_fence_ns AFTER INSERT ON upload_key_fences
WHEN NEW.actor_type='user' AND EXISTS(SELECT 1 FROM owner_comment_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_comment_selection_reopened_ns AFTER INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' AND EXISTS(
 SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
