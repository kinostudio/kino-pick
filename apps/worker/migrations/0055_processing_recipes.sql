-- Generated from the complete 0054 schema; only recipe admission/outbox are changed.

-- Recovery: disable new admission/runners; retain DB+R2 backups and repair forward. Never down-migrate live Cloudflare jobs.

-- Apply as one D1 migration after isolated populated restore/parity. Historical rows and keys are copied verbatim.

PRAGMA defer_foreign_keys=ON;

DROP TRIGGER "processing_review_command_apply";

DROP TRIGGER "processing_review_commands_no_update";

DROP TRIGGER "processing_review_commands_no_delete";

DROP TRIGGER "processing_job_insert_guard";

DROP TRIGGER "processing_original_outbox";

DROP TRIGGER "processing_output_insert_guard";

DROP TRIGGER "processing_job_slots";

DROP TRIGGER "processing_outputs_no_update";

DROP TRIGGER "processing_outputs_no_delete";

DROP TRIGGER "processing_jobs_no_delete";

DROP TRIGGER "processing_job_transition_guard";

DROP TRIGGER "processing_result_guard";

DROP TRIGGER "processing_job_apply";

DROP TRIGGER "content_archive_processing_guard";

DROP TRIGGER "request_commands_processing_review_id_guard";

DROP TRIGGER "invite_creation_command_guard";

DROP TRIGGER "request_command_guard";

DROP TRIGGER "processing_review_command_guard";

DROP TRIGGER "invite_revocation_command_guard";

DROP TRIGGER "selection_policy_command_guard";

DROP TRIGGER "processing_review_commands_selection_policy_namespace";

DROP TRIGGER "processing_review_shared_review_namespace";

DROP TRIGGER "shared_review_owner_command_guard";

DROP TRIGGER "selection_reopened_shared_review_full_namespace";

DROP TRIGGER "selection_policy_configuration_command_guard";

DROP TRIGGER "processing_review_policy_configuration_namespace";

DROP TRIGGER "processing_outputs_insert_integrity";

DROP TRIGGER "photo_version_head_command_guard";

DROP TRIGGER "photo_version_head_results_insert_guard";

DROP TRIGGER "processing_review_commands_photo_version_head_namespace";

DROP TRIGGER "upload_workflow_request_guard";

DROP TRIGGER "content_archive_upload_guard";

DROP TRIGGER "processing_review_commands_project_versioning_namespace";

DROP TRIGGER "owner_external_intents_insert_guard";

DROP TRIGGER "owner_external_intents_audit";

DROP TRIGGER "owner_external_intents_no_update";

DROP TRIGGER "owner_external_intents_no_delete";

DROP TRIGGER "owner_external_intents_workspace_commands_namespace";

DROP TRIGGER "owner_external_intents_request_commands_namespace";

DROP TRIGGER "owner_external_intents_upload_requests_namespace";

DROP TRIGGER "owner_external_intents_upload_workflow_namespace";

DROP TRIGGER "owner_external_intents_processing_review_namespace";

DROP TRIGGER "owner_external_intents_invite_revocation_namespace";

DROP TRIGGER "owner_external_intents_invite_creation_namespace";

DROP TRIGGER "owner_external_intents_selection_policy_namespace";

DROP TRIGGER "owner_external_intents_selection_policy_configuration_namespace";

DROP TRIGGER "owner_external_intents_shared_review_owner_namespace";

DROP TRIGGER "owner_external_intents_photo_version_head_namespace";

DROP TRIGGER "owner_external_intents_project_versioning_namespace";

DROP TRIGGER "owner_external_intents_selection_reopened_namespace";

DROP TRIGGER "owner_external_intents_upload_fence_guard";

DROP TRIGGER "owner_external_intents_processing_certificate_guard";

DROP TRIGGER "project_versioning_command_guard";

DROP TRIGGER "upload_request_guard";

DROP TRIGGER "guest_comment_command_guard";

DROP TRIGGER "owner_comment_commands_insert_guard";

DROP TRIGGER "owner_comment_ns_05";

DROP TRIGGER "owner_comment_external_intent_ns";

DROP TRIGGER "owner_comment_processing_commands_insert_guard";

DROP TRIGGER "owner_comment_processing_ns_05";

DROP TRIGGER "owner_comment_processing_ns_external_intents";

DROP TRIGGER "guest_annotation_command_guard";

DROP TRIGGER "owner_annotation_command_insert_guard";

DROP TRIGGER "owner_annotation_ns_processing_review_commands";

DROP TRIGGER "owner_annotation_ns_external_intents";

DROP TRIGGER "owner_annotation_processing_commands_insert_guard";

DROP TRIGGER "owner_annotation_processing_ns_processing_review_commands";

DROP TRIGGER "owner_annotation_processing_ns_owner_external_intents";

DROP TRIGGER "project_matching_rule_command_guard";

DROP TRIGGER "processing_review_commands_project_matching_rules_namespace";

DROP TRIGGER "owner_external_intents_project_matching_rules_namespace";

DROP TRIGGER "upload_resolved_reservation_guard";

DROP TRIGGER "guest_media_download_audit_guard";

DROP TRIGGER "human_photo_view_insert_guard";

DROP TRIGGER "version_approval_owner_command_guard";

DROP TRIGGER "version_approval_guest_command_guard";

DROP TRIGGER "version_approval_receipt_insert_guard";

DROP TRIGGER "version_approval_processing_review_commands_namespace";

DROP TRIGGER "version_approval_owner_external_intents_namespace";

DROP VIEW "guest_annotation_eligible_versions";

DROP VIEW "guest_comment_eligible_versions";

CREATE TABLE "image_processing_jobs_recipe_replacement"(
  id TEXT PRIMARY KEY REFERENCES photo_assets(id),
  recipe TEXT NOT NULL CHECK(recipe IN('local-sharp-0.35.5-v1','cloudflare-images-jpeg-82-v1')),
  status TEXT NOT NULL CHECK(status IN('queued','running','retryable','needs_review','succeeded','unsupported','abandoned')),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes IN(0,16777216)),
  lease_token TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK(lease_epoch>=0),
  lease_until_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts=lease_epoch),
  reason_code TEXT CHECK(reason_code IN('PROCESSING_CONTENT_INVALID','PROCESSING_IO_UNCERTAIN')),
  result_json TEXT,
  transition_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK(
    (status IN('queued','unsupported') AND reserved_bytes=0 AND lease_token IS NULL AND lease_until_ms IS NULL AND lease_epoch=0 AND result_json IS NULL)
    OR(status='running' AND reserved_bytes=16777216 AND lease_token IS NOT NULL AND lease_until_ms>updated_at_ms AND lease_epoch>0 AND result_json IS NULL)
    OR(status IN('retryable','needs_review') AND reserved_bytes=16777216 AND lease_token IS NULL AND lease_until_ms IS NULL AND lease_epoch>0 AND result_json IS NULL)
    OR(status='abandoned' AND reserved_bytes=0 AND lease_token IS NULL AND lease_until_ms IS NULL AND lease_epoch>0 AND result_json IS NULL)
    OR(status='succeeded' AND reserved_bytes=0 AND lease_token IS NULL AND lease_until_ms IS NULL AND lease_epoch>0 AND result_json IS NOT NULL)
  )
);

INSERT INTO "image_processing_jobs_recipe_replacement" SELECT * FROM "image_processing_jobs";

CREATE TABLE "image_processing_outputs_recipe_replacement"(
  job_id TEXT NOT NULL REFERENCES "image_processing_jobs_recipe_replacement"(id),
  kind TEXT NOT NULL CHECK(kind IN('thumbnail','preview')),
  asset_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  max_bytes INTEGER NOT NULL CHECK(max_bytes=8388608),
  PRIMARY KEY(job_id,kind)
);

INSERT INTO "image_processing_outputs_recipe_replacement" SELECT * FROM "image_processing_outputs";

CREATE TABLE processing_review_commands_recipe_replacement(
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES image_processing_jobs_recipe_replacement(id),
  expected_epoch INTEGER NOT NULL CHECK(expected_epoch>0),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  fences_json TEXT NOT NULL CHECK(json_valid(fences_json)),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);

INSERT INTO "processing_review_commands_recipe_replacement" SELECT * FROM "processing_review_commands";

CREATE TABLE owner_external_intents_recipe_replacement(
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL CHECK(length(request_id)=36
    AND request_id GLOB '????????-????-????-????-????????????'
    AND request_id NOT GLOB '*[^0-9A-Fa-f-]*'
    AND length(replace(request_id,'-',''))=32),
  operation TEXT NOT NULL CHECK(operation IN('upload.cancelled','processing.abandoned')),
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  upload_session_id TEXT REFERENCES upload_sessions(id),
  job_id TEXT REFERENCES image_processing_jobs_recipe_replacement(id),
  photo_id TEXT REFERENCES photos(id),
  version_id TEXT REFERENCES photo_versions(id),
  expected_epoch INTEGER,
  storage_node_id TEXT NOT NULL REFERENCES storage_nodes(id),
  original_object_key TEXT,
  thumbnail_key TEXT,
  preview_key TEXT,
  payload_json TEXT NOT NULL CHECK(COALESCE(CASE WHEN json_valid(payload_json)
    THEN json_type(payload_json)='object' ELSE 0 END,0)),
  created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'
    AND created_at_ms BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY(actor_id,request_id),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  FOREIGN KEY(album_id,project_id,workspace_id)
    REFERENCES albums(id,project_id,workspace_id),
  CHECK(
    (operation='upload.cancelled'
      AND upload_session_id IS NOT NULL
      AND job_id IS NULL AND photo_id IS NULL AND version_id IS NULL
      AND expected_epoch IS NULL
      AND original_object_key IS NOT NULL
      AND thumbnail_key IS NULL AND preview_key IS NULL)
    OR
    (operation='processing.abandoned'
      AND upload_session_id IS NULL
      AND job_id IS NOT NULL AND photo_id IS NOT NULL AND version_id IS NOT NULL
      AND typeof(expected_epoch)='integer'
      AND expected_epoch BETWEEN 1 AND 9007199254740991
      AND original_object_key IS NULL
      AND thumbnail_key IS NOT NULL AND preview_key IS NOT NULL)
  )
) WITHOUT ROWID;

INSERT INTO "owner_external_intents_recipe_replacement" SELECT * FROM "owner_external_intents";

DROP TABLE "owner_external_intents";

DROP TABLE "processing_review_commands";

DROP TABLE "image_processing_outputs";

DROP TABLE image_processing_jobs;

ALTER TABLE "image_processing_jobs_recipe_replacement" RENAME TO "image_processing_jobs";

ALTER TABLE "image_processing_outputs_recipe_replacement" RENAME TO "image_processing_outputs";

ALTER TABLE "processing_review_commands_recipe_replacement" RENAME TO "processing_review_commands";

ALTER TABLE "owner_external_intents_recipe_replacement" RENAME TO "owner_external_intents";

CREATE INDEX processing_jobs_pending ON image_processing_jobs(status,created_at_ms,id);

CREATE INDEX owner_external_intents_upload_scope ON owner_external_intents(upload_session_id,created_at_ms);

CREATE INDEX owner_external_intents_job_scope ON owner_external_intents(job_id,expected_epoch);

CREATE INDEX owner_external_intents_scope
  ON owner_external_intents(workspace_id,project_id,album_id,created_at_ms);

CREATE INDEX owner_comment_ns_case_processing_review_commands ON processing_review_commands(actor_id,lower(request_id));

CREATE INDEX owner_comment_ns_case_owner_external_intents ON owner_external_intents(actor_id,lower(request_id));


CREATE TABLE workspace_image_processing_policies(
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 recipe TEXT NOT NULL CHECK(recipe IN('local-sharp-0.35.5-v1','cloudflare-images-jpeg-82-v1')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991),
 updated_at_ms INTEGER NOT NULL
);
CREATE TABLE workspace_image_processing_policy_commands(
 actor_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, session_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision>=0 AND expected_revision<9007199254740991),
 recipe TEXT NOT NULL CHECK(recipe IN('local-sharp-0.35.5-v1','cloudflare-images-jpeg-82-v1')), created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
 PRIMARY KEY(actor_id,request_id)
);
CREATE TRIGGER workspace_processing_policy_command_guard BEFORE INSERT ON workspace_image_processing_policy_commands BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspaces w JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000 WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN length(NEW.request_id)<>36 OR NEW.request_id NOT GLOB '????????-????-????-????-????????????' OR NEW.request_id GLOB '*[^0-9A-Fa-f-]*' OR length(replace(NEW.request_id,'-',''))<>32 THEN RAISE(ABORT,'INVALID_REQUEST_ID') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id AND (c.workspace_id<>NEW.workspace_id OR c.expected_revision<>NEW.expected_revision OR c.recipe<>NEW.recipe)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
 SELECT CASE WHEN ABS(NEW.created_at_ms-unixepoch('subsec')*1000)>60000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
 SELECT CASE WHEN NEW.expected_revision<>COALESCE((SELECT revision FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id),0) THEN RAISE(ABORT,'IMAGE_PROCESSING_POLICY_REVISION_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_sessions u WHERE u.workspace_id=NEW.workspace_id AND u.status='reserved' AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id) AND NOT EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=u.id)) THEN RAISE(ABORT,'IMAGE_PROCESSING_POLICY_UPLOADS_IN_PROGRESS') END;
END;
CREATE TRIGGER workspace_processing_policy_command_apply AFTER INSERT ON workspace_image_processing_policy_commands BEGIN
 INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,action,before_json,after_json,request_id)
 VALUES('processing-policy:'||NEW.actor_id||':'||NEW.request_id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,'image_processing.policy_changed',json_object('recipe',COALESCE((SELECT recipe FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id),'local-sharp-0.35.5-v1'),'revision',NEW.expected_revision),json_object('recipe',NEW.recipe,'revision',NEW.expected_revision+1),NEW.request_id);
 INSERT INTO workspace_image_processing_policies(workspace_id,recipe,revision,updated_at_ms) VALUES(NEW.workspace_id,NEW.recipe,NEW.expected_revision+1,NEW.created_at_ms)
 ON CONFLICT(workspace_id) DO UPDATE SET recipe=excluded.recipe,revision=excluded.revision,updated_at_ms=excluded.updated_at_ms;
END;
CREATE TRIGGER workspace_processing_policy_insert_guard BEFORE INSERT ON workspace_image_processing_policies BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c WHERE c.workspace_id=NEW.workspace_id AND c.recipe=NEW.recipe AND c.expected_revision=NEW.revision-1 AND c.created_at_ms=NEW.updated_at_ms) OR (EXISTS(SELECT 1 FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id) AND NEW.revision<>1+(SELECT revision FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id)) THEN RAISE(ABORT,'PROCESSING_POLICY_COMMAND_REQUIRED') END;
END;
CREATE TRIGGER workspace_processing_policy_update_guard BEFORE UPDATE ON workspace_image_processing_policies BEGIN
 SELECT CASE WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c WHERE c.workspace_id=NEW.workspace_id AND c.recipe=NEW.recipe AND c.expected_revision=OLD.revision AND c.created_at_ms=NEW.updated_at_ms) THEN RAISE(ABORT,'PROCESSING_POLICY_COMMAND_REQUIRED') END;
END;
CREATE TRIGGER processing_policy_audit_guard BEFORE INSERT ON audit_events WHEN NEW.action='image_processing.policy_changed' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspace_image_processing_policy_commands c WHERE NEW.event_id='processing-policy:'||c.actor_id||':'||c.request_id AND NEW.actor_type='user' AND NEW.actor_id=c.actor_id AND NEW.session_id=c.session_id AND NEW.workspace_id=c.workspace_id AND NEW.request_id=c.request_id AND json_valid(NEW.before_json) AND json_valid(NEW.after_json) AND json_extract(NEW.before_json,'$.revision')=c.expected_revision AND json_extract(NEW.after_json,'$.revision')=c.expected_revision+1 AND json_extract(NEW.after_json,'$.recipe')=c.recipe) THEN RAISE(ABORT,'PROCESSING_POLICY_AUDIT_INVALID') END;
END;
CREATE TRIGGER workspace_processing_policy_no_delete BEFORE DELETE ON workspace_image_processing_policies BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_POLICY'); END;
CREATE TRIGGER workspace_processing_policy_commands_no_update BEFORE UPDATE ON workspace_image_processing_policy_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_POLICY_COMMAND'); END;
CREATE TRIGGER workspace_processing_policy_commands_no_delete BEFORE DELETE ON workspace_image_processing_policy_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_POLICY_COMMAND'); END;
CREATE TRIGGER upload_processing_source_limit BEFORE INSERT ON upload_sessions WHEN EXISTS(SELECT 1 FROM workspace_image_processing_policies p WHERE p.workspace_id=NEW.workspace_id AND p.recipe='cloudflare-images-jpeg-82-v1') AND NEW.expected_bytes>16777216 BEGIN SELECT RAISE(ABORT,'PROCESSING_SOURCE_LIMIT'); END;


CREATE VIEW guest_comment_eligible_versions AS
SELECT v.id AS version_id,v.photo_id AS photo_id,v.workspace_id AS workspace_id,
       p.project_id AS project_id,p.album_id AS album_id,v.version_no AS version_no
FROM photo_versions v
JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id
  AND head.project_id=p.project_id AND head.album_id=p.album_id
JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=p.id
  AND original.workspace_id=p.workspace_id AND original.asset_kind='original'
  AND original.state='private' AND original.byte_size=v.byte_size
  AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded'
JOIN image_processing_outputs thumb_slot ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'
JOIN photo_assets thumb ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key
  AND thumb.version_id=v.id AND thumb.photo_id=p.id AND thumb.workspace_id=p.workspace_id
  AND thumb.asset_kind='thumbnail' AND thumb.state='private' AND thumb.mime='image/jpeg'
JOIN image_processing_outputs preview_slot ON preview_slot.job_id=j.id AND preview_slot.kind='preview'
JOIN photo_assets preview ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key
  AND preview.version_id=v.id AND preview.photo_id=p.id AND preview.workspace_id=p.workspace_id
  AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
WHERE v.id=head.version_id OR v.version_no=1 OR EXISTS(
  SELECT 1 FROM photo_version_head_commands c
  JOIN photo_version_head_results r ON r.command_id=c.id
  WHERE c.photo_id=p.id AND c.workspace_id=p.workspace_id AND c.project_id=p.project_id
    AND c.album_id=p.album_id AND c.version_id=v.id
    AND json_extract(r.result_json,'$.changed')=1
);

CREATE VIEW guest_annotation_eligible_versions AS
SELECT version_id,photo_id,workspace_id,project_id,album_id,version_no
FROM guest_comment_eligible_versions;

CREATE TRIGGER processing_review_command_apply AFTER INSERT ON processing_review_commands BEGIN
  UPDATE image_processing_jobs SET status='abandoned',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,transition_id=NEW.request_id,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)
    WHERE id=NEW.job_id AND status='needs_review' AND lease_epoch=NEW.expected_epoch;
END;

CREATE TRIGGER processing_review_commands_no_update BEFORE UPDATE ON processing_review_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_REVIEW'); END;

CREATE TRIGGER processing_review_commands_no_delete BEFORE DELETE ON processing_review_commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_REVIEW'); END;

CREATE TRIGGER processing_job_insert_guard BEFORE INSERT ON image_processing_jobs BEGIN
 SELECT CASE WHEN NEW.recipe<>COALESCE((SELECT p.recipe FROM workspace_image_processing_policies p JOIN photo_assets a ON a.workspace_id=p.workspace_id WHERE a.id=NEW.id),'local-sharp-0.35.5-v1') THEN RAISE(ABORT,'PROCESSING_RECIPE_MISMATCH') END;
 SELECT CASE WHEN NEW.status='queued' AND NEW.recipe='cloudflare-images-jpeg-82-v1' AND EXISTS(SELECT 1 FROM photo_assets WHERE id=NEW.id AND byte_size>16777216) THEN RAISE(ABORT,'PROCESSING_SOURCE_LIMIT') END;
  SELECT CASE WHEN NEW.status NOT IN('queued','unsupported') OR NEW.reserved_bytes<>0 OR NEW.lease_epoch<>0 OR NOT EXISTS(
    SELECT 1 FROM photo_assets a JOIN photo_versions v ON v.id=a.version_id WHERE a.id=NEW.id AND a.asset_kind='original' AND a.state='private' AND a.checksum_sha256=v.source_hash_sha256 AND a.byte_size=v.byte_size AND a.mime=v.mime
  ) THEN RAISE(ABORT,'PROCESSING_SOURCE_INVALID') END;
END;

CREATE TRIGGER processing_original_outbox AFTER INSERT ON photo_assets WHEN NEW.asset_kind='original' BEGIN
  INSERT INTO image_processing_jobs(id,recipe,status,transition_id,created_at_ms,updated_at_ms)
    SELECT NEW.id,COALESCE((SELECT recipe FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id),'local-sharp-0.35.5-v1'),CASE WHEN v.width IS NOT NULL AND v.height IS NOT NULL AND v.byte_size<=CASE WHEN COALESCE((SELECT recipe FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id),'local-sharp-0.35.5-v1')='cloudflare-images-jpeg-82-v1' THEN 16777216 ELSE 67108864 END THEN 'queued' ELSE 'unsupported' END,
      NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER) FROM photo_versions v WHERE v.id=NEW.version_id;
END;

CREATE TRIGGER processing_output_insert_guard BEFORE INSERT ON image_processing_outputs BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN photos p ON p.id=a.photo_id
    WHERE j.id=NEW.job_id AND j.status IN('queued','unsupported') AND NEW.object_key=p.workspace_id||'/'||p.project_id||'/'||p.album_id||'/'||j.id||'/derived/'||j.recipe||'/'||NEW.kind||'.jpg'
  ) THEN RAISE(ABORT,'PROCESSING_OUTPUT_SCOPE_MISMATCH') END;
