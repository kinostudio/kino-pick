-- Immutable photo history must reject conflicts before SQLite REPLACE deletes rows.
-- Additive protection only: retain all old rows and existing scope checks.
CREATE TRIGGER photo_versions_insert_integrity
BEFORE INSERT ON photo_versions
WHEN NEW.id IS NULL OR EXISTS (
  SELECT 1 FROM photo_versions v WHERE v.id=NEW.id
    OR (v.photo_id=NEW.photo_id AND v.version_no=NEW.version_no)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION');
END;

CREATE TRIGGER photo_assets_insert_integrity
BEFORE INSERT ON photo_assets
WHEN NEW.id IS NULL OR EXISTS (
  SELECT 1 FROM photo_assets a WHERE a.id=NEW.id OR a.object_key=NEW.object_key
    OR (a.version_id=NEW.version_id AND a.asset_kind=NEW.asset_kind)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PHOTO_ASSET');
END;

CREATE TRIGGER processing_outputs_insert_integrity
BEFORE INSERT ON image_processing_outputs
WHEN EXISTS (
  SELECT 1 FROM image_processing_outputs o
  WHERE (o.job_id=NEW.job_id AND o.kind=NEW.kind)
    OR o.asset_id=NEW.asset_id OR o.object_key=NEW.object_key
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_OUTPUT');
END;