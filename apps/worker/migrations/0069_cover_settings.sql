-- Owner-chosen covers: one photo per album, one album per project.
-- Additive only: two new tables plus guard triggers. No existing table, view,
-- trigger or row is changed. A NULL choice means "automatic" (album: first
-- pinned > first photographer recommendation > first photo; project: first
-- album). Every change is audited by the service.
-- Rollback: stop calling the routes; keep the tables and their audit history.
-- A pre-adoption D1 Time Travel bookmark is recorded in the adoption evidence.
PRAGMA foreign_keys=ON;

CREATE TABLE album_cover_settings(
  album_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  photo_id TEXT,
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms>0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  last_request_id TEXT NOT NULL CHECK(length(last_request_id)=36),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id),
  FOREIGN KEY(photo_id) REFERENCES photos(id)
);

CREATE TRIGGER album_cover_settings_scope_guard BEFORE INSERT ON album_cover_settings
WHEN NEW.photo_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM photos p WHERE p.id=NEW.photo_id AND p.album_id=NEW.album_id AND p.workspace_id=NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT,'COVER_PHOTO_SCOPE_MISMATCH');
END;

CREATE TRIGGER album_cover_settings_update_guard BEFORE UPDATE ON album_cover_settings
WHEN NEW.album_id<>OLD.album_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
  OR NEW.revision<>OLD.revision+1
  OR (NEW.photo_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM photos p WHERE p.id=NEW.photo_id AND p.album_id=NEW.album_id AND p.workspace_id=NEW.workspace_id))
BEGIN
  SELECT RAISE(ABORT,'COVER_SETTINGS_REVISION_CONFLICT');
END;

CREATE TRIGGER album_cover_settings_no_delete BEFORE DELETE ON album_cover_settings BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_COVER_SETTINGS');
END;

CREATE TABLE project_cover_settings(
  project_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  album_id TEXT,
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms>0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  last_request_id TEXT NOT NULL CHECK(length(last_request_id)=36),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id) REFERENCES albums(id)
);

CREATE TRIGGER project_cover_settings_scope_guard BEFORE INSERT ON project_cover_settings
WHEN NEW.album_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM albums a WHERE a.id=NEW.album_id AND a.project_id=NEW.project_id AND a.workspace_id=NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT,'COVER_ALBUM_SCOPE_MISMATCH');
END;

CREATE TRIGGER project_cover_settings_update_guard BEFORE UPDATE ON project_cover_settings
WHEN NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id
  OR NEW.revision<>OLD.revision+1
  OR (NEW.album_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM albums a WHERE a.id=NEW.album_id AND a.project_id=NEW.project_id AND a.workspace_id=NEW.workspace_id))
BEGIN
  SELECT RAISE(ABORT,'COVER_SETTINGS_REVISION_CONFLICT');
END;

CREATE TRIGGER project_cover_settings_no_delete BEFORE DELETE ON project_cover_settings BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_COVER_SETTINGS');
END;