END;

CREATE TRIGGER processing_job_slots AFTER INSERT ON image_processing_jobs BEGIN
  INSERT INTO image_processing_outputs(job_id,kind,asset_id,object_key,max_bytes)
    SELECT NEW.id,k.kind,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
      p.workspace_id||'/'||p.project_id||'/'||p.album_id||'/'||NEW.id||'/derived/'||NEW.recipe||'/'||k.kind||'.jpg',8388608
    FROM photo_assets a JOIN photos p ON p.id=a.photo_id CROSS JOIN(SELECT 'thumbnail' AS kind UNION ALL SELECT 'preview') k WHERE a.id=NEW.id;
  INSERT INTO audit_events(event_id,actor_type,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id)
    SELECT 'processing:'||NEW.id||':0:'||NEW.status,'system',p.workspace_id,p.project_id,p.album_id,p.id,a.version_id,'processing.enqueued',json_object('jobId',NEW.id,'status',NEW.status,'recipe',NEW.recipe),NEW.transition_id
    FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE a.id=NEW.id;
END;

CREATE TRIGGER processing_outputs_no_update BEFORE UPDATE ON image_processing_outputs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_OUTPUT'); END;

CREATE TRIGGER processing_outputs_no_delete BEFORE DELETE ON image_processing_outputs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_OUTPUT'); END;

CREATE TRIGGER processing_jobs_no_delete BEFORE DELETE ON image_processing_jobs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROCESSING_JOB'); END;

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
    OR(OLD.status='running' AND OLD.lease_until_ms>unixepoch('subsec')*1000 AND NEW.status IN('retryable','needs_review','succeeded') AND NEW.lease_epoch=OLD.lease_epoch AND NEW.reason_code IS CASE WHEN NEW.status='succeeded' THEN NULL WHEN NEW.status='retryable' THEN 'PROCESSING_IO_UNCERTAIN' ELSE 'PROCESSING_CONTENT_INVALID' END)
  ) THEN RAISE(ABORT,'PROCESSING_LEASE_LOST') END;
  SELECT CASE WHEN NEW.status='running' AND (SELECT COUNT(*) FROM image_processing_outputs WHERE job_id=NEW.id)<>2 THEN RAISE(ABORT,'PROCESSING_OUTPUTS_MISSING') END;
  SELECT CASE WHEN NEW.reserved_bytes>OLD.reserved_bytes AND NOT EXISTS(
    SELECT 1 FROM photo_assets a JOIN workspace_storage_usage u ON u.workspace_id=a.workspace_id JOIN workspaces w ON w.id=u.workspace_id JOIN storage_nodes n ON n.id=a.storage_node_id
    WHERE a.id=NEW.id AND u.used_bytes+u.reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes<=w.quota_bytes AND n.used_bytes+n.reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes<=n.quota_bytes
  ) THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;
END;

CREATE TRIGGER processing_result_guard BEFORE UPDATE ON image_processing_jobs WHEN NEW.status='succeeded' BEGIN
  SELECT CASE WHEN NOT json_valid(NEW.result_json) THEN RAISE(ABORT,'INVALID_PROCESSING_RESULT') END;
  SELECT CASE WHEN json_type(NEW.result_json)<>'array' OR json_array_length(NEW.result_json)<>2 THEN RAISE(ABORT,'INVALID_PROCESSING_RESULT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.result_json) e LEFT JOIN image_processing_outputs s ON s.job_id=NEW.id AND s.kind=json_extract(e.value,'$.kind') WHERE s.kind IS NULL
      OR json_type(e.value,'$.bytes') IS NOT 'integer' OR json_extract(e.value,'$.bytes')<1 OR json_extract(e.value,'$.bytes')>s.max_bytes
      OR json_extract(e.value,'$.mime') IS NOT 'image/jpeg'
      OR json_type(e.value,'$.sha256') IS NOT 'text' OR length(json_extract(e.value,'$.sha256'))<>64 OR json_extract(e.value,'$.sha256') GLOB '*[^0-9a-f]*'
      OR json_type(e.value,'$.width') IS NOT 'integer' OR json_type(e.value,'$.height') IS NOT 'integer'
      OR json_extract(e.value,'$.width')<1 OR json_extract(e.value,'$.height')<1
      OR max(json_extract(e.value,'$.width'),json_extract(e.value,'$.height'))>CASE WHEN s.kind='thumbnail' THEN 320 ELSE 2048 END
  ) OR (SELECT COUNT(DISTINCT json_extract(value,'$.kind')) FROM json_each(NEW.result_json))<>2 THEN RAISE(ABORT,'INVALID_PROCESSING_RESULT') END;
END;

CREATE TRIGGER processing_job_apply AFTER UPDATE ON image_processing_jobs BEGIN
  UPDATE workspace_storage_usage SET reserved_bytes=reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes,
    used_bytes=used_bytes+CASE WHEN NEW.status='succeeded' THEN (SELECT SUM(json_extract(value,'$.bytes')) FROM json_each(NEW.result_json)) ELSE 0 END
    WHERE workspace_id=(SELECT workspace_id FROM photo_assets WHERE id=NEW.id);
  UPDATE storage_nodes SET reserved_bytes=reserved_bytes+NEW.reserved_bytes-OLD.reserved_bytes,
    used_bytes=used_bytes+CASE WHEN NEW.status='succeeded' THEN (SELECT SUM(json_extract(value,'$.bytes')) FROM json_each(NEW.result_json)) ELSE 0 END
    WHERE id=(SELECT storage_node_id FROM photo_assets WHERE id=NEW.id);
  INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state)
    SELECT s.asset_id,a.workspace_id,a.photo_id,a.version_id,a.storage_node_id,s.kind,s.object_key,json_extract(e.value,'$.bytes'),'image/jpeg',json_extract(e.value,'$.sha256'),'private'
    FROM json_each(NEW.result_json) e JOIN image_processing_outputs s ON s.job_id=NEW.id AND s.kind=json_extract(e.value,'$.kind') JOIN photo_assets a ON a.id=NEW.id WHERE NEW.status='succeeded';
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id)
    SELECT 'processing:'||NEW.id||':'||NEW.lease_epoch||':'||NEW.status,CASE WHEN NEW.status='abandoned' THEN 'user' ELSE 'system' END,
      CASE WHEN NEW.status='abandoned' THEN (SELECT actor_id FROM processing_review_commands WHERE job_id=NEW.id) END,
      CASE WHEN NEW.status='abandoned' THEN (SELECT session_id FROM processing_review_commands WHERE job_id=NEW.id) END,p.workspace_id,p.project_id,p.album_id,p.id,a.version_id,'processing.'||NEW.status,
      json_object('status',OLD.status,'reservedBytes',OLD.reserved_bytes,'leaseEpoch',OLD.lease_epoch),
      json_object('status',NEW.status,'reservedBytes',NEW.reserved_bytes,'leaseEpoch',NEW.lease_epoch,'reason',NEW.reason_code,'outputs',json(NEW.result_json)),NEW.transition_id
    FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE a.id=NEW.id;
END;

CREATE TRIGGER content_archive_processing_guard BEFORE INSERT ON request_commands
WHEN NEW.operation IN('project.archived','album.archived')
  AND NOT EXISTS(SELECT 1 FROM processing_review_commands r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM request_commands r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_workflow_requests r WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN photos p ON p.id=a.photo_id
    JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE w.owner_user_id=NEW.actor_id AND j.status IN('queued','running','retryable','needs_review')
      AND ((NEW.operation='project.archived' AND p.project_id=NEW.resource_id) OR (NEW.operation='album.archived' AND p.album_id=NEW.resource_id))
  ) THEN RAISE(ABORT,'PROCESSING_IN_PROGRESS') END;
END;

CREATE TRIGGER request_commands_processing_review_id_guard BEFORE INSERT ON request_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER invite_creation_command_guard BEFORE INSERT ON invite_creation_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id AND (project_id<>NEW.project_id OR payload_json<>NEW.payload_json OR request_commitment<>NEW.request_commitment))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invite_creation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=NEW.project_id AND w.owner_user_id=NEW.actor_id AND p.status<>'archived') THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN json_extract(NEW.payload_json,'$.projectId') IS NOT NEW.project_id
    OR json_type(NEW.payload_json,'$.albumIds') IS NOT 'array'
    OR json_array_length(NEW.payload_json,'$.albumIds') NOT BETWEEN 1 AND 24
    OR (SELECT count(DISTINCT value) FROM json_each(NEW.payload_json,'$.albumIds'))<>json_array_length(NEW.payload_json,'$.albumIds')
    OR EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.albumIds') e WHERE NOT EXISTS(SELECT 1 FROM albums a WHERE a.id=e.value AND a.project_id=NEW.project_id AND a.state='active'))
    THEN RAISE(ABORT,'INVALID_INVITE_SCOPE') END;
  SELECT CASE WHEN json_type(NEW.payload_json,'$.expiresAtMs') IS NOT 'integer'
    OR json_extract(NEW.payload_json,'$.expiresAtMs')<=unixepoch('subsec')*1000
    OR json_extract(NEW.payload_json,'$.expiresAtMs')>unixepoch('subsec')*1000+31536000000 THEN RAISE(ABORT,'INVALID_INVITE_EXPIRY') END;
  SELECT CASE WHEN (SELECT count(*) FROM guest_invites WHERE project_id=NEW.project_id)>=1000 THEN RAISE(ABORT,'INVITE_LIMIT_REACHED') END;
END;

CREATE TRIGGER request_command_guard BEFORE INSERT ON request_commands BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM invite_creation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM invite_revocation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests u WHERE u.actor_id=NEW.actor_id AND u.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END; SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id AND (c.operation<>NEW.operation OR c.payload_json<>NEW.payload_json)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END; SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END; SELECT CASE WHEN NEW.operation='workspace.created' AND (SELECT count(*) FROM workspaces WHERE owner_user_id=NEW.actor_id)>=100 THEN RAISE(ABORT,'WORKSPACE_LIMIT_REACHED') END; SELECT CASE WHEN NEW.operation='project.created' AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=json_extract(NEW.payload_json,'$.workspaceId') AND w.owner_user_id=NEW.actor_id) THEN RAISE(ABORT,'NOT_FOUND') END; SELECT CASE WHEN NEW.operation='album.created' AND NOT EXISTS(SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=json_extract(NEW.payload_json,'$.projectId') AND w.owner_user_id=NEW.actor_id AND p.status<>'archived') THEN RAISE(ABORT,'NOT_FOUND') END; SELECT CASE WHEN NEW.operation IN('project.renamed','project.archived','project.restored') AND NOT EXISTS(SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=NEW.resource_id AND w.owner_user_id=NEW.actor_id) THEN RAISE(ABORT,'NOT_FOUND') END; SELECT CASE WHEN NEW.operation IN('album.renamed','album.protection_changed','album.archived','album.restored') AND NOT EXISTS(SELECT 1 FROM albums a JOIN workspaces w ON w.id=a.workspace_id WHERE a.id=NEW.resource_id AND w.owner_user_id=NEW.actor_id) THEN RAISE(ABORT,'NOT_FOUND') END; SELECT CASE WHEN NEW.operation='project.renamed' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.resource_id AND revision=json_extract(NEW.payload_json,'$.expectedRevision') AND status<>'archived') THEN RAISE(ABORT,CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=NEW.resource_id AND status='archived') THEN 'RESOURCE_NOT_EDITABLE' ELSE 'CONCURRENT_MODIFICATION' END) END; SELECT CASE WHEN NEW.operation='album.renamed' AND NOT EXISTS(SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id WHERE a.id=NEW.resource_id AND a.revision=json_extract(NEW.payload_json,'$.expectedRevision') AND a.state NOT IN('archived','deleting','deleted') AND p.status<>'archived') THEN RAISE(ABORT,CASE WHEN EXISTS(SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id WHERE a.id=NEW.resource_id AND (a.state IN('archived','deleting','deleted') OR p.status='archived')) THEN 'RESOURCE_NOT_EDITABLE' ELSE 'CONCURRENT_MODIFICATION' END) END; SELECT CASE WHEN NEW.operation='album.protection_changed' AND NOT EXISTS(SELECT 1 FROM albums WHERE id=NEW.resource_id AND revision=json_extract(NEW.payload_json,'$.expectedRevision') AND state NOT IN('deleting','deleted')) THEN RAISE(ABORT,CASE WHEN EXISTS(SELECT 1 FROM albums WHERE id=NEW.resource_id AND state IN('deleting','deleted')) THEN 'RESOURCE_NOT_EDITABLE' ELSE 'CONCURRENT_MODIFICATION' END) END; SELECT CASE WHEN NEW.operation='album.protection_changed' AND EXISTS(SELECT 1 FROM albums a WHERE a.id=NEW.resource_id AND ((a.is_pinned=1 AND json_extract(NEW.payload_json,'$.isPinned')=0) OR (a.legal_hold=1 AND json_extract(NEW.payload_json,'$.legalHold')=0)) AND json_extract(NEW.payload_json,'$.confirmUnprotect')<>1) THEN RAISE(ABORT,'PROTECTION_CONFIRMATION_REQUIRED') END; SELECT CASE WHEN NEW.operation IN('project.archived','project.restored') AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.resource_id AND revision=json_extract(NEW.payload_json,'$.expectedRevision')) THEN RAISE(ABORT,'CONCURRENT_MODIFICATION') END; SELECT CASE WHEN NEW.operation='project.archived' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.resource_id AND status IN('draft','delivered') AND NOT EXISTS(SELECT 1 FROM albums WHERE project_id=projects.id) AND NOT EXISTS(SELECT 1 FROM photos p WHERE p.project_id=projects.id)) THEN RAISE(ABORT,CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=NEW.resource_id AND status NOT IN('draft','delivered')) THEN 'INVALID_STATE_TRANSITION' ELSE 'CONTENT_NOT_EMPTY_OR_IDLE' END) END; SELECT CASE WHEN NEW.operation='project.restored' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.resource_id AND status='archived' AND archived_from_status IS NOT NULL) THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END; SELECT CASE WHEN NEW.operation IN('album.archived','album.restored') AND NOT EXISTS(SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id WHERE a.id=NEW.resource_id AND a.revision=json_extract(NEW.payload_json,'$.expectedRevision') AND p.status<>'archived') THEN RAISE(ABORT,'CONCURRENT_MODIFICATION') END; SELECT CASE WHEN NEW.operation='album.archived' AND NOT EXISTS(SELECT 1 FROM albums WHERE id=NEW.resource_id AND state='draft') THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END; SELECT CASE WHEN NEW.operation='album.archived' AND (EXISTS(SELECT 1 FROM photos p WHERE p.album_id=NEW.resource_id) OR NOT EXISTS(SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id WHERE a.id=NEW.resource_id AND p.status IN('draft','delivered'))) THEN RAISE(ABORT,'CONTENT_NOT_EMPTY_OR_IDLE') END; SELECT CASE WHEN NEW.operation='album.restored' AND NOT EXISTS(SELECT 1 FROM albums WHERE id=NEW.resource_id AND state='archived' AND archived_from_state='draft') THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END; END;

CREATE TRIGGER processing_review_command_guard BEFORE INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM invite_creation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM invite_revocation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id AND (job_id<>NEW.job_id OR expected_epoch<>NEW.expected_epoch OR payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id AND a.asset_kind='original' AND a.state='private' AND a.storage_node_id='primary'
    JOIN photos p ON p.id=a.photo_id JOIN workspaces w ON w.id=p.workspace_id JOIN albums al ON al.id=p.album_id JOIN projects pr ON pr.id=p.project_id JOIN storage_nodes n ON n.id=a.storage_node_id AND n.status='active'
    WHERE j.id=NEW.job_id AND j.status='needs_review' AND j.reserved_bytes=16777216 AND j.lease_epoch=NEW.expected_epoch AND w.owner_user_id=NEW.actor_id
      AND p.id=json_extract(NEW.payload_json,'$.photoId') AND a.version_id=json_extract(NEW.payload_json,'$.versionId')
      AND json_extract(NEW.payload_json,'$.expectedLeaseEpoch')=NEW.expected_epoch AND json_extract(NEW.payload_json,'$.confirmAbandon')=1
      AND al.state NOT IN('archived','deleting','deleted') AND pr.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'PROCESSING_REVIEW_CONFLICT') END;
  SELECT CASE WHEN ABS(NEW.created_at_ms-unixepoch('subsec')*1000)>60000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN json_type(NEW.fences_json)<>'array' OR json_array_length(NEW.fences_json)<>2
    OR (SELECT count(DISTINCT json_extract(value,'$.kind')) FROM json_each(NEW.fences_json))<>2
    OR EXISTS(SELECT 1 FROM json_each(NEW.fences_json) e LEFT JOIN image_processing_outputs s ON s.job_id=NEW.job_id AND s.kind=json_extract(e.value,'$.kind') WHERE s.kind IS NULL OR json_extract(e.value,'$.state') IS NOT 'fenced')
    THEN RAISE(ABORT,'PROCESSING_FENCES_REQUIRED') END;
END;

CREATE TRIGGER invite_revocation_command_guard BEFORE INSERT ON invite_revocation_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM invite_creation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id AND (invite_id<>NEW.invite_id OR payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invite_revocation_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id WHERE i.id=NEW.invite_id AND w.owner_user_id=NEW.actor_id) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_invite_revocations WHERE invite_id=NEW.invite_id) THEN RAISE(ABORT,'INVITE_ALREADY_REVOKED') END;
END;

