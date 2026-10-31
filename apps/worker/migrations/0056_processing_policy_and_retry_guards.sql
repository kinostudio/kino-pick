-- Extend the case-folded Owner request namespace to processing policy commands.
-- Same-ledger replays continue through each ledger's existing guard.
CREATE TRIGGER processing_policy_commands_owner_namespace
BEFORE INSERT ON workspace_image_processing_policy_commands
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
)
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id) AND c.request_id<>NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM version_approval_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id AND lower(f.request_id)=lower(NEW.request_id))
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER processing_policy_workspace_commands_namespace
BEFORE INSERT ON workspace_commands
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_request_commands_namespace
BEFORE INSERT ON request_commands
WHEN NOT EXISTS (
  SELECT 1 FROM request_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_upload_requests_namespace
BEFORE INSERT ON upload_requests
WHEN NOT EXISTS (
  SELECT 1 FROM upload_requests c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_upload_workflow_requests_namespace
BEFORE INSERT ON upload_workflow_requests
WHEN NOT EXISTS (
  SELECT 1 FROM upload_workflow_requests c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_processing_review_commands_namespace
BEFORE INSERT ON processing_review_commands
WHEN NOT EXISTS (
  SELECT 1 FROM processing_review_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_invite_revocation_commands_namespace
BEFORE INSERT ON invite_revocation_commands
WHEN NOT EXISTS (
  SELECT 1 FROM invite_revocation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_invite_creation_commands_namespace
BEFORE INSERT ON invite_creation_commands
WHEN NOT EXISTS (
  SELECT 1 FROM invite_creation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_selection_policy_commands_namespace
BEFORE INSERT ON selection_policy_commands
WHEN NOT EXISTS (
  SELECT 1 FROM selection_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_selection_policy_configuration_commands_namespace
BEFORE INSERT ON selection_policy_configuration_commands
WHEN NOT EXISTS (
  SELECT 1 FROM selection_policy_configuration_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_shared_review_owner_commands_namespace
BEFORE INSERT ON shared_review_owner_commands
WHEN NOT EXISTS (
  SELECT 1 FROM shared_review_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_photo_version_head_commands_namespace
BEFORE INSERT ON photo_version_head_commands
WHEN NOT EXISTS (
  SELECT 1 FROM photo_version_head_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_project_versioning_commands_namespace
BEFORE INSERT ON project_versioning_commands
WHEN NOT EXISTS (
  SELECT 1 FROM project_versioning_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_owner_comment_commands_namespace
BEFORE INSERT ON owner_comment_commands
WHEN NOT EXISTS (
  SELECT 1 FROM owner_comment_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_owner_comment_processing_commands_namespace
BEFORE INSERT ON owner_comment_processing_commands
WHEN NOT EXISTS (
  SELECT 1 FROM owner_comment_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_owner_external_intents_namespace
BEFORE INSERT ON owner_external_intents
WHEN NOT EXISTS (
  SELECT 1 FROM owner_external_intents c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_owner_annotation_processing_commands_namespace
BEFORE INSERT ON owner_annotation_processing_commands
WHEN NOT EXISTS (
  SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_owner_annotation_commands_namespace
BEFORE INSERT ON owner_annotation_commands
WHEN NOT EXISTS (
  SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_project_matching_rule_commands_namespace
BEFORE INSERT ON project_matching_rule_commands
WHEN NOT EXISTS (
  SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_version_approval_owner_commands_namespace
BEFORE INSERT ON version_approval_owner_commands
WHEN NOT EXISTS (
  SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
) AND EXISTS (
  SELECT 1 FROM workspace_image_processing_policy_commands c
  WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER processing_policy_upload_key_fences_namespace
BEFORE INSERT ON upload_key_fences
WHEN NEW.actor_type='user'
  AND NOT EXISTS (
    SELECT 1 FROM upload_key_fences f
    WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id
  )
  AND EXISTS (
    SELECT 1 FROM workspace_image_processing_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id)
  )
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

-- Preserve I/O uncertainty when the Cloudflare consumer exhausts its three-attempt budget.
DROP TRIGGER processing_job_transition_guard;
CREATE TRIGGER processing_job_transition_guard BEFORE UPDATE ON image_processing_jobs BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.recipe<>OLD.recipe OR NEW.created_at_ms<>OLD.created_at_ms OR NEW.transition_id=OLD.transition_id OR ABS(NEW.updated_at_ms-unixepoch('subsec')*1000)>60000 THEN RAISE(ABORT,'INVALID_PROCESSING_TRANSITION') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_assets a JOIN photos p ON p.id=a.photo_id JOIN albums al ON al.id=p.album_id AND al.project_id=p.project_id AND al.workspace_id=p.workspace_id
    JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN storage_nodes n ON n.id=a.storage_node_id AND n.status='active'
    WHERE a.id=NEW.id AND al.state NOT IN('archived','deleting','deleted') AND pr.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'PROCESSING_SOURCE_UNAVAILABLE') END;
  SELECT CASE WHEN NOT(
    (NEW.status='running' AND (OLD.status IN('queued','retryable') OR (OLD.status='running' AND OLD.lease_until_ms<=unixepoch('subsec')*1000)) AND NEW.lease_epoch=OLD.lease_epoch+1 AND NEW.lease_token IS NOT OLD.lease_token AND NEW.lease_until_ms<=unixepoch('subsec')*1000+600000 AND NEW.reason_code IS NULL)
    OR(OLD.status='needs_review' AND NEW.status='abandoned' AND NEW.lease_epoch=OLD.lease_epoch AND NEW.reason_code IS OLD.reason_code AND EXISTS(
      SELECT 1 FROM processing_review_commands c WHERE c.job_id=NEW.id AND c.request_id=NEW.transition_id AND c.expected_epoch=OLD.lease_epoch
    ))
    OR(OLD.status='running' AND OLD.lease_until_ms>unixepoch('subsec')*1000 AND NEW.status IN('retryable','needs_review','succeeded') AND NEW.lease_epoch=OLD.lease_epoch AND NEW.reason_code IS CASE WHEN NEW.status='succeeded' THEN NULL WHEN NEW.status='retryable' OR (NEW.status='needs_review' AND NEW.recipe='cloudflare-images-jpeg-82-v1' AND NEW.lease_epoch>=3 AND NEW.reason_code='PROCESSING_IO_UNCERTAIN') THEN 'PROCESSING_IO_UNCERTAIN' ELSE 'PROCESSING_CONTENT_INVALID' END)
  ) THEN RAISE(ABORT,'PROCESSING_LEASE_LOST') END;
  SELECT CASE WHEN NEW.status='running' AND (SELECT COUNT(*) FROM image_processing_outputs WHERE job_id=NEW.id)<>2 THEN RAISE(ABORT,'PROCESSING_OUTPUTS_MISSING') END;
  SELECT CASE WHEN NEW.reserved_bytes>OLD.reserved_bytes AND NOT EXISTS(
    SELECT 1 FROM photo_assets a JOIN workspace_storage_usage u ON u.workspace_id=a.workspace_id JOIN workspaces w ON w.id=u.workspace_id JOIN storage_nodes n ON n.id=a.storage_node_id
    WHERE a.id=NEW.id AND u.used_bytes+u.reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes<=w.quota_bytes AND n.used_bytes+n.reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes<=n.quota_bytes
  ) THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;
END;
