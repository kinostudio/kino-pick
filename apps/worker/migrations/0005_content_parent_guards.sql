-- Close composite parentage invariants for the D1 photo catalog before uploads exist.
PRAGMA foreign_keys=ON;
CREATE UNIQUE INDEX albums_photo_parent ON albums(id,project_id,workspace_id);
CREATE TRIGGER projects_parent_immutable BEFORE UPDATE OF id,workspace_id ON projects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PARENT'); END;
CREATE TRIGGER albums_parent_immutable BEFORE UPDATE OF id,workspace_id,project_id ON albums BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PARENT'); END;
CREATE TRIGGER photos_parent_insert BEFORE INSERT ON photos WHEN NOT EXISTS(SELECT 1 FROM albums a WHERE a.id=NEW.album_id AND a.project_id=NEW.project_id AND a.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PARENT'); END;
CREATE TRIGGER photos_parent_immutable BEFORE UPDATE OF id,workspace_id,project_id,album_id ON photos BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PARENT'); END;
