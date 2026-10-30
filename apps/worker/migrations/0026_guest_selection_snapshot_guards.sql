-- Make M2j Guest submission snapshots append-closed and scope-stable.
-- Existing immutable submissions/items are sealed in place; no selected row or audit is rewritten.
PRAGMA foreign_keys=ON;

CREATE TABLE guest_selection_submission_seals(
  submission_id TEXT PRIMARY KEY REFERENCES guest_selection_submissions(id),
  item_count INTEGER NOT NULL CHECK(item_count>0),
  sealed_at_ms INTEGER NOT NULL CHECK(typeof(sealed_at_ms)='integer')
);
INSERT INTO guest_selection_submission_seals(submission_id,item_count,sealed_at_ms)
SELECT s.id,count(i.photo_id),s.created_at_ms
FROM guest_selection_submissions s
JOIN guest_selection_submission_items i ON i.submission_id=s.id
GROUP BY s.id;

CREATE TRIGGER guest_selection_submission_seals_no_update BEFORE UPDATE ON guest_selection_submission_seals BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SNAPSHOT_SEAL');
END;
CREATE TRIGGER guest_selection_submission_seals_no_delete BEFORE DELETE ON guest_selection_submission_seals BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SNAPSHOT_SEAL');
END;
CREATE TRIGGER guest_selection_submission_seals_guard BEFORE INSERT ON guest_selection_submission_seals BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_selection_submissions s
    JOIN guest_selection_round_state r ON r.invite_id=s.invite_id AND r.guest_id=s.guest_id AND r.album_id=s.album_id
      AND r.workspace_id=s.workspace_id AND r.project_id=s.project_id AND r.round_no=s.round_no
      AND r.selection_revision=s.selection_revision AND r.status='submitted'
    WHERE s.id=NEW.submission_id AND NEW.item_count=(
      SELECT count(*) FROM guest_selection_submission_items i WHERE i.submission_id=s.id
    ) AND NEW.item_count=(
      SELECT count(*) FROM guest_selection_state st
      WHERE st.invite_id=s.invite_id AND st.guest_id=s.guest_id AND st.album_id=s.album_id
    ) AND NOT EXISTS(
      SELECT 1 FROM guest_selection_submission_items i
      LEFT JOIN guest_selection_state st ON st.invite_id=i.invite_id AND st.guest_id=i.guest_id
        AND st.album_id=i.album_id AND st.photo_id=i.photo_id AND st.version_id=i.version_id
        AND st.selected_at_ms=i.selected_at_ms
      WHERE i.submission_id=s.id AND st.photo_id IS NULL
    )
  ) THEN RAISE(ABORT,'INVALID_GUEST_SELECTION_SNAPSHOT_SEAL') END;
END;

CREATE TRIGGER guest_selection_submission_items_guard BEFORE INSERT ON guest_selection_submission_items BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_selection_submission_seals x WHERE x.submission_id=NEW.submission_id
  ) THEN RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SNAPSHOT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_selection_submissions s
    JOIN guest_selection_round_state r ON r.invite_id=s.invite_id AND r.guest_id=s.guest_id AND r.album_id=s.album_id
      AND r.workspace_id=s.workspace_id AND r.project_id=s.project_id AND r.round_no=s.round_no
      AND r.selection_revision=s.selection_revision AND r.status='open'
    JOIN guest_selection_state st ON st.invite_id=s.invite_id AND st.guest_id=s.guest_id
      AND st.workspace_id=s.workspace_id AND st.project_id=s.project_id AND st.album_id=s.album_id
      AND st.photo_id=NEW.photo_id AND st.version_id=NEW.version_id AND st.selected_at_ms=NEW.selected_at_ms
    WHERE s.id=NEW.submission_id AND s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id
      AND s.workspace_id=NEW.workspace_id AND s.project_id=NEW.project_id AND s.album_id=NEW.album_id
  ) THEN RAISE(ABORT,'INVALID_GUEST_SELECTION_SNAPSHOT_ITEM') END;
