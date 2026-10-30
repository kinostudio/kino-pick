-- Correct submission precondition order: report an empty draft distinctly before CAS checks.
-- Authorization and request replay/conflict checks still run first inside the guard.
DROP TRIGGER guest_selection_submission_guard;
CREATE TRIGGER guest_selection_submission_guard BEFORE INSERT ON guest_selection_submissions BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id AND s.secret_hash=NEW.secret_hash
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id AND (i.permissions_mask & 512)=512
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.round_no<>NEW.round_no OR c.selection_revision<>NEW.selection_revision OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_selection_state s WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id)
    THEN RAISE(ABORT,'EMPTY_SELECTION') END;
  SELECT CASE WHEN NEW.expected_round_no IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id
      AND r.round_no=NEW.expected_round_no AND r.selection_revision=NEW.expected_revision AND r.status='open'
  ) THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.status='submitted')
    THEN RAISE(ABORT,'SELECTION_ALREADY_SUBMITTED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.round_no=NEW.round_no AND r.selection_revision=NEW.selection_revision AND r.status='open')
    THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
END;
