-- Guest comments are version-bound and private to one invitation.
-- Recovery is forward-only: retain comment commands, change history, results, and audit rows.
-- Do not rewrite or backfill earlier Guest ledgers.
PRAGMA foreign_keys=ON;

-- Mirrors guest-gallery.ts: succeeded original job + private thumbnail/preview slots,
-- and current head, V1 baseline, or immutable prior head-publication witness.
CREATE VIEW guest_comment_eligible_versions AS
SELECT v.id AS version_id,v.photo_id AS photo_id,v.workspace_id AS workspace_id,
       p.project_id AS project_id,p.album_id AS album_id,v.version_no AS version_no
FROM photo_versions v
JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id
  AND head.project_id=p.project_id AND head.album_id=p.album_id
JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=p.id
  AND original.workspace_id=p.workspace_id AND original.asset_kind='original'
  AND original.state='private' AND original.byte_size=v.byte_size
  AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded'
JOIN image_processing_outputs thumb_slot ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'
JOIN photo_assets thumb ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key
  AND thumb.version_id=v.id AND thumb.photo_id=p.id AND thumb.workspace_id=p.workspace_id
  AND thumb.asset_kind='thumbnail' AND thumb.state='private' AND thumb.mime='image/jpeg'
JOIN image_processing_outputs preview_slot ON preview_slot.job_id=j.id AND preview_slot.kind='preview'
JOIN photo_assets preview ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key
  AND preview.version_id=v.id AND preview.photo_id=p.id AND preview.workspace_id=p.workspace_id
  AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
WHERE v.id=head.version_id OR v.version_no=1 OR EXISTS(
  SELECT 1 FROM photo_version_head_commands c
  JOIN photo_version_head_results r ON r.command_id=c.id
  WHERE c.photo_id=p.id AND c.workspace_id=p.workspace_id AND c.project_id=p.project_id
    AND c.album_id=p.album_id AND c.version_id=v.id
    AND json_extract(r.result_json,'$.changed')=1
);

CREATE TABLE guest_comment_commands(
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  expected_guest_id TEXT NOT NULL CHECK(expected_guest_id=guest_id),
  request_id TEXT NOT NULL CHECK(length(request_id)=36),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('create','edit','delete','resolve','reopen')),
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json)<=20000),
  targets_json TEXT NOT NULL CHECK(json_valid(targets_json) AND json_type(targets_json)='array'
    AND length(targets_json)<=20000),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms>=0),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  CHECK(
    (operation='create' AND targets_json<>'[]'
      AND json_type(request_json,'$.requestId')='text'
      AND json_extract(request_json,'$.requestId')=request_id
      AND json_type(request_json,'$.expectedGuestId')='text'
      AND json_extract(request_json,'$.expectedGuestId')=expected_guest_id
      AND json_extract(request_json,'$.operation')='create')
    OR (operation<>'create' AND targets_json='[]'
      AND json_type(request_json,'$.requestId')='text'
      AND json_extract(request_json,'$.requestId')=request_id
      AND json_type(request_json,'$.expectedGuestId')='text'
      AND json_extract(request_json,'$.expectedGuestId')=expected_guest_id
      AND json_extract(request_json,'$.operation')=operation)
  )
);
CREATE INDEX guest_comment_commands_request ON guest_comment_commands(guest_id,request_id);
CREATE INDEX guest_comment_commands_invite ON guest_comment_commands(invite_id,album_id,created_at_ms);

