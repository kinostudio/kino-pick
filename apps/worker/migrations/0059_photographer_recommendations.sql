-- Owner-controlled photographer recommendations and immutable, version-bound metadata evidence.
-- Recovery: disable PHOTOGRAPHER_RECOMMENDATIONS_ENABLED; retain commands, results,
-- metadata evidence and audits. Repair forward; never erase source/version history.
PRAGMA foreign_keys=ON;

CREATE TABLE photographer_recommendation_commands(
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND request_id=lower(request_id)
    AND request_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND length(replace(request_id,'-',''))=32
  ),
  operation TEXT NOT NULL CHECK(operation IN(
    'album.photographer_recommendations.set',
    'photo.photographer_metadata.set',
    'photo.photographer_metadata.import'
  )),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  photo_id TEXT REFERENCES photos(id),
  version_id TEXT REFERENCES photo_versions(id),
  expected_revision INTEGER NOT NULL CHECK(
    typeof(expected_revision)='integer' AND expected_revision BETWEEN 0 AND 9007199254740990
  ),
  expected_head_revision INTEGER CHECK(
    expected_head_revision IS NULL OR
    (typeof(expected_head_revision)='integer' AND expected_head_revision BETWEEN 0 AND 9007199254740991)
  ),
  visible INTEGER CHECK(visible IS NULL OR (typeof(visible)='integer' AND visible IN(0,1))),
  min_rating INTEGER CHECK(min_rating IS NULL OR (typeof(min_rating)='integer' AND min_rating BETWEEN 1 AND 5)),
  allowed_labels_json TEXT CHECK(
    allowed_labels_json IS NULL OR
    (json_valid(allowed_labels_json) AND json_type(allowed_labels_json)='array'
      AND length(allowed_labels_json)<=64)
  ),
  rating_state TEXT CHECK(rating_state IS NULL OR rating_state IN('inherit','set','clear')),
  rating_value INTEGER CHECK(rating_value IS NULL OR (typeof(rating_value)='integer' AND rating_value BETWEEN 1 AND 5)),
  label_state TEXT CHECK(label_state IS NULL OR label_state IN('inherit','set','clear')),
  label_value TEXT CHECK(label_value IS NULL OR label_value IN('red','yellow','green','blue','purple')),
  decision TEXT CHECK(decision IS NULL OR decision IN('inherit','recommend','exclude')),
  source_asset_id TEXT REFERENCES photo_assets(id),
  source_sha256 TEXT CHECK(source_sha256 IS NULL OR
    (length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')),
  source_mime TEXT CHECK(source_mime IS NULL OR source_mime IN('image/jpeg','image/png','image/webp')),
  imported_metadata_json TEXT CHECK(imported_metadata_json IS NULL OR
    (json_valid(imported_metadata_json) AND json_type(imported_metadata_json)='object'
      AND length(imported_metadata_json)<=8192)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_type(payload_json)='object'
    AND length(payload_json)<=12288),
  before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'
    AND length(before_json)<=12288),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'
    AND created_at_ms BETWEEN 1 AND 9007199254740991),
  UNIQUE(actor_id,request_id),
  CHECK(
    (operation='album.photographer_recommendations.set'
      AND photo_id IS NULL AND version_id IS NULL AND expected_head_revision IS NULL
      AND visible IS NOT NULL AND allowed_labels_json IS NOT NULL
      AND rating_state IS NULL AND rating_value IS NULL
      AND label_state IS NULL AND label_value IS NULL AND decision IS NULL
      AND source_asset_id IS NULL AND source_sha256 IS NULL AND source_mime IS NULL
      AND imported_metadata_json IS NULL)
    OR
    (operation='photo.photographer_metadata.set'
      AND photo_id IS NOT NULL AND version_id IS NOT NULL AND expected_head_revision IS NOT NULL
      AND visible IS NULL AND min_rating IS NULL AND allowed_labels_json IS NULL
      AND rating_state IS NOT NULL AND label_state IS NOT NULL AND decision IS NOT NULL
      AND source_asset_id IS NULL AND source_sha256 IS NULL AND source_mime IS NULL
      AND imported_metadata_json IS NULL
      AND ((rating_state='set' AND rating_value BETWEEN 1 AND 5)
        OR (rating_state IN('inherit','clear') AND rating_value IS NULL))
      AND ((label_state='set' AND label_value IN('red','yellow','green','blue','purple'))
        OR (label_state IN('inherit','clear') AND label_value IS NULL)))
    OR
    (operation='photo.photographer_metadata.import'
      AND photo_id IS NOT NULL AND version_id IS NOT NULL AND expected_head_revision IS NULL
      AND visible IS NULL AND min_rating IS NULL AND allowed_labels_json IS NULL
      AND rating_state IS NULL AND rating_value IS NULL
      AND label_state IS NULL AND label_value IS NULL AND decision IS NULL
      AND source_asset_id IS NOT NULL AND source_sha256 IS NOT NULL AND source_mime IS NOT NULL
      AND imported_metadata_json IS NOT NULL)
  )
);
CREATE UNIQUE INDEX photographer_recommendation_commands_request_ci
  ON photographer_recommendation_commands(actor_id,lower(request_id));