END;

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
      AND NEW.selection_revision=0 AND NEW.submitted_at_ms IS NULL
      AND EXISTS(SELECT 1 FROM audit_events e JOIN owners o ON o.user_id=e.actor_id AND o.enabled=1
        JOIN workspaces w ON w.owner_user_id=o.user_id AND w.id=NEW.workspace_id
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=e.session_id AND s.expiresAt>unixepoch('subsec')*1000
        WHERE e.event_id='guest-selection-reopen:'||NEW.invite_id||':'||NEW.guest_id||':'||NEW.album_id||':'||NEW.round_no
          AND e.actor_type='user' AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id AND e.album_id=NEW.album_id
          AND e.action='selection.reopened' AND json_extract(e.before_json,'$.status')='submitted'
          AND json_extract(e.before_json,'$.roundNo')=OLD.round_no AND json_extract(e.after_json,'$.status')='open'
          AND json_extract(e.after_json,'$.roundNo')=NEW.round_no))
  ) THEN RAISE(ABORT,'INVALID_GUEST_SELECTION_ROUND_TRANSITION') END;
END;

CREATE TRIGGER guest_selection_round_state_insert_guard BEFORE INSERT ON guest_selection_round_state BEGIN
  SELECT CASE WHEN NOT (
    NEW.round_no=1 AND NEW.selection_revision=1 AND NEW.status='open' AND NEW.submitted_at_ms IS NULL
    AND EXISTS(
      SELECT 1 FROM guest_selection_state st
      JOIN guest_selection_commands c ON c.invite_id=st.invite_id AND c.guest_id=st.guest_id
        AND c.workspace_id=st.workspace_id AND c.project_id=st.project_id AND c.album_id=st.album_id
        AND c.photo_id=st.photo_id AND c.version_id=st.version_id AND c.selected=1 AND c.created_at_ms=st.selected_at_ms
      JOIN guest_selection_results r ON r.command_id=c.id AND r.event_id='guest-selection:'||c.id
      WHERE st.invite_id=NEW.invite_id AND st.guest_id=NEW.guest_id AND st.workspace_id=NEW.workspace_id
        AND st.project_id=NEW.project_id AND st.album_id=NEW.album_id AND st.selected_at_ms=NEW.updated_at_ms
        AND json_extract(r.after_json,'$.selected')=1 AND json_extract(r.after_json,'$.versionId')=st.version_id
    )
  ) THEN RAISE(ABORT,'INVALID_GUEST_SELECTION_ROUND_INSERT') END;
END;

DROP TRIGGER guest_selection_submission_apply;
CREATE TRIGGER guest_selection_submission_apply AFTER INSERT ON guest_selection_submissions BEGIN
  INSERT INTO guest_selection_submission_items(submission_id,invite_id,guest_id,workspace_id,project_id,album_id,photo_id,version_id,selected_at_ms)
  SELECT NEW.id,NEW.invite_id,NEW.guest_id,NEW.workspace_id,NEW.project_id,NEW.album_id,s.photo_id,s.version_id,s.selected_at_ms
  FROM guest_selection_state s WHERE s.invite_id=NEW.invite_id AND s.guest_id=NEW.guest_id AND s.album_id=NEW.album_id;
  INSERT INTO guest_selection_submission_results(submission_id,result_json,event_id,occurred_at_utc)
  SELECT NEW.id,json_object('submissionId',NEW.id,'roundNo',NEW.round_no,'selectionRevision',NEW.selection_revision,
    'selectedCount',(SELECT count(*) FROM guest_selection_submission_items i WHERE i.submission_id=NEW.id),
    'submittedAt',strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch'),
    'eventId','guest-selection-submit:'||NEW.id),
    'guest-selection-submit:'||NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch');
  UPDATE guest_selection_round_state SET status='submitted',submitted_at_ms=NEW.created_at_ms,updated_at_ms=NEW.created_at_ms
  WHERE invite_id=NEW.invite_id AND guest_id=NEW.guest_id AND album_id=NEW.album_id AND round_no=NEW.round_no AND selection_revision=NEW.selection_revision AND status='open';
  INSERT INTO guest_selection_submission_seals(submission_id,item_count,sealed_at_ms)
  SELECT NEW.id,count(*),NEW.created_at_ms FROM guest_selection_submission_items i WHERE i.submission_id=NEW.id;
  INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'guest',NEW.guest_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,'selection.submitted',
    json_object('roundNo',NEW.round_no,'selectionRevision',NEW.selection_revision,'status','open'),
    json_object('submissionId',NEW.id,'roundNo',NEW.round_no,'selectionRevision',NEW.selection_revision,
      'selectedCount',json_extract(r.result_json,'$.selectedCount'),'status','submitted'),NEW.request_id,r.occurred_at_utc
  FROM guest_selection_submission_results r WHERE r.submission_id=NEW.id;
END;