CREATE TABLE guest_comments(
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
  invite_id TEXT NOT NULL,
  author_guest_id TEXT NOT NULL,
  author_label TEXT NOT NULL CHECK(length(author_label) BETWEEN 1 AND 80),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL CHECK(state IN('open','resolved','deleted')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms>=0),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms>=created_at_ms),
  created_session_id TEXT NOT NULL,
  created_request_id TEXT NOT NULL,
  created_command_id TEXT NOT NULL REFERENCES guest_comment_commands(id),
  last_session_id TEXT NOT NULL,
  last_request_id TEXT NOT NULL,
  last_command_id TEXT NOT NULL REFERENCES guest_comment_commands(id),
  CHECK((state='deleted')=(body IS NULL)),
  CHECK(body IS NULL OR (length(body) BETWEEN 1 AND 2000 AND body=trim(body))),
  FOREIGN KEY(author_guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(created_session_id,author_guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(last_session_id,author_guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_comments_page ON guest_comments(invite_id,album_id,photo_id,version_id,created_at_ms,id);
CREATE INDEX guest_comments_author ON guest_comments(invite_id,author_guest_id,created_at_ms DESC,id DESC);

CREATE TABLE guest_comment_changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL REFERENCES guest_comment_commands(id),
  request_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  comment_id TEXT NOT NULL REFERENCES guest_comments(id),
  operation TEXT NOT NULL CHECK(operation IN('create','edit','delete','resolve','reopen')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  occurred_at_ms INTEGER NOT NULL CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms>=0),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  UNIQUE(comment_id,revision),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id),
  FOREIGN KEY(session_id,guest_id,invite_id) REFERENCES guest_sessions(id,guest_id,invite_id),
  FOREIGN KEY(invite_id,workspace_id,project_id,album_id)
    REFERENCES guest_invite_albums(invite_id,workspace_id,project_id,album_id),
  FOREIGN KEY(photo_id,workspace_id,project_id,album_id) REFERENCES photos(id,workspace_id,project_id,album_id),
  FOREIGN KEY(version_id,workspace_id,photo_id) REFERENCES photo_versions(id,workspace_id,photo_id)
);
CREATE INDEX guest_comment_changes_scope ON guest_comment_changes(invite_id,album_id,photo_id,version_id,seq);
CREATE INDEX guest_comment_changes_command ON guest_comment_changes(command_id,seq);

CREATE TABLE guest_comment_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES guest_comment_commands(id),
  guest_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=300000),
  occurred_at_ms INTEGER NOT NULL CHECK(typeof(occurred_at_ms)='integer' AND occurred_at_ms>=0),
  UNIQUE(guest_id,request_id),
  FOREIGN KEY(guest_id,invite_id) REFERENCES guest_identities(id,invite_id)
);