CREATE INDEX photographer_recommendation_commands_album_page
  ON photographer_recommendation_commands(album_id,created_at_ms DESC,id DESC);
CREATE INDEX photographer_recommendation_commands_photo_page
  ON photographer_recommendation_commands(photo_id,version_id,created_at_ms DESC,id DESC);

CREATE TABLE album_photographer_recommendation_policy(
  album_id TEXT PRIMARY KEY NOT NULL REFERENCES albums(id),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  visible INTEGER NOT NULL CHECK(typeof(visible)='integer' AND visible IN(0,1)),
  min_rating INTEGER CHECK(min_rating IS NULL OR (typeof(min_rating)='integer' AND min_rating BETWEEN 1 AND 5)),
  allowed_labels_json TEXT NOT NULL CHECK(
    json_valid(allowed_labels_json) AND json_type(allowed_labels_json)='array'
      AND length(allowed_labels_json)<=64
  ),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer'
    AND revision BETWEEN 1 AND 9007199254740991),
  last_command_id TEXT NOT NULL UNIQUE REFERENCES photographer_recommendation_commands(id)
);

CREATE TABLE photographer_photo_metadata(
  photo_id TEXT NOT NULL REFERENCES photos(id),
  version_id TEXT NOT NULL REFERENCES photo_versions(id),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  source_asset_id TEXT REFERENCES photo_assets(id),
  source_sha256 TEXT CHECK(source_sha256 IS NULL OR
    (length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')),
  source_mime TEXT CHECK(source_mime IS NULL OR source_mime IN('image/jpeg','image/png','image/webp')),
  imported_metadata_json TEXT CHECK(imported_metadata_json IS NULL OR
    (json_valid(imported_metadata_json) AND json_type(imported_metadata_json)='object'
      AND length(imported_metadata_json)<=8192)),
  imported_at_ms INTEGER CHECK(imported_at_ms IS NULL OR
    (typeof(imported_at_ms)='integer' AND imported_at_ms BETWEEN 1 AND 9007199254740991)),
  rating_state TEXT NOT NULL DEFAULT 'inherit' CHECK(rating_state IN('inherit','set','clear')),
  rating_value INTEGER CHECK(rating_value IS NULL OR (typeof(rating_value)='integer' AND rating_value BETWEEN 1 AND 5)),
  label_state TEXT NOT NULL DEFAULT 'inherit' CHECK(label_state IN('inherit','set','clear')),
  label_value TEXT CHECK(label_value IS NULL OR label_value IN('red','yellow','green','blue','purple')),
  decision TEXT NOT NULL DEFAULT 'inherit' CHECK(decision IN('inherit','recommend','exclude')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer'
    AND revision BETWEEN 1 AND 9007199254740991),
  last_command_id TEXT NOT NULL UNIQUE REFERENCES photographer_recommendation_commands(id),
  PRIMARY KEY(photo_id,version_id),
  CHECK(
    ((source_asset_id IS NULL AND source_sha256 IS NULL AND source_mime IS NULL
      AND imported_metadata_json IS NULL AND imported_at_ms IS NULL)
    OR (source_asset_id IS NOT NULL AND source_sha256 IS NOT NULL AND source_mime IS NOT NULL
      AND imported_metadata_json IS NOT NULL AND imported_at_ms IS NOT NULL))
    AND ((rating_state='set' AND rating_value BETWEEN 1 AND 5)
      OR (rating_state IN('inherit','clear') AND rating_value IS NULL))
    AND ((label_state='set' AND label_value IN('red','yellow','green','blue','purple'))
      OR (label_state IN('inherit','clear') AND label_value IS NULL))
  )
);
CREATE INDEX photographer_photo_metadata_album_version
  ON photographer_photo_metadata(album_id,photo_id,version_id);
CREATE INDEX photographer_photo_metadata_source
  ON photographer_photo_metadata(source_asset_id,source_sha256);

CREATE TABLE photographer_recommendation_results(
  command_id TEXT PRIMARY KEY NOT NULL REFERENCES photographer_recommendation_commands(id),
  before_json TEXT NOT NULL CHECK(json_valid(before_json) AND json_type(before_json)='object'),
  after_json TEXT NOT NULL CHECK(json_valid(after_json) AND json_type(after_json)='object'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json)='object'),
  changed INTEGER NOT NULL CHECK(changed IN(0,1)),
  event_id TEXT UNIQUE,
  occurred_at_utc TEXT NOT NULL,
  CHECK((changed=1 AND event_id=command_id) OR (changed=0 AND event_id IS NULL))
);

CREATE TRIGGER photographer_recommendation_command_guard
BEFORE INSERT ON photographer_recommendation_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM workspaces w
    JOIN projects p ON p.workspace_id=w.id AND p.id=NEW.project_id
    JOIN albums a ON a.workspace_id=w.id AND a.project_id=p.id AND a.id=NEW.album_id
    WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p JOIN albums a
      ON a.project_id=p.id AND a.workspace_id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND a.id=NEW.album_id
      AND (p.status IN('archived','deleting','deleted')
        OR a.state IN('archived','deleting','deleted'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
      AND (c.operation<>NEW.operation OR c.payload_json<>NEW.payload_json
        OR c.album_id<>NEW.album_id OR c.photo_id IS NOT NEW.photo_id
        OR c.version_id IS NOT NEW.version_id)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM version_approval_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM album_activation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND lower(f.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND lower(e.request_id)=lower(NEW.request_id))
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN NEW.operation='album.photographer_recommendations.set'
    AND (
      EXISTS(SELECT 1 FROM json_each(NEW.allowed_labels_json)
        WHERE type<>'text' OR value NOT IN('red','yellow','green','blue','purple'))
      OR (SELECT count(*) FROM json_each(NEW.allowed_labels_json)) <>
         (SELECT count(DISTINCT value) FROM json_each(NEW.allowed_labels_json))
    ) THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='album.photographer_recommendations.set'
    AND (
      NEW.payload_json<>json_object(
        'requestId',NEW.request_id,'expectedRevision',NEW.expected_revision,
        'visible',json(CASE WHEN NEW.visible=1 THEN 'true' ELSE 'false' END),
        'minRating',NEW.min_rating,'allowedLabels',json(NEW.allowed_labels_json))
      OR NEW.before_json<>COALESCE((
        SELECT json_object(
          'albumId',p.album_id,'revision',p.revision,
          'visible',json(CASE WHEN p.visible=1 THEN 'true' ELSE 'false' END),
          'minRating',p.min_rating,'allowedLabels',json(p.allowed_labels_json),
          'matchMode','any')
        FROM album_photographer_recommendation_policy p
        WHERE p.album_id=NEW.album_id
      ),json_object('albumId',NEW.album_id,'revision',0,'visible',json('false'),
        'minRating',NULL,'allowedLabels',json('[]'),'matchMode','any'))
      OR COALESCE((SELECT revision FROM album_photographer_recommendation_policy
        WHERE album_id=NEW.album_id),0)<>NEW.expected_revision
    ) THEN RAISE(ABORT,'PHOTOGRAPHER_RECOMMENDATION_REVISION_CONFLICT') END;

  SELECT CASE WHEN NEW.operation='photo.photographer_metadata.set'
    AND (
      NEW.payload_json<>json_object(
        'requestId',NEW.request_id,'expectedRevision',NEW.expected_revision,
        'expectedHeadRevision',NEW.expected_head_revision,'versionId',NEW.version_id,
        'ratingState',NEW.rating_state,'ratingValue',NEW.rating_value,
        'labelState',NEW.label_state,'labelValue',NEW.label_value,
        'decision',NEW.decision)
      OR COALESCE((SELECT revision FROM photographer_photo_metadata
        WHERE photo_id=NEW.photo_id AND version_id=NEW.version_id),0)<>NEW.expected_revision
      OR NOT EXISTS(
        SELECT 1 FROM photos ph
        JOIN photo_versions v ON v.id=NEW.version_id AND v.photo_id=ph.id
          AND v.workspace_id=ph.workspace_id
        JOIN photo_version_heads h ON h.photo_id=ph.id
          AND h.workspace_id=ph.workspace_id AND h.version_id=v.id
        WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
          AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id
          AND h.revision=NEW.expected_head_revision
      )
    ) THEN RAISE(ABORT,'PHOTOGRAPHER_METADATA_REVISION_CONFLICT') END;

  SELECT CASE WHEN NEW.operation='photo.photographer_metadata.import'
    AND (
      NEW.payload_json<>json_object(
        'requestId',NEW.request_id,'expectedRevision',NEW.expected_revision,
        'workspaceId',NEW.workspace_id,'projectId',NEW.project_id,
        'albumId',NEW.album_id,'photoId',NEW.photo_id,'versionId',NEW.version_id,
        'assetId',NEW.source_asset_id,'sourceSha256',NEW.source_sha256,
        'sourceMime',NEW.source_mime,'metadata',json(NEW.imported_metadata_json))
      OR COALESCE((SELECT revision FROM photographer_photo_metadata
        WHERE photo_id=NEW.photo_id AND version_id=NEW.version_id),0)<>NEW.expected_revision
      OR NOT EXISTS(
        SELECT 1 FROM photos ph
        JOIN photo_versions v ON v.id=NEW.version_id AND v.photo_id=ph.id
          AND v.workspace_id=ph.workspace_id
        JOIN photo_assets a ON a.id=NEW.source_asset_id AND a.photo_id=ph.id
          AND a.version_id=v.id AND a.workspace_id=ph.workspace_id
          AND a.asset_kind='original' AND a.state='private'
          AND a.checksum_sha256=NEW.source_sha256 AND a.mime=NEW.source_mime
          AND v.source_hash_sha256=NEW.source_sha256 AND v.mime=NEW.source_mime
        WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
          AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id
      )
    ) THEN RAISE(ABORT,'PHOTOGRAPHER_METADATA_SOURCE_CONFLICT') END;
END;

CREATE TRIGGER photographer_recommendation_policy_insert_guard
BEFORE INSERT ON album_photographer_recommendation_policy BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.id=NEW.last_command_id
      AND c.operation='album.photographer_recommendations.set'
      AND c.album_id=NEW.album_id AND c.workspace_id=NEW.workspace_id
      AND c.project_id=NEW.project_id AND c.visible=NEW.visible
      AND c.min_rating IS NEW.min_rating
      AND c.allowed_labels_json=NEW.allowed_labels_json
      AND c.expected_revision=0 AND NEW.revision=1
  ) THEN RAISE(ABORT,'INVALID_PHOTOGRAPHER_RECOMMENDATION_STATE') END;
END;
CREATE TRIGGER photographer_recommendation_policy_update_guard
BEFORE UPDATE ON album_photographer_recommendation_policy BEGIN
  SELECT CASE WHEN NEW.album_id<>OLD.album_id OR NEW.workspace_id<>OLD.workspace_id
      OR NEW.project_id<>OLD.project_id
      OR NOT EXISTS(
        SELECT 1 FROM photographer_recommendation_commands c
        WHERE c.id=NEW.last_command_id
          AND c.operation='album.photographer_recommendations.set'
          AND c.album_id=OLD.album_id AND c.workspace_id=OLD.workspace_id
          AND c.project_id=OLD.project_id AND c.expected_revision=OLD.revision
          AND NEW.revision=OLD.revision+1
          AND c.visible=NEW.visible AND c.min_rating IS NEW.min_rating
          AND c.allowed_labels_json=NEW.allowed_labels_json
      )
    THEN RAISE(ABORT,'INVALID_PHOTOGRAPHER_RECOMMENDATION_STATE') END;
END;
CREATE TRIGGER photographer_recommendation_policy_no_delete
BEFORE DELETE ON album_photographer_recommendation_policy BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_STATE');
END;

CREATE TRIGGER photographer_photo_metadata_insert_guard
BEFORE INSERT ON photographer_photo_metadata BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.id=NEW.last_command_id
      AND c.operation IN('photo.photographer_metadata.set','photo.photographer_metadata.import')
      AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.expected_revision=0 AND NEW.revision=1
      AND (
        (c.operation='photo.photographer_metadata.set'
          AND c.rating_state=NEW.rating_state AND c.rating_value IS NEW.rating_value
          AND c.label_state=NEW.label_state AND c.label_value IS NEW.label_value
          AND c.decision=NEW.decision
          AND NEW.source_asset_id IS NULL AND NEW.source_sha256 IS NULL
          AND NEW.imported_metadata_json IS NULL)
        OR
        (c.operation='photo.photographer_metadata.import'
          AND NEW.source_asset_id=c.source_asset_id
          AND NEW.source_sha256=c.source_sha256 AND NEW.source_mime=c.source_mime
          AND NEW.imported_metadata_json=c.imported_metadata_json
          AND NEW.rating_state='inherit' AND NEW.rating_value IS NULL
          AND NEW.label_state='inherit' AND NEW.label_value IS NULL
          AND NEW.decision='inherit')
      )
  ) THEN RAISE(ABORT,'INVALID_PHOTOGRAPHER_METADATA_STATE') END;
END;
CREATE TRIGGER photographer_photo_metadata_update_guard
BEFORE UPDATE ON photographer_photo_metadata BEGIN
  SELECT CASE WHEN NEW.photo_id<>OLD.photo_id OR NEW.version_id<>OLD.version_id
      OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
      OR NEW.album_id<>OLD.album_id
      OR NOT EXISTS(
        SELECT 1 FROM photographer_recommendation_commands c
        WHERE c.id=NEW.last_command_id
          AND c.operation IN('photo.photographer_metadata.set','photo.photographer_metadata.import')
          AND c.photo_id=OLD.photo_id AND c.version_id=OLD.version_id
          AND c.workspace_id=OLD.workspace_id AND c.project_id=OLD.project_id
          AND c.album_id=OLD.album_id AND c.expected_revision=OLD.revision
          AND NEW.revision=OLD.revision+1
          AND (
            (c.operation='photo.photographer_metadata.set'
              AND NEW.rating_state=c.rating_state AND NEW.rating_value IS c.rating_value
              AND NEW.label_state=c.label_state AND NEW.label_value IS c.label_value
              AND NEW.decision=c.decision
              AND NEW.source_asset_id IS OLD.source_asset_id
              AND NEW.source_sha256 IS OLD.source_sha256
              AND NEW.source_mime IS OLD.source_mime
              AND NEW.imported_metadata_json IS OLD.imported_metadata_json
              AND NEW.imported_at_ms IS OLD.imported_at_ms)
            OR
            (c.operation='photo.photographer_metadata.import'
              AND NEW.rating_state=OLD.rating_state AND NEW.rating_value IS OLD.rating_value
              AND NEW.label_state=OLD.label_state AND NEW.label_value IS OLD.label_value
              AND NEW.decision=OLD.decision
              AND NEW.source_asset_id=c.source_asset_id
              AND NEW.source_sha256=c.source_sha256 AND NEW.source_mime=c.source_mime
              AND NEW.imported_metadata_json=c.imported_metadata_json
              AND NEW.imported_at_ms=c.created_at_ms)
          )
      )
    THEN RAISE(ABORT,'INVALID_PHOTOGRAPHER_METADATA_STATE') END;
END;
CREATE TRIGGER photographer_photo_metadata_no_delete
BEFORE DELETE ON photographer_photo_metadata BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_METADATA_STATE');
END;

CREATE TRIGGER photographer_recommendation_commands_no_update
BEFORE UPDATE ON photographer_recommendation_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_COMMAND');
END;
CREATE TRIGGER photographer_recommendation_commands_no_delete
BEFORE DELETE ON photographer_recommendation_commands BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_COMMAND');
END;
CREATE TRIGGER photographer_recommendation_commands_no_replace
BEFORE INSERT ON photographer_recommendation_commands
WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c WHERE c.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_COMMAND'); END;

CREATE TRIGGER photographer_recommendation_results_insert_guard
BEFORE INSERT ON photographer_recommendation_results BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photographer_recommendation_results r
    WHERE r.command_id=NEW.command_id OR
      (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
  ) THEN RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_RESULT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.id=NEW.command_id AND c.before_json=NEW.before_json
      AND NEW.occurred_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND (
        (c.operation='album.photographer_recommendations.set'
          AND EXISTS(SELECT 1 FROM album_photographer_recommendation_policy p
            WHERE p.album_id=c.album_id AND p.workspace_id=c.workspace_id
              AND p.project_id=c.project_id AND p.revision BETWEEN c.expected_revision
                AND c.expected_revision+1
              AND p.visible=c.visible AND p.min_rating IS c.min_rating
              AND p.allowed_labels_json=c.allowed_labels_json
              AND ((NEW.changed=1 AND p.last_command_id=c.id
                    AND p.revision=c.expected_revision+1 AND NEW.event_id=c.id)
                OR (NEW.changed=0 AND NEW.event_id IS NULL
                    AND p.revision=c.expected_revision)))
          OR (c.operation='album.photographer_recommendations.set'
            AND NEW.changed=0 AND NEW.event_id IS NULL
            AND c.expected_revision=0
            AND NOT EXISTS(SELECT 1 FROM album_photographer_recommendation_policy p
              WHERE p.album_id=c.album_id))
        )
        OR
        (c.operation IN('photo.photographer_metadata.set','photo.photographer_metadata.import')
          AND EXISTS(SELECT 1 FROM photographer_photo_metadata m
            WHERE m.photo_id=c.photo_id AND m.version_id=c.version_id
              AND m.workspace_id=c.workspace_id AND m.project_id=c.project_id
              AND m.album_id=c.album_id AND m.revision BETWEEN c.expected_revision
                AND c.expected_revision+1
              AND ((NEW.changed=1 AND m.last_command_id=c.id
                    AND m.revision=c.expected_revision+1 AND NEW.event_id=c.id)
                OR (NEW.changed=0 AND NEW.event_id IS NULL
                    AND m.revision=c.expected_revision))))
        OR (c.operation IN('photo.photographer_metadata.set','photo.photographer_metadata.import')
          AND NEW.changed=0 AND NEW.event_id IS NULL AND c.expected_revision=0
          AND NOT EXISTS(SELECT 1 FROM photographer_photo_metadata m
            WHERE m.photo_id=c.photo_id AND m.version_id=c.version_id))
      )
  ) THEN RAISE(ABORT,'INVALID_PHOTOGRAPHER_RECOMMENDATION_RESULT') END;
