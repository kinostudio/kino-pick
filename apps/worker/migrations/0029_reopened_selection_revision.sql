-- Initialize retained selections in reopened rounds at revision1 so unchanged
-- resubmission satisfies the existing positive-revision snapshot invariant.
-- Preserve every sealed snapshot and historical reopen event/result.
PRAGMA foreign_keys=ON;
INSERT INTO audit_events(event_id,actor_type,workspace_id,project_id,album_id,action,before_json,after_json,request_id)
SELECT 'selection-round-init:'||r.invite_id||':'||r.guest_id||':'||r.album_id||':'||r.round_no,
  'system',r.workspace_id,r.project_id,r.album_id,'selection.round_initialized',
  json_object('inviteId',r.invite_id,'guestId',r.guest_id,'roundNo',r.round_no,'selectionRevision',0),
  json_object('inviteId',r.invite_id,'guestId',r.guest_id,'roundNo',r.round_no,'selectionRevision',1),
  'selection-round-init:'||r.invite_id||':'||r.guest_id||':'||r.album_id||':'||r.round_no
FROM guest_selection_round_state r
WHERE r.status='open' AND r.round_no>1 AND r.selection_revision=0;
UPDATE guest_selection_round_state SET selection_revision=1,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)
WHERE status='open' AND round_no>1 AND selection_revision=0
  AND EXISTS(SELECT 1 FROM audit_events e WHERE e.event_id='selection-round-init:'||guest_selection_round_state.invite_id||':'||guest_selection_round_state.guest_id||':'||guest_selection_round_state.album_id||':'||guest_selection_round_state.round_no
    AND e.action='selection.round_initialized' AND e.actor_type='system');

DROP TRIGGER guest_selection_round_state_update_guard;
CREATE TRIGGER guest_selection_round_state_update_guard BEFORE UPDATE ON guest_selection_round_state BEGIN
  SELECT CASE WHEN NEW.invite_id<>OLD.invite_id OR NEW.guest_id<>OLD.guest_id
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.project_id<>OLD.project_id OR NEW.album_id<>OLD.album_id
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_ROUND_SCOPE') END;
  SELECT CASE WHEN NOT (
    (OLD.status='open' AND NEW.status='open' AND NEW.round_no=OLD.round_no
      AND NEW.selection_revision=OLD.selection_revision+1 AND NEW.submitted_at_ms IS NULL)
    OR (OLD.status='open' AND NEW.status='submitted' AND NEW.round_no=OLD.round_no
      AND NEW.selection_revision=OLD.selection_revision AND NEW.submitted_at_ms IS NOT NULL
      AND EXISTS(SELECT 1 FROM guest_selection_submissions s WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id
        AND s.workspace_id=NEW.workspace_id AND s.project_id=NEW.project_id AND s.album_id=NEW.album_id
        AND s.round_no=NEW.round_no AND s.selection_revision=NEW.selection_revision AND s.created_at_ms=NEW.submitted_at_ms))
    OR (OLD.status='submitted' AND NEW.status='open' AND NEW.round_no=OLD.round_no+1
      AND NEW.selection_revision=1 AND NEW.submitted_at_ms IS NULL
      AND EXISTS(SELECT 1 FROM audit_events e JOIN owners o ON o.user_id=e.actor_id AND o.enabled=1
        JOIN workspaces w ON w.owner_user_id=o.user_id AND w.id=NEW.workspace_id
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=e.session_id AND s.expiresAt>unixepoch('subsec')*1000
        WHERE e.event_id='guest-selection-reopen:'||NEW.invite_id||':'||NEW.guest_id||':'||NEW.album_id||':'||NEW.round_no
          AND e.actor_type='user' AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id AND e.album_id=NEW.album_id
          AND e.action='selection.reopened' AND json_extract(e.before_json,'$.status')='submitted'
          AND json_extract(e.before_json,'$.roundNo')=OLD.round_no AND json_extract(e.after_json,'$.status')='open'
          AND json_extract(e.after_json,'$.roundNo')=NEW.round_no
          AND json_extract(e.after_json,'$.selectionRevision')=1))
  ) THEN RAISE(ABORT,'INVALID_GUEST_SELECTION_ROUND_TRANSITION') END;
END;
