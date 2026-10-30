-- M3i1: append-only, lazily maintained canonical filename witnesses.
-- No source rows are backfilled and no upload or matching behavior is switched here.
PRAGMA foreign_keys=ON;

CREATE UNIQUE INDEX upload_sessions_matching_filename_source
  ON upload_sessions(id,workspace_id,project_id,album_id,original_filename);

CREATE TABLE matching_filename_index(
  upload_session_id TEXT NOT NULL CHECK(typeof(upload_session_id)='text'),
  profile TEXT NOT NULL CHECK(profile='default-v1'),
  workspace_id TEXT NOT NULL CHECK(typeof(workspace_id)='text'),
  project_id TEXT NOT NULL CHECK(typeof(project_id)='text'),
  album_id TEXT NOT NULL CHECK(typeof(album_id)='text'),
  original_filename TEXT NOT NULL
    CHECK(typeof(original_filename)='text' AND length(original_filename) BETWEEN 1 AND 255),
  canonical_basename TEXT,
  canonical_extension TEXT,
  is_invalid INTEGER NOT NULL
    CHECK(typeof(is_invalid)='integer' AND is_invalid IN(0,1)),
  PRIMARY KEY(upload_session_id,profile),
  CHECK(
    (is_invalid=1 AND canonical_basename IS NULL AND canonical_extension IS NULL)
    OR
    (is_invalid=0 AND typeof(canonical_basename)='text'
      AND length(canonical_basename) BETWEEN 1 AND 255
      AND (canonical_extension IS NULL OR
        (typeof(canonical_extension)='text'
          AND lower(canonical_extension) IN(
            'avif','bmp','gif','heic','heif','jpeg','jpg','png','tif','tiff','webp'
          )
        )
      )
    )
  ),
  FOREIGN KEY(upload_session_id,workspace_id,project_id,album_id,original_filename)
    REFERENCES upload_sessions(id,workspace_id,project_id,album_id,original_filename)
);

CREATE INDEX matching_filename_index_album_profile
  ON matching_filename_index(workspace_id,project_id,album_id,profile,upload_session_id);

CREATE INDEX matching_filename_index_canonical_scope
  ON matching_filename_index(
    workspace_id,project_id,album_id,profile,
    canonical_basename,canonical_extension,upload_session_id
  ) WHERE is_invalid=0;

-- SQLite cannot certify JavaScript NFC canonicalization. The trusted Worker
-- computes canonical values; these guards validate shape, profile and witnesses.
CREATE TRIGGER matching_filename_index_insert_guard
BEFORE INSERT ON matching_filename_index BEGIN
  SELECT CASE WHEN NEW.profile IS NOT 'default-v1'
    THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_PROFILE') END;
  SELECT CASE WHEN
    (NEW.is_invalid=1 AND
      (NEW.canonical_basename IS NOT NULL OR NEW.canonical_extension IS NOT NULL))
    OR (NEW.is_invalid=0 AND
      (typeof(NEW.canonical_basename)<>'text'
        OR length(NEW.canonical_basename)=0
        OR (NEW.canonical_extension IS NOT NULL AND
          (typeof(NEW.canonical_extension)<>'text'
            OR lower(NEW.canonical_extension) NOT IN(
              'avif','bmp','gif','heic','heif','jpeg','jpg','png','tif','tiff','webp'
            )
          )
        )
      )
    )
    THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_INVALID_PAIR') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM upload_sessions u
    WHERE u.id=NEW.upload_session_id AND u.workspace_id=NEW.workspace_id
      AND u.project_id=NEW.project_id AND u.album_id=NEW.album_id
      AND u.original_filename=NEW.original_filename
  ) THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_SOURCE_MISMATCH') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM matching_filename_index old
    WHERE old.upload_session_id=NEW.upload_session_id AND old.profile=NEW.profile
      AND (
        old.workspace_id IS NOT NEW.workspace_id
        OR old.project_id IS NOT NEW.project_id
        OR old.album_id IS NOT NEW.album_id
        OR old.original_filename IS NOT NEW.original_filename
        OR old.canonical_basename IS NOT NEW.canonical_basename
        OR old.canonical_extension IS NOT NEW.canonical_extension
        OR old.is_invalid IS NOT NEW.is_invalid
      )
  ) THEN RAISE(ABORT,'MATCHING_FILENAME_INDEX_IMMUTABLE') END;
END;

CREATE TRIGGER matching_filename_index_no_update
BEFORE UPDATE ON matching_filename_index BEGIN
  SELECT RAISE(ABORT,'MATCHING_FILENAME_INDEX_IMMUTABLE');
END;

CREATE TRIGGER matching_filename_index_no_delete
BEFORE DELETE ON matching_filename_index BEGIN
  SELECT RAISE(ABORT,'MATCHING_FILENAME_INDEX_IMMUTABLE');
END;
