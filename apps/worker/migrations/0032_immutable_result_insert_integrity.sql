-- M2n1: all unique conflicts of immutable result rows must fail closed.
-- Do not rely on recursive_triggers or DELETE hooks to stop REPLACE.
PRAGMA foreign_keys=ON;

CREATE TRIGGER guest_selection_results_insert_integrity
BEFORE INSERT ON guest_selection_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM guest_selection_results r WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_RESULT');
END;

CREATE TRIGGER guest_feedback_results_insert_integrity
BEFORE INSERT ON guest_feedback_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM guest_feedback_results r WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_FEEDBACK_RESULT');
END;

CREATE TRIGGER guest_selection_submission_results_insert_integrity
BEFORE INSERT ON guest_selection_submission_results
WHEN NEW.submission_id IS NULL OR EXISTS(
  SELECT 1 FROM guest_selection_submission_results r WHERE r.submission_id=NEW.submission_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_GUEST_SELECTION_SUBMISSION_RESULT');
END;

CREATE TRIGGER selection_policy_results_insert_integrity
BEFORE INSERT ON selection_policy_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM selection_policy_results r WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_RESULT');
END;

CREATE TRIGGER selection_policy_configuration_results_insert_integrity
BEFORE INSERT ON selection_policy_configuration_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM selection_policy_configuration_results r WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SELECTION_POLICY_CONFIGURATION_RESULT');
END;

CREATE TRIGGER shared_review_owner_results_insert_integrity
BEFORE INSERT ON shared_review_owner_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM shared_review_owner_results r WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_OWNER_RESULT');
END;

CREATE TRIGGER shared_review_guest_results_insert_integrity
BEFORE INSERT ON shared_review_guest_results
WHEN NEW.command_id IS NULL OR EXISTS(
  SELECT 1 FROM shared_review_guest_results r WHERE r.command_id=NEW.command_id
    OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_GUEST_RESULT');
END;

CREATE TRIGGER audit_events_required_key
BEFORE INSERT ON audit_events
WHEN NEW.event_id IS NULL OR length(NEW.event_id)=0 BEGIN
  SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT');
END;