CREATE TRIGGER selection_policy_command_guard BEFORE INSERT ON selection_policy_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=NEW.actor_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND a.state IN('active','draft')
      AND p.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.album_id<>NEW.album_id OR c.expected_revision<>NEW.expected_revision
        OR c.minimum<>NEW.minimum OR c.maximum IS NOT NEW.maximum OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.expected_revision<>COALESCE(
    (SELECT revision FROM album_selection_policies p WHERE p.album_id=NEW.album_id),0
  ) THEN RAISE(ABORT,'SELECTION_POLICY_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.maximum IS NOT NULL AND EXISTS(
    SELECT 1 FROM guest_selection_round_state r
    WHERE r.album_id=NEW.album_id AND r.status='open'
      AND (SELECT count(*) FROM guest_selection_state s
        WHERE s.invite_id=r.invite_id AND s.guest_id=r.guest_id AND s.album_id=r.album_id)>NEW.maximum
  ) THEN RAISE(ABORT,'SELECTION_POLICY_BELOW_CURRENT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

CREATE TRIGGER processing_review_commands_selection_policy_namespace AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER processing_review_shared_review_namespace AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER shared_review_owner_command_guard BEFORE INSERT ON shared_review_owner_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000 AND w.id=NEW.workspace_id
      AND p.status NOT IN('archived','deleting','deleted') AND a.state='active'
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.session_id<>NEW.session_id OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.action<>NEW.action
        OR (c.action='reopen' AND c.review_id<>NEW.review_id) OR c.title IS NOT NEW.title
        OR c.invite_ids_json<>NEW.invite_ids_json OR c.expected_round_no IS NOT NEW.expected_round_no
        OR c.minimum<>NEW.minimum OR c.maximum IS NOT NEW.maximum OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NEW.action='create' AND EXISTS(
    SELECT 1 FROM json_each(NEW.invite_ids_json) m
    WHERE NOT EXISTS(
      SELECT 1 FROM guest_invites i JOIN guest_invite_seals seal ON seal.invite_id=i.id
      JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
        AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
      JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=NEW.actor_id
      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
        AND a.project_id=i.project_id AND a.state='active'
      WHERE i.id=m.value AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
        AND i.created_by=NEW.actor_id AND i.expires_at_ms>unixepoch('subsec')*1000
        AND (i.permissions_mask & 520)<>0
        AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
        AND p.status NOT IN('archived','deleting','deleted')
    )
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_MEMBERS') END;
  SELECT CASE WHEN NEW.action='create' AND (
      json_array_length(NEW.invite_ids_json) NOT BETWEEN 1 AND 24
      OR (SELECT count(DISTINCT value) FROM json_each(NEW.invite_ids_json))<>json_array_length(NEW.invite_ids_json))
    THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_MEMBERS') END;
  SELECT CASE WHEN NEW.action='create' AND EXISTS(SELECT 1 FROM shared_reviews r WHERE r.id=NEW.review_id)
    THEN RAISE(ABORT,'SHARED_REVIEW_ID_CONFLICT') END;
  SELECT CASE WHEN NEW.action='create' AND (SELECT count(*) FROM shared_reviews r WHERE r.album_id=NEW.album_id)>=20
    THEN RAISE(ABORT,'SHARED_REVIEW_LIMIT_REACHED') END;
  SELECT CASE WHEN NEW.action='reopen' AND NOT EXISTS(
      SELECT 1 FROM shared_reviews r WHERE r.id=NEW.review_id AND r.album_id=NEW.album_id
        AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.created_by=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.action='reopen' AND NOT EXISTS(
      SELECT 1 FROM shared_review_rounds r WHERE r.review_id=NEW.review_id
        AND r.round_no=NEW.expected_round_no AND r.status='submitted'
        AND r.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=NEW.review_id))
    AND EXISTS(SELECT 1 FROM shared_review_rounds r WHERE r.review_id=NEW.review_id
      AND r.round_no=NEW.expected_round_no AND r.status<>'submitted')
    THEN RAISE(ABORT,'ROUND_NOT_SUBMITTED') END;
  SELECT CASE WHEN NEW.action='reopen' AND NOT EXISTS(
      SELECT 1 FROM shared_review_rounds r WHERE r.review_id=NEW.review_id
        AND r.round_no=NEW.expected_round_no AND r.status='submitted'
        AND r.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=NEW.review_id))
    THEN RAISE(ABORT,'ROUND_CONFLICT') END;
END;

CREATE TRIGGER selection_reopened_shared_review_full_namespace BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened' BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER selection_policy_configuration_command_guard
BEFORE INSERT ON selection_policy_configuration_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.target_type='project' AND NOT EXISTS(
    SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.target_type='album' AND NOT EXISTS(
    SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      JOIN workspaces w ON w.id=a.workspace_id
    WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN (NEW.target_type='project' AND NOT EXISTS(
      SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
        AND p.status NOT IN('archived','deleting','deleted')
    )) OR (NEW.target_type='album' AND NOT EXISTS(
      SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
        AND a.project_id=NEW.project_id AND a.state IN('active','draft')
        AND p.status NOT IN('archived','deleting','deleted')
    )) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.target_type<>NEW.target_type OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id IS NOT NEW.album_id
        OR c.expected_project_revision<>NEW.expected_project_revision
        OR c.expected_album_revision IS NOT NEW.expected_album_revision
        OR c.configuration IS NOT NEW.configuration OR c.minimum IS NOT NEW.minimum
        OR c.maximum IS NOT NEW.maximum OR c.payload_json<>NEW.payload_json
        OR c.legacy_payload_json IS NOT NEW.legacy_payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.target_type='project' AND NEW.expected_project_revision<>COALESCE(
    (SELECT revision FROM project_selection_policy_configurations p WHERE p.project_id=NEW.project_id),0
  ) THEN RAISE(ABORT,'SELECTION_POLICY_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.target_type='album' AND (
    NEW.expected_album_revision<>COALESCE(
      (SELECT revision FROM album_selection_policy_configurations a WHERE a.album_id=NEW.album_id),0
    )
    OR NEW.expected_project_revision<>COALESCE(
      (SELECT revision FROM project_selection_policy_configurations p WHERE p.project_id=NEW.project_id),0
    )
  ) THEN RAISE(ABORT,'SELECTION_POLICY_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.target_type='project' AND NEW.maximum IS NOT NULL AND EXISTS(
    SELECT 1 FROM guest_selection_round_state r
    JOIN albums a ON a.id=r.album_id AND a.workspace_id=r.workspace_id AND a.project_id=r.project_id
    LEFT JOIN album_selection_policy_configurations ac ON ac.album_id=a.id
    WHERE r.project_id=NEW.project_id AND r.status='open'
      AND COALESCE(ac.configuration,'inherit')='inherit'
      AND (SELECT count(*) FROM guest_selection_state st
        WHERE st.invite_id=r.invite_id AND st.guest_id=r.guest_id AND st.album_id=r.album_id)>NEW.maximum
  ) THEN RAISE(ABORT,'SELECTION_POLICY_BELOW_CURRENT') END;
  SELECT CASE WHEN NEW.target_type='album' AND (
    CASE WHEN NEW.configuration='override' THEN NEW.maximum
      ELSE COALESCE((SELECT p.maximum FROM project_selection_policy_configurations p
        WHERE p.project_id=NEW.project_id),NULL) END
  ) IS NOT NULL AND EXISTS(
    SELECT 1 FROM guest_selection_round_state r
    WHERE r.album_id=NEW.album_id AND r.status='open'
      AND (SELECT count(*) FROM guest_selection_state st
        WHERE st.invite_id=r.invite_id AND st.guest_id=r.guest_id AND st.album_id=r.album_id)>
        CASE WHEN NEW.configuration='override' THEN NEW.maximum
          ELSE COALESCE((SELECT p.maximum FROM project_selection_policy_configurations p
            WHERE p.project_id=NEW.project_id),NULL) END
  ) THEN RAISE(ABORT,'SELECTION_POLICY_BELOW_CURRENT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

CREATE TRIGGER processing_review_policy_configuration_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
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

CREATE TRIGGER photo_version_head_command_guard
BEFORE INSERT ON photo_version_head_commands BEGIN
  -- Authorization is deliberately checked before scope, conflicts, or replay.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Bind the current request and both version witnesses to the same live photo
  -- before allowing a stored request to replay.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photos p
    JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN photo_versions expected
      ON expected.id=NEW.expected_current_version_id
      AND expected.workspace_id=p.workspace_id AND expected.photo_id=p.id
    JOIN photo_versions target
      ON target.id=NEW.version_id
      AND target.workspace_id=p.workspace_id AND target.photo_id=p.id
    JOIN photo_version_heads h
      ON h.photo_id=p.id AND h.workspace_id=p.workspace_id
      AND h.project_id=p.project_id AND h.album_id=p.album_id
    WHERE p.id=NEW.photo_id AND p.workspace_id=NEW.workspace_id
      AND p.project_id=NEW.project_id AND p.album_id=NEW.album_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photos p
    JOIN albums a ON a.id=p.album_id AND a.workspace_id=p.workspace_id
      AND a.project_id=p.project_id
    JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id
    WHERE p.id=NEW.photo_id
      AND (a.state IN('archived','deleting','deleted')
        OR pr.status IN('archived','deleting','deleted'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN NEW.id IS NULL OR EXISTS(
    SELECT 1 FROM photo_version_head_commands c WHERE c.id=NEW.id
  ) THEN RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND') END;

  -- Owner actor/request IDs are shared across all existing Owner ledgers.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e
      WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
        AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.photo_id<>NEW.photo_id
        OR c.expected_revision<>NEW.expected_revision
        OR c.expected_current_version_id<>NEW.expected_current_version_id
        OR c.version_id<>NEW.version_id OR c.confirm<>NEW.confirm
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Exact intent replays the original immutable result. Session validity and
  -- photo scope above still apply, but a newly authenticated session may retry.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_version_heads h
    WHERE h.photo_id=NEW.photo_id AND h.workspace_id=NEW.workspace_id
      AND h.project_id=NEW.project_id AND h.album_id=NEW.album_id
      AND h.revision=NEW.expected_revision
      AND h.version_id=NEW.expected_current_version_id
  ) THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_CONFLICT') END;

  SELECT CASE WHEN NEW.version_id<>NEW.expected_current_version_id
      AND NEW.expected_revision=9007199254740991
    THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_EXHAUSTED') END;

  -- A no-op does not switch versions and therefore does not need a derivative.
  -- A changed head may point only at a private source with the exact two
  -- successful, immutable JPEG derivative slots available to gallery routes.
  SELECT CASE WHEN NEW.version_id<>NEW.expected_current_version_id AND NOT EXISTS(
    SELECT 1 FROM photo_versions v
    JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
    JOIN photo_assets original
      ON original.version_id=v.id AND original.photo_id=p.id
      AND original.workspace_id=p.workspace_id AND original.asset_kind='original'
      AND original.state='private' AND original.byte_size=v.byte_size
      AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
    JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded'
    JOIN image_processing_outputs thumb_slot
      ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'
    JOIN photo_assets thumb
      ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key
      AND thumb.version_id=v.id AND thumb.photo_id=p.id
      AND thumb.workspace_id=p.workspace_id AND thumb.asset_kind='thumbnail'
      AND thumb.state='private' AND thumb.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=j.id AND preview_slot.kind='preview'
    JOIN photo_assets preview
      ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key
      AND preview.version_id=v.id AND preview.photo_id=p.id
      AND preview.workspace_id=p.workspace_id AND preview.asset_kind='preview'
      AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE v.id=NEW.version_id AND v.photo_id=NEW.photo_id
      AND v.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'PHOTO_VERSION_NOT_READY') END;
END;

CREATE TRIGGER photo_version_head_results_insert_guard
BEFORE INSERT ON photo_version_head_results BEGIN
  SELECT CASE WHEN NEW.command_id IS NULL OR EXISTS(
    SELECT 1 FROM photo_version_head_results r
    WHERE r.command_id=NEW.command_id
      OR (NEW.event_id IS NOT NULL AND r.event_id=NEW.event_id)
  ) THEN RAISE(ABORT,'IMMUTABLE_PHOTO_VERSION_HEAD_RESULT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photo_version_head_commands c
    JOIN photo_version_heads h ON h.photo_id=c.photo_id
      AND h.workspace_id=c.workspace_id AND h.project_id=c.project_id
      AND h.album_id=c.album_id
    WHERE c.id=NEW.command_id
      AND NEW.previous_command_id IS h.last_command_id
      AND c.expected_revision=h.revision
      AND c.expected_current_version_id=h.version_id
      AND NEW.before_json=json_object('versionId',h.version_id,'revision',h.revision)
      AND NEW.occurred_at_utc=strftime(
        '%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND (
        (
          c.version_id=h.version_id
          AND NEW.event_id IS NULL
          AND NEW.after_json=json_object('versionId',h.version_id,'revision',h.revision)
          AND NEW.result_json=json_object(
            'photoId',c.photo_id,
            'current',json_object('versionId',h.version_id,'revision',h.revision),
            'changed',json('false'),'eventId',NULL,
            'occurredAt',NEW.occurred_at_utc)
        )
        OR
        (
          c.version_id<>h.version_id
          AND NEW.event_id='photo-version-current:'||c.id
          AND NEW.after_json=json_object('versionId',c.version_id,'revision',h.revision+1)
          AND NEW.result_json=json_object(
            'photoId',c.photo_id,
            'current',json_object('versionId',c.version_id,'revision',h.revision+1),
            'changed',json('true'),'eventId','photo-version-current:'||c.id,
            'occurredAt',NEW.occurred_at_utc)
          AND EXISTS(
            SELECT 1 FROM photo_versions v
            JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id
            JOIN photo_assets original
              ON original.version_id=v.id AND original.photo_id=p.id
              AND original.workspace_id=p.workspace_id
              AND original.asset_kind='original' AND original.state='private'
              AND original.byte_size=v.byte_size AND original.mime=v.mime
              AND original.checksum_sha256=v.source_hash_sha256
            JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded'
            JOIN image_processing_outputs thumb_slot
              ON thumb_slot.job_id=j.id AND thumb_slot.kind='thumbnail'
            JOIN photo_assets thumb
              ON thumb.id=thumb_slot.asset_id AND thumb.object_key=thumb_slot.object_key
              AND thumb.version_id=v.id AND thumb.photo_id=p.id
              AND thumb.workspace_id=p.workspace_id
              AND thumb.asset_kind='thumbnail' AND thumb.state='private'
              AND thumb.mime='image/jpeg'
            JOIN image_processing_outputs preview_slot
              ON preview_slot.job_id=j.id AND preview_slot.kind='preview'
            JOIN photo_assets preview
              ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key
              AND preview.version_id=v.id AND preview.photo_id=p.id
              AND preview.workspace_id=p.workspace_id
              AND preview.asset_kind='preview' AND preview.state='private'
              AND preview.mime='image/jpeg'
            WHERE v.id=c.version_id AND v.photo_id=c.photo_id
              AND v.workspace_id=c.workspace_id
          )
        )
      )
  ) THEN RAISE(ABORT,'INVALID_PHOTO_VERSION_HEAD_RESULT') END;
END;

CREATE TRIGGER processing_review_commands_photo_version_head_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM photo_version_head_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER upload_workflow_request_guard
BEFORE INSERT ON upload_workflow_requests BEGIN
  SELECT CASE WHEN NEW.actor_id IS NULL OR NEW.request_id IS NULL
    OR NEW.session_id IS NULL OR NEW.upload_session_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      WHERE o.user_id=NEW.actor_id AND o.enabled=1
        AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)
    THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id)
    AND NOT EXISTS(
      SELECT 1 FROM upload_version_targets t
      JOIN upload_sessions u ON u.id=t.upload_session_id
      JOIN photos ph ON ph.id=t.photo_id AND ph.workspace_id=t.workspace_id
        AND ph.project_id=t.project_id AND ph.album_id=t.album_id
      JOIN workspaces w ON w.id=ph.workspace_id
      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
      JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
        AND a.workspace_id=ph.workspace_id
      JOIN photo_versions parent ON parent.id=t.parent_version_id
        AND parent.workspace_id=t.workspace_id AND parent.photo_id=t.photo_id
      WHERE t.upload_session_id=NEW.upload_session_id
        AND t.actor_id=NEW.actor_id AND u.actor_id=NEW.actor_id
        AND w.owner_user_id=NEW.actor_id
        AND a.state NOT IN('archived','deleting','deleted')
        AND p.status NOT IN('archived','deleting','deleted')
        AND (NEW.operation='upload.authorized'
          OR (NEW.operation='upload.completed' AND NEW.photo_id=t.photo_id))
    ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
      AND (r.operation<>NEW.operation OR r.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_workflow_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
    THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM upload_sessions u
    JOIN workspaces w ON w.id=u.workspace_id
    WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id
      AND u.status='reserved' AND w.owner_user_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_completions c
      WHERE c.upload_session_id=NEW.upload_session_id)
    OR EXISTS(SELECT 1 FROM upload_version_completions c
      WHERE c.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_review_flags f
      WHERE f.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'UPLOAD_NEEDS_REVIEW') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;

  SELECT CASE WHEN NEW.operation='upload.authorized' AND (
    NEW.signed_at_ms IS NULL OR NEW.expires_at_ms IS NULL
    OR NEW.content_type IS NULL OR NEW.sha256_hex IS NULL
    OR NEW.actual_bytes IS NOT NULL OR NEW.photo_id IS NOT NULL
    OR NEW.version_id IS NOT NULL OR NEW.asset_id IS NOT NULL)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.authorized'
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u
      JOIN upload_specs p ON p.upload_session_id=u.id
      WHERE u.id=NEW.upload_session_id AND u.expires_at_ms>NEW.created_at_ms
        AND p.content_type=NEW.content_type AND p.sha256_hex=NEW.sha256_hex
        AND NEW.signed_at_ms=NEW.created_at_ms
        AND NEW.expires_at_ms>NEW.signed_at_ms
        AND NEW.expires_at_ms<=u.expires_at_ms
        AND NEW.expires_at_ms<=NEW.signed_at_ms+600000)
    THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.authorized'
    AND EXISTS(SELECT 1 FROM upload_authorizations a
      WHERE a.upload_session_id=NEW.upload_session_id)
    THEN RAISE(ABORT,'UPLOAD_ALREADY_AUTHORIZED') END;

  SELECT CASE WHEN NEW.operation='upload.completed' AND (
    NEW.signed_at_ms IS NOT NULL OR NEW.expires_at_ms IS NOT NULL
    OR NEW.content_type IS NULL OR NEW.sha256_hex IS NULL
    OR NEW.actual_bytes IS NULL OR NEW.photo_id IS NULL
    OR NEW.version_id IS NULL OR NEW.asset_id IS NULL)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.completed'
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u
      JOIN upload_specs p ON p.upload_session_id=u.id
      JOIN upload_authorizations auth ON auth.upload_session_id=u.id
      JOIN workspace_storage_usage ws ON ws.workspace_id=u.workspace_id
      JOIN storage_nodes n ON n.id=u.storage_node_id
      WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id
        AND p.content_type=NEW.content_type AND p.sha256_hex=NEW.sha256_hex
        AND u.expected_bytes=NEW.actual_bytes
        AND ws.reserved_bytes>=u.reserved_bytes
        AND n.reserved_bytes>=u.reserved_bytes
        AND n.status IN('active','readonly')
        AND NOT EXISTS(SELECT 1 FROM upload_key_fences f
          WHERE f.upload_session_id=u.id))
    THEN RAISE(ABORT,'UPLOAD_VERIFICATION_MISMATCH') END;
  SELECT CASE WHEN NEW.operation='upload.completed'
    AND EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id)
    AND NOT EXISTS(SELECT 1 FROM upload_version_targets t
      JOIN upload_sessions u ON u.id=t.upload_session_id
      WHERE t.upload_session_id=NEW.upload_session_id
        AND t.actor_id=NEW.actor_id AND t.photo_id=NEW.photo_id
        AND t.workspace_id=u.workspace_id AND t.project_id=u.project_id
        AND t.album_id=u.album_id)
    THEN RAISE(ABORT,'UPLOAD_VERSION_TARGET_MISMATCH') END;
  SELECT CASE WHEN NEW.operation='upload.completed'
    AND EXISTS(SELECT 1 FROM upload_version_targets t
      WHERE t.upload_session_id=NEW.upload_session_id)
    AND (SELECT COALESCE(MAX(v.version_no),0) FROM photo_versions v
      JOIN upload_version_targets t ON t.photo_id=v.photo_id
      WHERE t.upload_session_id=NEW.upload_session_id)>=9007199254740991
    THEN RAISE(ABORT,'PHOTO_VERSION_NUMBER_EXHAUSTED') END;
END;

CREATE TRIGGER content_archive_upload_guard
BEFORE INSERT ON request_commands
WHEN NEW.operation IN('project.archived','album.archived')
  AND NOT EXISTS(SELECT 1 FROM processing_review_commands r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM request_commands r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
  AND NOT EXISTS(SELECT 1 FROM upload_workflow_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM upload_sessions u
    JOIN workspaces w ON w.id=u.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE w.owner_user_id=NEW.actor_id AND u.status='reserved'
      AND NOT EXISTS(SELECT 1 FROM upload_completions c
        WHERE c.upload_session_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM upload_version_completions c
        WHERE c.upload_session_id=u.id)
      AND ((NEW.operation='project.archived' AND u.project_id=NEW.resource_id)
        OR (NEW.operation='album.archived' AND u.album_id=NEW.resource_id))
  ) THEN RAISE(ABORT,'UPLOADS_IN_PROGRESS') END;
END;

CREATE TRIGGER processing_review_commands_project_versioning_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
END;

CREATE TRIGGER owner_external_intents_insert_guard
BEFORE INSERT ON owner_external_intents BEGIN
  SELECT CASE WHEN NEW.actor_id IS NULL OR NEW.request_id IS NULL
    OR NEW.operation IS NULL OR NEW.session_id IS NULL
    OR NEW.workspace_id IS NULL OR NEW.project_id IS NULL OR NEW.album_id IS NULL
    OR NEW.storage_node_id IS NULL OR NEW.payload_json IS NULL
    OR NEW.created_at_ms IS NULL
    OR (NEW.operation='upload.cancelled' AND (NEW.upload_session_id IS NULL
      OR NEW.original_object_key IS NULL OR NEW.job_id IS NOT NULL
      OR NEW.photo_id IS NOT NULL OR NEW.version_id IS NOT NULL
      OR NEW.expected_epoch IS NOT NULL OR NEW.thumbnail_key IS NOT NULL
      OR NEW.preview_key IS NOT NULL))
    OR (NEW.operation='processing.abandoned' AND (NEW.job_id IS NULL
      OR NEW.photo_id IS NULL OR NEW.version_id IS NULL
      OR NEW.expected_epoch IS NULL OR NEW.storage_node_id IS NULL
      OR NEW.thumbnail_key IS NULL OR NEW.preview_key IS NULL
      OR NEW.upload_session_id IS NOT NULL OR NEW.original_object_key IS NOT NULL))
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND COALESCE(CASE WHEN json_valid(NEW.payload_json)
      THEN NEW.payload_json=json_object('uploadSessionId',NEW.upload_session_id)
      ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='processing.abandoned'
    AND COALESCE(CASE WHEN json_valid(NEW.payload_json)
      THEN NEW.payload_json=json_object('photoId',NEW.photo_id,
        'versionId',NEW.version_id,'expectedLeaseEpoch',NEW.expected_epoch,
        'confirmAbandon',json('true'))
      ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  -- Current owner/scope/node/target identity is checked on every replay. These
  -- clauses deliberately omit mutable upload/job status and lease epoch.
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND NOT EXISTS(
    SELECT 1 FROM upload_sessions u
    JOIN workspaces w ON w.id=u.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN projects p ON p.id=u.project_id AND p.workspace_id=u.workspace_id
    JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id
      AND a.workspace_id=u.workspace_id
    JOIN storage_nodes n ON n.id=u.storage_node_id AND n.status='active'
    WHERE u.id=NEW.upload_session_id AND u.actor_id=NEW.actor_id
      AND u.workspace_id=NEW.workspace_id AND u.project_id=NEW.project_id
      AND u.album_id=NEW.album_id AND u.storage_node_id=NEW.storage_node_id
      AND u.object_key=NEW.original_object_key
      AND u.object_key=u.workspace_id||'/'||u.project_id||'/'||u.album_id||'/'||u.id||'/original'
      AND a.state NOT IN('archived','deleting','deleted')
      AND p.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='processing.abandoned' AND NOT EXISTS(
    SELECT 1 FROM image_processing_jobs j
    JOIN photo_assets src ON src.id=j.id AND src.asset_kind='original'
      AND src.state='private'
    JOIN photo_versions v ON v.id=src.version_id
      AND v.workspace_id=src.workspace_id AND v.photo_id=src.photo_id
    JOIN photos ph ON ph.id=src.photo_id
      AND ph.workspace_id=src.workspace_id
    JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
    JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
      AND a.workspace_id=ph.workspace_id
    JOIN storage_nodes n ON n.id=src.storage_node_id AND n.status='active'
    JOIN image_processing_outputs t ON t.job_id=j.id AND t.kind='thumbnail'
    JOIN image_processing_outputs pr ON pr.job_id=j.id AND pr.kind='preview'
    WHERE j.id=NEW.job_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
      AND ph.album_id=NEW.album_id AND src.storage_node_id=NEW.storage_node_id
      AND t.object_key=NEW.thumbnail_key AND pr.object_key=NEW.preview_key
      AND a.state NOT IN('archived','deleting','deleted')
      AND p.status NOT IN('archived','deleting','deleted')
      AND (SELECT count(*) FROM image_processing_outputs x WHERE x.job_id=j.id)=2
  ) THEN RAISE(ABORT,'PROCESSING_SOURCE_UNAVAILABLE') END;

  -- Exact retries of this claim do not depend on the original session, timestamp,
  -- mutable status, or processing epoch. Altered intent reusing the actor ID conflicts.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.upload_session_id IS NOT NEW.upload_session_id
        OR c.job_id IS NOT NEW.job_id OR c.photo_id IS NOT NEW.photo_id
        OR c.version_id IS NOT NEW.version_id
        OR c.expected_epoch IS NOT NEW.expected_epoch
        OR c.storage_node_id<>NEW.storage_node_id
        OR c.original_object_key IS NOT NEW.original_object_key
        OR c.thumbnail_key IS NOT NEW.thumbnail_key
        OR c.preview_key IS NOT NEW.preview_key
        OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    THEN RAISE(IGNORE) END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND e.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id
      AND NOT (NEW.operation='upload.cancelled' AND f.reason='cancel'
        AND f.upload_session_id=NEW.upload_session_id
        AND f.object_key=NEW.original_object_key))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND EXISTS(
    SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND (u.expires_at_ms<=NEW.created_at_ms
        OR u.expires_at_ms<=unixepoch('subsec')*1000)
  ) THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND NOT EXISTS(
    SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status='reserved'
  ) THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND (
      EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=NEW.upload_session_id)
      OR EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=NEW.upload_session_id)
    ) THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND EXISTS(
    SELECT 1 FROM upload_review_flags f WHERE f.upload_session_id=NEW.upload_session_id
  ) THEN RAISE(ABORT,'UPLOAD_NEEDS_REVIEW') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND EXISTS(
    SELECT 1 FROM upload_key_fences f
    WHERE f.upload_session_id=NEW.upload_session_id
      AND f.object_key<>NEW.original_object_key
  ) THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;  SELECT CASE WHEN NEW.operation='processing.abandoned' AND (
      EXISTS(SELECT 1 FROM image_processing_jobs j
        WHERE j.id=NEW.job_id AND (j.status<>'needs_review'
          OR j.lease_epoch<>NEW.expected_epoch OR j.reserved_bytes<>16777216))
      OR NOT EXISTS(SELECT 1 FROM image_processing_jobs j
        WHERE j.id=NEW.job_id AND j.status='needs_review'
          AND j.lease_epoch=NEW.expected_epoch AND j.reserved_bytes=16777216)
    ) THEN RAISE(ABORT,'PROCESSING_REVIEW_CONFLICT') END;
END;

CREATE TRIGGER owner_external_intents_audit
AFTER INSERT ON owner_external_intents BEGIN
  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    photo_id,version_id,action,before_json,after_json,request_id
  ) VALUES(
    'owner-external-intent:'||NEW.actor_id||':'||NEW.request_id,
    'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    NEW.photo_id,NEW.version_id,'owner.external_intent_claimed',NULL,
    CASE WHEN NEW.operation='upload.cancelled'
      THEN json_object('operation',NEW.operation,'uploadSessionId',NEW.upload_session_id)
      ELSE json_object('operation',NEW.operation,'jobId',NEW.job_id,
        'expectedEpoch',NEW.expected_epoch) END,
    NEW.request_id
  );
END;

CREATE TRIGGER owner_external_intents_no_update
BEFORE UPDATE ON owner_external_intents BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_EXTERNAL_INTENT');
END;

CREATE TRIGGER owner_external_intents_no_delete
BEFORE DELETE ON owner_external_intents BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_OWNER_EXTERNAL_INTENT');
END;

CREATE TRIGGER owner_external_intents_workspace_commands_namespace
AFTER INSERT ON workspace_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_request_commands_namespace
AFTER INSERT ON request_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_upload_requests_namespace
AFTER INSERT ON upload_requests BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
        AND NOT (NEW.operation='upload.cancelled' AND c.operation='upload.cancelled'
          AND c.upload_session_id=NEW.upload_session_id AND c.payload_json=NEW.payload_json
          AND EXISTS(SELECT 1 FROM upload_sessions u
            WHERE u.id=NEW.upload_session_id AND c.workspace_id=u.workspace_id
              AND c.project_id=u.project_id AND c.album_id=u.album_id
              AND c.storage_node_id=u.storage_node_id
              AND c.original_object_key=u.object_key)))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id
        AND f.request_id=NEW.request_id
        AND NOT (NEW.operation='upload.cancelled' AND f.reason='cancel'
          AND f.upload_session_id=NEW.upload_session_id
          AND f.object_key=(SELECT u.object_key FROM upload_sessions u
            WHERE u.id=NEW.upload_session_id)))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled' AND NOT EXISTS(
    SELECT 1 FROM owner_external_intents c
    JOIN upload_sessions u ON u.id=NEW.upload_session_id
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.operation='upload.cancelled' AND c.payload_json=NEW.payload_json
      AND c.upload_session_id=NEW.upload_session_id
      AND c.workspace_id=u.workspace_id AND c.project_id=u.project_id
      AND c.album_id=u.album_id AND c.storage_node_id=u.storage_node_id
      AND c.original_object_key=u.object_key
  ) THEN RAISE(ABORT,'OWNER_EXTERNAL_INTENT_REQUIRED') END;
