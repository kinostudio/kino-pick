-- G2-01/G2-02: per-album retention policy and invite expiry mode.
-- Additive only: two new tables plus immutability triggers. No existing table,
-- view, trigger or row is changed. Automatic deletion stays OFF globally
-- (STORAGE_AUTODELETE_ENABLED=false); cleanup_enabled only records the Owner's
-- per-album intent for the dry-run preview.
-- Rollback: stop calling the routes; keep the tables and their audit history.
-- A pre-adoption D1 Time Travel bookmark is recorded in the adoption evidence.
PRAGMA foreign_keys=ON;

CREATE TABLE album_retention_settings(
  album_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  inactive_days INTEGER NOT NULL CHECK(typeof(inactive_days)='integer' AND inactive_days BETWEEN 7 AND 3650),
  cleanup_enabled INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_enabled IN(0,1)),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
  updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms>0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  last_request_id TEXT NOT NULL CHECK(length(last_request_id)=36),
  FOREIGN KEY(album_id,workspace_id,project_id) REFERENCES albums(id,workspace_id,project_id)
);

CREATE TRIGGER album_retention_settings_revision_guard BEFORE UPDATE ON album_retention_settings
WHEN NEW.album_id<>OLD.album_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id
  OR NEW.revision<>OLD.revision+1
BEGIN
  SELECT RAISE(ABORT,'RETENTION_SETTINGS_REVISION_CONFLICT');
END;

CREATE TRIGGER album_retention_settings_no_delete BEFORE DELETE ON album_retention_settings BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_RETENTION_SETTINGS');
END;

CREATE TABLE invite_expiry_modes(
  invite_id TEXT PRIMARY KEY NOT NULL REFERENCES guest_invites(id),
  mode TEXT NOT NULL CHECK(mode IN('custom','inherit')),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms>0),
  created_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TRIGGER invite_expiry_modes_no_update BEFORE UPDATE ON invite_expiry_modes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INVITE_EXPIRY_MODE');
END;

CREATE TRIGGER invite_expiry_modes_no_delete BEFORE DELETE ON invite_expiry_modes BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INVITE_EXPIRY_MODE');
END;