CREATE TRIGGER guest_comment_command_guard BEFORE INSERT ON guest_comment_commands BEGIN
  -- One live statement scope with independent can_comment and exact published-ready targets.
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
      AND (i.permissions_mask & 256)=256
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
      AND (
        (NEW.operation='create'
          AND json_array_length(NEW.targets_json) BETWEEN 1 AND 24
          AND json_array_length(NEW.request_json,'$.targets')=json_array_length(NEW.targets_json)
          AND json_type(NEW.request_json,'$.body')='text'
          AND (SELECT count(DISTINCT json_extract(value,'$.photoId'))
               FROM json_each(NEW.targets_json))=json_array_length(NEW.targets_json)
          AND NOT EXISTS(
            SELECT 1 FROM json_each(NEW.targets_json) item
            WHERE json_type(item.value,'$.commentId') IS NOT 'text'
              OR length(json_extract(item.value,'$.commentId'))<>36
              OR json_type(item.value,'$.photoId') IS NOT 'text'
              OR json_type(item.value,'$.versionId') IS NOT 'text'
              OR item.value<>json_object(
                'commentId',json_extract(item.value,'$.commentId'),
                'photoId',json_extract(item.value,'$.photoId'),
                'versionId',json_extract(item.value,'$.versionId'))
              OR json_extract(NEW.request_json,'$.targets['||CAST(item.key AS TEXT)||'].photoId')
                <>json_extract(item.value,'$.photoId')
              OR json_extract(NEW.request_json,'$.targets['||CAST(item.key AS TEXT)||'].versionId')
                <>json_extract(item.value,'$.versionId')
              OR NOT EXISTS(
                SELECT 1 FROM guest_comment_eligible_versions ev
                WHERE ev.photo_id=json_extract(item.value,'$.photoId')
                  AND ev.version_id=json_extract(item.value,'$.versionId')
                  AND ev.workspace_id=NEW.workspace_id AND ev.project_id=NEW.project_id
                  AND ev.album_id=NEW.album_id)
          )
        )
        OR (NEW.operation IN('edit','delete','resolve','reopen')
          AND EXISTS(
            SELECT 1 FROM guest_comments c
            JOIN guest_comment_eligible_versions ev ON ev.version_id=c.version_id
              AND ev.photo_id=c.photo_id AND ev.workspace_id=c.workspace_id
              AND ev.project_id=c.project_id AND ev.album_id=c.album_id
            WHERE c.id=json_extract(NEW.request_json,'$.commentId')
              AND c.invite_id=NEW.invite_id AND c.album_id=NEW.album_id
              AND c.author_guest_id=NEW.guest_id)
        )
      )
      AND (
        (NEW.operation='create' AND NEW.request_json=json_object(
          'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,'operation','create',
          'targets',json((
            SELECT json_group_array(json(target_json)) FROM (
              SELECT json_object('photoId',json_extract(value,'$.photoId'),
                'versionId',json_extract(value,'$.versionId')) AS target_json
              FROM json_each(NEW.request_json,'$.targets') ORDER BY CAST(key AS INTEGER)
            )
          )),
          'body',json_extract(NEW.request_json,'$.body')))
        OR (NEW.operation='edit'
          AND json_type(NEW.request_json,'$.body')='text'
          AND json_type(NEW.request_json,'$.commentId')='text'
          AND json_type(NEW.request_json,'$.expectedRevision')='integer'
          AND NEW.request_json=json_object(
            'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,
            'commentId',json_extract(NEW.request_json,'$.commentId'),
            'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision'),
            'operation','edit','body',json_extract(NEW.request_json,'$.body')))
        OR (NEW.operation IN('delete','resolve','reopen')
          AND json_type(NEW.request_json,'$.commentId')='text'
          AND json_type(NEW.request_json,'$.expectedRevision')='integer'
          AND NEW.request_json=json_object(
            'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,
            'commentId',json_extract(NEW.request_json,'$.commentId'),
            'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision'),
            'operation',NEW.operation))
      )
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;

  SELECT CASE WHEN NEW.operation IN('create','edit') AND (
    length(json_extract(NEW.request_json,'$.body'))<1
    OR length(json_extract(NEW.request_json,'$.body'))>2000
    OR json_extract(NEW.request_json,'$.body')<>trim(json_extract(NEW.request_json,'$.body'))
    OR instr(json_extract(NEW.request_json,'$.body'),char(0))>0
    OR instr(json_extract(NEW.request_json,'$.body'),char(13))>0
    OR EXISTS(
      WITH RECURSIVE codepoints(body,pos,cp) AS (
        SELECT json_extract(NEW.request_json,'$.body'),1,
          unicode(substr(json_extract(NEW.request_json,'$.body'),1,1))
        UNION ALL
        SELECT body,pos+1,unicode(substr(body,pos+1,1))
        FROM codepoints WHERE pos<length(body)
      )
      SELECT 1 FROM codepoints
      WHERE cp IS NULL OR (cp BETWEEN 1 AND 8) OR cp IN(11,12)
        OR (cp BETWEEN 14 AND 31) OR (cp BETWEEN 127 AND 159)
        OR cp IN(173,1564,6158,8203,8204,8205,8206,8207,8234,8235,8236,8237,
          8238,8288,8289,8290,8291,8292,8294,8295,8296,8297,65279,65529,65530,65531)
        OR (cp BETWEEN 1536 AND 1541) OR cp=1757 OR cp=69821 OR cp=69837
        OR cp=1807 OR (cp BETWEEN 2192 AND 2193) OR cp=2274
        OR (cp BETWEEN 78896 AND 78911) OR (cp BETWEEN 113824 AND 113827)
        OR (cp BETWEEN 119155 AND 119162)
        OR cp=917505 OR (cp BETWEEN 917536 AND 917631)
    )
  ) THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  -- Cross-ledger namespace: Guest request UUIDs are guest-scoped, except exchange
  -- which is invitation-scoped. ACL above is deliberately first.
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
    OR EXISTS(SELECT 1 FROM guest_tag_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.operation<>NEW.operation
        OR c.request_json<>NEW.request_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_COMMAND') END;

  SELECT CASE WHEN NEW.operation='create' AND EXISTS(
    SELECT 1 FROM json_each(NEW.targets_json) item
    WHERE (SELECT count(*) FROM guest_comments c
      WHERE c.invite_id=NEW.invite_id AND c.album_id=NEW.album_id
        AND c.photo_id=json_extract(item.value,'$.photoId')
        AND c.version_id=json_extract(item.value,'$.versionId'))>=1000
  ) THEN RAISE(ABORT,'COMMENT_LIMIT_REACHED') END;

  SELECT CASE WHEN NEW.operation IN('edit','delete','resolve','reopen')
    AND NOT EXISTS(
      SELECT 1 FROM guest_comments c
      WHERE c.id=json_extract(NEW.request_json,'$.commentId')
        AND c.invite_id=NEW.invite_id AND c.album_id=NEW.album_id
        AND c.author_guest_id=NEW.guest_id
        AND c.revision=json_extract(NEW.request_json,'$.expectedRevision')
        AND c.revision<9007199254740991 AND c.state<>'deleted'
        AND ((NEW.operation='resolve' AND c.state='open')
          OR (NEW.operation='reopen' AND c.state='resolved')
          OR NEW.operation IN('edit','delete'))
    ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
END;

CREATE TRIGGER guest_comment_insert_guard BEFORE INSERT ON guest_comments BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comments c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_comment_commands c
    JOIN guest_identities g ON g.id=c.guest_id AND g.invite_id=c.invite_id
    JOIN json_each(c.targets_json) item
    WHERE c.id=NEW.created_command_id AND c.operation='create'
      AND c.guest_id=NEW.author_guest_id AND c.invite_id=NEW.invite_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND NEW.author_label=g.display_name
      AND c.created_at_ms=NEW.created_at_ms AND c.created_at_ms=NEW.updated_at_ms
      AND c.session_id=NEW.created_session_id AND c.session_id=NEW.last_session_id
      AND c.request_id=NEW.created_request_id AND c.request_id=NEW.last_request_id
      AND c.id=NEW.last_command_id AND NEW.revision=1 AND NEW.state='open'
      AND NEW.body=json_extract(c.request_json,'$.body')
      AND NEW.id=json_extract(item.value,'$.commentId')
      AND NEW.photo_id=json_extract(item.value,'$.photoId')
      AND NEW.version_id=json_extract(item.value,'$.versionId')
  ) THEN RAISE(ABORT,'INVALID_GUEST_COMMENT_PROJECTION') END;
  SELECT CASE WHEN (SELECT count(*) FROM guest_comments c
      WHERE c.invite_id=NEW.invite_id AND c.album_id=NEW.album_id
        AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id)>=1000
    THEN RAISE(ABORT,'COMMENT_LIMIT_REACHED') END;
END;

-- Every change is an immutable command-bound predecessor witness.
CREATE TRIGGER guest_comment_change_insert_guard BEFORE INSERT ON guest_comment_changes BEGIN
  SELECT CASE WHEN NEW.event_id IS NULL OR EXISTS(
    SELECT 1 FROM guest_comment_changes x
    WHERE x.event_id=NEW.event_id OR (NEW.seq IS NOT NULL AND x.seq=NEW.seq)
      OR (x.comment_id=NEW.comment_id AND x.revision=NEW.revision)
  ) THEN RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_CHANGE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_comment_commands cmd JOIN guest_comments c ON c.id=NEW.comment_id
    WHERE cmd.id=NEW.command_id AND cmd.guest_id=NEW.guest_id
      AND cmd.invite_id=NEW.invite_id AND cmd.session_id=NEW.session_id
      AND cmd.request_id=NEW.request_id AND cmd.workspace_id=NEW.workspace_id
      AND cmd.project_id=NEW.project_id AND cmd.album_id=NEW.album_id
      AND cmd.operation=NEW.operation AND cmd.created_at_ms=NEW.occurred_at_ms
      AND c.invite_id=NEW.invite_id AND c.author_guest_id=NEW.guest_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND NEW.event_id='guest-comment:'||NEW.comment_id||':'||NEW.revision
      AND (
        (cmd.operation='create' AND NEW.revision=1
          AND NEW.before_json=json_object('commentId',NEW.comment_id,'revision',0,'state','absent','body',NULL)
          AND NEW.after_json=json_object('commentId',c.id,'revision',1,'state',c.state,'body',c.body)
          AND c.revision=1 AND c.created_command_id=cmd.id)
        OR (cmd.operation<>'create' AND NEW.revision=c.revision+1
          AND c.id=json_extract(cmd.request_json,'$.commentId')
          AND NEW.revision=json_extract(cmd.request_json,'$.expectedRevision')+1
          AND NEW.before_json=json_object('commentId',c.id,'revision',c.revision,'state',c.state,'body',c.body)
          AND NEW.after_json=json_object(
            'commentId',c.id,'revision',c.revision+1,
            'state',CASE WHEN cmd.operation='delete' THEN 'deleted'
              WHEN cmd.operation='resolve' THEN 'resolved'
              WHEN cmd.operation='reopen' THEN 'open' ELSE c.state END,
            'body',CASE WHEN cmd.operation='delete' THEN NULL
              WHEN cmd.operation='edit' THEN json_extract(cmd.request_json,'$.body') ELSE c.body END)
          AND c.last_command_id<>cmd.id
          AND ((cmd.operation='edit' AND c.state IN('open','resolved') AND c.body IS NOT NULL)
            OR (cmd.operation='delete' AND c.state IN('open','resolved') AND c.body IS NOT NULL)
            OR (cmd.operation='resolve' AND c.state='open' AND c.body IS NOT NULL)
            OR (cmd.operation='reopen' AND c.state='resolved' AND c.body IS NOT NULL)))
      )
  ) THEN RAISE(ABORT,'INVALID_GUEST_COMMENT_CHANGE') END;
