-- Forward-only migration 0058: enable the existing Guest and Owner annotation writers
-- to persist bounded freehand-v1 geometry. Only the two INSERT guard definitions change.
-- Tables, existing annotation/command/result/history/audit rows, permissions, and
-- point/rectangle validation remain unchanged. Wrangler applies this migration atomically.
-- Do not edit prior migrations or use this as a cloud deployment authorization.

DROP TRIGGER guest_annotation_command_guard;
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
        OR (json_type(NEW.geometry_json) IS 'object'
          AND json_type(NEW.geometry_json,'$.type') IS 'text'
          AND json_extract(NEW.geometry_json,'$.type') IS 'freehand'
          AND json_type(NEW.geometry_json,'$.coordinateSpace') IS 'text'
          AND json_extract(NEW.geometry_json,'$.coordinateSpace') IS 'normalized_1e6'
          AND json_type(NEW.geometry_json,'$.version') IS 'integer'
          AND json_extract(NEW.geometry_json,'$.version')=1
          AND json_type(NEW.geometry_json,'$.points') IS 'array'
          AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
          AND json_array_length(NEW.geometry_json,'$.points') BETWEEN 2 AND 256
          AND length(CAST(NEW.geometry_json AS BLOB))<=8192
          AND NOT EXISTS (
            SELECT 1 FROM json_each(NEW.geometry_json,'$.points') AS point
            WHERE point.type IS NOT 'object'
              OR (SELECT count(*) FROM json_each(point.value))<>2
              OR json_type(point.value,'$.x') IS NOT 'integer'
              OR json_type(point.value,'$.y') IS NOT 'integer'
              OR COALESCE(json_extract(point.value,'$.x'),-1) NOT BETWEEN 0 AND 1000000
              OR COALESCE(json_extract(point.value,'$.y'),-1) NOT BETWEEN 0 AND 1000000
              OR point.value<>json_object('x',json_extract(point.value,'$.x'),
                'y',json_extract(point.value,'$.y'))
            )
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(NEW.geometry_json,'$.points') AS next_point
            JOIN json_each(NEW.geometry_json,'$.points') AS previous_point
              ON CAST(previous_point.key AS INTEGER)=CAST(next_point.key AS INTEGER)-1
            WHERE json_extract(previous_point.value,'$.x')=json_extract(next_point.value,'$.x')
              AND json_extract(previous_point.value,'$.y')=json_extract(next_point.value,'$.y')
          )
          AND NEW.geometry_json=json_object('type','freehand',
              'coordinateSpace','normalized_1e6','version',1,
              'points',json(json_extract(NEW.geometry_json,'$.points')))
        )
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

DROP TRIGGER owner_annotation_command_insert_guard;
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
      OR (json_type(NEW.geometry_json) IS 'object'
        AND json_type(NEW.geometry_json,'$.type') IS 'text'
        AND json_extract(NEW.geometry_json,'$.type') IS 'freehand'
        AND json_type(NEW.geometry_json,'$.coordinateSpace') IS 'text'
        AND json_extract(NEW.geometry_json,'$.coordinateSpace') IS 'normalized_1e6'
        AND json_type(NEW.geometry_json,'$.version') IS 'integer'
        AND json_extract(NEW.geometry_json,'$.version')=1
        AND json_type(NEW.geometry_json,'$.points') IS 'array'
        AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
        AND json_array_length(NEW.geometry_json,'$.points') BETWEEN 2 AND 256
        AND length(CAST(NEW.geometry_json AS BLOB))<=8192
        AND NOT EXISTS (
          SELECT 1 FROM json_each(NEW.geometry_json,'$.points') AS point
          WHERE point.type IS NOT 'object'
            OR (SELECT count(*) FROM json_each(point.value))<>2
            OR json_type(point.value,'$.x') IS NOT 'integer'
            OR json_type(point.value,'$.y') IS NOT 'integer'
            OR COALESCE(json_extract(point.value,'$.x'),-1) NOT BETWEEN 0 AND 1000000
            OR COALESCE(json_extract(point.value,'$.y'),-1) NOT BETWEEN 0 AND 1000000
            OR point.value<>json_object('x',json_extract(point.value,'$.x'),
              'y',json_extract(point.value,'$.y'))
          )
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(NEW.geometry_json,'$.points') AS next_point
          JOIN json_each(NEW.geometry_json,'$.points') AS previous_point
            ON CAST(previous_point.key AS INTEGER)=CAST(next_point.key AS INTEGER)-1
          WHERE json_extract(previous_point.value,'$.x')=json_extract(next_point.value,'$.x')
            AND json_extract(previous_point.value,'$.y')=json_extract(next_point.value,'$.y')
        )
        AND NEW.geometry_json=json_object('type','freehand',
            'coordinateSpace','normalized_1e6','version',1,
            'points',json(json_extract(NEW.geometry_json,'$.points')))
      )
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