END;

CREATE TRIGGER owner_external_intents_upload_workflow_namespace
AFTER INSERT ON upload_workflow_requests
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_processing_review_namespace
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_external_intents c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
        AND NOT EXISTS(
          SELECT 1 FROM image_processing_jobs j
          JOIN photo_assets src ON src.id=j.id AND src.asset_kind='original'
          JOIN photos ph ON ph.id=src.photo_id
          JOIN image_processing_outputs t ON t.job_id=j.id AND t.kind='thumbnail'
          JOIN image_processing_outputs pr ON pr.job_id=j.id AND pr.kind='preview'
          WHERE c.operation='processing.abandoned' AND c.job_id=NEW.job_id
            AND c.expected_epoch=NEW.expected_epoch AND c.payload_json=NEW.payload_json
            AND c.photo_id=ph.id AND c.version_id=src.version_id
            AND c.workspace_id=ph.workspace_id AND c.project_id=ph.project_id
            AND c.album_id=ph.album_id AND c.storage_node_id=src.storage_node_id
            AND c.thumbnail_key=t.object_key AND c.preview_key=pr.object_key
        )) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id
        AND f.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owner_external_intents c
    JOIN image_processing_jobs j ON j.id=NEW.job_id
    JOIN photo_assets src ON src.id=j.id AND src.asset_kind='original'
    JOIN photos ph ON ph.id=src.photo_id
    JOIN image_processing_outputs t ON t.job_id=j.id AND t.kind='thumbnail'
    JOIN image_processing_outputs pr ON pr.job_id=j.id AND pr.kind='preview'
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND c.operation='processing.abandoned' AND c.job_id=NEW.job_id
      AND c.expected_epoch=NEW.expected_epoch AND c.payload_json=NEW.payload_json
      AND c.photo_id=ph.id AND c.version_id=src.version_id
      AND c.workspace_id=ph.workspace_id AND c.project_id=ph.project_id
      AND c.album_id=ph.album_id AND c.storage_node_id=src.storage_node_id
      AND c.thumbnail_key=t.object_key AND c.preview_key=pr.object_key
  ) THEN RAISE(ABORT,'OWNER_EXTERNAL_INTENT_REQUIRED') END;
END;

CREATE TRIGGER owner_external_intents_invite_revocation_namespace
AFTER INSERT ON invite_revocation_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_invite_creation_namespace
AFTER INSERT ON invite_creation_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_selection_policy_namespace
AFTER INSERT ON selection_policy_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_selection_policy_configuration_namespace
AFTER INSERT ON selection_policy_configuration_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_shared_review_owner_namespace
AFTER INSERT ON shared_review_owner_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_photo_version_head_namespace
AFTER INSERT ON photo_version_head_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_project_versioning_namespace
AFTER INSERT ON project_versioning_commands
WHEN EXISTS(SELECT 1 FROM owner_external_intents c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
    AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_selection_reopened_namespace
BEFORE INSERT ON audit_events
WHEN NEW.actor_type='user' AND NEW.action='selection.reopened'
  AND (EXISTS(SELECT 1 FROM owner_external_intents c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND f.request_id=NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_upload_fence_guard
BEFORE INSERT ON upload_key_fences BEGIN
  SELECT CASE WHEN NEW.upload_session_id IS NULL OR NEW.object_key IS NULL
    OR NEW.reason IS NULL OR NEW.actor_type IS NULL OR NEW.request_id IS NULL
    OR NEW.occurred_at_ms IS NULL
    OR (NEW.actor_type='user' AND (NEW.actor_id IS NULL OR NEW.session_id IS NULL))
    OR (NEW.actor_type='system' AND (NEW.actor_id IS NOT NULL OR NEW.session_id IS NOT NULL))
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.actor_type='user' AND NEW.reason<>'cancel'
    THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
  SELECT CASE WHEN NEW.actor_type='user' AND NEW.reason='cancel'
    AND NOT EXISTS(
      SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      JOIN owner_external_intents c ON c.actor_id=o.user_id
      JOIN upload_sessions u ON u.id=c.upload_session_id
      JOIN workspaces w ON w.id=u.workspace_id AND w.owner_user_id=NEW.actor_id
      JOIN projects p ON p.id=u.project_id AND p.workspace_id=u.workspace_id
      JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id
        AND a.workspace_id=u.workspace_id
      JOIN storage_nodes n ON n.id=u.storage_node_id AND n.status='active'
      WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id
        AND s.expiresAt>unixepoch('subsec')*1000
        AND c.request_id=NEW.request_id AND c.operation='upload.cancelled'
        AND c.upload_session_id=NEW.upload_session_id
        AND c.workspace_id=u.workspace_id AND c.project_id=u.project_id
        AND c.album_id=u.album_id AND c.storage_node_id=u.storage_node_id
        AND c.original_object_key=u.object_key AND NEW.object_key=u.object_key
        AND a.state NOT IN('archived','deleting','deleted')
        AND p.status NOT IN('archived','deleting','deleted')
    ) THEN RAISE(ABORT,'OWNER_EXTERNAL_INTENT_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.upload_session_id=NEW.upload_session_id
        AND f.object_key<>NEW.object_key)
    OR EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.object_key=NEW.object_key AND f.upload_session_id<>NEW.upload_session_id)
    THEN RAISE(ABORT,'IMMUTABLE_UPLOAD_KEY_FENCE') END;
  -- Preserve the original physical fence certificate even when another valid
  -- receipt adopts its immutable object key.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_key_fences f
      WHERE f.upload_session_id=NEW.upload_session_id AND f.object_key=NEW.object_key)
    THEN RAISE(IGNORE) END;
END;

CREATE TRIGGER owner_external_intents_processing_certificate_guard
AFTER INSERT ON processing_review_commands BEGIN
  SELECT CASE WHEN COALESCE(CASE WHEN json_valid(NEW.fences_json) THEN
    json_type(NEW.fences_json)='array' AND json_array_length(NEW.fences_json)=2
    AND (SELECT count(DISTINCT json_extract(e.value,'$.kind'))
      FROM json_each(NEW.fences_json) e WHERE e.type='object')=2
    AND NOT EXISTS(SELECT 1 FROM json_each(NEW.fences_json) e
      WHERE CASE WHEN e.type='object' THEN
        json_type(e.value,'$.kind') IS NOT 'text'
        OR json_extract(e.value,'$.kind') NOT IN('thumbnail','preview')
        OR json_type(e.value,'$.key') IS NOT 'text'
        OR json_extract(e.value,'$.state') IS NOT 'fenced'
        OR json_extract(e.value,'$.key') IS NOT (
          SELECT CASE json_extract(e.value,'$.kind')
            WHEN 'thumbnail' THEN c.thumbnail_key ELSE c.preview_key END
          FROM owner_external_intents c
          WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
            AND c.operation='processing.abandoned' AND c.job_id=NEW.job_id
            AND c.expected_epoch=NEW.expected_epoch)
        OR (SELECT count(*) FROM json_each(e.value))<>3
        OR (SELECT count(DISTINCT k.key) FROM json_each(e.value) k)<>3
        OR EXISTS(SELECT 1 FROM json_each(e.value) k
          WHERE k.key NOT IN('kind','key','state'))
      ELSE 1 END)
    ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'PROCESSING_FENCES_REQUIRED') END;
END;

CREATE TRIGGER project_versioning_command_guard
BEFORE INSERT ON project_versioning_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id
      AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN NEW.id IS NULL OR NEW.request_id IS NULL
      OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_PROJECT_VERSIONING_COMMAND') END;

  -- Owner actor/request IDs share one namespace across all Owner command ledgers.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e
      WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
        AND e.action='selection.reopened' AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Ignore captured before-state/session fields for canonical intent comparison:
  -- a retry may arrive in a later live Owner session and after newer mode changes.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.operation<>NEW.operation
        OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id
        OR c.expected_revision<>NEW.expected_revision
        OR c.mode<>NEW.mode OR c.confirm<>NEW.confirm
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Current Owner/session and project scope above still apply to exact retries.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_versioning_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN COALESCE(
      CASE WHEN json_valid(NEW.payload_json) THEN
        json_type(NEW.payload_json)='object'
        AND json_type(NEW.payload_json,'$.projectId')='text'
        AND json_extract(NEW.payload_json,'$.projectId')=NEW.project_id
        AND json_type(NEW.payload_json,'$.expectedRevision')='integer'
        AND json_extract(NEW.payload_json,'$.expectedRevision')=NEW.expected_revision
        AND json_type(NEW.payload_json,'$.mode')='text'
        AND json_extract(NEW.payload_json,'$.mode')=NEW.mode
        AND json_type(NEW.payload_json,'$.confirm')='true'
        AND json_extract(NEW.payload_json,'$.confirm')=1
        AND NEW.payload_json=json_object(
          'projectId',NEW.project_id,
          'expectedRevision',NEW.expected_revision,
          'mode',NEW.mode,
          'confirm',json('true'))
      ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;


  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
      AND p.revision=NEW.expected_revision
      AND p.versioning_mode=NEW.before_mode
      AND p.versioning_command_id IS NEW.previous_command_id
  ) THEN RAISE(ABORT,'PROJECT_VERSIONING_REVISION_CONFLICT') END;

  SELECT CASE WHEN NEW.mode<>NEW.before_mode
      AND NEW.expected_revision=2147483647
    THEN RAISE(ABORT,'PROJECT_VERSIONING_REVISION_EXHAUSTED') END;
END;

CREATE TRIGGER upload_request_guard BEFORE INSERT ON upload_requests BEGIN
  SELECT CASE WHEN NEW.actor_id IS NULL OR NEW.request_id IS NULL
    OR NEW.session_id IS NULL OR NEW.upload_session_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      WHERE o.user_id=NEW.actor_id AND o.enabled=1
        AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)
    THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Only V2 reservations require the existing photo to be live before replay.
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_valid(NEW.payload_json)
    AND json_type(NEW.payload_json,'$.versionTarget')='object'
    AND NOT EXISTS(
      SELECT 1 FROM photos ph
      JOIN photo_versions parent
        ON parent.id=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId')
        AND parent.workspace_id=ph.workspace_id AND parent.photo_id=ph.id
      JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
      JOIN projects p ON p.id=ph.project_id AND p.workspace_id=ph.workspace_id
      JOIN albums a ON a.id=ph.album_id AND a.project_id=ph.project_id
        AND a.workspace_id=ph.workspace_id
      WHERE ph.id=json_extract(NEW.payload_json,'$.versionTarget.photoId')
        AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
        AND ph.album_id=NEW.album_id
        AND a.state NOT IN('archived','deleting','deleted')
        AND p.status NOT IN('archived','deleting','deleted'))
    THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c
      WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND e.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id
      AND (r.operation<>NEW.operation OR r.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
    THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  SELECT CASE WHEN NEW.operation='upload.reserved' AND (
    NEW.workspace_id IS NULL OR NEW.project_id IS NULL OR NEW.album_id IS NULL
    OR NEW.storage_node_id<>'primary'
    OR NEW.object_key<>NEW.workspace_id||'/'||NEW.project_id||'/'||NEW.album_id||'/'||NEW.upload_session_id||'/original'
    OR NEW.original_filename IS NULL OR length(NEW.original_filename) NOT BETWEEN 1 AND 255
    OR NEW.expected_bytes IS NULL OR NEW.expected_bytes<=0
    OR NEW.expected_bytes>5363466240
    OR NOT json_valid(NEW.payload_json) OR json_type(NEW.payload_json)<>'object')
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved' AND (
    json_type(NEW.payload_json,'$.workspaceId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.workspaceId')<>NEW.workspace_id
    OR json_type(NEW.payload_json,'$.projectId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.projectId')<>NEW.project_id
    OR json_type(NEW.payload_json,'$.albumId') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.albumId')<>NEW.album_id
    OR json_type(NEW.payload_json,'$.originalFilename') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.originalFilename')<>NEW.original_filename
    OR json_type(NEW.payload_json,'$.expectedBytes') IS NOT 'integer'
    OR json_extract(NEW.payload_json,'$.expectedBytes')<>NEW.expected_bytes
    OR json_type(NEW.payload_json,'$.contentType') IS NOT 'text'
    OR json_extract(NEW.payload_json,'$.contentType') NOT IN('image/jpeg','image/png','image/webp')
    OR json_type(NEW.payload_json,'$.sha256') IS NOT 'text'
    OR length(json_extract(NEW.payload_json,'$.sha256'))<>64
    OR json_extract(NEW.payload_json,'$.sha256') GLOB '*[^0-9a-f]*')
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NULL
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>7+CASE WHEN json_type(NEW.payload_json,'$.resolution') IS NOT NULL THEN 1 ELSE 0 END
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND (SELECT count(*) FROM json_each(NEW.payload_json))<>8+CASE WHEN json_type(NEW.payload_json,'$.resolution') IS NOT NULL THEN 1 ELSE 0 END
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND (
      json_type(NEW.payload_json,'$.versionTarget')<>'object'
      OR (SELECT count(*) FROM json_each(NEW.payload_json,'$.versionTarget'))<>7
      OR json_type(NEW.payload_json,'$.versionTarget.photoId') IS NOT 'text'
      OR json_type(NEW.payload_json,'$.versionTarget.parentVersionId') IS NOT 'text'
      OR json_type(NEW.payload_json,'$.versionTarget.expectedRevision') IS NOT 'integer'
      OR json_extract(NEW.payload_json,'$.versionTarget.expectedRevision') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(NEW.payload_json,'$.versionTarget.confirm') IS NOT 'true'
      OR json_extract(NEW.payload_json,'$.versionTarget.confirm')<>1
      OR json_type(NEW.payload_json,'$.versionTarget.changeType') IS NOT 'text'
      OR json_extract(NEW.payload_json,'$.versionTarget.changeType') NOT IN('new_retouch','replace_current')
      OR json_type(NEW.payload_json,'$.versionTarget.changeNote') IS NOT 'text'
      OR length(json_extract(NEW.payload_json,'$.versionTarget.changeNote'))>2000
      OR json_type(NEW.payload_json,'$.versionTarget.labels') IS NOT 'array'
      OR json_array_length(NEW.payload_json,'$.versionTarget.labels')>16
      OR EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.versionTarget.labels') l
        WHERE l.type<>'text' OR length(l.value) NOT BETWEEN 1 AND 40 OR l.value<>trim(l.value))
      OR (SELECT count(*) FROM json_each(NEW.payload_json,'$.versionTarget.labels'))
        <>(SELECT count(DISTINCT value COLLATE BINARY)
          FROM json_each(NEW.payload_json,'$.versionTarget.labels')))
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  -- New reservation CAS; an exact retry returned above keeps its original parent.
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM photos ph
      JOIN photo_version_heads h ON h.photo_id=ph.id
        AND h.workspace_id=ph.workspace_id AND h.project_id=ph.project_id
        AND h.album_id=ph.album_id
      WHERE ph.id=json_extract(NEW.payload_json,'$.versionTarget.photoId')
        AND ph.workspace_id=NEW.workspace_id AND ph.project_id=NEW.project_id
        AND ph.album_id=NEW.album_id
        AND h.revision=json_extract(NEW.payload_json,'$.versionTarget.expectedRevision')
        AND h.version_id=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId'))
    THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NOT NULL
    AND json_extract(NEW.payload_json,'$.versionTarget.changeType')='new_retouch'
    AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id
      AND p.workspace_id=NEW.workspace_id
      AND p.versioning_mode IN('manual','auto_filename','assisted'))
    THEN RAISE(ABORT,'VERSIONING_MODE_DISABLED') END;

  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND json_type(NEW.payload_json,'$.versionTarget') IS NULL
    AND NOT EXISTS(
      SELECT 1 FROM albums a JOIN projects p
        ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      JOIN workspaces w ON w.id=p.workspace_id
      JOIN storage_nodes n ON n.id=NEW.storage_node_id AND n.status='active'
      WHERE a.id=NEW.album_id AND a.project_id=NEW.project_id
        AND a.workspace_id=NEW.workspace_id
        AND p.status IN('draft','uploading') AND a.state IN('draft','active')
        AND w.owner_user_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND EXISTS(SELECT 1 FROM workspace_storage_usage u
      JOIN workspaces w ON w.id=u.workspace_id
      WHERE u.workspace_id=NEW.workspace_id
        AND u.used_bytes+u.reserved_bytes+NEW.expected_bytes>w.quota_bytes)
    THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND NOT EXISTS(SELECT 1 FROM workspace_storage_usage u
      WHERE u.workspace_id=NEW.workspace_id)
    THEN RAISE(ABORT,'STORAGE_LEDGER_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.operation='upload.reserved'
    AND NOT EXISTS(SELECT 1 FROM storage_nodes n WHERE n.id=NEW.storage_node_id
      AND n.status='active'
      AND n.used_bytes+n.reserved_bytes+NEW.expected_bytes<=n.quota_bytes)
    THEN RAISE(ABORT,'STORAGE_QUOTA_EXCEEDED') END;

  SELECT CASE WHEN NEW.operation='upload.cancelled' AND (
    NEW.workspace_id IS NOT NULL OR NEW.project_id IS NOT NULL OR NEW.album_id IS NOT NULL
    OR NEW.storage_node_id IS NOT NULL OR NEW.object_key IS NOT NULL
    OR NEW.original_filename IS NOT NULL OR NEW.expected_bytes IS NOT NULL)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND NOT EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id)
    THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status<>'reserved')
    THEN RAISE(ABORT,'INVALID_STATE_TRANSITION') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_sessions u WHERE u.id=NEW.upload_session_id
      AND u.actor_id=NEW.actor_id AND u.status='reserved'
      AND u.expires_at_ms<=NEW.created_at_ms)
    THEN RAISE(ABORT,'UPLOAD_SESSION_EXPIRED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND (EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=NEW.upload_session_id)
      OR EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=NEW.upload_session_id))
    THEN RAISE(ABORT,'UPLOAD_ALREADY_COMPLETED') END;
  SELECT CASE WHEN NEW.operation='upload.cancelled'
    AND EXISTS(SELECT 1 FROM upload_authorizations a WHERE a.upload_session_id=NEW.upload_session_id)
    AND NOT EXISTS(SELECT 1 FROM upload_key_fences f JOIN upload_sessions u
      ON u.id=f.upload_session_id WHERE f.upload_session_id=NEW.upload_session_id
      AND f.object_key=u.object_key)
    THEN RAISE(ABORT,'UPLOAD_KEY_NOT_FENCED') END;