END;
CREATE TRIGGER guest_comment_changes_no_update BEFORE UPDATE ON guest_comment_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_CHANGE');
END;
CREATE TRIGGER guest_comment_changes_no_delete BEFORE DELETE ON guest_comment_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_CHANGE');
END;

-- Comment audit rows are emitted only from their immutable change witness.
-- Leave every other audit action on its existing guard path.
CREATE TRIGGER guest_comment_audit_insert_guard BEFORE INSERT ON audit_events
WHEN NEW.action GLOB 'comment.*' BEGIN
  SELECT CASE WHEN NEW.session_id IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM guest_comment_changes ch
    WHERE ch.event_id=NEW.event_id
      AND NEW.action='comment.'||ch.operation
      AND NEW.actor_type='guest' AND NEW.actor_id=ch.guest_id
      AND NEW.guest_session_id=ch.session_id
      AND NEW.workspace_id=ch.workspace_id AND NEW.project_id=ch.project_id
      AND NEW.album_id=ch.album_id AND NEW.photo_id=ch.photo_id
      AND NEW.version_id=ch.version_id
      AND NEW.before_json=ch.before_json AND NEW.after_json=ch.after_json
      AND NEW.request_id=ch.request_id
      AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  ) THEN RAISE(ABORT,'INVALID_GUEST_COMMENT_AUDIT') END;
