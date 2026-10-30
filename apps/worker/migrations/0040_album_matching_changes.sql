-- M3c2b: append-only, internal candidate invalidation markers.
-- These rows tell advisory candidate readers when album content may have
-- changed. They are not operation audit events and do not identify an actor,
-- request, or complete authorized action.
--
-- No historical backfill: an album's existing content is baseline sequence 0.
-- Only source mutations after this migration produce markers.
--
-- Recovery: keep matching feature flags OFF. If future matching writes must
-- stop, disable those writes and repair forward while retaining these markers;
-- do not delete or rewrite marker history.

CREATE TABLE album_matching_changes(
  sequence INTEGER PRIMARY KEY AUTOINCREMENT
    CHECK(typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991),
  workspace_id TEXT NOT NULL CHECK(typeof(workspace_id)='text' AND length(workspace_id)>0),
  project_id TEXT NOT NULL CHECK(typeof(project_id)='text' AND length(project_id)>0),
  album_id TEXT NOT NULL CHECK(typeof(album_id)='text' AND length(album_id)>0),
  kind TEXT NOT NULL CHECK(typeof(kind)='text' AND kind IN('photo','version','head','upload')),
  source_id TEXT NOT NULL CHECK(typeof(source_id)='text' AND length(source_id)>0),
  source_revision INTEGER NOT NULL
    CHECK(typeof(source_revision)='integer' AND source_revision BETWEEN 0 AND 9007199254740991),
  source_state TEXT NOT NULL CHECK(typeof(source_state)='text'),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER))
    CHECK(typeof(created_at_ms)='integer' AND created_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(
    (kind IN('photo','version') AND source_revision=0 AND source_state='')
    OR (kind='head' AND source_state='')
    OR (kind='upload' AND source_revision=0
      AND source_state IN('reserved','cancelled','expired'))
  ),
  UNIQUE(kind,source_id,source_revision,source_state),
  FOREIGN KEY(album_id,project_id,workspace_id)
    REFERENCES albums(id,project_id,workspace_id)
);

CREATE INDEX album_matching_changes_album_sequence
  ON album_matching_changes(album_id,sequence DESC);

-- Reject NULL/type/scope violations and any conflict that INSERT OR REPLACE
-- could otherwise use to erase an earlier invalidation marker. The integer
-- primary key may be omitted for AUTOINCREMENT; SQLite supplies it on insert.
CREATE TRIGGER album_matching_changes_insert_guard
BEFORE INSERT ON album_matching_changes BEGIN
  SELECT CASE WHEN
      NEW.workspace_id IS NULL OR typeof(NEW.workspace_id)<>'text' OR length(NEW.workspace_id)=0
      OR NEW.project_id IS NULL OR typeof(NEW.project_id)<>'text' OR length(NEW.project_id)=0
      OR NEW.album_id IS NULL OR typeof(NEW.album_id)<>'text' OR length(NEW.album_id)=0
      OR NEW.kind IS NULL OR typeof(NEW.kind)<>'text'
      OR NEW.source_id IS NULL OR typeof(NEW.source_id)<>'text' OR length(NEW.source_id)=0
      OR NEW.source_revision IS NULL OR typeof(NEW.source_revision)<>'integer'
      OR NEW.source_state IS NULL OR typeof(NEW.source_state)<>'text'
      OR NEW.created_at_ms IS NULL OR typeof(NEW.created_at_ms)<>'integer'
      OR (NEW.sequence IS NOT NULL AND typeof(NEW.sequence)<>'integer')
      OR NEW.kind NOT IN('photo','version','head','upload')
    THEN RAISE(ABORT,'INVALID_ALBUM_MATCHING_CHANGE') END;

  SELECT CASE WHEN
      (NEW.sequence IS NOT NULL AND NEW.sequence>0
        AND EXISTS(SELECT 1 FROM album_matching_changes c
          WHERE c.sequence=NEW.sequence))
      OR EXISTS(SELECT 1 FROM album_matching_changes c
        WHERE c.kind=NEW.kind AND c.source_id=NEW.source_id
          AND c.source_revision=NEW.source_revision
          AND c.source_state=NEW.source_state)
    THEN RAISE(ABORT,'IMMUTABLE_ALBUM_MATCHING_CHANGE') END;

  SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM albums a
      WHERE a.id=NEW.album_id AND a.project_id=NEW.project_id
        AND a.workspace_id=NEW.workspace_id)
    THEN RAISE(ABORT,'ALBUM_MATCHING_CHANGE_SCOPE_MISMATCH') END;

  SELECT CASE WHEN
      (NEW.kind='photo' AND (
        NEW.source_revision<>0 OR NEW.source_state<>''
        OR NOT EXISTS(SELECT 1 FROM photos p
          WHERE p.id=NEW.source_id AND p.workspace_id=NEW.workspace_id
            AND p.project_id=NEW.project_id AND p.album_id=NEW.album_id)))
      OR (NEW.kind='version' AND (
        NEW.source_revision<>0 OR NEW.source_state<>''
        OR NOT EXISTS(SELECT 1 FROM photo_versions v
          JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
          WHERE v.id=NEW.source_id AND p.workspace_id=NEW.workspace_id
            AND p.project_id=NEW.project_id AND p.album_id=NEW.album_id)))
      OR (NEW.kind='head' AND (
        NEW.source_state<>''
        OR NOT EXISTS(SELECT 1 FROM photo_version_heads h
          WHERE h.photo_id=NEW.source_id AND h.workspace_id=NEW.workspace_id
            AND h.project_id=NEW.project_id AND h.album_id=NEW.album_id
            AND h.revision=NEW.source_revision)))
      OR (NEW.kind='upload' AND (
        NEW.source_revision<>0
        OR NEW.source_state NOT IN('reserved','cancelled','expired')
        OR NOT EXISTS(SELECT 1 FROM upload_sessions u
          WHERE u.id=NEW.source_id AND u.workspace_id=NEW.workspace_id
            AND u.project_id=NEW.project_id AND u.album_id=NEW.album_id
            AND u.status=NEW.source_state)))
    THEN RAISE(ABORT,'ALBUM_MATCHING_CHANGE_SOURCE_MISMATCH') END;