END;

CREATE TRIGGER guest_comment_command_guard BEFORE INSERT ON guest_comment_commands BEGIN
  -- One live statement scope with independent can_comment and exact published-ready targets.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id
      AND s.secret_hash=NEW.secret_hash AND g.id=NEW.expected_guest_id
      AND NEW.expected_guest_id=NEW.guest_id AND i.workspace_id=NEW.workspace_id
      AND i.project_id=NEW.project_id AND a.id=NEW.album_id
      AND (i.permissions_mask & 256)=256
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
      AND (
        (NEW.operation='create'
          AND json_array_length(NEW.targets_json) BETWEEN 1 AND 24
          AND json_array_length(NEW.request_json,'$.targets')=json_array_length(NEW.targets_json)
          AND json_type(NEW.request_json,'$.body')='text'
          AND (SELECT count(DISTINCT json_extract(value,'$.photoId'))
               FROM json_each(NEW.targets_json))=json_array_length(NEW.targets_json)
          AND NOT EXISTS(
            SELECT 1 FROM json_each(NEW.targets_json) item
            WHERE json_type(item.value,'$.commentId') IS NOT 'text'
              OR length(json_extract(item.value,'$.commentId'))<>36
              OR json_type(item.value,'$.photoId') IS NOT 'text'
              OR json_type(item.value,'$.versionId') IS NOT 'text'
              OR item.value<>json_object(
                'commentId',json_extract(item.value,'$.commentId'),
                'photoId',json_extract(item.value,'$.photoId'),
                'versionId',json_extract(item.value,'$.versionId'))
              OR json_extract(NEW.request_json,'$.targets['||CAST(item.key AS TEXT)||'].photoId')
                <>json_extract(item.value,'$.photoId')
              OR json_extract(NEW.request_json,'$.targets['||CAST(item.key AS TEXT)||'].versionId')
                <>json_extract(item.value,'$.versionId')
              OR NOT EXISTS(
                SELECT 1 FROM guest_comment_eligible_versions ev
                WHERE ev.photo_id=json_extract(item.value,'$.photoId')
                  AND ev.version_id=json_extract(item.value,'$.versionId')
                  AND ev.workspace_id=NEW.workspace_id AND ev.project_id=NEW.project_id
                  AND ev.album_id=NEW.album_id)
          )
        )
        OR (NEW.operation IN('edit','delete','resolve','reopen')
          AND EXISTS(
            SELECT 1 FROM guest_comments c
            JOIN guest_comment_eligible_versions ev ON ev.version_id=c.version_id
              AND ev.photo_id=c.photo_id AND ev.workspace_id=c.workspace_id
              AND ev.project_id=c.project_id AND ev.album_id=c.album_id
            WHERE c.id=json_extract(NEW.request_json,'$.commentId')
              AND c.invite_id=NEW.invite_id AND c.album_id=NEW.album_id
              AND c.author_guest_id=NEW.guest_id)
        )
      )
      AND (
        (NEW.operation='create' AND NEW.request_json=json_object(
          'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,'operation','create',
          'targets',json((
            SELECT json_group_array(json(target_json)) FROM (
              SELECT json_object('photoId',json_extract(value,'$.photoId'),
                'versionId',json_extract(value,'$.versionId')) AS target_json
              FROM json_each(NEW.request_json,'$.targets') ORDER BY CAST(key AS INTEGER)
            )
          )),
          'body',json_extract(NEW.request_json,'$.body')))
        OR (NEW.operation='edit'
          AND json_type(NEW.request_json,'$.body')='text'
          AND json_type(NEW.request_json,'$.commentId')='text'
          AND json_type(NEW.request_json,'$.expectedRevision')='integer'
          AND NEW.request_json=json_object(
            'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,
            'commentId',json_extract(NEW.request_json,'$.commentId'),
            'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision'),
            'operation','edit','body',json_extract(NEW.request_json,'$.body')))
        OR (NEW.operation IN('delete','resolve','reopen')
          AND json_type(NEW.request_json,'$.commentId')='text'
          AND json_type(NEW.request_json,'$.expectedRevision')='integer'
          AND NEW.request_json=json_object(
            'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,
            'commentId',json_extract(NEW.request_json,'$.commentId'),
            'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision'),
            'operation',NEW.operation))
      )
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;

  SELECT CASE WHEN NEW.operation IN('create','edit') AND (
    length(json_extract(NEW.request_json,'$.body'))<1
    OR length(json_extract(NEW.request_json,'$.body'))>2000
    OR json_extract(NEW.request_json,'$.body')<>trim(json_extract(NEW.request_json,'$.body'))
    OR instr(json_extract(NEW.request_json,'$.body'),char(0))>0
    OR instr(json_extract(NEW.request_json,'$.body'),char(13))>0
    OR EXISTS(
      WITH RECURSIVE codepoints(body,pos,cp) AS (
        SELECT json_extract(NEW.request_json,'$.body'),1,
          unicode(substr(json_extract(NEW.request_json,'$.body'),1,1))
        UNION ALL
        SELECT body,pos+1,unicode(substr(body,pos+1,1))
        FROM codepoints WHERE pos<length(body)
      )
      SELECT 1 FROM codepoints
      WHERE cp IS NULL OR (cp BETWEEN 1 AND 8) OR cp IN(11,12)
        OR (cp BETWEEN 14 AND 31) OR (cp BETWEEN 127 AND 159)
        OR cp IN(173,1564,6158,8203,8204,8205,8206,8207,8234,8235,8236,8237,
          8238,8288,8289,8290,8291,8292,8294,8295,8296,8297,65279,65529,65530,65531)
        OR (cp BETWEEN 1536 AND 1541) OR cp=1757 OR cp=69821 OR cp=69837
        OR cp=1807 OR (cp BETWEEN 2192 AND 2193) OR cp=2274
        OR (cp BETWEEN 78896 AND 78911) OR (cp BETWEEN 113824 AND 113827)
        OR (cp BETWEEN 119155 AND 119162)
        OR cp=917505 OR (cp BETWEEN 917536 AND 917631)
    )
  ) THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  -- Cross-ledger namespace: Guest request UUIDs are guest-scoped, except exchange
  -- which is invitation-scoped. ACL above is deliberately first.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c
      WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_guest_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_tag_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.operation<>NEW.operation
        OR c.request_json<>NEW.request_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_comment_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_comment_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_COMMENT_COMMAND') END;

  SELECT CASE WHEN NEW.operation='create' AND EXISTS(
    SELECT 1 FROM json_each(NEW.targets_json) item
    WHERE (SELECT count(*) FROM guest_comments c
      WHERE c.invite_id=NEW.invite_id AND c.album_id=NEW.album_id
        AND c.photo_id=json_extract(item.value,'$.photoId')
        AND c.version_id=json_extract(item.value,'$.versionId'))>=1000
  ) THEN RAISE(ABORT,'COMMENT_LIMIT_REACHED') END;

  SELECT CASE WHEN NEW.operation IN('edit','delete','resolve','reopen')
    AND NOT EXISTS(
      SELECT 1 FROM guest_comments c
      WHERE c.id=json_extract(NEW.request_json,'$.commentId')
        AND c.invite_id=NEW.invite_id AND c.album_id=NEW.album_id
        AND c.author_guest_id=NEW.guest_id
        AND c.revision=json_extract(NEW.request_json,'$.expectedRevision')
        AND c.revision<9007199254740991 AND c.state<>'deleted'
        AND ((NEW.operation='resolve' AND c.state='open')
          OR (NEW.operation='reopen' AND c.state='resolved')
          OR NEW.operation IN('edit','delete'))
    ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_comment_commands_insert_guard
BEFORE INSERT ON owner_comment_commands BEGIN
 SELECT CASE WHEN NEW.id IS NULL OR length(NEW.id)<>36 OR NEW.id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.id GLOB '*[^0-9A-Fa-f-]*' OR length(replace(NEW.id,'-',''))<>32
  OR NEW.request_id IS NULL OR length(NEW.request_id)<>36 OR NEW.request_id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.request_id GLOB '*[^0-9A-Fa-f-]*' OR length(replace(NEW.request_id,'-',''))<>32
  OR NEW.request_id<>lower(NEW.request_id)
  OR NEW.operation NOT IN('reply','edit_reply','delete_reply') OR NEW.request_json IS NULL
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
  WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
 ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM workspaces w JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id AND ev.album_id=a.id
   AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
 ) THEN RAISE(ABORT,'NOT_FOUND') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM workspaces w JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id AND ev.album_id=a.id
   AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
   AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
 ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
 -- Invitation expiry/revocation do not invalidate historical Owner threads.
 SELECT CASE WHEN NEW.operation='reply' AND NOT (
  EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.parent_comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id AND g.album_id=NEW.album_id
   AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id)

 ) THEN RAISE(ABORT,'NOT_FOUND') END;
 SELECT CASE WHEN NEW.operation IN('edit_reply','delete_reply') AND NOT EXISTS(
  SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id AND r.author_user_id=NEW.actor_id
   AND r.invite_id=NEW.invite_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
   AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
   AND r.parent_comment_id=NEW.parent_comment_id
 ) THEN RAISE(ABORT,'NOT_FOUND') END;

 -- Fresh valid sessions can recover exact actor/request claims; original session/result is retained.
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
   OR c.album_id<>NEW.album_id OR c.invite_id<>NEW.invite_id OR c.photo_id<>NEW.photo_id
   OR c.version_id<>NEW.version_id OR c.parent_comment_id<>NEW.parent_comment_id
   OR c.request_json<>NEW.request_json OR (NEW.operation<>'reply' AND c.reply_id<>NEW.reply_id))
 ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
 ) THEN RAISE(IGNORE) END;

 SELECT CASE WHEN COALESCE(CASE WHEN json_valid(NEW.request_json)
  THEN json_type(NEW.request_json)='object' ELSE 0 END,0)<>1
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NOT (
  (NEW.operation='reply' AND json_type(NEW.request_json,'$.requestId')='text'
   AND json_type(NEW.request_json,'$.operation')='text' AND json_extract(NEW.request_json,'$.requestId')=NEW.request_id
   AND json_extract(NEW.request_json,'$.operation')='reply' AND json_type(NEW.request_json,'$.inviteId')='text'
   AND json_extract(NEW.request_json,'$.inviteId')=NEW.invite_id AND json_type(NEW.request_json,'$.photoId')='text'
   AND json_extract(NEW.request_json,'$.photoId')=NEW.photo_id AND json_type(NEW.request_json,'$.versionId')='text'
   AND json_extract(NEW.request_json,'$.versionId')=NEW.version_id AND json_type(NEW.request_json,'$.parentCommentId')='text'
   AND json_extract(NEW.request_json,'$.parentCommentId')=NEW.parent_comment_id
   AND json_type(NEW.request_json,'$.expectedParentRevision')='integer'
   AND json_extract(NEW.request_json,'$.expectedParentRevision') BETWEEN 1 AND 9007199254740991
   AND json_type(NEW.request_json,'$.body')='text'
   AND NEW.request_json=json_object('requestId',NEW.request_id,'operation','reply','inviteId',NEW.invite_id,
    'photoId',NEW.photo_id,'versionId',NEW.version_id,'parentCommentId',NEW.parent_comment_id,
    'expectedParentRevision',json_extract(NEW.request_json,'$.expectedParentRevision'),'body',json_extract(NEW.request_json,'$.body')))
  OR (NEW.operation='edit_reply' AND json_type(NEW.request_json,'$.requestId')='text'
   AND json_type(NEW.request_json,'$.operation')='text' AND json_extract(NEW.request_json,'$.requestId')=NEW.request_id
   AND json_extract(NEW.request_json,'$.operation')='edit_reply' AND json_type(NEW.request_json,'$.replyId')='text'
   AND json_extract(NEW.request_json,'$.replyId')=NEW.reply_id AND json_type(NEW.request_json,'$.expectedRevision')='integer'
   AND json_extract(NEW.request_json,'$.expectedRevision') BETWEEN 1 AND 9007199254740991
   AND json_type(NEW.request_json,'$.body')='text'
   AND NEW.request_json=json_object('requestId',NEW.request_id,'operation','edit_reply','replyId',NEW.reply_id,
    'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision'),'body',json_extract(NEW.request_json,'$.body')))
  OR (NEW.operation='delete_reply' AND json_type(NEW.request_json,'$.requestId')='text'
   AND json_type(NEW.request_json,'$.operation')='text' AND json_extract(NEW.request_json,'$.requestId')=NEW.request_id
   AND json_extract(NEW.request_json,'$.operation')='delete_reply' AND json_type(NEW.request_json,'$.replyId')='text'
   AND json_extract(NEW.request_json,'$.replyId')=NEW.reply_id AND json_type(NEW.request_json,'$.expectedRevision')='integer'
   AND json_extract(NEW.request_json,'$.expectedRevision') BETWEEN 1 AND 9007199254740991
   AND NEW.request_json=json_object('requestId',NEW.request_id,'operation','delete_reply','replyId',NEW.reply_id,
    'expectedRevision',json_extract(NEW.request_json,'$.expectedRevision')))
 ) THEN RAISE(ABORT,'INVALID_INPUT') END;

 SELECT CASE WHEN NEW.operation IN('reply','edit_reply') AND (
  length(json_extract(NEW.request_json,'$.body'))<1 OR length(json_extract(NEW.request_json,'$.body'))>2000
  OR json_extract(NEW.request_json,'$.body')<>trim(json_extract(NEW.request_json,'$.body'))
  OR instr(json_extract(NEW.request_json,'$.body'),char(0))>0 OR instr(json_extract(NEW.request_json,'$.body'),char(13))>0
  OR EXISTS(WITH RECURSIVE codepoints(body,pos,cp) AS (
   SELECT json_extract(NEW.request_json,'$.body'),1,unicode(substr(json_extract(NEW.request_json,'$.body'),1,1))
   UNION ALL SELECT body,pos+1,unicode(substr(body,pos+1,1)) FROM codepoints WHERE pos<length(body)
  ) SELECT 1 FROM codepoints WHERE cp IS NULL OR cp BETWEEN 1 AND 8 OR cp IN(11,12)
   OR cp BETWEEN 14 AND 31 OR cp BETWEEN 127 AND 159
   OR cp IN(173,1564,6158,8203,8204,8205,8206,8207,8234,8235,8236,8237,8238,8288,8289,8290,8291,8292,8294,8295,8296,8297,65279,65529,65530,65531)
   OR cp BETWEEN 1536 AND 1541 OR cp IN(1757,69821,69837,1807,2274,917505)
   OR cp BETWEEN 2192 AND 2193 OR cp BETWEEN 78896 AND 78911 OR cp BETWEEN 113824 AND 113827
   OR cp BETWEEN 119155 AND 119162 OR cp BETWEEN 917536 AND 917631)
 ) THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
   OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
   THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

 SELECT CASE WHEN
  EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
   AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
   AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.id=NEW.id)
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_COMMAND') END;
 SELECT CASE WHEN NEW.operation='reply' AND (
  EXISTS(SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id)
  OR EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.reply_id)
 ) THEN RAISE(ABORT,'COMMENT_ID_COLLISION') END;
 SELECT CASE WHEN NEW.operation='reply' AND
  (SELECT count(*) FROM owner_comment_replies r WHERE r.invite_id=NEW.invite_id
   AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id)>=1000
  THEN RAISE(ABORT,'COMMENT_LIMIT_REACHED') END;
 SELECT CASE WHEN NEW.operation='reply' AND NOT (
  EXISTS(SELECT 1 FROM guest_comments g WHERE g.id=NEW.parent_comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id AND g.album_id=NEW.album_id
   AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id AND g.state<>'deleted'
   AND g.revision=json_extract(NEW.request_json,'$.expectedParentRevision'))

 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
 SELECT CASE WHEN NEW.operation IN('edit_reply','delete_reply') AND EXISTS(
  SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id AND r.author_user_id=NEW.actor_id
   AND r.invite_id=NEW.invite_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
   AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
   AND r.parent_comment_id=NEW.parent_comment_id AND r.state='open'
   AND r.revision=json_extract(NEW.request_json,'$.expectedRevision')
   AND r.revision>=9007199254740991
 ) THEN RAISE(ABORT,'COMMENT_REVISION_EXHAUSTED') END; SELECT CASE WHEN NEW.operation IN('edit_reply','delete_reply') AND NOT EXISTS(
  SELECT 1 FROM owner_comment_replies r WHERE r.id=NEW.reply_id AND r.author_user_id=NEW.actor_id
   AND r.invite_id=NEW.invite_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
   AND r.album_id=NEW.album_id AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
   AND r.parent_comment_id=NEW.parent_comment_id AND r.state='open' AND r.body IS NOT NULL
   AND r.revision=json_extract(NEW.request_json,'$.expectedRevision') AND r.revision<9007199254740991
   AND NEW.created_at_ms>=r.updated_at_ms
 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_comment_ns_05 AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_comment_external_intent_ns AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_comment_processing_commands_insert_guard
BEFORE INSERT ON owner_comment_processing_commands BEGIN
 SELECT CASE WHEN NEW.id IS NULL OR length(NEW.id)<>36
  OR NEW.id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.id GLOB '*[^0-9A-Fa-f-]*' OR length(replace(NEW.id,'-',''))<>32
  OR NEW.request_id IS NULL OR length(NEW.request_id)<>36
  OR NEW.request_id NOT GLOB '????????-????-????-????-????????????'
  OR NEW.request_id GLOB '*[^0-9a-f-]*' OR length(replace(NEW.request_id,'-',''))<>32
  OR NEW.request_id<>lower(NEW.request_id)
  OR NEW.operation<>'set_processing_state'
  OR NEW.target_state NOT IN('open','in_progress','resolved')
  OR NEW.request_json IS NULL OR NOT json_valid(NEW.request_json)
  OR json_type(NEW.request_json)<>'object' OR length(NEW.request_json)>20000
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN json_type(NEW.request_json,'$.requestId')<>'text'
  OR json_extract(NEW.request_json,'$.requestId')<>NEW.request_id
  OR json_type(NEW.request_json,'$.operation')<>'text'
  OR json_extract(NEW.request_json,'$.operation')<>'set_processing_state'
  OR json_type(NEW.request_json,'$.inviteId')<>'text'
  OR json_extract(NEW.request_json,'$.inviteId')<>NEW.invite_id
  OR json_type(NEW.request_json,'$.photoId')<>'text'
  OR json_extract(NEW.request_json,'$.photoId')<>NEW.photo_id
  OR json_type(NEW.request_json,'$.versionId')<>'text'
  OR json_extract(NEW.request_json,'$.versionId')<>NEW.version_id
  OR json_type(NEW.request_json,'$.commentId')<>'text'
  OR json_extract(NEW.request_json,'$.commentId')<>NEW.comment_id
  OR json_type(NEW.request_json,'$.expectedCommentRevision')<>'integer'
  OR json_extract(NEW.request_json,'$.expectedCommentRevision')<>NEW.expected_comment_revision
  OR json_type(NEW.request_json,'$.expectedProcessingRevision')<>'integer'
  OR json_extract(NEW.request_json,'$.expectedProcessingRevision')<>NEW.expected_processing_revision
  OR json_type(NEW.request_json,'$.state')<>'text'
  OR json_extract(NEW.request_json,'$.state')<>NEW.target_state
  OR NEW.request_json<>json_object(
   'requestId',NEW.request_id,'operation','set_processing_state','inviteId',NEW.invite_id,
   'photoId',NEW.photo_id,'versionId',NEW.version_id,'commentId',NEW.comment_id,
   'expectedCommentRevision',NEW.expected_comment_revision,
   'expectedProcessingRevision',NEW.expected_processing_revision,'state',NEW.target_state)
  THEN RAISE(ABORT,'INVALID_INPUT') END;
 SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
  OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
  THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
  WHERE o.user_id=NEW.actor_id AND o.enabled=1
   AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
 ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 -- Check live Owner ownership, the exact sealed invitation/grant and eligible version
 -- before replay. Invitation expiry/revocation deliberately do not block Owner history.
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM workspaces w
  JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id
   AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
   AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id
   AND ev.album_id=a.id AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  JOIN guest_comments g ON g.id=NEW.comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
   AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
 ) THEN RAISE(ABORT,'NOT_FOUND') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM workspaces w
  JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
  JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
  JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id
   AND i.project_id=p.id AND i.created_by=NEW.actor_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
   AND ia.project_id=p.id AND ia.album_id=a.id
  JOIN guest_comment_eligible_versions ev ON ev.workspace_id=w.id AND ev.project_id=p.id
   AND ev.album_id=a.id AND ev.photo_id=NEW.photo_id AND ev.version_id=NEW.version_id
  WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
   AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
 ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

 -- Exact canonical replay uses the newly authenticated session but preserves the old
 -- command/session/receipt. It precedes parent tombstone and mutable revision checks.
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM owner_comment_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
   AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
    OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.invite_id<>NEW.invite_id
    OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id OR c.comment_id<>NEW.comment_id
    OR c.target_state<>NEW.target_state
    OR c.expected_comment_revision<>NEW.expected_comment_revision
    OR c.expected_processing_revision<>NEW.expected_processing_revision
    OR c.request_json<>NEW.request_json)
 ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM owner_comment_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
 ) THEN RAISE(IGNORE) END;

 -- Symmetric actor/request namespace with every existing Owner ledger and witness.
 SELECT CASE WHEN
  EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
   AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
  OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
   AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
  THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.id=NEW.id)
  THEN RAISE(ABORT,'IMMUTABLE_OWNER_COMMENT_PROCESSING_COMMAND') END;
 -- Guest tombstones block a new command, but the exact replay above remains recoverable.
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM guest_comments g WHERE g.id=NEW.comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
   AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
   AND g.state<>'deleted'
 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM guest_comments g WHERE g.id=NEW.comment_id AND g.invite_id=NEW.invite_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
   AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
   AND g.state<>'deleted' AND g.revision=NEW.expected_comment_revision
 ) THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
 SELECT CASE WHEN COALESCE((
  SELECT s.revision FROM owner_comment_processing_state s WHERE s.comment_id=NEW.comment_id
 ),0)<>NEW.expected_processing_revision
  THEN RAISE(ABORT,'COMMENT_PROCESSING_REVISION_CONFLICT') END;
 SELECT CASE WHEN NEW.expected_processing_revision>=9007199254740991
  THEN RAISE(ABORT,'COMMENT_PROCESSING_REVISION_EXHAUSTED') END;
 SELECT CASE WHEN NEW.content_revision<>COALESCE((
  SELECT MAX(ch.revision) FROM guest_comment_changes ch
  WHERE ch.comment_id=NEW.comment_id AND ch.operation IN('create','edit')
 ),0) OR NEW.content_revision<1 OR NEW.content_revision>NEW.expected_comment_revision
  THEN RAISE(ABORT,'COMMENT_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_comment_processing_ns_05 AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_comment_processing_ns_external_intents AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_comment_processing_commands c
 WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER guest_annotation_command_guard BEFORE INSERT ON guest_annotation_commands BEGIN
  -- Current session, sealed grant, enabled Owner, active scope, independent annotation right,
  -- and exact immutable published-ready version are checked before every replay lookup.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id
      AND s.secret_hash=NEW.secret_hash AND g.id=NEW.expected_guest_id
      AND NEW.expected_guest_id=NEW.guest_id AND i.workspace_id=NEW.workspace_id
      AND i.project_id=NEW.project_id AND a.id=NEW.album_id
      AND (i.permissions_mask & 128)=128
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
      AND (
        (NEW.operation='create' AND EXISTS(
          SELECT 1 FROM guest_annotation_eligible_versions ev
          WHERE ev.version_id=NEW.version_id AND ev.photo_id=NEW.photo_id
            AND ev.workspace_id=NEW.workspace_id AND ev.project_id=NEW.project_id
            AND ev.album_id=NEW.album_id))
        OR (NEW.operation<>'create' AND EXISTS(
          SELECT 1 FROM guest_annotations current
          JOIN guest_annotation_eligible_versions ev ON ev.version_id=current.version_id
            AND ev.photo_id=current.photo_id AND ev.workspace_id=current.workspace_id
            AND ev.project_id=current.project_id AND ev.album_id=current.album_id
          WHERE current.id=NEW.annotation_id AND current.author_guest_id=NEW.guest_id
            AND current.invite_id=NEW.invite_id AND current.workspace_id=NEW.workspace_id
            AND current.project_id=NEW.project_id AND current.album_id=NEW.album_id
            AND current.photo_id=NEW.photo_id AND current.version_id=NEW.version_id)
        )
      )
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;

  -- Existing ledgers remain authoritative for their guest/request namespace, including
  -- historical uppercase UUID aliases. Authorization above intentionally precedes this check.
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c
      WHERE c.invite_id=NEW.invite_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_guest_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_tag_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_comment_commands c
      WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- Exact same-session/canonical replay returns the original immutable receipt before
  -- mutable revision, tombstone, or lifetime-cap checks. A different session conflicts.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id
        OR c.annotation_id<>NEW.annotation_id OR c.operation<>NEW.operation
        OR c.expected_revision IS NOT NEW.expected_revision
        OR c.geometry_json IS NOT NEW.geometry_json OR c.style_json IS NOT NEW.style_json
        OR c.linked_comment_id IS NOT NEW.linked_comment_id OR c.request_json<>NEW.request_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_annotation_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_annotation_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_ANNOTATION_COMMAND') END;

  -- Canonical request key order and exact normalized geometry/style schemas are immutable.
  SELECT CASE WHEN NOT (
    (NEW.operation IN('create','update')
      AND (
        (json_type(NEW.geometry_json)='object'
          AND json_type(NEW.geometry_json,'$.type')='text'
          AND json_type(NEW.geometry_json,'$.coordinateSpace')='text'
          AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
          AND json_type(NEW.geometry_json,'$.x')='integer'
          AND json_type(NEW.geometry_json,'$.y')='integer'
          AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
          AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
          AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
          AND json_extract(NEW.geometry_json,'$.type')='point'
          AND NEW.geometry_json=json_object('type','point','coordinateSpace','normalized_1e6',
            'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y')))
        OR (json_type(NEW.geometry_json)='object'
          AND json_type(NEW.geometry_json,'$.type')='text'
          AND json_type(NEW.geometry_json,'$.coordinateSpace')='text'
          AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
          AND json_type(NEW.geometry_json,'$.x')='integer'
          AND json_type(NEW.geometry_json,'$.y')='integer'
          AND json_type(NEW.geometry_json,'$.width')='integer'
          AND json_type(NEW.geometry_json,'$.height')='integer'
          AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
          AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
          AND json_extract(NEW.geometry_json,'$.width') BETWEEN 1 AND 1000000
          AND json_extract(NEW.geometry_json,'$.height') BETWEEN 1 AND 1000000
          AND json_extract(NEW.geometry_json,'$.x')+json_extract(NEW.geometry_json,'$.width')<=1000000
          AND json_extract(NEW.geometry_json,'$.y')+json_extract(NEW.geometry_json,'$.height')<=1000000
          AND (SELECT count(*) FROM json_each(NEW.geometry_json))=6
          AND json_extract(NEW.geometry_json,'$.type')='rectangle'
          AND NEW.geometry_json=json_object('type','rectangle','coordinateSpace','normalized_1e6',
            'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y'),
            'width',json_extract(NEW.geometry_json,'$.width'),'height',json_extract(NEW.geometry_json,'$.height')))
      )
      AND json_type(NEW.style_json)='object'
      AND (SELECT count(*) FROM json_each(NEW.style_json))=1
      AND json_type(NEW.style_json,'$.color')='text'
      AND json_extract(NEW.style_json,'$.color') IN('amber','red','blue')
      AND NEW.style_json=json_object('color',json_extract(NEW.style_json,'$.color'))
      AND NEW.linked_comment_id IS json_extract(NEW.request_json,'$.commentId')
      AND (
        (NEW.operation='create' AND NEW.request_json=json_object(
          'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,'operation','create',
          'photoId',NEW.photo_id,'versionId',NEW.version_id,'geometry',json(NEW.geometry_json),
          'style',json(NEW.style_json),'commentId',NEW.linked_comment_id))
        OR (NEW.operation='update' AND NEW.request_json=json_object(
          'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,'operation','update',
          'annotationId',NEW.annotation_id,'expectedRevision',NEW.expected_revision,
          'geometry',json(NEW.geometry_json),'style',json(NEW.style_json),
          'commentId',NEW.linked_comment_id))
      )
    )
    OR (NEW.operation IN('delete','resolve','reopen')
      AND NEW.geometry_json IS NULL AND NEW.style_json IS NULL AND NEW.linked_comment_id IS NULL AND NEW.request_json=json_object(
        'requestId',NEW.request_id,'expectedGuestId',NEW.expected_guest_id,
        'operation',NEW.operation,'annotationId',NEW.annotation_id,
        'expectedRevision',NEW.expected_revision))
  ) THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  -- Linking a Guest comment is optional and independent: only a new nonnull create/update link
  -- requires can_comment and a nondeleted comment by this same Guest in this exact version/scope.
  SELECT CASE WHEN NEW.operation IN('create','update') AND NEW.linked_comment_id IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM guest_invites i
      WHERE i.id=NEW.invite_id AND (i.permissions_mask & 256)=256
        AND EXISTS(SELECT 1 FROM guest_comments c
          WHERE c.id=NEW.linked_comment_id AND c.author_guest_id=NEW.guest_id
            AND c.invite_id=NEW.invite_id AND c.workspace_id=NEW.workspace_id
            AND c.project_id=NEW.project_id AND c.album_id=NEW.album_id
            AND c.photo_id=NEW.photo_id AND c.version_id=NEW.version_id
            AND c.state<>'deleted')
    ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;

  SELECT CASE WHEN NEW.operation='create' AND (SELECT count(*) FROM guest_annotations a WHERE a.invite_id=NEW.invite_id AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id)>=1000 THEN RAISE(ABORT,'ANNOTATION_LIMIT_REACHED') END;

  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen') AND EXISTS(
    SELECT 1 FROM guest_annotations a
    WHERE a.id=NEW.annotation_id AND a.invite_id=NEW.invite_id
      AND a.author_guest_id=NEW.guest_id AND a.revision=NEW.expected_revision
      AND a.revision>=9007199254740991 AND (
        (NEW.operation='update' AND a.state='open')
        OR (NEW.operation='delete' AND a.state IN('open','resolved')) OR (NEW.operation='resolve' AND a.state='open') OR (NEW.operation='reopen' AND a.state='resolved'))
  ) THEN RAISE(ABORT,'ANNOTATION_REVISION_EXHAUSTED') END;

  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen') AND NOT EXISTS(
    SELECT 1 FROM guest_annotations a
    WHERE a.id=NEW.annotation_id AND a.invite_id=NEW.invite_id
      AND a.author_guest_id=NEW.guest_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND a.album_id=NEW.album_id
      AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id
      AND a.revision=NEW.expected_revision AND a.revision<9007199254740991
      AND ((NEW.operation='update' AND a.state='open')
        OR (NEW.operation='delete' AND a.state IN('open','resolved')) OR (NEW.operation='resolve' AND a.state='open') OR (NEW.operation='reopen' AND a.state='resolved'))
  ) THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_annotation_command_insert_guard
