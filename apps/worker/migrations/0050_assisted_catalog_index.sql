-- M3i3: bounded Owner Assisted candidate catalog seeks.
-- Additive index only; existing photos and matching behavior are unchanged.
CREATE INDEX photos_assisted_catalog_scope_id
  ON photos(workspace_id,project_id,album_id,id);