END;

CREATE TRIGGER guest_comment_update_guard BEFORE UPDATE ON guest_comments BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.invite_id<>OLD.invite_id
    OR NEW.author_guest_id<>OLD.author_guest_id OR NEW.author_label<>OLD.author_label
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
    OR NEW.album_id<>OLD.album_id OR NEW.photo_id<>OLD.photo_id OR NEW.version_id<>OLD.version_id
    OR NEW.created_at_ms<>OLD.created_at_ms OR NEW.created_session_id<>OLD.created_session_id
    OR NEW.created_request_id<>OLD.created_request_id OR NEW.created_command_id<>OLD.created_command_id
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_SCOPE') END;
  SELECT CASE WHEN NEW.revision<>OLD.revision+1 OR NEW.revision>9007199254740991
    OR NEW.updated_at_ms<OLD.updated_at_ms
    OR NOT EXISTS(
      SELECT 1 FROM guest_comment_changes ch JOIN guest_comment_commands cmd ON cmd.id=ch.command_id
      WHERE ch.comment_id=OLD.id AND ch.revision=NEW.revision
        AND ch.command_id=NEW.last_command_id AND cmd.operation<>'create'
        AND json_extract(cmd.request_json,'$.commentId')=OLD.id
        AND ch.session_id=NEW.last_session_id AND ch.request_id=NEW.last_request_id
        AND ch.invite_id=NEW.invite_id AND ch.guest_id=NEW.author_guest_id
        AND ch.workspace_id=NEW.workspace_id AND ch.project_id=NEW.project_id
        AND ch.album_id=NEW.album_id AND ch.photo_id=NEW.photo_id AND ch.version_id=NEW.version_id
        AND ch.occurred_at_ms=NEW.updated_at_ms
        AND ch.before_json=json_object('commentId',OLD.id,'revision',OLD.revision,'state',OLD.state,'body',OLD.body)
        AND ch.after_json=json_object('commentId',NEW.id,'revision',NEW.revision,'state',NEW.state,'body',NEW.body)
        AND ((cmd.operation='edit' AND NEW.state=OLD.state AND NEW.body IS NOT NULL
              AND NEW.body=json_extract(cmd.request_json,'$.body'))
          OR (cmd.operation='delete' AND OLD.state IN('open','resolved') AND NEW.state='deleted' AND NEW.body IS NULL)
          OR (cmd.operation='resolve' AND OLD.state='open' AND NEW.state='resolved' AND NEW.body=OLD.body)
          OR (cmd.operation='reopen' AND OLD.state='resolved' AND NEW.state='open' AND NEW.body=OLD.body))
    ) THEN RAISE(ABORT,'INVALID_GUEST_COMMENT_PREDECESSOR') END;