BEFORE INSERT ON owner_annotation_commands BEGIN
  SELECT CASE WHEN NEW.expected_owner_id<>NEW.actor_id
    THEN RAISE(ABORT,'OWNER_IDENTITY_CHANGED') END;
  SELECT CASE WHEN NEW.id IS NULL OR length(NEW.id)<>36 OR NEW.id<>lower(NEW.id)
      OR NEW.id GLOB '*[^0-9a-f-]*'
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.request_id IS NULL OR length(NEW.request_id)<>36
      OR NEW.request_id<>lower(NEW.request_id)
      OR NEW.request_id GLOB '*[^0-9a-f-]*'
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.operation NOT IN('create','update','delete','resolve','reopen')
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.request_json IS NULL OR NOT json_valid(NEW.request_json)
      OR json_type(NEW.request_json)<>'object' OR length(NEW.request_json)>20000
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Current Owner identity, active project/album, sealed invite ownership,
  -- exact album membership, photo and any owned version are required for replay too.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.workspace_id=w.id AND p.id=NEW.project_id
    JOIN albums a ON a.workspace_id=w.id AND a.project_id=p.id AND a.id=NEW.album_id
    JOIN guest_invites i ON i.workspace_id=w.id AND i.project_id=p.id
      AND i.id=NEW.invite_id AND i.created_by=o.user_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
      AND ia.project_id=p.id AND ia.album_id=a.id
    JOIN photos ph ON ph.workspace_id=w.id AND ph.project_id=p.id
      AND ph.album_id=a.id AND ph.id=NEW.photo_id
    JOIN photo_versions v ON v.workspace_id=w.id AND v.photo_id=ph.id
      AND v.id=NEW.version_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND i.id=NEW.invite_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.workspace_id=w.id AND p.id=NEW.project_id
    JOIN albums a ON a.workspace_id=w.id AND a.project_id=p.id AND a.id=NEW.album_id
    JOIN guest_invites i ON i.workspace_id=w.id AND i.project_id=p.id
      AND i.id=NEW.invite_id AND i.created_by=o.user_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
      AND ia.project_id=p.id AND ia.album_id=a.id
    JOIN photos ph ON ph.workspace_id=w.id AND ph.project_id=p.id
      AND ph.album_id=a.id AND ph.id=NEW.photo_id
    JOIN photo_versions v ON v.workspace_id=w.id AND v.photo_id=ph.id
      AND v.id=NEW.version_id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND i.id=NEW.invite_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  SELECT CASE WHEN NEW.operation<>'create' AND NOT EXISTS(
    SELECT 1 FROM owner_annotations a
    WHERE a.id=NEW.annotation_id AND a.author_user_id=NEW.actor_id
      AND a.invite_id=NEW.invite_id AND a.workspace_id=NEW.workspace_id
      AND a.project_id=NEW.project_id AND a.album_id=NEW.album_id
      AND a.photo_id=NEW.photo_id AND a.version_id=NEW.version_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;

  -- Validate the exact command body and nested schemas before replay lookup.
  SELECT CASE WHEN NOT (
    (NEW.operation IN('create','update') AND (
      (json_type(NEW.geometry_json)='object'
        AND json_extract(NEW.geometry_json,'$.type')='point'
        AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
        AND json_type(NEW.geometry_json,'$.x')='integer'
        AND json_type(NEW.geometry_json,'$.y')='integer'
        AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
        AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
        AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
        AND NEW.geometry_json=json_object('type','point','coordinateSpace','normalized_1e6',
          'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y')))
      OR (json_type(NEW.geometry_json)='object'
        AND json_extract(NEW.geometry_json,'$.type')='rectangle'
        AND json_extract(NEW.geometry_json,'$.coordinateSpace')='normalized_1e6'
        AND json_type(NEW.geometry_json,'$.x')='integer'
        AND json_type(NEW.geometry_json,'$.y')='integer'
        AND json_type(NEW.geometry_json,'$.width')='integer'
        AND json_type(NEW.geometry_json,'$.height')='integer'
        AND json_extract(NEW.geometry_json,'$.x') BETWEEN 0 AND 1000000
        AND json_extract(NEW.geometry_json,'$.y') BETWEEN 0 AND 1000000
        AND json_extract(NEW.geometry_json,'$.width') BETWEEN 1 AND 1000000
        AND json_extract(NEW.geometry_json,'$.height') BETWEEN 1 AND 1000000
        AND json_extract(NEW.geometry_json,'$.x')+json_extract(NEW.geometry_json,'$.width')<=1000000
        AND json_extract(NEW.geometry_json,'$.y')+json_extract(NEW.geometry_json,'$.height')<=1000000
        AND (SELECT count(*) FROM json_each(NEW.geometry_json))=6
        AND NEW.geometry_json=json_object('type','rectangle','coordinateSpace','normalized_1e6',
          'x',json_extract(NEW.geometry_json,'$.x'),'y',json_extract(NEW.geometry_json,'$.y'),
          'width',json_extract(NEW.geometry_json,'$.width'),
          'height',json_extract(NEW.geometry_json,'$.height')))
    )
    AND json_type(NEW.style_json)='object'
    AND (SELECT count(*) FROM json_each(NEW.style_json))=1
    AND json_type(NEW.style_json,'$.color')='text'
    AND json_extract(NEW.style_json,'$.color') IN('amber','red','blue')
    AND NEW.style_json=json_object('color',json_extract(NEW.style_json,'$.color'))
    AND (
      (NEW.operation='create' AND NEW.request_json=json_object(
        'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
        'operation','create','inviteId',NEW.invite_id,'photoId',NEW.photo_id,
        'versionId',NEW.version_id,'geometry',json(NEW.geometry_json),
        'style',json(NEW.style_json),'commentId',NEW.linked_comment_id))
      OR (NEW.operation='update' AND NEW.request_json=json_object(
        'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
        'operation','update','inviteId',NEW.invite_id,'photoId',NEW.photo_id,
        'versionId',NEW.version_id,'annotationId',NEW.annotation_id,
        'expectedRevision',NEW.expected_revision,'geometry',json(NEW.geometry_json),
        'style',json(NEW.style_json),'commentId',NEW.linked_comment_id))
    )
    OR (NEW.operation IN('delete','resolve','reopen') AND NEW.request_json=json_object(
      'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
      'operation',NEW.operation,'inviteId',NEW.invite_id,'photoId',NEW.photo_id,
      'versionId',NEW.version_id,'annotationId',NEW.annotation_id,
      'expectedRevision',NEW.expected_revision))
  )) THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

  -- Reauthorize base scope above, but permit a fresh opaque session to recover the
  -- exact original command/result without requiring its historical session row.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.expected_owner_id<>NEW.expected_owner_id
        OR c.operation<>NEW.operation OR c.invite_id<>NEW.invite_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.request_json<>NEW.request_json
        OR c.expected_revision IS NOT NEW.expected_revision
        OR c.geometry_json IS NOT NEW.geometry_json OR c.style_json IS NOT NEW.style_json
        OR c.linked_comment_id IS NOT NEW.linked_comment_id
        OR (NEW.operation<>'create' AND c.annotation_id<>NEW.annotation_id))
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  -- Preserve the 17-ledger case-insensitive Owner request namespace.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_commands c WHERE c.id=NEW.id
  ) THEN RAISE(ABORT,'IMMUTABLE_OWNER_ANNOTATION_COMMAND') END;
  SELECT CASE WHEN NEW.operation='create' AND (
    EXISTS(SELECT 1 FROM owner_annotations a WHERE a.id=NEW.annotation_id)
    OR EXISTS(SELECT 1 FROM guest_annotations g WHERE g.id=NEW.annotation_id)
  ) THEN RAISE(ABORT,'ANNOTATION_ID_COLLISION') END;

  SELECT CASE WHEN NEW.operation IN('create','update') AND NEW.linked_comment_id IS NOT NULL
      AND NOT EXISTS(
        SELECT 1 FROM guest_comments g WHERE g.id=NEW.linked_comment_id
          AND g.invite_id=NEW.invite_id AND g.workspace_id=NEW.workspace_id
          AND g.project_id=NEW.project_id AND g.album_id=NEW.album_id
          AND g.photo_id=NEW.photo_id AND g.version_id=NEW.version_id
          AND g.state='open' AND g.body IS NOT NULL
      )
    THEN RAISE(ABORT,'ANNOTATION_COMMENT_UNAVAILABLE') END;

  SELECT CASE WHEN NEW.operation='create'
      AND (SELECT count(*) FROM guest_annotations g
        WHERE g.invite_id=NEW.invite_id AND g.photo_id=NEW.photo_id
          AND g.version_id=NEW.version_id)
        + (SELECT count(*) FROM owner_annotations a
        WHERE a.invite_id=NEW.invite_id AND a.photo_id=NEW.photo_id
          AND a.version_id=NEW.version_id)>=1000
    THEN RAISE(ABORT,'ANNOTATION_LIMIT_REACHED') END;

  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen')
      AND EXISTS(SELECT 1 FROM owner_annotations a WHERE a.id=NEW.annotation_id
        AND a.revision=NEW.expected_revision AND a.revision>=9007199254740991)
    THEN RAISE(ABORT,'ANNOTATION_REVISION_EXHAUSTED') END;
  SELECT CASE WHEN NEW.operation IN('update','delete','resolve','reopen')
      AND NOT EXISTS(
        SELECT 1 FROM owner_annotations a WHERE a.id=NEW.annotation_id
          AND a.author_user_id=NEW.actor_id AND a.invite_id=NEW.invite_id
          AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
          AND a.album_id=NEW.album_id AND a.photo_id=NEW.photo_id
          AND a.version_id=NEW.version_id AND a.revision=NEW.expected_revision
          AND a.revision<9007199254740991
          AND ((NEW.operation='update' AND a.state='open')
            OR (NEW.operation='delete' AND a.state IN('open','resolved'))
            OR (NEW.operation='resolve' AND a.state='open')
            OR (NEW.operation='reopen' AND a.state='resolved'))
      )
    THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_annotation_ns_processing_review_commands AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_annotation_ns_external_intents AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_annotation_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_annotation_processing_commands_insert_guard
