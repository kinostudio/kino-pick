-- Additive Owner history query indexes only. Existing audit rows, tables, and triggers are unchanged.
-- Workspace-leading indexes support full and scoped history ordering; the single
-- workspace index uses SQLite's implicit rowid suffix for bounded snapshot seeks.
CREATE INDEX audit_owner_history_workspace_time
  ON audit_events(workspace_id, occurred_at_utc DESC, event_id DESC);

CREATE INDEX audit_owner_history_project_time
  ON audit_events(workspace_id, project_id, occurred_at_utc DESC, event_id DESC);

CREATE INDEX audit_owner_history_album_time
  ON audit_events(workspace_id, album_id, occurred_at_utc DESC, event_id DESC);

CREATE INDEX audit_owner_history_photo_time
  ON audit_events(workspace_id, photo_id, occurred_at_utc DESC, event_id DESC);

CREATE INDEX audit_owner_history_version_time
  ON audit_events(workspace_id, version_id, occurred_at_utc DESC, event_id DESC);

CREATE INDEX audit_owner_history_action_time
  ON audit_events(workspace_id, action, occurred_at_utc DESC, event_id DESC);

CREATE INDEX audit_owner_history_workspace_rowid
  ON audit_events(workspace_id);