END;
CREATE TRIGGER guest_comments_no_delete BEFORE DELETE ON guest_comments BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT');
END;

CREATE TRIGGER guest_comment_result_insert_guard BEFORE INSERT ON guest_comment_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM guest_comment_results r WHERE r.command_id=NEW.command_id
      OR (r.guest_id=NEW.guest_id AND r.request_id=NEW.request_id)
  ) THEN RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_comment_commands c
    WHERE c.id=NEW.command_id AND c.guest_id=NEW.guest_id AND c.invite_id=NEW.invite_id
      AND c.request_id=NEW.request_id AND NEW.occurred_at_ms=c.created_at_ms
      AND json_extract(NEW.result_json,'$.guestId')=c.guest_id
      AND json_extract(NEW.result_json,'$.requestId')=c.request_id
      AND json_extract(NEW.result_json,'$.operation')=c.operation
      AND json_extract(NEW.result_json,'$.occurredAt')=strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND json_type(NEW.result_json,'$.items')='array'
      AND json_array_length(NEW.result_json,'$.items') BETWEEN 1 AND 24
  ) THEN RAISE(ABORT,'INVALID_GUEST_COMMENT_RESULT') END;
END;
CREATE TRIGGER guest_comment_results_no_update BEFORE UPDATE ON guest_comment_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_RESULT');
END;
CREATE TRIGGER guest_comment_results_no_delete BEFORE DELETE ON guest_comment_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_RESULT');
END;