BEFORE INSERT ON owner_annotation_processing_commands BEGIN
  SELECT CASE WHEN NEW.expected_owner_id<>NEW.actor_id
      OR NEW.id IS NULL OR length(NEW.id)<>36 OR NEW.id<>lower(NEW.id)
      OR NEW.id GLOB '*[^0-9a-f-]*'
      OR NEW.request_id IS NULL OR length(NEW.request_id)<>36
      OR NEW.request_id<>lower(NEW.request_id)
      OR NEW.request_id GLOB '*[^0-9a-f-]*'
      OR NEW.operation<>'set_processing_state'
      OR NEW.state NOT IN('open','in_progress','resolved')
      OR NEW.request_json IS NULL OR NOT json_valid(NEW.request_json)
      OR json_type(NEW.request_json)<>'object' OR length(NEW.request_json)>20000
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.request_json<>json_object(
      'requestId',NEW.request_id,'expectedOwnerId',NEW.expected_owner_id,
      'operation','set_processing_state','inviteId',NEW.invite_id,
      'photoId',NEW.photo_id,'versionId',NEW.version_id,
      'annotationId',NEW.annotation_id,
      'expectedAnnotationRevision',NEW.expected_annotation_revision,
      'expectedProcessingRevision',NEW.expected_processing_revision,'state',NEW.state
    )
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;

  -- Reauthorize the current Owner session and retained sealed resource scope before
  -- replay. Invitation expiry/revocation and Guest grant bits are intentionally absent.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=w.id
      AND i.project_id=p.id AND i.created_by=o.user_id
    JOIN guest_invite_seals seal ON seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=w.id
      AND ia.project_id=p.id AND ia.album_id=a.id
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=w.id
      AND ph.project_id=p.id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=w.id
      AND v.photo_id=ph.id
    JOIN guest_annotations g ON g.id=NEW.annotation_id AND g.invite_id=i.id
      AND g.workspace_id=w.id AND g.project_id=p.id AND g.album_id=a.id
      AND g.photo_id=ph.id AND g.version_id=v.id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND i.id=NEW.invite_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND g.id=NEW.annotation_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN workspaces w ON w.owner_user_id=o.user_id
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND w.id=NEW.workspace_id AND p.id=NEW.project_id AND a.id=NEW.album_id
      AND (p.status IN('archived','deleting','deleted') OR a.state<>'active')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  -- Replay happens before Guest tombstone and either mutable revision check. A fresh
  -- current Owner session can recover the original receipt without the old session row.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_processing_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
      AND (c.expected_owner_id<>NEW.expected_owner_id
        OR c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.invite_id<>NEW.invite_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.annotation_id<>NEW.annotation_id
        OR c.expected_annotation_revision<>NEW.expected_annotation_revision
        OR c.expected_processing_revision<>NEW.expected_processing_revision
        OR c.state<>NEW.state OR c.content_revision<>NEW.content_revision
        OR c.request_json<>NEW.request_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM owner_annotation_processing_commands c
    WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  -- Preserve the case-folded namespace across all 18 previous Owner ledgers.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user' AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_annotations g
    WHERE g.id=NEW.annotation_id AND g.invite_id=NEW.invite_id
      AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
      AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id
      AND g.version_id=NEW.version_id AND g.state='deleted'
  ) THEN RAISE(ABORT,'ANNOTATION_NOT_EDITABLE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_annotations g
    WHERE g.id=NEW.annotation_id AND g.invite_id=NEW.invite_id
      AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id
      AND g.album_id=NEW.album_id AND g.photo_id=NEW.photo_id
      AND g.version_id=NEW.version_id AND g.revision=NEW.expected_annotation_revision
      AND g.state<>'deleted'
  ) THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
  SELECT CASE WHEN COALESCE((
    SELECT s.revision FROM owner_annotation_processing_states s
    WHERE s.annotation_id=NEW.annotation_id AND s.invite_id=NEW.invite_id
      AND s.workspace_id=NEW.workspace_id AND s.project_id=NEW.project_id
      AND s.album_id=NEW.album_id AND s.photo_id=NEW.photo_id
      AND s.version_id=NEW.version_id
  ),0)<>NEW.expected_processing_revision
    THEN RAISE(ABORT,'ANNOTATION_PROCESSING_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.expected_processing_revision>=9007199254740991
    THEN RAISE(ABORT,'PROCESSING_REVISION_EXHAUSTED') END;
  SELECT CASE WHEN NEW.content_revision<>COALESCE((
      SELECT MAX(ch.revision) FROM guest_annotation_changes ch
      WHERE ch.annotation_id=NEW.annotation_id AND ch.operation IN('create','update')
        AND ch.revision<=NEW.expected_annotation_revision
    ),0)
    OR NEW.content_revision<1 OR NEW.content_revision>NEW.expected_annotation_revision
    THEN RAISE(ABORT,'ANNOTATION_REVISION_CONFLICT') END;
END;

CREATE TRIGGER owner_annotation_processing_ns_processing_review_commands AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_annotation_processing_ns_owner_external_intents AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM owner_annotation_processing_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER project_matching_rule_command_guard
BEFORE INSERT ON project_matching_rule_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p WHERE p.id=NEW.project_id
      AND p.workspace_id=NEW.workspace_id
      AND p.status IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
  SELECT CASE WHEN NEW.id IS NULL OR NEW.request_id IS NULL
      OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND') END;

  -- Exact retries ignore captured session and before-state, but keep the original
  -- canonical intent and pass the current Owner/project checks above.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
      AND (c.operation<>NEW.operation OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id
        OR c.expected_project_revision<>NEW.expected_project_revision
        OR c.expected_rule_revision<>NEW.expected_rule_revision
        OR c.profile<>NEW.profile OR c.confirm<>NEW.confirm
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM project_matching_rule_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  -- Shared case-folded actor/request namespace with every prior Owner writer.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND lower(f.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND lower(e.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN COALESCE(
    CASE WHEN json_valid(NEW.payload_json) THEN
      json_type(NEW.payload_json)='object'
      AND (SELECT count(*) FROM json_each(NEW.payload_json))=5
      AND json_type(NEW.payload_json,'$.projectId')='text'
      AND json_extract(NEW.payload_json,'$.projectId')=NEW.project_id
      AND json_type(NEW.payload_json,'$.expectedProjectRevision')='integer'
      AND json_extract(NEW.payload_json,'$.expectedProjectRevision')=NEW.expected_project_revision
      AND json_type(NEW.payload_json,'$.expectedRuleRevision')='integer'
      AND json_extract(NEW.payload_json,'$.expectedRuleRevision')=NEW.expected_rule_revision
      AND json_type(NEW.payload_json,'$.profile')='text'
      AND json_extract(NEW.payload_json,'$.profile')=NEW.profile
      AND json_type(NEW.payload_json,'$.confirm')='true'
      AND json_extract(NEW.payload_json,'$.confirm')=1
      AND NEW.payload_json=json_object(
        'projectId',NEW.project_id,
        'expectedProjectRevision',NEW.expected_project_revision,
        'expectedRuleRevision',NEW.expected_rule_revision,
        'profile',NEW.profile, 'confirm',json('true'))
    ELSE 0 END,0)<>1
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p
    LEFT JOIN project_matching_rule_heads h
      ON h.project_id=p.id AND h.workspace_id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
      AND p.revision=NEW.expected_project_revision
      AND COALESCE(h.profile,'default-v1')=NEW.before_profile
      AND COALESCE(h.revision,0)=NEW.expected_rule_revision
      AND h.command_id IS NEW.previous_command_id
  ) THEN RAISE(ABORT,'MATCHING_RULES_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.profile<>NEW.before_profile
      AND (NEW.expected_project_revision=2147483647
        OR NEW.expected_rule_revision=2147483647)
    THEN RAISE(ABORT,'MATCHING_RULES_REVISION_EXHAUSTED') END;
END;

CREATE TRIGGER processing_review_commands_project_matching_rules_namespace AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER owner_external_intents_project_matching_rules_namespace AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM project_matching_rule_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER upload_resolved_reservation_guard
BEFORE INSERT ON upload_requests
WHEN NEW.operation='upload.reserved'
  AND json_valid(NEW.payload_json)
  AND json_type(NEW.payload_json,'$.resolution') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM upload_requests r
    WHERE r.actor_id=NEW.actor_id AND r.request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
      AND w.owner_user_id=NEW.actor_id
    JOIN albums a ON a.id=NEW.album_id AND a.project_id=p.id
      AND a.workspace_id=w.id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND a.state NOT IN('archived','deleting','deleted')
      AND p.status NOT IN('archived','deleting','deleted')
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p JOIN albums a ON a.id=NEW.album_id
      AND a.project_id=p.id AND a.workspace_id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND (p.status IN('archived','deleting','deleted') OR a.state NOT IN('draft','active'))
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;

  -- Resolve cross-ledger request conflicts before stale-CAS checks.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
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
    OR EXISTS(SELECT 1 FROM upload_key_fences f WHERE f.actor_type='user'
      AND f.actor_id=NEW.actor_id AND lower(f.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user'
      AND e.actor_id=NEW.actor_id AND e.action='selection.reopened'
      AND lower(e.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=lower(NEW.request_id))
    OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.actor_id=NEW.actor_id
      AND lower(c.request_id)=lower(NEW.request_id))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN COALESCE(CASE WHEN
    json_type(NEW.payload_json,'$.resolution')='object' THEN
      (
        ((SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution'))=6
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile') IS NULL)
        OR
        ((SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution'))=7
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile')='object'
          AND (SELECT count(*) FROM json_each(
            NEW.payload_json,'$.resolution.matchingProfile'))=2
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile.profile')='text'
          AND json_extract(NEW.payload_json,'$.resolution.matchingProfile.profile') IN(
            'default-v1','rules-v1-001','rules-v1-010','rules-v1-011',
            'rules-v1-100','rules-v1-101','rules-v1-110','rules-v1-111')
          AND json_type(NEW.payload_json,'$.resolution.matchingProfile.ruleRevision')='integer'
          AND json_extract(NEW.payload_json,'$.resolution.matchingProfile.ruleRevision')
            BETWEEN 0 AND 2147483647)
      )
      AND json_type(NEW.payload_json,'$.resolution.expectedChangeSequence')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.expectedChangeSequence') BETWEEN 0 AND 9007199254740991
      AND json_type(NEW.payload_json,'$.resolution.expectedProjectRevision')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.expectedProjectRevision') BETWEEN 1 AND 2147483647
      AND json_extract(NEW.payload_json,'$.resolution.expectedMode') IN('auto_filename','assisted')
      AND json_type(NEW.payload_json,'$.resolution.confirm')='true'
      AND json_type(NEW.payload_json,'$.resolution.dimensions')='object'
      AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.dimensions'))=2
      AND json_type(NEW.payload_json,'$.resolution.dimensions.width')='integer'
      AND json_type(NEW.payload_json,'$.resolution.dimensions.height')='integer'
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.width') BETWEEN 1 AND 32768
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.height') BETWEEN 1 AND 32768
      AND json_extract(NEW.payload_json,'$.resolution.dimensions.width')*json_extract(NEW.payload_json,'$.resolution.dimensions.height')<=80000000
      AND json_type(NEW.payload_json,'$.resolution.choice')='object'
      AND ((json_extract(NEW.payload_json,'$.resolution.choice.kind')='new_photo'
          AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.choice'))=1
          AND json_type(NEW.payload_json,'$.versionTarget') IS NULL)
        OR (json_extract(NEW.payload_json,'$.resolution.choice.kind')='new_version'
          AND (SELECT count(*) FROM json_each(NEW.payload_json,'$.resolution.choice'))=4
          AND json_type(NEW.payload_json,'$.versionTarget')='object'
          AND json_extract(NEW.payload_json,'$.resolution.choice.photoId')=json_extract(NEW.payload_json,'$.versionTarget.photoId')
          AND json_extract(NEW.payload_json,'$.resolution.choice.parentVersionId')=json_extract(NEW.payload_json,'$.versionTarget.parentVersionId')
          AND json_extract(NEW.payload_json,'$.resolution.choice.expectedRevision')=json_extract(NEW.payload_json,'$.versionTarget.expectedRevision')
          AND json_extract(NEW.payload_json,'$.versionTarget.changeType')='new_retouch'))
    ELSE 0 END,0)<>1 THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN
    json_extract(NEW.payload_json,'$.resolution.expectedChangeSequence')<>
      COALESCE((SELECT MAX(m.sequence) FROM album_matching_changes m
        WHERE m.workspace_id=NEW.workspace_id AND m.project_id=NEW.project_id
          AND m.album_id=NEW.album_id),0)
    OR NOT EXISTS(SELECT 1 FROM projects p
      WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
        AND p.revision=json_extract(NEW.payload_json,'$.resolution.expectedProjectRevision')
        AND p.versioning_mode=json_extract(NEW.payload_json,'$.resolution.expectedMode')
        AND p.status NOT IN('archived','deleting','deleted'))
    OR (json_type(NEW.payload_json,'$.resolution.matchingProfile') IS NULL
      AND COALESCE((SELECT h.profile FROM project_matching_rule_heads h
        WHERE h.project_id=NEW.project_id AND h.workspace_id=NEW.workspace_id),
        'default-v1')<>'default-v1')
    OR (json_type(NEW.payload_json,'$.resolution.matchingProfile')='object'
      AND (
        COALESCE((SELECT h.profile FROM project_matching_rule_heads h
          WHERE h.project_id=NEW.project_id AND h.workspace_id=NEW.workspace_id),
          'default-v1') IS NOT
          json_extract(NEW.payload_json,'$.resolution.matchingProfile.profile')
        OR COALESCE((SELECT h.revision FROM project_matching_rule_heads h
          WHERE h.project_id=NEW.project_id AND h.workspace_id=NEW.workspace_id),0) IS NOT
          json_extract(NEW.payload_json,'$.resolution.matchingProfile.ruleRevision')
      ))
    THEN RAISE(ABORT,'RESOLUTION_STALE') END;
END;

CREATE TRIGGER guest_media_download_audit_guard
BEFORE INSERT ON audit_events
WHEN NEW.action IN('download.requested','download.generated')
  AND (NEW.actor_type='guest' OR json_type(NEW.after_json,'$.assetKind') IS NOT NULL)
BEGIN
  SELECT CASE WHEN
    NEW.actor_type<>'guest'
    OR NEW.actor_id IS NULL
    OR NEW.guest_session_id IS NULL
    OR NEW.session_id IS NOT NULL
    OR NEW.before_json IS NOT NULL
    OR COALESCE(json_valid(NEW.after_json),0)<>1
    OR json_type(NEW.after_json,'$') IS NOT 'object'
    OR (SELECT count(*) FROM json_each(NEW.after_json))<>5
    OR (SELECT count(DISTINCT key) FROM json_each(NEW.after_json))<>5
    OR EXISTS(SELECT 1 FROM json_each(NEW.after_json)
      WHERE key NOT IN('assetKind','assetId','filename','byteSize','mime'))
    OR json_type(NEW.after_json,'$.assetKind') IS NOT 'text'
    OR json_extract(NEW.after_json,'$.assetKind') NOT IN('preview','original')
    OR json_type(NEW.after_json,'$.assetId') IS NOT 'text'
    OR length(json_extract(NEW.after_json,'$.assetId'))<>36
    OR substr(json_extract(NEW.after_json,'$.assetId'),9,1)<>'-'
    OR substr(json_extract(NEW.after_json,'$.assetId'),14,1)<>'-'
    OR substr(json_extract(NEW.after_json,'$.assetId'),19,1)<>'-'
    OR substr(json_extract(NEW.after_json,'$.assetId'),24,1)<>'-'
    OR length(replace(json_extract(NEW.after_json,'$.assetId'),'-',''))<>32
    OR replace(json_extract(NEW.after_json,'$.assetId'),'-','') GLOB '*[^0-9a-fA-F]*'
    OR json_type(NEW.after_json,'$.filename') IS NOT 'text'
    OR json_type(NEW.after_json,'$.byteSize') IS NOT 'integer'
    OR json_extract(NEW.after_json,'$.byteSize')<1
    OR json_type(NEW.after_json,'$.mime') IS NOT 'text'
    OR NEW.event_id IS NULL
    OR length(NEW.event_id)<>36
    OR substr(NEW.event_id,9,1)<>'-'
    OR substr(NEW.event_id,14,1)<>'-'
    OR substr(NEW.event_id,19,1)<>'-'
    OR substr(NEW.event_id,24,1)<>'-'
    OR length(replace(NEW.event_id,'-',''))<>32
    OR replace(NEW.event_id,'-','') GLOB '*[^0-9a-fA-F]*'
    OR NEW.request_id IS NULL
    OR length(NEW.request_id)<>36
    OR substr(NEW.request_id,9,1)<>'-'
    OR substr(NEW.request_id,14,1)<>'-'
    OR substr(NEW.request_id,19,1)<>'-'
    OR substr(NEW.request_id,24,1)<>'-'
    OR length(replace(NEW.request_id,'-',''))<>32
    OR replace(NEW.request_id,'-','') GLOB '*[^0-9a-fA-F]*'
    OR NOT EXISTS(
      SELECT 1
      FROM guest_sessions s
      JOIN guest_identities g
        ON g.id=s.guest_id AND g.invite_id=s.invite_id
      JOIN guest_invites i ON i.id=s.invite_id
      JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
      JOIN guest_invite_albums ia
        ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
        AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
      JOIN albums al
        ON al.id=ia.album_id AND al.workspace_id=i.workspace_id
        AND al.project_id=i.project_id AND al.state='active'
      JOIN projects pr
        ON pr.id=i.project_id AND pr.workspace_id=i.workspace_id
        AND pr.status NOT IN('archived','deleting','deleted')
      JOIN workspaces w ON w.id=i.workspace_id
      JOIN owners o
        ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
      JOIN photos p
        ON p.id=NEW.photo_id AND p.workspace_id=i.workspace_id
        AND p.project_id=i.project_id AND p.album_id=al.id
      JOIN photo_version_heads head
        ON head.photo_id=p.id AND head.workspace_id=p.workspace_id
        AND head.project_id=p.project_id AND head.album_id=p.album_id
        AND head.version_id=NEW.version_id
      JOIN photo_versions v
        ON v.id=head.version_id AND v.photo_id=p.id
        AND v.workspace_id=p.workspace_id
      JOIN photo_assets original
        ON original.version_id=v.id AND original.photo_id=p.id
        AND original.workspace_id=p.workspace_id AND original.asset_kind='original'
        AND original.state='private' AND original.byte_size=v.byte_size
        AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
      LEFT JOIN upload_completions sourceV1
        ON sourceV1.asset_id=original.id AND sourceV1.photo_id=p.id
        AND sourceV1.version_id=v.id AND sourceV1.workspace_id=p.workspace_id
        AND sourceV1.project_id=p.project_id AND sourceV1.album_id=p.album_id
        AND sourceV1.actor_id=w.owner_user_id
      LEFT JOIN upload_version_completions sourceV2
        ON sourceV2.asset_id=original.id AND sourceV2.photo_id=p.id
        AND sourceV2.version_id=v.id AND sourceV2.workspace_id=p.workspace_id
        AND sourceV2.project_id=p.project_id AND sourceV2.album_id=p.album_id
        AND sourceV2.actor_id=w.owner_user_id
      JOIN upload_sessions sourceUpload
        ON sourceUpload.id=COALESCE(sourceV1.upload_session_id,sourceV2.upload_session_id)
        AND sourceUpload.workspace_id=p.workspace_id
        AND sourceUpload.project_id=p.project_id AND sourceUpload.album_id=p.album_id
        AND sourceUpload.actor_id=w.owner_user_id
        AND sourceUpload.object_key=original.object_key
      JOIN image_processing_jobs job
        ON job.id=original.id AND job.status='succeeded'
      JOIN image_processing_outputs thumbnail_slot
        ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
      JOIN photo_assets thumbnail
        ON thumbnail.id=thumbnail_slot.asset_id
        AND thumbnail.object_key=thumbnail_slot.object_key
        AND thumbnail.version_id=v.id AND thumbnail.photo_id=p.id
        AND thumbnail.workspace_id=p.workspace_id
        AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private'
        AND thumbnail.mime='image/jpeg'
      JOIN image_processing_outputs preview_slot
        ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
      JOIN photo_assets preview
        ON preview.id=preview_slot.asset_id
        AND preview.object_key=preview_slot.object_key
        AND preview.version_id=v.id AND preview.photo_id=p.id
        AND preview.workspace_id=p.workspace_id
        AND preview.asset_kind='preview' AND preview.state='private'
        AND preview.mime='image/jpeg'
      JOIN photo_assets target
        ON target.id=json_extract(NEW.after_json,'$.assetId')
        AND target.version_id=v.id AND target.photo_id=p.id
        AND target.workspace_id=p.workspace_id AND target.state='private'
        AND target.asset_kind=CASE json_extract(NEW.after_json,'$.assetKind')
          WHEN 'preview' THEN 'preview' ELSE 'original' END
        AND target.byte_size=json_extract(NEW.after_json,'$.byteSize')
        AND target.mime=json_extract(NEW.after_json,'$.mime')
        AND ((json_extract(NEW.after_json,'$.assetKind')='original'
            AND target.id=original.id)
          OR (json_extract(NEW.after_json,'$.assetKind')='preview'
            AND target.id=preview.id))
      WHERE s.id=NEW.guest_session_id AND s.guest_id=NEW.actor_id
        AND g.id=NEW.actor_id AND s.expires_at_ms>unixepoch('subsec')*1000
        AND i.expires_at_ms>unixepoch('subsec')*1000
        AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
        AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
        AND ((json_extract(NEW.after_json,'$.assetKind')='preview'
            AND (i.permissions_mask & 2)=2)
          OR (json_extract(NEW.after_json,'$.assetKind')='original'
            AND (i.permissions_mask & 4)=4))
        AND NEW.actor_type='guest' AND NEW.actor_id=g.id
        AND NEW.guest_session_id=s.id AND NEW.session_id IS NULL
        AND NEW.workspace_id=i.workspace_id AND NEW.project_id=i.project_id
        AND NEW.album_id=ia.album_id AND NEW.photo_id=p.id
        AND NEW.version_id=v.id
        AND json_extract(NEW.after_json,'$.filename')=sourceUpload.original_filename
        AND ((sourceV1.upload_session_id IS NOT NULL AND sourceV2.upload_session_id IS NULL)
          OR (sourceV2.upload_session_id IS NOT NULL AND sourceV1.upload_session_id IS NULL))
    ) THEN RAISE(ABORT,'GUEST_MEDIA_DOWNLOAD_INVALID') END;

  SELECT CASE WHEN NEW.action='download.generated' AND NOT EXISTS(
    SELECT 1 FROM audit_events requested
    WHERE requested.action='download.requested'
      AND requested.request_id=NEW.request_id
      AND requested.actor_type=NEW.actor_type
      AND requested.actor_id=NEW.actor_id
      AND requested.guest_session_id=NEW.guest_session_id
      AND requested.session_id IS NULL
      AND requested.workspace_id=NEW.workspace_id
      AND requested.project_id=NEW.project_id
      AND requested.album_id=NEW.album_id
      AND requested.photo_id=NEW.photo_id
      AND requested.version_id=NEW.version_id
      AND requested.before_json IS NULL
      AND requested.after_json=NEW.after_json
  ) THEN RAISE(ABORT,'GUEST_MEDIA_DOWNLOAD_REQUEST_REQUIRED') END;
END;

CREATE TRIGGER human_photo_view_insert_guard BEFORE INSERT ON human_photo_views BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM human_photo_views prior
    WHERE prior.event_id=NEW.event_id OR prior.request_id=NEW.request_id)
    THEN RAISE(ABORT,'IMMUTABLE_HUMAN_PHOTO_VIEW') END;
  SELECT CASE WHEN NEW.viewed_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+1000
    THEN RAISE(ABORT,'HUMAN_VIEW_TIMESTAMP_INVALID') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1
    FROM workspaces w
    JOIN owners owner ON owner.user_id=w.owner_user_id AND owner.enabled=1
    JOIN projects project ON project.id=NEW.project_id
      AND project.workspace_id=NEW.workspace_id
      AND project.status NOT IN('archived','deleting','deleted')
    JOIN albums album ON album.id=NEW.album_id
      AND album.workspace_id=NEW.workspace_id AND album.project_id=NEW.project_id
      AND album.state='active'
    JOIN photos photo ON photo.id=NEW.photo_id
      AND photo.workspace_id=NEW.workspace_id AND photo.project_id=NEW.project_id
      AND photo.album_id=NEW.album_id
    JOIN photo_version_heads head ON head.photo_id=photo.id
      AND head.workspace_id=photo.workspace_id AND head.project_id=photo.project_id
      AND head.album_id=photo.album_id
    JOIN photo_versions version ON version.id=NEW.version_id
      AND version.workspace_id=photo.workspace_id AND version.photo_id=photo.id
    JOIN photo_assets original ON original.version_id=version.id
      AND original.photo_id=photo.id AND original.workspace_id=photo.workspace_id
      AND original.asset_kind='original' AND original.state='private'
      AND original.byte_size=version.byte_size AND original.mime=version.mime
      AND original.checksum_sha256=version.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=photo.id AND source_v1.version_id=version.id
      AND source_v1.workspace_id=photo.workspace_id
      AND source_v1.project_id=photo.project_id AND source_v1.album_id=photo.album_id
      AND source_v1.actor_id=w.owner_user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=photo.id AND source_v2.version_id=version.id
      AND source_v2.workspace_id=photo.workspace_id
      AND source_v2.project_id=photo.project_id AND source_v2.album_id=photo.album_id
      AND source_v2.actor_id=w.owner_user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=photo.workspace_id
      AND source_upload.project_id=photo.project_id AND source_upload.album_id=photo.album_id
      AND source_upload.actor_id=w.owner_user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key
      AND thumbnail.version_id=version.id AND thumbnail.photo_id=photo.id
      AND thumbnail.workspace_id=photo.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private'
      AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key
      AND preview.version_id=version.id AND preview.photo_id=photo.id
      AND preview.workspace_id=photo.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private'
      AND preview.mime='image/jpeg'
    WHERE w.id=NEW.workspace_id AND owner.user_id=w.owner_user_id
      AND version.id=NEW.version_id AND photo.id=NEW.photo_id
      AND source_upload.original_filename IS NOT NULL
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
      AND (
        (NEW.actor_type='user' AND EXISTS(
          SELECT 1 FROM owner_sessions owner_session
          WHERE owner_session.id=NEW.authorization_session_id
            AND owner_session.userId=owner.user_id
            AND owner_session.userId=NEW.actor_id
            AND owner_session.expiresAt>unixepoch('subsec')*1000))
        OR
        (NEW.actor_type='guest' AND EXISTS(
          SELECT 1 FROM guest_sessions guest_session
          JOIN guest_identities guest ON guest.id=guest_session.guest_id
            AND guest.invite_id=guest_session.invite_id
          JOIN guest_invites invite ON invite.id=guest_session.invite_id
          JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
          JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
            AND invite_album.workspace_id=invite.workspace_id
            AND invite_album.project_id=invite.project_id
            AND invite_album.album_id=NEW.album_id
          WHERE guest_session.id=NEW.authorization_session_id
            AND guest.id=NEW.actor_id
            AND invite.workspace_id=NEW.workspace_id
            AND invite.project_id=NEW.project_id
            AND invite.created_by=owner.user_id
            AND (invite.permissions_mask & 1)=1
            AND guest_session.expires_at_ms>unixepoch('subsec')*1000
            AND invite.expires_at_ms>unixepoch('subsec')*1000
            AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
              WHERE revoked.invite_id=invite.id)
            AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
              WHERE revoked.session_id=guest_session.id)
            AND (version.id=head.version_id OR (
              (invite.permissions_mask & 2048)=2048
              AND (version.version_no=1 OR EXISTS(
                SELECT 1 FROM photo_version_head_commands head_command
                JOIN photo_version_head_results head_result
                  ON head_result.command_id=head_command.id
                WHERE head_command.photo_id=photo.id
                  AND head_command.workspace_id=photo.workspace_id
                  AND head_command.project_id=photo.project_id
                  AND head_command.album_id=photo.album_id
                  AND head_command.version_id=version.id
                  AND json_extract(head_result.result_json,'$.changed')=1))
            ))))
      )
  ) THEN RAISE(ABORT,'HUMAN_VIEW_NOT_AUTHORIZED') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM human_photo_views prior
    WHERE prior.authorization_session_id=NEW.authorization_session_id
      AND prior.actor_type=NEW.actor_type AND prior.actor_id=NEW.actor_id
      AND prior.album_id=NEW.album_id
      AND prior.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)-300000
  ) THEN RAISE(ABORT,'HUMAN_VIEW_RATE_LIMITED') END;
END;

CREATE TRIGGER version_approval_owner_command_guard
BEFORE INSERT ON version_approval_owner_commands BEGIN
  -- Current Owner and route scope are checked before request-ID lookup/replay.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM owners o
    JOIN owner_sessions s ON s.userId=o.user_id
      AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000
    WHERE o.user_id=NEW.actor_id AND o.enabled=1
      AND NEW.expected_owner_id=o.user_id
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM workspaces w
    JOIN projects p ON p.id=NEW.project_id AND p.workspace_id=w.id
    JOIN albums a ON a.id=NEW.album_id AND a.workspace_id=w.id AND a.project_id=p.id
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=w.id
      AND ph.project_id=p.id AND ph.album_id=a.id
    WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.actor_id
  ) THEN RAISE(ABORT,'NOT_FOUND') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM projects p JOIN albums a
      ON a.project_id=p.id AND a.workspace_id=p.workspace_id
    WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id
      AND a.id=NEW.album_id AND (p.status IN('archived','deleting','deleted')
        OR a.state<>'active')
  ) THEN RAISE(ABORT,'RESOURCE_NOT_EDITABLE') END;
  SELECT CASE WHEN NEW.id IS NULL OR EXISTS(
      SELECT 1 FROM version_approval_owner_commands c WHERE c.id=NEW.id
    ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_OWNER_COMMAND') END;

  -- Share the case-folded Owner request namespace with every existing ledger/claim.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM workspace_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_workflow_requests c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM processing_review_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_revocation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM invite_creation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM selection_policy_configuration_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_owner_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM photo_version_head_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_versioning_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_comment_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_external_intents c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM upload_key_fences c WHERE c.actor_type='user' AND c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_processing_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM owner_annotation_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM project_matching_rule_commands c WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_type='user' AND e.actor_id=NEW.actor_id
      AND e.action='selection.reopened' AND lower(e.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  -- A changed body or session conflicts. An exact replay returns the immutable original
  -- result after the same live Owner session and owned active scope above are revalidated.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
      AND (c.expected_owner_id<>NEW.expected_owner_id OR c.session_id<>NEW.session_id OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id
        OR c.head_revision<>NEW.head_revision OR c.invite_ids_json<>NEW.invite_ids_json
        OR c.confirm<>NEW.confirm OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_owner_commands c
    WHERE c.actor_id=NEW.actor_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN NEW.request_id IS NULL OR NEW.confirm<>1
      OR NEW.request_resource_id IS NULL OR NEW.invite_ids_json IS NULL
      OR NEW.payload_json IS NULL
      OR NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_INPUT') END;

  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM photos ph
    JOIN photo_version_heads head ON head.photo_id=ph.id
      AND head.workspace_id=ph.workspace_id AND head.project_id=ph.project_id
      AND head.album_id=ph.album_id
    JOIN photo_versions v ON v.id=head.version_id AND v.photo_id=ph.id
      AND v.workspace_id=ph.workspace_id
    JOIN workspaces w ON w.id=ph.workspace_id AND w.owner_user_id=NEW.actor_id
    JOIN photo_assets original ON original.version_id=v.id
      AND original.photo_id=ph.id AND original.workspace_id=ph.workspace_id
      AND original.asset_kind='original' AND original.state='private'
      AND original.byte_size=v.byte_size AND original.mime=v.mime
      AND original.checksum_sha256=v.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=ph.id AND source_v1.version_id=v.id
      AND source_v1.workspace_id=ph.workspace_id AND source_v1.project_id=ph.project_id
      AND source_v1.album_id=ph.album_id AND source_v1.actor_id=w.owner_user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=ph.id AND source_v2.version_id=v.id
      AND source_v2.workspace_id=ph.workspace_id AND source_v2.project_id=ph.project_id
      AND source_v2.album_id=ph.album_id AND source_v2.actor_id=w.owner_user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=ph.workspace_id
      AND source_upload.project_id=ph.project_id AND source_upload.album_id=ph.album_id
      AND source_upload.actor_id=w.owner_user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key AND thumbnail.version_id=v.id
      AND thumbnail.photo_id=ph.id AND thumbnail.workspace_id=ph.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private' AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id
      AND preview.photo_id=ph.id AND preview.workspace_id=ph.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
      AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id
      AND head.version_id=NEW.version_id AND head.revision=NEW.head_revision
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
  ) THEN RAISE(ABORT,'PHOTO_VERSION_REVISION_CONFLICT') END;

  SELECT CASE WHEN json_array_length(NEW.invite_ids_json) NOT BETWEEN 1 AND 24
      OR (SELECT count(*) FROM json_each(NEW.invite_ids_json)
        WHERE type<>'text' OR length(value)<>36 OR value<>lower(value)
          OR value NOT GLOB '*[^0-9a-f-]*' OR substr(value,9,1)<>'-'
          OR substr(value,14,1)<>'-' OR substr(value,19,1)<>'-'
          OR substr(value,24,1)<>'-' OR length(replace(value,'-',''))<>32)
        <>json_array_length(NEW.invite_ids_json)
      OR (SELECT count(DISTINCT value) FROM json_each(NEW.invite_ids_json))
        <>json_array_length(NEW.invite_ids_json)
      OR EXISTS(
        SELECT 1 FROM json_each(NEW.invite_ids_json) member
        WHERE NOT EXISTS(
          SELECT 1 FROM guest_invites invite
          JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=invite.id
          JOIN guest_invite_albums ia ON ia.invite_id=invite.id
            AND ia.workspace_id=invite.workspace_id AND ia.project_id=invite.project_id
            AND ia.album_id=NEW.album_id
          WHERE invite.id=member.value AND invite.workspace_id=NEW.workspace_id
            AND invite.project_id=NEW.project_id AND invite.created_by=NEW.actor_id
            AND invite.expires_at_ms>unixepoch('subsec')*1000
            AND (invite.permissions_mask & 1)=1
            AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
              WHERE revoked.invite_id=invite.id)
        )
      )
    THEN RAISE(ABORT,'VERSION_APPROVAL_INVALID_INVITES') END;
END;

CREATE TRIGGER version_approval_guest_command_guard
BEFORE INSERT ON version_approval_guest_commands BEGIN
  -- Resolve current cookie-derived session, invitation, request membership, target, and
  -- visible-version permission before looking up an idempotency key.
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN version_approval_requests r ON r.id=NEW.approval_request_id
      AND r.workspace_id=i.workspace_id AND r.project_id=i.project_id AND r.album_id=a.id
      AND r.photo_id=NEW.photo_id AND r.version_id=NEW.version_id
      AND r.head_revision=NEW.head_revision
    JOIN version_approval_request_seals seal ON seal.approval_request_id=r.id
      AND seal.workspace_id=r.workspace_id AND seal.project_id=r.project_id
      AND seal.album_id=r.album_id
      AND seal.member_count=(SELECT count(*) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
    JOIN version_approval_request_invites member ON member.approval_request_id=r.id
      AND member.invite_id=i.id AND member.workspace_id=r.workspace_id
      AND member.project_id=r.project_id AND member.album_id=r.album_id
    JOIN photos ph ON ph.id=r.photo_id AND ph.workspace_id=r.workspace_id
      AND ph.project_id=r.project_id AND ph.album_id=r.album_id
    JOIN photo_version_heads head ON head.photo_id=ph.id
      AND head.workspace_id=ph.workspace_id AND head.project_id=ph.project_id
      AND head.album_id=ph.album_id
    JOIN photo_versions v ON v.id=r.version_id AND v.photo_id=ph.id
      AND v.workspace_id=ph.workspace_id AND v.version_no=r.version_no
    JOIN workspaces owner_workspace ON owner_workspace.id=ph.workspace_id
      AND owner_workspace.owner_user_id=o.user_id
    JOIN photo_assets original ON original.version_id=v.id
      AND original.photo_id=ph.id AND original.workspace_id=ph.workspace_id
      AND original.asset_kind='original' AND original.state='private'
      AND original.byte_size=v.byte_size AND original.mime=v.mime
      AND original.checksum_sha256=v.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=ph.id AND source_v1.version_id=v.id
      AND source_v1.workspace_id=ph.workspace_id AND source_v1.project_id=ph.project_id
      AND source_v1.album_id=ph.album_id AND source_v1.actor_id=o.user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=ph.id AND source_v2.version_id=v.id
      AND source_v2.workspace_id=ph.workspace_id AND source_v2.project_id=ph.project_id
      AND source_v2.album_id=ph.album_id AND source_v2.actor_id=o.user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=ph.workspace_id
      AND source_upload.project_id=ph.project_id AND source_upload.album_id=ph.album_id
      AND source_upload.actor_id=o.user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key AND thumbnail.version_id=v.id
      AND thumbnail.photo_id=ph.id AND thumbnail.workspace_id=ph.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private' AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id
      AND preview.photo_id=ph.id AND preview.workspace_id=ph.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id
      AND NEW.expected_guest_id=NEW.guest_id
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND a.id=NEW.album_id AND ph.id=NEW.photo_id AND v.id=NEW.version_id
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND i.expires_at_ms>unixepoch('subsec')*1000
      AND (i.permissions_mask & 1)=1
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
        WHERE revoked.session_id=s.id)
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
      -- The request is explicitly authorized by this sealed invitation, but its fixed
      -- version must also remain actually visible under the existing Guest gallery rules.
      AND (v.id=head.version_id OR (
        (i.permissions_mask & 2048)=2048
        AND (v.version_no=1 OR EXISTS(
          SELECT 1 FROM photo_version_head_commands head_command
          JOIN photo_version_head_results head_result ON head_result.command_id=head_command.id
          WHERE head_command.photo_id=ph.id AND head_command.workspace_id=ph.workspace_id
            AND head_command.project_id=ph.project_id AND head_command.album_id=ph.album_id
            AND head_command.version_id=v.id
            AND json_extract(head_result.result_json,'$.changed')=1
        ))
      ))
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.id IS NULL OR EXISTS(
    SELECT 1 FROM version_approval_guest_commands c WHERE c.id=NEW.id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_GUEST_COMMAND') END;

  -- Preserve the full case-folded Guest request namespace, including invite-keyed exchange.
  SELECT CASE WHEN
    EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM shared_review_guest_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_tag_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_comment_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_annotation_commands c WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
      AND (c.expected_guest_id<>NEW.expected_guest_id OR c.session_id<>NEW.session_id OR c.invite_id<>NEW.invite_id
        OR c.approval_request_id<>NEW.approval_request_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.head_revision<>NEW.head_revision
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  -- Only the same currently live Guest session may replay this exact immutable result.
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND lower(c.request_id)=NEW.request_id
  ) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
      OR NEW.created_at_ms>unixepoch('subsec')*1000+60000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
END;

CREATE TRIGGER version_approval_receipt_insert_guard
BEFORE INSERT ON version_approval_receipts BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_receipts r
    WHERE r.approval_request_id=NEW.approval_request_id AND r.guest_id=NEW.guest_id
      OR r.event_id=NEW.event_id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_RECEIPT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_guest_commands c
    JOIN guest_sessions s ON s.id=c.session_id AND s.guest_id=c.guest_id
      AND s.invite_id=c.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=c.album_id
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN version_approval_requests r ON r.id=c.approval_request_id
      AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id
      AND r.album_id=c.album_id AND r.photo_id=c.photo_id
      AND r.version_id=c.version_id AND r.head_revision=c.head_revision
    JOIN version_approval_request_seals seal ON seal.approval_request_id=r.id
      AND seal.member_count=(SELECT count(*) FROM version_approval_request_invites m
        WHERE m.approval_request_id=r.id)
    JOIN version_approval_request_invites member ON member.approval_request_id=r.id
      AND member.invite_id=i.id AND member.workspace_id=r.workspace_id
      AND member.project_id=r.project_id AND member.album_id=r.album_id
    JOIN photos ph ON ph.id=r.photo_id AND ph.workspace_id=r.workspace_id
      AND ph.project_id=r.project_id AND ph.album_id=r.album_id
    JOIN photo_version_heads head ON head.photo_id=ph.id AND head.workspace_id=ph.workspace_id
      AND head.project_id=ph.project_id AND head.album_id=ph.album_id
    JOIN photo_versions v ON v.id=r.version_id AND v.workspace_id=ph.workspace_id
      AND v.photo_id=ph.id AND v.version_no=r.version_no
    JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=ph.id
      AND original.workspace_id=ph.workspace_id AND original.asset_kind='original'
      AND original.state='private' AND original.byte_size=v.byte_size
      AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256
    LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id
      AND source_v1.photo_id=ph.id AND source_v1.version_id=v.id
      AND source_v1.workspace_id=ph.workspace_id AND source_v1.project_id=ph.project_id
      AND source_v1.album_id=ph.album_id AND source_v1.actor_id=o.user_id
    LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id
      AND source_v2.photo_id=ph.id AND source_v2.version_id=v.id
      AND source_v2.workspace_id=ph.workspace_id AND source_v2.project_id=ph.project_id
      AND source_v2.album_id=ph.album_id AND source_v2.actor_id=o.user_id
    JOIN upload_sessions source_upload
      ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id)
      AND source_upload.workspace_id=ph.workspace_id
      AND source_upload.project_id=ph.project_id AND source_upload.album_id=ph.album_id
      AND source_upload.actor_id=o.user_id AND source_upload.object_key=original.object_key
    JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded'
    JOIN image_processing_outputs thumbnail_slot
      ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail'
    JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id
      AND thumbnail.object_key=thumbnail_slot.object_key AND thumbnail.version_id=v.id
      AND thumbnail.photo_id=ph.id AND thumbnail.workspace_id=ph.workspace_id
      AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private' AND thumbnail.mime='image/jpeg'
    JOIN image_processing_outputs preview_slot
      ON preview_slot.job_id=job.id AND preview_slot.kind='preview'
    JOIN photo_assets preview ON preview.id=preview_slot.asset_id
      AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id
      AND preview.photo_id=ph.id AND preview.workspace_id=ph.workspace_id
      AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg'
    WHERE c.id=NEW.event_id AND c.guest_id=NEW.guest_id
      AND c.invite_id=NEW.invite_id AND c.session_id=NEW.session_id
      AND c.request_id=NEW.request_id AND c.approval_request_id=NEW.approval_request_id
      AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
      AND c.album_id=NEW.album_id AND c.photo_id=NEW.photo_id
      AND c.version_id=NEW.version_id AND c.head_revision=NEW.head_revision
      AND NEW.event_id=c.id AND NEW.occurred_at_utc=
        strftime('%Y-%m-%dT%H:%M:%fZ',c.created_at_ms/1000.0,'unixepoch')
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND i.expires_at_ms>unixepoch('subsec')*1000
      AND (i.permissions_mask & 1)=1
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked WHERE revoked.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked WHERE revoked.session_id=s.id)
      AND ((v.id=head.version_id) OR (
        (i.permissions_mask & 2048)=2048
        AND (v.version_no=1 OR EXISTS(
          SELECT 1 FROM photo_version_head_commands head_command
          JOIN photo_version_head_results head_result ON head_result.command_id=head_command.id
          WHERE head_command.photo_id=ph.id AND head_command.workspace_id=ph.workspace_id
            AND head_command.project_id=ph.project_id AND head_command.album_id=ph.album_id
            AND head_command.version_id=v.id
            AND json_extract(head_result.result_json,'$.changed')=1
        ))
      ))
      AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL)
        OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_RECEIPT') END;
END;

CREATE TRIGGER version_approval_processing_review_commands_namespace AFTER INSERT ON processing_review_commands
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;

CREATE TRIGGER version_approval_owner_external_intents_namespace AFTER INSERT ON owner_external_intents
WHEN EXISTS(SELECT 1 FROM version_approval_owner_commands c
  WHERE c.actor_id=NEW.actor_id AND c.request_id=lower(NEW.request_id))
BEGIN SELECT RAISE(ABORT,'REQUEST_ID_CONFLICT'); END;
