-- Stop sending clientLabel to disable new label creation; keep labels and their
-- invite history. This additive sidecar deliberately has no destructive down step.
PRAGMA foreign_keys=ON;

CREATE TABLE guest_invite_labels(
  invite_id TEXT PRIMARY KEY NOT NULL REFERENCES guest_invites(id),
  client_label TEXT NOT NULL CHECK(
    typeof(client_label)='text' AND length(client_label) BETWEEN 1 AND 80
    AND length(trim(client_label))>0 AND client_label=trim(client_label)
    AND instr(client_label,char(0))=0
    AND client_label NOT GLOB (
      '*[' || char(1) || '-' || char(31) || char(127) || '-' || char(159)
      || char(8234) || '-' || char(8238) || char(8294) || '-' || char(8297) || ']*'
    )
  ),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms>0)
);

CREATE TRIGGER guest_invite_labels_insert_guard BEFORE INSERT ON guest_invite_labels BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1
    FROM invite_creation_commands c
    JOIN guest_invites i ON i.id=c.invite_id AND i.created_by=c.actor_id AND i.owner_session_id=c.session_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.id=c.project_id
    JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=c.actor_id
    JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=c.actor_id AND s.id=c.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    WHERE c.invite_id=NEW.invite_id AND NEW.created_by=c.actor_id
      AND NEW.created_at_ms=c.created_at_ms
      AND json_type(c.payload_json,'$.clientLabel')='text'
      AND json_extract(c.payload_json,'$.clientLabel')=NEW.client_label
  ) THEN RAISE(ABORT,'INVITE_LABEL_NOT_AUTHORIZED') END;
END;

CREATE TRIGGER guest_invite_labels_no_update BEFORE UPDATE ON guest_invite_labels BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INVITE_LABEL');
END;

CREATE TRIGGER guest_invite_labels_no_delete BEFORE DELETE ON guest_invite_labels BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INVITE_LABEL');
END;