CREATE TRIGGER guest_comments_insert_audit AFTER INSERT ON guest_comments BEGIN
  INSERT INTO guest_comment_changes(
    event_id,command_id,request_id,guest_id,invite_id,session_id,workspace_id,project_id,
    album_id,photo_id,version_id,comment_id,operation,revision,occurred_at_ms,before_json,after_json
  )
  SELECT 'guest-comment:'||NEW.id||':1',c.id,c.request_id,c.guest_id,c.invite_id,c.session_id,
    c.workspace_id,c.project_id,c.album_id,NEW.photo_id,NEW.version_id,NEW.id,'create',1,c.created_at_ms,
    json_object('commentId',NEW.id,'revision',0,'state','absent','body',NULL),
    json_object('commentId',NEW.id,'revision',1,'state',NEW.state,'body',NEW.body)
  FROM guest_comment_commands c WHERE c.id=NEW.created_command_id;
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'guest',ch.guest_id,ch.session_id,ch.workspace_id,ch.project_id,
    ch.album_id,ch.photo_id,ch.version_id,'comment.create',ch.before_json,ch.after_json,
    ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM guest_comment_changes ch WHERE ch.command_id=NEW.created_command_id
    AND ch.comment_id=NEW.id AND ch.revision=1;
END;
CREATE TRIGGER guest_comments_update_audit AFTER UPDATE ON guest_comments BEGIN
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc
  )
  SELECT ch.event_id,'guest',ch.guest_id,ch.session_id,ch.workspace_id,ch.project_id,
    ch.album_id,ch.photo_id,ch.version_id,'comment.'||ch.operation,ch.before_json,ch.after_json,
    ch.request_id,strftime('%Y-%m-%dT%H:%M:%fZ',ch.occurred_at_ms/1000.0,'unixepoch')
  FROM guest_comment_changes ch WHERE ch.command_id=NEW.last_command_id
    AND ch.comment_id=NEW.id AND ch.revision=NEW.revision;
END;