END;
CREATE TRIGGER photographer_recommendation_results_no_update
BEFORE UPDATE ON photographer_recommendation_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_RESULT');
END;
CREATE TRIGGER photographer_recommendation_results_no_delete
BEFORE DELETE ON photographer_recommendation_results BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_RESULT');
END;
CREATE TRIGGER photographer_recommendation_results_no_replace
BEFORE INSERT ON photographer_recommendation_results
WHEN EXISTS(SELECT 1 FROM photographer_recommendation_results r WHERE r.command_id=NEW.command_id)
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_RESULT'); END;

CREATE TRIGGER photographer_recommendation_audit_guard
BEFORE INSERT ON audit_events
WHEN NEW.action IN(
  'album.photographer_recommendations.changed',
  'photo.photographer_metadata.changed',
  'photo.photographer_metadata.imported'
)
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photographer_recommendation_commands c
    JOIN photographer_recommendation_results r ON r.command_id=c.id
    WHERE c.id=NEW.event_id AND c.actor_id=NEW.actor_id
      AND c.session_id=NEW.session_id AND c.request_id=NEW.request_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id IS NEW.photo_id
      AND c.version_id IS NEW.version_id AND r.event_id=NEW.event_id
      AND r.before_json=NEW.before_json AND r.after_json=NEW.after_json
      AND NEW.actor_type='user'
      AND NEW.action=CASE c.operation
        WHEN 'album.photographer_recommendations.set'
          THEN 'album.photographer_recommendations.changed'
        WHEN 'photo.photographer_metadata.set'
          THEN 'photo.photographer_metadata.changed'
        ELSE 'photo.photographer_metadata.imported' END
      AND NEW.occurred_at_utc=r.occurred_at_utc
  ) THEN RAISE(ABORT,'INVALID_PHOTOGRAPHER_RECOMMENDATION_AUDIT') END;