END;

CREATE TRIGGER album_matching_changes_no_update
BEFORE UPDATE ON album_matching_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_MATCHING_CHANGE');
END;

CREATE TRIGGER album_matching_changes_no_delete
BEFORE DELETE ON album_matching_changes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_MATCHING_CHANGE');
END;

CREATE TRIGGER album_matching_changes_photo_insert
AFTER INSERT ON photos BEGIN
  INSERT INTO album_matching_changes(
    workspace_id,project_id,album_id,kind,source_id,source_revision,source_state
  ) VALUES(NEW.workspace_id,NEW.project_id,NEW.album_id,'photo',NEW.id,0,'');
END;

CREATE TRIGGER album_matching_changes_version_insert
AFTER INSERT ON photo_versions BEGIN
  SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM photos p
      WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id)
    THEN RAISE(ABORT,'ALBUM_MATCHING_CHANGE_SOURCE_MISMATCH') END;
  INSERT INTO album_matching_changes(
    workspace_id,project_id,album_id,kind,source_id,source_revision,source_state
  )
  SELECT p.workspace_id,p.project_id,p.album_id,'version',NEW.id,0,''
  FROM photos p
  WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id;
END;

CREATE TRIGGER album_matching_changes_head_insert
AFTER INSERT ON photo_version_heads BEGIN
  INSERT INTO album_matching_changes(
    workspace_id,project_id,album_id,kind,source_id,source_revision,source_state
  ) VALUES(
    NEW.workspace_id,NEW.project_id,NEW.album_id,'head',NEW.photo_id,NEW.revision,''
  );
END;

CREATE TRIGGER album_matching_changes_head_update
AFTER UPDATE ON photo_version_heads
WHEN NEW.revision<>OLD.revision OR NEW.version_id<>OLD.version_id BEGIN
  INSERT INTO album_matching_changes(
    workspace_id,project_id,album_id,kind,source_id,source_revision,source_state
  ) VALUES(
    NEW.workspace_id,NEW.project_id,NEW.album_id,'head',NEW.photo_id,NEW.revision,''
  );
END;

CREATE TRIGGER album_matching_changes_upload_insert
AFTER INSERT ON upload_sessions WHEN NEW.status='reserved' BEGIN
  INSERT INTO album_matching_changes(
    workspace_id,project_id,album_id,kind,source_id,source_revision,source_state
  ) VALUES(
    NEW.workspace_id,NEW.project_id,NEW.album_id,'upload',NEW.id,0,NEW.status
  );
END;

CREATE TRIGGER album_matching_changes_upload_status
AFTER UPDATE ON upload_sessions
WHEN NEW.status<>OLD.status BEGIN
  INSERT INTO album_matching_changes(
    workspace_id,project_id,album_id,kind,source_id,source_revision,source_state
  ) VALUES(
    NEW.workspace_id,NEW.project_id,NEW.album_id,'upload',NEW.id,0,NEW.status
  );
END;