CREATE TRIGGER guest_comment_command_apply AFTER INSERT ON guest_comment_commands BEGIN
  INSERT INTO guest_comments(
    id,invite_id,author_guest_id,author_label,workspace_id,project_id,album_id,photo_id,version_id,
    body,state,revision,created_at_ms,updated_at_ms,created_session_id,created_request_id,
    created_command_id,last_session_id,last_request_id,last_command_id
  )
  SELECT json_extract(item.value,'$.commentId'),NEW.invite_id,NEW.guest_id,g.display_name,
    NEW.workspace_id,NEW.project_id,NEW.album_id,json_extract(item.value,'$.photoId'),
    json_extract(item.value,'$.versionId'),json_extract(NEW.request_json,'$.body'),'open',1,
    NEW.created_at_ms,NEW.created_at_ms,NEW.session_id,NEW.request_id,NEW.id,NEW.session_id,
    NEW.request_id,NEW.id
  FROM json_each(NEW.targets_json) item
  JOIN guest_identities g ON g.id=NEW.guest_id AND g.invite_id=NEW.invite_id
  WHERE NEW.operation='create';

  INSERT INTO guest_comment_changes(
    event_id,command_id,request_id,guest_id,invite_id,session_id,workspace_id,project_id,
    album_id,photo_id,version_id,comment_id,operation,revision,occurred_at_ms,before_json,after_json
  )
  SELECT 'guest-comment:'||c.id||':'||(c.revision+1),NEW.id,NEW.request_id,NEW.guest_id,NEW.invite_id,
    NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,c.photo_id,c.version_id,c.id,
    NEW.operation,c.revision+1,NEW.created_at_ms,
    json_object('commentId',c.id,'revision',c.revision,'state',c.state,'body',c.body),
    json_object('commentId',c.id,'revision',c.revision+1,
      'state',CASE WHEN NEW.operation='delete' THEN 'deleted'
        WHEN NEW.operation='resolve' THEN 'resolved' WHEN NEW.operation='reopen' THEN 'open' ELSE c.state END,
      'body',CASE WHEN NEW.operation='delete' THEN NULL
        WHEN NEW.operation='edit' THEN json_extract(NEW.request_json,'$.body') ELSE c.body END)
  FROM guest_comments c WHERE NEW.operation<>'create'
    AND c.id=json_extract(NEW.request_json,'$.commentId');

  UPDATE guest_comments
  SET body=CASE WHEN NEW.operation='delete' THEN NULL
      WHEN NEW.operation='edit' THEN json_extract(NEW.request_json,'$.body') ELSE body END,
      state=CASE WHEN NEW.operation='delete' THEN 'deleted'
        WHEN NEW.operation='resolve' THEN 'resolved' WHEN NEW.operation='reopen' THEN 'open' ELSE state END,
      revision=revision+1,updated_at_ms=NEW.created_at_ms,
      last_session_id=NEW.session_id,last_request_id=NEW.request_id,last_command_id=NEW.id
  WHERE NEW.operation<>'create' AND id=json_extract(NEW.request_json,'$.commentId');

  INSERT INTO guest_comment_results(command_id,guest_id,invite_id,request_id,result_json,occurred_at_ms)
  SELECT NEW.id,NEW.guest_id,NEW.invite_id,NEW.request_id,
    json_object('guestId',NEW.guest_id,'requestId',NEW.request_id,'operation',NEW.operation,
      'items',json(CASE WHEN NEW.operation='create' THEN (
        SELECT json_group_array(json(item_json)) FROM (
          SELECT json_object('commentId',c.id,'photoId',c.photo_id,'versionId',c.version_id,
            'revision',c.revision,'body',c.body,'state',c.state,'authorLabel',c.author_label,
            'isMine',json('true'),
            'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'),
            'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.updated_at_ms/1000.0,'unixepoch')
          ) AS item_json
          FROM json_each(NEW.targets_json) item
          JOIN guest_comments c ON c.id=json_extract(item.value,'$.commentId')
          ORDER BY CAST(item.key AS INTEGER)
        )
      ) ELSE (
        SELECT json_group_array(json(item_json)) FROM (
          SELECT json_object('commentId',c.id,'photoId',c.photo_id,'versionId',c.version_id,
            'revision',c.revision,'body',c.body,'state',c.state,'authorLabel',c.author_label,
            'isMine',json('true'),
            'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch'),
            'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ',c.updated_at_ms/1000.0,'unixepoch')
          ) AS item_json FROM guest_comments c
          WHERE c.id=json_extract(NEW.request_json,'$.commentId')
        )
      ) END),
      'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')),
    NEW.created_at_ms;
END;

CREATE TRIGGER guest_comment_commands_no_update BEFORE UPDATE ON guest_comment_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_COMMAND');
END;
CREATE TRIGGER guest_comment_commands_no_delete BEFORE DELETE ON guest_comment_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_COMMAND');
END;

-- AFTER INSERT guards on old ledgers roll back the entire old statement on collision,
-- while their historical exact-replay RAISE(IGNORE) paths remain intact.
CREATE TRIGGER guest_selection_comments_namespace AFTER INSERT ON guest_selection_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_submission_comments_namespace AFTER INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_logout_comments_namespace AFTER INSERT ON guest_logout_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_exchange_comments_namespace AFTER INSERT ON guest_exchange_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c
    WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_feedback_comments_namespace AFTER INSERT ON guest_feedback_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_guest_comments_namespace AFTER INSERT ON shared_review_guest_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER guest_tag_comments_namespace AFTER INSERT ON guest_tag_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