END;


-- Symmetric Owner request-ID namespace guards. These are additive: existing
-- ledgers remain immutable and still operate on their original request IDs.
CREATE TRIGGER workspace_commands_photographer_recommendation_namespace
AFTER INSERT ON workspace_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER request_commands_photographer_recommendation_namespace
AFTER INSERT ON request_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_requests_photographer_recommendation_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER upload_workflow_requests_photographer_recommendation_namespace
AFTER INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER processing_review_commands_photographer_recommendation_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_revocation_commands_photographer_recommendation_namespace
AFTER INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER invite_creation_commands_photographer_recommendation_namespace
AFTER INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_commands_photographer_recommendation_namespace
AFTER INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER selection_policy_configuration_commands_photographer_recommendation_namespace
AFTER INSERT ON selection_policy_configuration_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER shared_review_owner_commands_photographer_recommendation_namespace
AFTER INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photo_version_head_commands_photographer_recommendation_namespace
AFTER INSERT ON photo_version_head_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER project_versioning_commands_photographer_recommendation_namespace
AFTER INSERT ON project_versioning_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_comment_commands_photographer_recommendation_namespace
AFTER INSERT ON owner_comment_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_comment_processing_commands_photographer_recommendation_namespace
AFTER INSERT ON owner_comment_processing_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_external_intents_photographer_recommendation_namespace
AFTER INSERT ON owner_external_intents BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_annotation_processing_commands_photographer_recommendation_namespace
AFTER INSERT ON owner_annotation_processing_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER owner_annotation_commands_photographer_recommendation_namespace
AFTER INSERT ON owner_annotation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER version_approval_owner_commands_photographer_recommendation_namespace
AFTER INSERT ON version_approval_owner_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER album_activation_commands_photographer_recommendation_namespace
AFTER INSERT ON album_activation_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photographer_review_flags_photographer_recommendation_namespace
AFTER INSERT ON upload_review_flags BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;
CREATE TRIGGER photographer_recommendation_audit_namespace
BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
      AND NOT (
        c.id=NEW.event_id
        AND NEW.action=CASE c.operation
          WHEN 'album.photographer_recommendations.set'
            THEN 'album.photographer_recommendations.changed'
          WHEN 'photo.photographer_metadata.set'
            THEN 'photo.photographer_metadata.changed'
          ELSE 'photo.photographer_metadata.imported' END
      )
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;




CREATE TRIGGER upload_key_fences_photographer_recommendation_namespace
AFTER INSERT ON upload_key_fences
WHEN NEW.actor_type='user' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photographer_recommendation_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;


