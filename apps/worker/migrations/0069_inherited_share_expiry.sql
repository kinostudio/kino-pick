-- Inherited expiry is independently authorized per album. Existing rows remain custom.
-- Restore: disable new issuance first; preserve immutable assets, sessions and history, then forward fix.
-- This rebuild requires incoming foreign keys to be NO ACTION; the independent restore must verify legacy rows, schema and sequences.
PRAGMA defer_foreign_keys=ON;

CREATE TABLE kino_guest_invites_0069_copy AS SELECT * FROM guest_invites;

DROP TABLE guest_invites;

CREATE TABLE guest_invites(
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  access_mode TEXT NOT NULL CHECK(access_mode IN('link_only','generated_password','custom_password')),
  password_verifier TEXT,
  permissions_mask INTEGER NOT NULL CHECK(typeof(permissions_mask)='integer' AND permissions_mask BETWEEN 0 AND 4095),
  expires_at_ms INTEGER CHECK(expires_at_ms IS NULL OR typeof(expires_at_ms)='integer'),
  expiry_mode TEXT NOT NULL DEFAULT 'custom' CHECK((expiry_mode='custom' AND expires_at_ms IS NOT NULL) OR (expiry_mode='inherit_album' AND expires_at_ms IS NULL)),
  max_uses INTEGER CHECK(max_uses IS NULL OR (typeof(max_uses)='integer' AND max_uses BETWEEN 1 AND 10000)),
  created_by TEXT NOT NULL REFERENCES users(id),
  owner_session_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL DEFAULT(unixepoch('subsec')*1000),
  FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id),
  UNIQUE(id,workspace_id,project_id),
  CHECK((access_mode='link_only' AND password_verifier IS NULL) OR (access_mode<>'link_only' AND password_verifier IS NOT NULL AND length(password_verifier) BETWEEN 32 AND 1024)),
  CHECK(expires_at_ms>created_at_ms)
);

INSERT INTO guest_invites("id","workspace_id","project_id","token_hash","access_mode","password_verifier","permissions_mask","expires_at_ms","max_uses","created_by","owner_session_id","created_at_ms") SELECT "id","workspace_id","project_id","token_hash","access_mode","password_verifier","permissions_mask","expires_at_ms","max_uses","created_by","owner_session_id","created_at_ms" FROM kino_guest_invites_0069_copy;

DROP TABLE kino_guest_invites_0069_copy;

CREATE INDEX guest_invites_project ON guest_invites(workspace_id,project_id,created_at_ms,id);

CREATE TRIGGER guest_invites_no_delete BEFORE DELETE ON guest_invites BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;

CREATE TRIGGER guest_invites_no_update BEFORE UPDATE ON guest_invites BEGIN SELECT RAISE(ABORT,'IMMUTABLE_GUEST_GRANT'); END;

CREATE TRIGGER guest_password_verifier_guard BEFORE INSERT ON guest_invites BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.created_by AND o.enabled=1 AND s.id=NEW.owner_session_id AND s.expiresAt>unixepoch('subsec')*1000) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.access_mode<>'link_only' AND (
    NEW.password_verifier IS NULL
    OR instr(NEW.password_verifier,char(0))>0
    OR length(NEW.password_verifier)<>length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+97
    OR substr(NEW.password_verifier,1,length('$kino-scrypt$v=1$N=32768,r=8,p=3$'))<>'$kino-scrypt$v=1$N=32768,r=8,p=3$'
    OR substr(NEW.password_verifier,length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+1,32) GLOB '*[^0-9a-f]*'
    OR substr(NEW.password_verifier,length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+33,1)<>'$'
    OR substr(NEW.password_verifier,length('$kino-scrypt$v=1$N=32768,r=8,p=3$')+34,64) GLOB '*[^0-9a-f]*'
  ) THEN RAISE(ABORT,'INVALID_GUEST_PASSWORD_VERIFIER') END;
END;

ALTER TABLE guest_invite_albums ADD COLUMN inherit_generation INTEGER CHECK(inherit_generation IS NULL OR (typeof(inherit_generation)='integer' AND inherit_generation BETWEEN 1 AND 2147483647));

-- An invitation binds only the generation. The projection fingerprint tracks
-- authoritative inputs, so a valid view can extend the same live generation.
CREATE TRIGGER albums_created_at_inherited_expiry_immutable
BEFORE UPDATE OF created_at ON albums WHEN NEW.created_at IS NOT OLD.created_at BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_CREATED_AT');
END;
CREATE TRIGGER albums_inherited_expiry_no_replace
BEFORE INSERT ON albums WHEN EXISTS(SELECT 1 FROM albums a WHERE a.id=NEW.id) BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ALBUM_ID');
END;
CREATE TABLE album_inherited_share_transitions(
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK(source_kind IN('bootstrap','human','policy','activation','issuance')),
  source_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  prior_transition_id TEXT REFERENCES album_inherited_share_transitions(id),
  generation INTEGER NOT NULL CHECK(typeof(generation)='integer' AND generation BETWEEN 1 AND 2147483647),
  phase TEXT NOT NULL CHECK(phase IN('off','finite','closed','unknown','exhausted')),
  expires_at_ms INTEGER,
  inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
  created_at_ms INTEGER NOT NULL DEFAULT(CAST(unixepoch('subsec')*1000 AS INTEGER)),
  FOREIGN KEY(album_id,project_id,workspace_id) REFERENCES albums(id,project_id,workspace_id),
  UNIQUE(source_kind,source_id,album_id),
  CHECK((phase='finite' AND typeof(expires_at_ms)='integer') OR (phase<>'finite' AND expires_at_ms IS NULL))
);
CREATE TABLE album_inherited_share_states(
  album_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(typeof(generation)='integer' AND generation BETWEEN 1 AND 2147483647),
  phase TEXT NOT NULL CHECK(phase IN('off','finite','closed','unknown','exhausted')),
  expires_at_ms INTEGER,
  inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
  last_transition_id TEXT NOT NULL UNIQUE REFERENCES album_inherited_share_transitions(id),
  FOREIGN KEY(album_id,project_id,workspace_id) REFERENCES albums(id,project_id,workspace_id),
  CHECK((phase='finite' AND typeof(expires_at_ms)='integer') OR (phase<>'finite' AND expires_at_ms IS NULL))
);

-- Positive guarded timestamps authorize an inherited deadline. They do not
-- establish the continuous activity coverage required for destructive cleanup.
CREATE INDEX album_activation_commands_expiry_baseline
  ON album_activation_commands(album_id,workspace_id,project_id,created_at_ms);
CREATE VIEW effective_album_inherited_share_expiry AS
WITH raw AS NOT MATERIALIZED (
  SELECT a.id AS album_id,a.workspace_id,a.project_id,
    COALESCE(c.cleanup_allowed,0) AS cleanup_allowed,
    COALESCE(c.inactive_days,90) AS inactive_days,COALESCE(c.revision,0) AS policy_revision,
    c.album_id IS NOT NULL AS policy_verified,
    CAST(unixepoch(a.created_at,'subsec')*1000 AS INTEGER) AS created_at_ms,
    (SELECT max(ac.created_at_ms) FROM album_activation_commands ac
      WHERE ac.album_id=a.id AND ac.workspace_id=a.workspace_id AND ac.project_id=a.project_id) AS published_at_ms,
    h.last_valid_viewed_at_ms AS human_at_ms,h.view_event_id,
    CASE WHEN h.album_id IS NULL THEN NOT EXISTS(SELECT 1 FROM album_human_activity bad WHERE bad.album_id=a.id) ELSE EXISTS(
      SELECT 1 FROM human_photo_views v WHERE v.event_id=h.view_event_id
        AND v.album_id=a.id AND v.workspace_id=a.workspace_id AND v.project_id=a.project_id
        AND v.viewed_at_ms=h.last_valid_viewed_at_ms) END AS frontier_verified,
    CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms
  FROM albums a
  LEFT JOIN album_retention_policy_configurations c ON c.album_id=a.id
    AND c.workspace_id=a.workspace_id AND c.project_id=a.project_id
  LEFT JOIN album_human_activity h ON h.album_id=a.id
    AND h.workspace_id=a.workspace_id AND h.project_id=a.project_id
), inputs AS NOT MATERIALIZED (
  SELECT *,max(COALESCE(created_at_ms,0),COALESCE(published_at_ms,0),COALESCE(human_at_ms,0))
      +inactive_days*86400000 AS deadline_ms,
    CASE WHEN cleanup_allowed=0 THEN json_array(0,inactive_days,policy_revision,policy_verified)
      ELSE json_array(cleanup_allowed,inactive_days,policy_revision,policy_verified,created_at_ms,published_at_ms,human_at_ms,view_event_id,frontier_verified) END AS inputs_json,
    CASE WHEN typeof(created_at_ms)='integer' AND created_at_ms>=0 AND created_at_ms<=now_ms
      AND (published_at_ms IS NULL OR (typeof(published_at_ms)='integer' AND published_at_ms>=0 AND published_at_ms<=now_ms))
      AND (human_at_ms IS NULL OR (typeof(human_at_ms)='integer' AND human_at_ms>=0 AND human_at_ms<=now_ms))
      AND frontier_verified=1 THEN 1 ELSE 0 END AS activity_valid
  FROM raw
)
SELECT album_id,workspace_id,project_id,inputs_json,view_event_id,now_ms,
  created_at_ms,published_at_ms,human_at_ms,policy_verified,
  CASE WHEN policy_verified<>1 OR cleanup_allowed NOT IN(0,1)
      OR typeof(inactive_days)<>'integer' OR inactive_days NOT BETWEEN 1 AND 36500 THEN 'unknown'
    WHEN cleanup_allowed=0 THEN 'off'
    WHEN activity_valid<>1 OR typeof(deadline_ms)<>'integer' OR deadline_ms>8640000000000000 THEN 'unknown'
    WHEN deadline_ms>now_ms THEN 'finite' ELSE 'closed' END AS phase,
  CASE WHEN policy_verified=1 AND cleanup_allowed=1 AND inactive_days BETWEEN 1 AND 36500
      AND activity_valid=1 AND typeof(deadline_ms)='integer'
      AND deadline_ms<=8640000000000000 AND deadline_ms>now_ms THEN deadline_ms END AS expires_at_ms
FROM inputs;

CREATE VIEW next_album_inherited_share_state AS
WITH source AS NOT MATERIALIZED (
  SELECT i.*,s.last_transition_id AS prior_transition_id,s.generation AS old_generation,s.phase AS old_phase,
    CASE WHEN s.phase IN('off','finite')
      AND ((s.phase='finite' AND s.expires_at_ms<=i.now_ms) OR i.phase IN('closed','unknown'))
      THEN 1 ELSE 0 END AS rotate
  FROM effective_album_inherited_share_expiry i
  LEFT JOIN album_inherited_share_states s ON s.album_id=i.album_id
    AND s.workspace_id=i.workspace_id AND s.project_id=i.project_id
)
SELECT album_id,workspace_id,project_id,prior_transition_id,inputs_json,
  CASE WHEN old_generation IS NULL THEN 1
    WHEN rotate=1 AND old_generation<2147483647 THEN old_generation+1 ELSE old_generation END AS generation,
  CASE WHEN old_phase='exhausted' OR (rotate=1 AND old_generation=2147483647)
    THEN 'exhausted' ELSE phase END AS phase,
  CASE WHEN old_phase<>'exhausted' AND NOT(rotate=1 AND old_generation=2147483647)
      OR old_generation IS NULL THEN expires_at_ms END AS expires_at_ms
FROM source;

CREATE TRIGGER album_inherited_transitions_guard
BEFORE INSERT ON album_inherited_share_transitions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM album_inherited_share_transitions t
      WHERE t.id=NEW.id OR (t.source_kind=NEW.source_kind AND t.source_id=NEW.source_id AND t.album_id=NEW.album_id))
    THEN RAISE(ABORT,'IMMUTABLE_INHERITED_SHARE_TRANSITION') END;
  SELECT CASE WHEN NEW.id IS NOT NEW.source_kind||':'||NEW.source_id||':'||NEW.album_id
      OR NEW.created_at_ms IS NOT CAST(unixepoch('subsec')*1000 AS INTEGER)
      OR NOT EXISTS(SELECT 1 FROM next_album_inherited_share_state n
        WHERE n.album_id=NEW.album_id AND n.workspace_id=NEW.workspace_id AND n.project_id=NEW.project_id
          AND n.prior_transition_id IS NEW.prior_transition_id AND n.generation=NEW.generation
          AND n.phase=NEW.phase AND n.expires_at_ms IS NEW.expires_at_ms AND n.inputs_json IS NEW.inputs_json)
    THEN RAISE(ABORT,'INVALID_INHERITED_SHARE_TRANSITION') END;
  SELECT CASE WHEN NOT(
    (NEW.source_kind='bootstrap' AND NEW.source_id=NEW.album_id AND NEW.prior_transition_id IS NULL)
    OR (NEW.source_kind='human' AND EXISTS(SELECT 1 FROM album_human_activity h
      JOIN human_photo_views v ON v.event_id=h.view_event_id AND v.viewed_at_ms=h.last_valid_viewed_at_ms
      WHERE h.album_id=NEW.album_id AND h.workspace_id=NEW.workspace_id AND h.project_id=NEW.project_id
        AND v.album_id=h.album_id AND v.workspace_id=h.workspace_id AND v.project_id=h.project_id
        AND v.event_id=NEW.source_id AND v.viewed_at_ms BETWEEN NEW.created_at_ms-5000 AND NEW.created_at_ms+1000))
    OR (NEW.source_kind='policy' AND EXISTS(SELECT 1 FROM album_retention_policy_configurations c
      JOIN album_retention_policy_commands p ON p.id=c.last_command_id
      WHERE c.album_id=NEW.album_id AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
        AND p.id=NEW.source_id AND p.album_id=c.album_id AND p.workspace_id=c.workspace_id AND p.project_id=c.project_id
        AND p.created_at_ms BETWEEN NEW.created_at_ms-5000 AND NEW.created_at_ms+1000))
    OR (NEW.source_kind='activation' AND EXISTS(SELECT 1 FROM album_activation_commands a
      WHERE a.album_id=NEW.album_id AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
        AND a.actor_id||':'||a.request_id=NEW.source_id
        AND a.created_at_ms BETWEEN NEW.created_at_ms-5000 AND NEW.created_at_ms+1000))
    OR (NEW.source_kind='issuance' AND EXISTS(SELECT 1 FROM invite_creation_commands c
      JOIN projects p ON p.id=c.project_id, json_each(c.payload_json,'$.albumIds') e
      WHERE c.invite_id=NEW.source_id AND c.project_id=NEW.project_id AND p.workspace_id=NEW.workspace_id
        AND e.value=NEW.album_id AND json_extract(c.payload_json,'$.expiryMode')='inherit_album'
        AND c.created_at_ms BETWEEN NEW.created_at_ms-5000 AND NEW.created_at_ms+1000))
  ) THEN RAISE(ABORT,'INHERITED_SHARE_CAUSE_REQUIRED') END;
END;
CREATE TRIGGER album_inherited_transitions_no_update BEFORE UPDATE ON album_inherited_share_transitions BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INHERITED_SHARE_TRANSITION'); END;
CREATE TRIGGER album_inherited_transitions_no_delete BEFORE DELETE ON album_inherited_share_transitions BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INHERITED_SHARE_TRANSITION'); END;
CREATE TRIGGER album_inherited_states_no_delete BEFORE DELETE ON album_inherited_share_states BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INHERITED_SHARE_STATE'); END;
CREATE TRIGGER album_inherited_states_insert_guard BEFORE INSERT ON album_inherited_share_states BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM album_inherited_share_transitions t
    WHERE t.id=NEW.last_transition_id AND t.album_id=NEW.album_id AND t.workspace_id=NEW.workspace_id AND t.project_id=NEW.project_id
      AND t.generation=NEW.generation AND t.phase=NEW.phase AND t.expires_at_ms IS NEW.expires_at_ms AND t.inputs_json IS NEW.inputs_json
      AND t.prior_transition_id IS (SELECT last_transition_id FROM album_inherited_share_states s WHERE s.album_id=NEW.album_id))
    THEN RAISE(ABORT,'INHERITED_SHARE_TRANSITION_REQUIRED') END;
END;
CREATE TRIGGER album_inherited_states_update_guard BEFORE UPDATE ON album_inherited_share_states BEGIN
  SELECT CASE WHEN NEW.album_id IS NOT OLD.album_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.project_id IS NOT OLD.project_id
    OR NEW.last_transition_id IS OLD.last_transition_id
    OR NOT EXISTS(SELECT 1 FROM album_inherited_share_transitions t
      WHERE t.id=NEW.last_transition_id AND t.prior_transition_id IS OLD.last_transition_id
        AND t.album_id=NEW.album_id AND t.workspace_id=NEW.workspace_id AND t.project_id=NEW.project_id
        AND t.generation=NEW.generation AND t.phase=NEW.phase AND t.expires_at_ms IS NEW.expires_at_ms AND t.inputs_json IS NEW.inputs_json)
    THEN RAISE(ABORT,'INHERITED_SHARE_TRANSITION_REQUIRED') END;
END;
CREATE TRIGGER album_inherited_transitions_apply AFTER INSERT ON album_inherited_share_transitions BEGIN
  INSERT INTO album_inherited_share_states(album_id,workspace_id,project_id,generation,phase,expires_at_ms,inputs_json,last_transition_id)
  VALUES(NEW.album_id,NEW.workspace_id,NEW.project_id,NEW.generation,NEW.phase,NEW.expires_at_ms,NEW.inputs_json,NEW.id)
  ON CONFLICT(album_id) DO UPDATE SET generation=excluded.generation,phase=excluded.phase,
    expires_at_ms=excluded.expires_at_ms,inputs_json=excluded.inputs_json,last_transition_id=excluded.last_transition_id;
END;

INSERT INTO album_inherited_share_transitions(id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json)
SELECT 'bootstrap:'||album_id||':'||album_id,'bootstrap',album_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json
FROM next_album_inherited_share_state;

CREATE VIEW effective_guest_invite_album_expiry AS
SELECT i.id AS invite_id,i.workspace_id,i.project_id,ia.album_id,i.expiry_mode,
  CASE WHEN i.expiry_mode='custom' THEN i.expires_at_ms ELSE s.expires_at_ms END AS expires_at_ms,
  CASE WHEN i.expiry_mode='custom' THEN typeof(i.expires_at_ms)='integer' AND i.expires_at_ms>unixepoch('subsec')*1000
    ELSE s.generation=ia.inherit_generation AND EXISTS(
      SELECT 1 FROM effective_album_inherited_share_expiry inputs
      WHERE inputs.album_id=ia.album_id AND inputs.workspace_id=ia.workspace_id AND inputs.project_id=ia.project_id
        AND s.inputs_json IS inputs.inputs_json AND inputs.policy_verified=1
        AND ((s.phase='off' AND json_extract(s.inputs_json,'$[0]')=0 AND s.expires_at_ms IS NULL)
          OR (s.phase='finite' AND json_extract(s.inputs_json,'$[0]')=1
            AND inputs.created_at_ms BETWEEN 0 AND inputs.now_ms
            AND (inputs.published_at_ms IS NULL OR inputs.published_at_ms BETWEEN 0 AND inputs.now_ms)
            AND (inputs.human_at_ms IS NULL OR inputs.human_at_ms BETWEEN 0 AND inputs.now_ms)
            AND typeof(s.expires_at_ms)='integer' AND s.expires_at_ms>unixepoch('subsec')*1000))) END AS expiry_valid
FROM guest_invites i
JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id
LEFT JOIN album_inherited_share_states s ON s.album_id=ia.album_id AND s.workspace_id=ia.workspace_id AND s.project_id=ia.project_id;

-- Existing scoped operation guards use exact per-album effective expiry.
DROP TRIGGER "approved_delivery_publish_guard";

CREATE TRIGGER approved_delivery_publish_guard BEFORE INSERT ON audit_events WHEN NEW.action='delivery.published' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events prior WHERE prior.action='delivery.revoked' AND prior.actor_id=NEW.actor_id AND prior.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events p WHERE p.action=NEW.action AND p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id AND (p.session_id IS NOT NEW.session_id OR p.album_id IS NOT NEW.album_id OR p.photo_id IS NOT NEW.photo_id OR p.version_id IS NOT NEW.version_id OR p.after_json IS NOT NEW.after_json)) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events p WHERE p.action=NEW.action AND p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NEW.actor_type IS NOT 'user' OR NEW.guest_session_id IS NOT NULL OR NEW.before_json IS NOT NULL
 OR length(NEW.event_id) IS NOT 36 OR NEW.event_id GLOB '*[^0-9a-f-]*' OR length(NEW.request_id) IS NOT 36 OR NEW.request_id GLOB '*[^0-9a-f-]*'
 OR NOT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id WHERE o.user_id=NEW.actor_id AND o.enabled=1 AND s.id=NEW.session_id AND s.expiresAt>unixepoch('subsec')*1000)
 THEN RAISE(ABORT,'OWNER_REQUIRED') END;
 SELECT CASE WHEN COALESCE(json_valid(NEW.after_json),0)<>1 THEN RAISE(ABORT,'INVALID_DELIVERY') END;
 SELECT CASE WHEN json_type(NEW.after_json,'$.inviteIds') IS NOT 'array' OR json_array_length(NEW.after_json,'$.inviteIds') NOT BETWEEN 1 AND 24
 OR (SELECT count(DISTINCT value) FROM json_each(NEW.after_json,'$.inviteIds'))<>json_array_length(NEW.after_json,'$.inviteIds')
 OR EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.inviteIds') dest WHERE dest.type<>'text' OR NOT EXISTS(
 SELECT 1 FROM version_approval_request_invites member JOIN guest_invites i ON i.id=member.invite_id JOIN guest_invite_seals seal ON seal.invite_id=i.id JOIN guest_invite_albums ia ON ia.invite_id=i.id
 WHERE member.approval_request_id=json_extract(NEW.after_json,'$.approvalRequestId') AND member.invite_id=dest.value
 AND member.workspace_id=NEW.workspace_id AND member.project_id=NEW.project_id AND member.album_id=NEW.album_id
 AND i.created_by=NEW.actor_id AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id AND ia.album_id=NEW.album_id AND ia.workspace_id=NEW.workspace_id AND ia.project_id=NEW.project_id
 AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1) AND (i.permissions_mask&5)<>0 AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)))
 THEN RAISE(ABORT,'INVALID_DELIVERY_RECIPIENTS') END;
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM approved_delivery_sources src JOIN version_approval_requests ar ON ar.workspace_id=src.workspace_id AND ar.project_id=src.project_id AND ar.album_id=src.album_id AND ar.photo_id=src.photo_id AND ar.version_id=src.version_id
 JOIN version_approval_request_seals sealed ON sealed.approval_request_id=ar.id
 JOIN version_approval_receipts receipt ON receipt.approval_request_id=ar.id AND receipt.event_id=json_extract(NEW.after_json,'$.approvalReceiptId')
 WHERE ar.id=json_extract(NEW.after_json,'$.approvalRequestId') AND ar.owner_id=NEW.actor_id AND src.owner_user_id=NEW.actor_id
 AND src.workspace_id=NEW.workspace_id AND src.project_id=NEW.project_id AND src.album_id=NEW.album_id AND src.photo_id=NEW.photo_id AND src.version_id=NEW.version_id

 AND NEW.after_json IS json_object('approvalRequestId',ar.id,'approvalReceiptId',receipt.event_id,'inviteIds',json(json_extract(NEW.after_json,'$.inviteIds')),'expiresAt',NULL,'item',json_object('photoId',src.photo_id,'versionId',src.version_id,'versionNo',src.version_no,'asset',json_object('id',src.asset_id,'assetKind','original','filename',src.filename,'byteSize',src.byte_size,'mime',src.mime,'checksumSha256',src.checksum_sha256,'verification',json_object('state','verified','verifiedAt',strftime('%Y-%m-%dT%H:%M:%fZ',src.verified_at_ms/1000.0,'unixepoch')))))
 ) THEN RAISE(ABORT,'APPROVED_VERSION_REQUIRED') END;
END;

DROP TRIGGER "client_browse_events_insert_guard";

CREATE TRIGGER client_browse_events_insert_guard
BEFORE INSERT ON client_browse_events BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM client_browse_events prior
    WHERE prior.event_id=NEW.event_id)
    THEN RAISE(ABORT,'IMMUTABLE_CLIENT_BROWSE_EVENT') END;
  SELECT CASE WHEN NEW.viewed_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+1000
    THEN RAISE(ABORT,'CLIENT_ACTIVITY_TIMESTAMP_INVALID') END;
  -- shortcut: cap each invitation session at 120 events per five minutes; upgrade if cross-session abuse control is required.
  SELECT CASE WHEN (SELECT count(*) FROM client_browse_events recent
    WHERE recent.guest_session_id=NEW.guest_session_id
      AND recent.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)-300000)>=120
    THEN RAISE(ABORT,'CLIENT_ACTIVITY_WRITE_LIMIT') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM client_activity_ready_versions ready
    JOIN guest_sessions session ON session.id=NEW.guest_session_id
      AND session.guest_id=NEW.guest_id AND session.invite_id=NEW.invite_id
    JOIN guest_identities guest ON guest.id=session.guest_id
      AND guest.invite_id=session.invite_id
    JOIN guest_invites invite ON invite.id=session.invite_id
    JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
    JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
      AND invite_album.workspace_id=invite.workspace_id
      AND invite_album.project_id=invite.project_id AND invite_album.album_id=NEW.album_id
    JOIN workspaces workspace ON workspace.id=invite.workspace_id
    JOIN owners owner ON owner.user_id=workspace.owner_user_id AND owner.enabled=1
      AND invite.created_by=owner.user_id
    JOIN projects project ON project.id=invite.project_id
      AND project.workspace_id=invite.workspace_id
      AND project.status NOT IN('archived','deleting','deleted')
    JOIN albums album ON album.id=invite_album.album_id
      AND album.workspace_id=invite.workspace_id AND album.project_id=invite.project_id
      AND album.state='active'
    WHERE ready.workspace_id=NEW.workspace_id AND ready.project_id=NEW.project_id
      AND ready.album_id=NEW.album_id AND ready.photo_id=NEW.photo_id
      AND ready.version_id=NEW.version_id AND invite.workspace_id=NEW.workspace_id
      AND invite.project_id=NEW.project_id AND album.id=NEW.album_id
      AND (invite.permissions_mask & 1)=1
      AND (NEW.version_id=ready.head_version_id OR (
        (invite.permissions_mask & 2048)=2048 AND ready.published=1))
      AND session.expires_at_ms>unixepoch('subsec')*1000
      AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=invite.id AND share_expiry.workspace_id=invite.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=invite.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=invite.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
        WHERE revoked.session_id=session.id)
  ) THEN RAISE(ABORT,'CLIENT_ACTIVITY_GUEST_SCOPE_REQUIRED') END;
END;

DROP TRIGGER "guest_annotation_command_guard";

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
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
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
        OR (json_type(NEW.geometry_json) IS 'object'
          AND json_type(NEW.geometry_json,'$.type') IS 'text'
          AND json_extract(NEW.geometry_json,'$.type') IS 'freehand'
          AND json_type(NEW.geometry_json,'$.coordinateSpace') IS 'text'
          AND json_extract(NEW.geometry_json,'$.coordinateSpace') IS 'normalized_1e6'
          AND json_type(NEW.geometry_json,'$.version') IS 'integer'
          AND json_extract(NEW.geometry_json,'$.version')=1
          AND json_type(NEW.geometry_json,'$.points') IS 'array'
          AND (SELECT count(*) FROM json_each(NEW.geometry_json))=4
          AND json_array_length(NEW.geometry_json,'$.points') BETWEEN 2 AND 256
          AND length(CAST(NEW.geometry_json AS BLOB))<=8192
          AND NOT EXISTS (
            SELECT 1 FROM json_each(NEW.geometry_json,'$.points') AS point
            WHERE point.type IS NOT 'object'
              OR (SELECT count(*) FROM json_each(point.value))<>2
              OR json_type(point.value,'$.x') IS NOT 'integer'
              OR json_type(point.value,'$.y') IS NOT 'integer'
              OR COALESCE(json_extract(point.value,'$.x'),-1) NOT BETWEEN 0 AND 1000000
              OR COALESCE(json_extract(point.value,'$.y'),-1) NOT BETWEEN 0 AND 1000000
              OR point.value<>json_object('x',json_extract(point.value,'$.x'),
                'y',json_extract(point.value,'$.y'))
            )
          AND NOT EXISTS (
            SELECT 1
            FROM json_each(NEW.geometry_json,'$.points') AS next_point
            JOIN json_each(NEW.geometry_json,'$.points') AS previous_point
              ON CAST(previous_point.key AS INTEGER)=CAST(next_point.key AS INTEGER)-1
            WHERE json_extract(previous_point.value,'$.x')=json_extract(next_point.value,'$.x')
              AND json_extract(previous_point.value,'$.y')=json_extract(next_point.value,'$.y')
          )
          AND NEW.geometry_json=json_object('type','freehand',
              'coordinateSpace','normalized_1e6','version',1,
              'points',json(json_extract(NEW.geometry_json,'$.points')))
        )
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

DROP TRIGGER "guest_comment_command_guard";

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
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
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

DROP TRIGGER "guest_download_ip_sidecars_insert_guard";

CREATE TRIGGER guest_download_ip_sidecars_insert_guard
BEFORE INSERT ON guest_download_ip_sidecars BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_download_ip_sidecars prior
    WHERE prior.request_id=NEW.request_id OR prior.audit_event_id=NEW.audit_event_id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_DOWNLOAD_IP') END;
  SELECT CASE WHEN NEW.recorded_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.recorded_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+1000
    THEN RAISE(ABORT,'CLIENT_ACTIVITY_TIMESTAMP_INVALID') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM audit_events requested
    JOIN guest_sessions session ON session.id=requested.guest_session_id
      AND session.guest_id=requested.actor_id
    JOIN guest_identities guest ON guest.id=session.guest_id
      AND guest.invite_id=session.invite_id
    JOIN guest_invites invite ON invite.id=session.invite_id
    JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
    JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
      AND invite_album.workspace_id=invite.workspace_id
      AND invite_album.project_id=invite.project_id AND invite_album.album_id=NEW.album_id
    JOIN workspaces workspace ON workspace.id=invite.workspace_id
    JOIN owners owner ON owner.user_id=workspace.owner_user_id AND owner.enabled=1
      AND invite.created_by=owner.user_id
    JOIN projects project ON project.id=requested.project_id
      AND project.workspace_id=requested.workspace_id
      AND project.workspace_id=invite.workspace_id AND project.id=invite.project_id
      AND project.status NOT IN('archived','deleting','deleted')
    JOIN albums album ON album.id=requested.album_id
      AND album.workspace_id=requested.workspace_id
      AND album.project_id=requested.project_id AND album.state='active'
    WHERE requested.event_id=NEW.audit_event_id
      AND requested.request_id=NEW.request_id
      AND requested.action='download.requested'
      AND requested.actor_type='guest' AND requested.actor_id=NEW.guest_id
      AND requested.guest_session_id=NEW.guest_session_id
      AND requested.workspace_id=NEW.workspace_id AND requested.project_id=NEW.project_id
      AND requested.album_id=NEW.album_id AND requested.photo_id=NEW.photo_id
      AND requested.version_id=NEW.version_id AND requested.session_id IS NULL
      AND requested.before_json IS NULL AND invite.id=NEW.invite_id
      AND session.invite_id=NEW.invite_id AND session.id=NEW.guest_session_id
      AND session.expires_at_ms>unixepoch('subsec')*1000
      AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=invite.id AND share_expiry.workspace_id=invite.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=invite.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=invite.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
        WHERE revoked.session_id=session.id)
      AND ((json_extract(requested.after_json,'$.assetKind')='preview'
          AND (invite.permissions_mask & 2)=2)
        OR (json_extract(requested.after_json,'$.assetKind')='original'
          AND (invite.permissions_mask & 4)=4))
  ) THEN RAISE(ABORT,'GUEST_DOWNLOAD_IP_AUDIT_REQUIRED') END;
END;

DROP TRIGGER "guest_exchange_command_apply";

CREATE TRIGGER guest_exchange_command_apply AFTER INSERT ON guest_exchange_commands BEGIN
  INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms)
  SELECT NEW.session_id,NEW.invite_id,NEW.guest_id,NEW.session_secret_hash,
    min(CAST(unixepoch('subsec')*1000 AS INTEGER)+86400000,
  (SELECT CASE WHEN sum(CASE WHEN share_expiry.expires_at_ms IS NULL THEN 1 ELSE 0 END)>0
      THEN CAST(unixepoch('subsec')*1000 AS INTEGER)+86400000 ELSE max(share_expiry.expires_at_ms) END
    FROM effective_guest_invite_album_expiry share_expiry
  JOIN albums expiry_album ON expiry_album.id=share_expiry.album_id AND expiry_album.workspace_id=share_expiry.workspace_id
    AND expiry_album.project_id=share_expiry.project_id AND expiry_album.state='active' WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id
      AND share_expiry.project_id=i.project_id AND share_expiry.expiry_valid=1))
  FROM guest_invites i WHERE i.id=NEW.invite_id;
END;

DROP TRIGGER "guest_exchange_command_guard";

CREATE TRIGGER guest_exchange_command_guard BEFORE INSERT ON guest_exchange_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status<>'archived'
    JOIN guest_identities g ON g.id=NEW.guest_id AND g.invite_id=i.id
    WHERE i.id=NEW.invite_id AND i.token_hash=NEW.invite_token_hash AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry
  JOIN albums expiry_album ON expiry_album.id=share_expiry.album_id AND expiry_album.workspace_id=share_expiry.workspace_id
    AND expiry_album.project_id=share_expiry.project_id AND expiry_album.state='active' WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
      AND (i.max_uses IS NULL OR (SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id)<i.max_uses)
      AND ((i.access_mode='link_only' AND NEW.kdf_permit_id IS NULL)
        OR (i.access_mode IN('generated_password','custom_password') AND NEW.kdf_permit_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM guest_kdf_permits gp JOIN guest_kdf_permit_releases gr ON gr.permit_id=gp.id WHERE gp.id=NEW.kdf_permit_id AND gp.invite_id=i.id)))
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c JOIN guest_sessions s ON s.id=c.session_id WHERE s.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_GUEST_EXCHANGE_TIME') END;
END;

DROP TRIGGER "guest_feedback_command_guard";

CREATE TRIGGER guest_feedback_command_guard BEFORE INSERT ON guest_feedback_commands BEGIN
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
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=i.workspace_id
      AND ph.project_id=i.project_id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=ph.workspace_id
      AND v.photo_id=ph.id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id
      AND s.invite_id=NEW.invite_id AND s.secret_hash=NEW.secret_hash
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND ((NEW.kind='rating' AND (i.permissions_mask & 16)=16)
        OR (NEW.kind='favorite' AND (i.permissions_mask & 32)=32))
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c
      WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c
      WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id
        OR c.kind<>NEW.kind OR c.value_integer IS NOT NEW.value_integer
        OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_feedback_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;
END;

CREATE TRIGGER guest_invite_audit AFTER INSERT ON guest_invites BEGIN
  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,action,after_json,request_id)
  VALUES('guest-invite:'||NEW.id,'user',NEW.created_by,NEW.owner_session_id,NEW.workspace_id,NEW.project_id,'share.created',json_object('inviteId',NEW.id,'accessMode',NEW.access_mode,'permissionsMask',NEW.permissions_mask,'expiresAtMs',NEW.expires_at_ms,'maxUses',NEW.max_uses,'expiryMode',NEW.expiry_mode),COALESCE((SELECT request_id FROM invite_creation_commands WHERE invite_id=NEW.id),'guest-invite:'||NEW.id));
END;

CREATE TRIGGER guest_invite_insert_guard BEFORE INSERT ON guest_invites BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM workspaces w JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=NEW.owner_session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN projects p ON p.workspace_id=w.id AND p.id=NEW.project_id AND p.status<>'archived'
    WHERE w.id=NEW.workspace_id AND w.owner_user_id=NEW.created_by
  ) THEN RAISE(ABORT,'OWNER_REQUIRED') END;
  SELECT CASE WHEN NEW.expiry_mode IS NOT 'custom' AND NEW.expiry_mode IS NOT 'inherit_album' THEN RAISE(ABORT,'INVALID_INVITE_EXPIRY') END;
  SELECT CASE WHEN NEW.expiry_mode='custom' AND (typeof(NEW.expires_at_ms) IS NOT 'integer' OR NEW.expires_at_ms<=unixepoch('subsec')*1000) THEN RAISE(ABORT,'INVITE_EXPIRED') END;
  SELECT CASE WHEN NEW.expiry_mode='inherit_album' AND NEW.expires_at_ms IS NOT NULL THEN RAISE(ABORT,'INVALID_INVITE_EXPIRY') END;
END;

DROP TRIGGER "guest_invite_seal_guard";

CREATE TRIGGER guest_invite_seal_guard BEFORE INSERT ON guest_invite_seals BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=i.owner_session_id AND s.expiresAt>unixepoch('subsec')*1000
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status<>'archived'
    WHERE i.id=NEW.invite_id AND i.created_by=o.user_id AND (EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry
  JOIN albums expiry_album ON expiry_album.id=share_expiry.album_id AND expiry_album.workspace_id=share_expiry.workspace_id
    AND expiry_album.project_id=share_expiry.project_id AND expiry_album.state='active' WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.expiry_valid=1) AND NOT EXISTS(SELECT 1 FROM guest_invite_albums expiry_member WHERE expiry_member.invite_id=i.id AND expiry_member.workspace_id=i.workspace_id AND expiry_member.project_id=i.project_id AND NOT EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry_member WHERE share_expiry_member.invite_id=i.id AND share_expiry_member.workspace_id=i.workspace_id AND share_expiry_member.workspace_id=expiry_member.workspace_id AND share_expiry_member.project_id=i.project_id AND share_expiry_member.project_id=expiry_member.project_id AND share_expiry_member.album_id=expiry_member.album_id AND share_expiry_member.expiry_valid=1)))
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
  ) THEN RAISE(ABORT,'GUEST_SCOPE_NOT_READY') END;
END;

DROP TRIGGER "guest_kdf_permit_guard";

CREATE TRIGGER guest_kdf_permit_guard BEFORE INSERT ON guest_kdf_permits BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status<>'archived'
    WHERE i.id=NEW.invite_id AND i.access_mode<>'link_only' AND i.password_verifier IS NOT NULL AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry
  JOIN albums expiry_album ON expiry_album.id=share_expiry.album_id AND expiry_album.workspace_id=share_expiry.workspace_id
    AND expiry_album.project_id=share_expiry.project_id AND expiry_album.state='active' WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
      AND (i.max_uses IS NULL OR (SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id)<i.max_uses)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM kdf_active_slot WHERE slot=1) OR EXISTS(SELECT 1 FROM guest_kdf_active_slot WHERE slot=1) THEN RAISE(ABORT,'KDF_CAPACITY_UNAVAILABLE') END;
END;

DROP TRIGGER "guest_media_download_audit_guard";

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
  -- Keep the same conjunct outside the deep asset/version joins for D1's expression-depth limit.
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry checked_expiry
    JOIN guest_sessions checked_session ON checked_session.id=NEW.guest_session_id AND checked_session.invite_id=checked_expiry.invite_id
    WHERE checked_expiry.workspace_id=NEW.workspace_id AND checked_expiry.project_id=NEW.project_id
      AND checked_expiry.album_id=NEW.album_id AND checked_expiry.expiry_valid=1

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

DROP TRIGGER "guest_selection_command_guard";

CREATE TRIGGER guest_selection_command_guard BEFORE INSERT ON guest_selection_commands BEGIN
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
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=i.workspace_id AND ph.project_id=i.project_id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=ph.workspace_id AND v.photo_id=ph.id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id AND s.secret_hash=NEW.secret_hash
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND (i.permissions_mask & 8)=8
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c JOIN guest_sessions s ON s.id=c.session_id WHERE s.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id OR c.version_id<>NEW.version_id OR c.selected<>NEW.selected OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_round_state r WHERE r.invite_id=NEW.invite_id AND r.guest_id=NEW.guest_id AND r.album_id=NEW.album_id AND r.status='submitted')
    THEN RAISE(ABORT,'SELECTION_ALREADY_SUBMITTED') END;
END;

DROP TRIGGER "guest_selection_submission_guard";

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
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
    AND (c.invite_id<>NEW.invite_id OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id OR c.round_no<>NEW.round_no OR c.selection_revision<>NEW.selection_revision OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
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

DROP TRIGGER "guest_session_insert_guard";

CREATE TRIGGER guest_session_insert_guard BEFORE INSERT ON guest_sessions BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
    JOIN workspaces w ON w.id=i.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    WHERE i.id=NEW.invite_id AND ((i.expiry_mode='custom' AND i.expires_at_ms>unixepoch('subsec')*1000 AND NEW.expires_at_ms<=i.expires_at_ms AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry
  JOIN albums expiry_album ON expiry_album.id=share_expiry.album_id AND expiry_album.workspace_id=share_expiry.workspace_id
    AND expiry_album.project_id=share_expiry.project_id AND expiry_album.state='active' WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.expiry_valid=1))
        OR (i.expiry_mode='inherit_album' AND i.expires_at_ms IS NULL AND NEW.expires_at_ms<=min(CAST(unixepoch('subsec')*1000 AS INTEGER)+86400000,
  (SELECT CASE WHEN sum(CASE WHEN share_expiry.expires_at_ms IS NULL THEN 1 ELSE 0 END)>0
      THEN CAST(unixepoch('subsec')*1000 AS INTEGER)+86400000 ELSE max(share_expiry.expires_at_ms) END
    FROM effective_guest_invite_album_expiry share_expiry
  JOIN albums expiry_album ON expiry_album.id=share_expiry.album_id AND expiry_album.workspace_id=share_expiry.workspace_id
    AND expiry_album.project_id=share_expiry.project_id AND expiry_album.state='active' WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id
      AND share_expiry.project_id=i.project_id AND share_expiry.expiry_valid=1)) AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry
  JOIN albums expiry_album ON expiry_album.id=share_expiry.album_id AND expiry_album.workspace_id=share_expiry.workspace_id
    AND expiry_album.project_id=share_expiry.project_id AND expiry_album.state='active' WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.expiry_valid=1))) AND p.status<>'archived'
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id)
      AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
      AND (i.max_uses IS NULL OR (SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id)<i.max_uses)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000 OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    OR NEW.expires_at_ms<=unixepoch('subsec')*1000 OR NEW.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+86400000 THEN RAISE(ABORT,'INVALID_GUEST_SESSION_TIME') END;
END;

DROP TRIGGER "guest_tag_command_guard";

CREATE TRIGGER guest_tag_command_guard BEFORE INSERT ON guest_tag_commands BEGIN
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
    JOIN photos ph ON ph.id=NEW.photo_id AND ph.workspace_id=i.workspace_id
      AND ph.project_id=i.project_id AND ph.album_id=a.id
    JOIN photo_versions v ON v.id=NEW.version_id AND v.workspace_id=ph.workspace_id
      AND v.photo_id=ph.id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id
      AND s.invite_id=NEW.invite_id AND s.secret_hash=NEW.secret_hash
      AND g.id=NEW.expected_guest_id AND NEW.expected_guest_id=NEW.guest_id
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND (i.permissions_mask & 64)=64
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;

  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000
    THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;

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
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id
        OR c.workspace_id<>NEW.workspace_id OR c.project_id<>NEW.project_id
        OR c.album_id<>NEW.album_id OR c.photo_id<>NEW.photo_id
        OR c.version_id<>NEW.version_id OR c.label<>NEW.label
        OR c.present<>NEW.present OR c.payload_json<>NEW.payload_json)
  ) THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;

  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM guest_tag_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
  ) THEN RAISE(IGNORE) END;

  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_tag_commands c WHERE c.id=NEW.id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_TAG_COMMAND') END;

  SELECT CASE WHEN NEW.present=1
    AND NOT EXISTS(
      SELECT 1 FROM guest_tag_labels l
      JOIN guest_tag_state st ON st.tag_id=l.tag_id
      WHERE l.workspace_id=NEW.workspace_id AND l.project_id=NEW.project_id
        AND l.label=NEW.label COLLATE BINARY
        AND st.invite_id=NEW.invite_id AND st.guest_id=NEW.guest_id
        AND st.photo_id=NEW.photo_id AND st.present=1
    )
    AND (SELECT count(*) FROM guest_tag_state st
      WHERE st.invite_id=NEW.invite_id AND st.guest_id=NEW.guest_id
        AND st.photo_id=NEW.photo_id AND st.present=1)>=20
    THEN RAISE(ABORT,'TAG_LIMIT_REACHED') END;
END;

DROP TRIGGER "human_photo_view_insert_guard";

CREATE TRIGGER human_photo_view_insert_guard BEFORE INSERT ON human_photo_views BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM human_photo_views prior
    WHERE prior.event_id=NEW.event_id OR prior.request_id=NEW.request_id)
    THEN RAISE(ABORT,'IMMUTABLE_HUMAN_PHOTO_VIEW') END;
  SELECT CASE WHEN NEW.viewed_at_ms<CAST(unixepoch('subsec')*1000 AS INTEGER)-5000
    OR NEW.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)
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
  -- Keep the same conjunct outside the deep asset/version joins for D1's expression-depth limit.
  SELECT CASE WHEN NEW.actor_type='guest' AND NOT EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry checked_expiry
    JOIN guest_sessions checked_session ON checked_session.id=NEW.authorization_session_id AND checked_session.invite_id=checked_expiry.invite_id
    WHERE checked_expiry.workspace_id=NEW.workspace_id AND checked_expiry.project_id=NEW.project_id
      AND checked_expiry.album_id=NEW.album_id AND checked_expiry.expiry_valid=1

  ) THEN RAISE(ABORT,'HUMAN_VIEW_NOT_AUTHORIZED') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM human_photo_views prior
    WHERE prior.authorization_session_id=NEW.authorization_session_id
      AND prior.actor_type=NEW.actor_type AND prior.actor_id=NEW.actor_id
      AND prior.album_id=NEW.album_id
      AND prior.viewed_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)-300000
  ) THEN RAISE(ABORT,'HUMAN_VIEW_RATE_LIMITED') END;
END;

DROP TRIGGER "shared_review_guest_command_guard";

CREATE TRIGGER shared_review_guest_command_guard BEFORE INSERT ON shared_review_guest_commands BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
      AND a.project_id=i.project_id AND a.state='active'
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN shared_reviews r ON r.id=NEW.review_id AND r.workspace_id=i.workspace_id
      AND r.project_id=i.project_id AND r.album_id=a.id
    JOIN shared_review_seals review_seal ON review_seal.review_id=r.id
      AND review_seal.workspace_id=r.workspace_id AND review_seal.project_id=r.project_id
      AND review_seal.album_id=r.album_id
    JOIN shared_review_invites member ON member.review_id=r.id AND member.invite_id=i.id
      AND member.workspace_id=i.workspace_id AND member.project_id=i.project_id AND member.album_id=a.id
    WHERE s.id=NEW.session_id AND s.guest_id=NEW.guest_id AND s.invite_id=NEW.invite_id
      AND NEW.expected_guest_id=NEW.guest_id AND json_extract(NEW.payload_json,'$.expectedGuestId')=NEW.expected_guest_id
      AND s.secret_hash=NEW.secret_hash AND i.workspace_id=NEW.workspace_id
      AND i.project_id=NEW.project_id AND a.id=NEW.album_id
      AND ((NEW.action='set' AND (i.permissions_mask & 8)=8)
        OR (NEW.action='submit' AND (i.permissions_mask & 512)=512))
      AND s.expires_at_ms>unixepoch('subsec')*1000 AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
  ) THEN RAISE(ABORT,'GUEST_ACCESS_REQUIRED') END;
  SELECT CASE WHEN NEW.created_at_ms<unixepoch('subsec')*1000-60000
    OR NEW.created_at_ms>unixepoch('subsec')*1000+1000 THEN RAISE(ABORT,'INVALID_TIMESTAMP') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_selection_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_selection_submissions c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_feedback_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_logout_commands c WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id)
    OR EXISTS(SELECT 1 FROM guest_exchange_commands c WHERE c.invite_id=NEW.invite_id AND c.request_id=NEW.request_id)
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id
      AND (c.invite_id<>NEW.invite_id OR c.session_id<>NEW.session_id
        OR c.secret_hash<>NEW.secret_hash OR c.expected_guest_id<>NEW.expected_guest_id OR c.workspace_id<>NEW.workspace_id
        OR c.project_id<>NEW.project_id OR c.album_id<>NEW.album_id
        OR c.review_id<>NEW.review_id OR c.round_no<>NEW.round_no
        OR c.action<>NEW.action OR c.photo_id IS NOT NEW.photo_id
        OR c.version_id IS NOT NEW.version_id OR c.selected IS NOT NEW.selected
        OR c.expected_revision IS NOT NEW.expected_revision OR c.payload_json<>NEW.payload_json))
    THEN RAISE(ABORT,'REQUEST_ID_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_guest_commands c
    WHERE c.guest_id=NEW.guest_id AND c.request_id=NEW.request_id) THEN RAISE(IGNORE) END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shared_review_rounds rd
    WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no AND rd.status='open'
      AND rd.round_no=(SELECT max(x.round_no) FROM shared_review_rounds x WHERE x.review_id=NEW.review_id))
    THEN RAISE(ABORT,'SHARED_ROUND_CONFLICT') END;
  SELECT CASE WHEN NEW.action='set' AND NOT EXISTS(
    SELECT 1 FROM photos ph JOIN photo_versions v ON v.id=NEW.version_id
      AND v.workspace_id=ph.workspace_id AND v.photo_id=ph.id
    WHERE ph.id=NEW.photo_id AND ph.workspace_id=NEW.workspace_id
      AND ph.project_id=NEW.project_id AND ph.album_id=NEW.album_id)
    THEN RAISE(ABORT,'INVALID_INPUT') END;
  SELECT CASE WHEN NEW.action='set' AND NEW.selected=1 AND NOT EXISTS(
      SELECT 1 FROM shared_review_state st WHERE st.review_id=NEW.review_id
        AND st.photo_id=NEW.photo_id AND st.selected=1)
    AND EXISTS(SELECT 1 FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id
      AND rd.round_no=NEW.round_no AND rd.maximum IS NOT NULL
      AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1)>=rd.maximum)
    THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
  SELECT CASE WHEN NEW.action='submit' AND NEW.expected_revision<>
      (SELECT rd.revision FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no)
    THEN RAISE(ABORT,'SELECTION_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.action='submit' AND (SELECT count(*) FROM shared_review_state st
      WHERE st.review_id=NEW.review_id AND st.selected=1)=0
    THEN RAISE(ABORT,'EMPTY_SELECTION') END;
  SELECT CASE WHEN NEW.action='submit' AND (SELECT count(*) FROM shared_review_state st
      WHERE st.review_id=NEW.review_id AND st.selected=1)<>
      (SELECT rd.minimum FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no)
    AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1)<
      (SELECT rd.minimum FROM shared_review_rounds rd WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no)
    THEN RAISE(ABORT,'SELECTION_MINIMUM_NOT_MET') END;
  SELECT CASE WHEN NEW.action='submit' AND EXISTS(SELECT 1 FROM shared_review_rounds rd
      WHERE rd.review_id=NEW.review_id AND rd.round_no=NEW.round_no AND rd.maximum IS NOT NULL
        AND (SELECT count(*) FROM shared_review_state st WHERE st.review_id=NEW.review_id AND st.selected=1)>rd.maximum)
    THEN RAISE(ABORT,'SELECTION_LIMIT_REACHED') END;
END;

DROP TRIGGER "shared_review_invites_insert_guard";

CREATE TRIGGER shared_review_invites_insert_guard BEFORE INSERT ON shared_review_invites BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shared_review_seals s WHERE s.review_id=NEW.review_id)
    THEN RAISE(ABORT,'IMMUTABLE_SHARED_REVIEW_MEMBERSHIP') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shared_reviews r JOIN shared_review_owner_commands c ON c.id=r.created_command_id
    JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
    JOIN guest_invite_seals isea ON isea.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
    JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
    JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
    WHERE r.id=NEW.review_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
      AND r.album_id=NEW.album_id AND c.action='create'
      AND EXISTS(SELECT 1 FROM json_each(c.invite_ids_json) j WHERE j.value=NEW.invite_id)
      AND i.created_by=o.user_id AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
      AND (i.permissions_mask & 520)<>0
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
  ) THEN RAISE(ABORT,'INVALID_SHARED_REVIEW_MEMBER') END;
END;

DROP TRIGGER "shared_review_owner_command_guard";

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
        AND i.created_by=NEW.actor_id AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
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

DROP TRIGGER "version_approval_guest_command_guard";

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
      AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
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

DROP TRIGGER "version_approval_owner_command_guard";

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
            AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=invite.id AND share_expiry.workspace_id=invite.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=invite.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1)
            AND (invite.permissions_mask & 1)=1
            AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
              WHERE revoked.invite_id=invite.id)
        )
      )
    THEN RAISE(ABORT,'VERSION_APPROVAL_INVALID_INVITES') END;
END;

DROP TRIGGER "version_approval_receipt_insert_guard";

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
  -- Keep the same conjunct outside the deep asset/version joins for D1's expression-depth limit.
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry checked_expiry
    JOIN guest_sessions checked_session ON checked_session.id=NEW.session_id AND checked_session.invite_id=checked_expiry.invite_id
    WHERE checked_expiry.workspace_id=NEW.workspace_id AND checked_expiry.project_id=NEW.project_id
      AND checked_expiry.album_id=NEW.album_id AND checked_expiry.expiry_valid=1
      AND checked_expiry.invite_id=NEW.invite_id
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_RECEIPT') END;
END;

DROP TRIGGER "version_approval_request_invite_insert_guard";

CREATE TRIGGER version_approval_request_invite_insert_guard
BEFORE INSERT ON version_approval_request_invites BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM version_approval_request_invites m
    WHERE m.approval_request_id=NEW.approval_request_id AND m.invite_id=NEW.invite_id
  ) OR EXISTS(
    SELECT 1 FROM version_approval_request_seals s WHERE s.approval_request_id=NEW.approval_request_id
  ) THEN RAISE(ABORT,'IMMUTABLE_VERSION_APPROVAL_MEMBERSHIP') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM version_approval_requests r
    JOIN version_approval_owner_commands c ON c.id=r.created_command_id
    JOIN guest_invites i ON i.id=NEW.invite_id AND i.workspace_id=NEW.workspace_id
      AND i.project_id=NEW.project_id AND i.created_by=r.owner_id
    JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id
    JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
      AND ia.project_id=i.project_id AND ia.album_id=NEW.album_id
    WHERE r.id=NEW.approval_request_id AND r.workspace_id=NEW.workspace_id
      AND r.project_id=NEW.project_id AND r.album_id=NEW.album_id
      AND EXISTS(SELECT 1 FROM json_each(c.invite_ids_json) member
        WHERE member.type='text' AND member.value=NEW.invite_id)
      AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=NEW.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=NEW.project_id AND share_expiry.album_id=NEW.album_id AND share_expiry.expiry_valid=1) AND (i.permissions_mask & 1)=1
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
        WHERE revoked.invite_id=i.id)
  ) THEN RAISE(ABORT,'INVALID_VERSION_APPROVAL_MEMBER') END;
END;

DROP VIEW "approved_delivery_live_guests";

CREATE VIEW approved_delivery_live_guests AS
SELECT d.event_id AS delivery_id,d.workspace_id,d.project_id,d.album_id,d.photo_id,d.version_id,d.after_json,
 s.id AS guest_session_id,s.secret_hash,g.id AS guest_id,i.id AS invite_id,i.permissions_mask,
 CASE WHEN share_expiry.expires_at_ms IS NULL THEN s.expires_at_ms ELSE min(s.expires_at_ms,share_expiry.expires_at_ms) END AS expires_at_ms,src.asset_id,src.storage_node_id,src.object_key,
 src.filename,src.byte_size,src.mime,src.checksum_sha256
FROM audit_events d
JOIN json_each(CASE WHEN d.action='delivery.published' AND json_valid(d.after_json) THEN d.after_json ELSE '{}' END,'$.inviteIds') member
JOIN guest_invites i ON i.id=member.value AND i.workspace_id=d.workspace_id AND i.project_id=d.project_id
JOIN guest_invite_seals seal ON seal.invite_id=i.id
JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.album_id=d.album_id AND ia.workspace_id=d.workspace_id AND ia.project_id=d.project_id
JOIN effective_guest_invite_album_expiry share_expiry ON share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=d.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=d.project_id AND share_expiry.album_id=d.album_id AND share_expiry.expiry_valid=1
JOIN guest_sessions s ON s.invite_id=i.id
JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=i.id
JOIN approved_delivery_sources src ON src.workspace_id=d.workspace_id AND src.project_id=d.project_id AND src.album_id=d.album_id AND src.photo_id=d.photo_id AND src.version_id=d.version_id AND src.asset_id=json_extract(d.after_json,'$.item.asset.id') AND src.owner_user_id=d.actor_id AND src.filename=json_extract(d.after_json,'$.item.asset.filename') AND src.byte_size=json_extract(d.after_json,'$.item.asset.byteSize') AND src.mime=json_extract(d.after_json,'$.item.asset.mime') AND src.checksum_sha256=json_extract(d.after_json,'$.item.asset.checksumSha256')
WHERE d.action='delivery.published' AND (i.permissions_mask&5)<>0
 AND s.expires_at_ms>unixepoch('subsec')*1000
 AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
 AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM audit_events r WHERE r.action='delivery.revoked' AND json_extract(r.after_json,'$.deliveryId')=d.event_id);

DROP VIEW "manual_album_deletion_blockers";

CREATE VIEW manual_album_deletion_blockers AS
  SELECT a.id AS album_id,'DELETE_PROTECTED' AS blocker FROM albums a
    WHERE a.is_pinned=1 OR a.legal_hold=1 OR EXISTS(SELECT 1 FROM photo_pin_states pin WHERE pin.album_id=a.id AND pin.is_pinned=1)
  UNION ALL SELECT a.id,'DELETE_CONTENT_BUSY' FROM albums a JOIN projects p ON p.id=a.project_id
    WHERE p.status NOT IN('draft','uploading','delivered','archived')
      OR EXISTS(SELECT 1 FROM pending_upload_storage_reservations r WHERE r.album_id=a.id)
      OR EXISTS(SELECT 1 FROM upload_sessions u JOIN upload_authorizations grant_row ON grant_row.upload_session_id=u.id
        WHERE u.album_id=a.id AND grant_row.expires_at_ms>unixepoch('subsec')*1000)
      OR EXISTS(SELECT 1 FROM image_processing_jobs j JOIN photo_assets asset ON asset.id=j.id JOIN photos photo ON photo.id=asset.photo_id
        WHERE photo.album_id=a.id AND (j.status<>'succeeded' OR j.reserved_bytes<>0))
  UNION ALL SELECT a.id,'DELETE_ACTIVE_REVIEW' FROM albums a WHERE EXISTS(
    SELECT 1 FROM guest_invite_albums ia JOIN guest_invites i ON i.id=ia.invite_id JOIN guest_sessions s ON s.invite_id=i.id
    WHERE ia.album_id=a.id AND ia.workspace_id=a.workspace_id AND ia.project_id=a.project_id AND EXISTS(SELECT 1 FROM effective_guest_invite_album_expiry share_expiry WHERE share_expiry.invite_id=i.id AND share_expiry.workspace_id=i.workspace_id AND share_expiry.workspace_id=a.workspace_id AND share_expiry.project_id=i.project_id AND share_expiry.project_id=a.project_id AND share_expiry.album_id=a.id AND share_expiry.expiry_valid=1) AND s.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
  ) OR EXISTS(SELECT 1 FROM album_human_activity h WHERE h.album_id=a.id AND h.last_valid_viewed_at_ms>unixepoch('subsec')*1000-900000)
  UNION ALL SELECT a.id,'DELETE_SHARED_REFERENCE' FROM albums a WHERE EXISTS(
    SELECT 1 FROM photo_versions child JOIN photo_versions parent ON parent.id=child.parent_version_id
    JOIN photos cp ON cp.id=child.photo_id JOIN photos pp ON pp.id=parent.photo_id
    WHERE (cp.album_id=a.id OR pp.album_id=a.id) AND cp.album_id<>pp.album_id
  ) OR EXISTS(SELECT 1 FROM version_approval_requests r WHERE r.album_id=a.id);

DROP TRIGGER "invite_creation_command_guard";

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
  SELECT CASE WHEN NOT (
    (json_type(NEW.payload_json,'$.expiryMode') IS NULL
      AND json_type(NEW.payload_json,'$.expiresAtMs') IS 'integer'
      AND json_extract(NEW.payload_json,'$.expiresAtMs')>unixepoch('subsec')*1000
      AND json_extract(NEW.payload_json,'$.expiresAtMs')<=unixepoch('subsec')*1000+31536000000
      AND NEW.payload_json IS json_object('projectId',NEW.project_id,'albumIds',json(json_extract(NEW.payload_json,'$.albumIds')),'accessMode',json_extract(NEW.payload_json,'$.accessMode'),'permissionsMask',json_extract(NEW.payload_json,'$.permissionsMask'),'expiresAtMs',json_extract(NEW.payload_json,'$.expiresAtMs'),'maxUses',json_extract(NEW.payload_json,'$.maxUses')))
    OR (json_type(NEW.payload_json,'$.expiryMode') IS 'text'
      AND json_extract(NEW.payload_json,'$.expiryMode') IS 'inherit_album'
      AND json_type(NEW.payload_json,'$.expiresAtMs') IS 'null'
      AND NEW.payload_json IS json_object('projectId',NEW.project_id,'albumIds',json(json_extract(NEW.payload_json,'$.albumIds')),'accessMode',json_extract(NEW.payload_json,'$.accessMode'),'permissionsMask',json_extract(NEW.payload_json,'$.permissionsMask'),'expiresAtMs',NULL,'maxUses',json_extract(NEW.payload_json,'$.maxUses'),'expiryMode','inherit_album'))
  ) THEN RAISE(ABORT,'INVALID_INVITE_EXPIRY') END;
  SELECT CASE WHEN (SELECT count(*) FROM guest_invites WHERE project_id=NEW.project_id)>=1000 THEN RAISE(ABORT,'INVITE_LIMIT_REACHED') END;
END;

DROP TRIGGER "invite_creation_command_apply";

CREATE TRIGGER invite_creation_command_apply AFTER INSERT ON invite_creation_commands BEGIN

  INSERT INTO album_inherited_share_transitions(id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json)
  SELECT 'issuance:'||NEW.invite_id||':'||n.album_id,'issuance',NEW.invite_id,n.album_id,n.workspace_id,n.project_id,n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
  FROM next_album_inherited_share_state n WHERE json_extract(NEW.payload_json,'$.expiryMode')='inherit_album' AND n.project_id=NEW.project_id AND n.album_id IN(SELECT value FROM json_each(NEW.payload_json,'$.albumIds'))
    AND NOT EXISTS(SELECT 1 FROM album_inherited_share_states same
      WHERE same.album_id=n.album_id AND same.workspace_id=n.workspace_id AND same.project_id=n.project_id
        AND same.generation=n.generation AND same.phase=n.phase AND same.expires_at_ms IS n.expires_at_ms AND same.inputs_json=n.inputs_json);
  SELECT CASE WHEN json_extract(NEW.payload_json,'$.expiryMode')='inherit_album' AND EXISTS(
    SELECT 1 FROM json_each(NEW.payload_json,'$.albumIds') e WHERE NOT EXISTS(
      SELECT 1 FROM album_inherited_share_states s JOIN effective_album_inherited_share_expiry inputs
        ON inputs.album_id=s.album_id AND inputs.workspace_id=s.workspace_id AND inputs.project_id=s.project_id
      WHERE s.album_id=e.value AND s.project_id=NEW.project_id AND s.inputs_json=inputs.inputs_json
        AND ((s.phase='off' AND inputs.phase='off') OR(s.phase='finite' AND inputs.phase='finite' AND s.expires_at_ms>unixepoch('subsec')*1000))
    )) THEN RAISE(ABORT,'INVALID_INVITE_EXPIRY') END;
  INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,expiry_mode,max_uses,created_by,owner_session_id)
    SELECT NEW.invite_id,p.workspace_id,p.id,NEW.token_hash,json_extract(NEW.payload_json,'$.accessMode'),NEW.password_verifier,json_extract(NEW.payload_json,'$.permissionsMask'),json_extract(NEW.payload_json,'$.expiresAtMs'),CASE WHEN json_type(NEW.payload_json,'$.expiryMode') IS 'text' THEN json_extract(NEW.payload_json,'$.expiryMode') ELSE 'custom' END,json_extract(NEW.payload_json,'$.maxUses'),NEW.actor_id,NEW.session_id FROM projects p WHERE p.id=NEW.project_id;
  INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id,inherit_generation)
    SELECT NEW.invite_id,p.workspace_id,p.id,e.value,CASE WHEN i.expiry_mode='inherit_album' THEN (SELECT state.generation FROM album_inherited_share_states state WHERE state.album_id=e.value AND state.workspace_id=p.workspace_id AND state.project_id=p.id) ELSE NULL END
    FROM projects p,json_each(NEW.payload_json,'$.albumIds') e,guest_invites i
    WHERE p.id=NEW.project_id AND i.id=NEW.invite_id AND i.workspace_id=p.workspace_id AND i.project_id=p.id;
  INSERT INTO guest_invite_seals(invite_id) VALUES(NEW.invite_id);
END;

DROP TRIGGER "guest_invite_album_guard";

CREATE TRIGGER guest_invite_album_guard BEFORE INSERT ON guest_invite_albums BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM guest_invite_seals WHERE invite_id=NEW.invite_id)
    OR EXISTS(SELECT 1 FROM guest_invite_revocations WHERE invite_id=NEW.invite_id)
    THEN RAISE(ABORT,'IMMUTABLE_GUEST_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM guest_invites i WHERE i.id=NEW.invite_id
      AND i.workspace_id=NEW.workspace_id AND i.project_id=NEW.project_id
      AND ((i.expiry_mode='custom' AND NEW.inherit_generation IS NULL
          AND typeof(i.expires_at_ms)='integer' AND i.expires_at_ms>unixepoch('subsec')*1000)
        OR (i.expiry_mode='inherit_album' AND i.expires_at_ms IS NULL
          AND typeof(NEW.inherit_generation)='integer'
          AND EXISTS(SELECT 1 FROM album_inherited_share_states state JOIN effective_album_inherited_share_expiry inputs ON inputs.album_id=state.album_id AND inputs.workspace_id=state.workspace_id AND inputs.project_id=state.project_id AND inputs.inputs_json=state.inputs_json AND inputs.phase=state.phase
            WHERE state.album_id=NEW.album_id AND state.workspace_id=NEW.workspace_id
              AND state.project_id=NEW.project_id AND state.generation=NEW.inherit_generation
              AND ((state.phase='off' AND state.expires_at_ms IS NULL)
                OR (state.phase='finite' AND typeof(state.expires_at_ms)='integer'
                  AND state.expires_at_ms>unixepoch('subsec')*1000)))))
  ) THEN RAISE(ABORT,'INVALID_INVITE_EXPIRY') END;
END;

DROP TRIGGER "human_photo_view_after_insert";

CREATE TRIGGER human_photo_view_after_insert AFTER INSERT ON human_photo_views BEGIN
  INSERT INTO album_human_activity(
    album_id,workspace_id,project_id,last_valid_viewed_at_ms,view_event_id
  ) SELECT NEW.album_id,NEW.workspace_id,NEW.project_id,NEW.viewed_at_ms,NEW.event_id
  WHERE NOT EXISTS(SELECT 1 FROM album_human_activity current
      WHERE current.album_id=NEW.album_id)
    OR EXISTS(SELECT 1 FROM album_human_activity current
      WHERE current.album_id=NEW.album_id
        AND (NEW.viewed_at_ms>current.last_valid_viewed_at_ms
          OR (NEW.viewed_at_ms=current.last_valid_viewed_at_ms
            AND NEW.event_id>current.view_event_id)))
  ON CONFLICT(album_id) DO UPDATE SET
    workspace_id=excluded.workspace_id,
    project_id=excluded.project_id,
    last_valid_viewed_at_ms=excluded.last_valid_viewed_at_ms,
    view_event_id=excluded.view_event_id
  WHERE excluded.last_valid_viewed_at_ms>album_human_activity.last_valid_viewed_at_ms
    OR (excluded.last_valid_viewed_at_ms=album_human_activity.last_valid_viewed_at_ms
      AND excluded.view_event_id>album_human_activity.view_event_id);

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,guest_session_id,session_id,
    workspace_id,project_id,album_id,photo_id,version_id,action,
    before_json,after_json,request_id,occurred_at_utc
  ) VALUES(
    NEW.event_id,NEW.actor_type,NEW.actor_id,
    CASE WHEN NEW.actor_type='guest' THEN NEW.authorization_session_id END,
    CASE WHEN NEW.actor_type='user' THEN NEW.authorization_session_id END,
    NEW.workspace_id,NEW.project_id,NEW.album_id,NEW.photo_id,NEW.version_id,
    'gallery.viewed',NULL,
    json_object('source','visible_photo','visibleForMs',NEW.visible_for_ms),
    NEW.request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.viewed_at_ms/1000.0,'unixepoch')
  );

  INSERT INTO album_inherited_share_transitions(id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json)
  SELECT 'human:'||NEW.event_id||':'||n.album_id,'human',NEW.event_id,n.album_id,n.workspace_id,n.project_id,n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
  FROM next_album_inherited_share_state n WHERE n.album_id=NEW.album_id AND EXISTS(SELECT 1 FROM album_human_activity h WHERE h.album_id=NEW.album_id AND h.view_event_id=NEW.event_id)
    AND NOT EXISTS(SELECT 1 FROM album_inherited_share_states same
      WHERE same.album_id=n.album_id AND same.workspace_id=n.workspace_id AND same.project_id=n.project_id
        AND same.generation=n.generation AND same.phase=n.phase AND same.expires_at_ms IS n.expires_at_ms AND same.inputs_json=n.inputs_json);
END;

DROP TRIGGER "album_retention_policy_command_apply";

CREATE TRIGGER album_retention_policy_command_apply
AFTER INSERT ON album_retention_policy_commands BEGIN
  INSERT INTO album_retention_policy_results(
    command_id,before_json,after_json,result_json,event_id,occurred_at_utc
  )
  SELECT NEW.id,
    json_object('inactiveDays',c.inactive_days,
      'cleanupAllowed',json(CASE WHEN c.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
      'revision',c.revision),
    json_object('inactiveDays',NEW.inactive_days,
      'cleanupAllowed',json(CASE WHEN NEW.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
      'revision',c.revision+CASE WHEN c.inactive_days<>NEW.inactive_days OR c.cleanup_allowed<>NEW.cleanup_allowed THEN 1 ELSE 0 END),
    json_object('albumId',NEW.album_id,'revision',c.revision+
      CASE WHEN c.inactive_days<>NEW.inactive_days OR c.cleanup_allowed<>NEW.cleanup_allowed THEN 1 ELSE 0 END,
      'cleanupAllowed',json(CASE WHEN NEW.cleanup_allowed=1 THEN 'true' ELSE 'false' END),
      'inactiveDays',NEW.inactive_days,'automaticDeletionEnabled',json('false'),'dryRun',json('true')),
    CASE WHEN c.inactive_days<>NEW.inactive_days OR c.cleanup_allowed<>NEW.cleanup_allowed
      THEN 'album-retention-policy:'||NEW.id ELSE NULL END,
    strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at_ms/1000.0,'unixepoch')
  FROM album_retention_policy_configurations c WHERE c.album_id=NEW.album_id;

  UPDATE album_retention_policy_configurations
  SET inactive_days=NEW.inactive_days,cleanup_allowed=NEW.cleanup_allowed,
    revision=revision+1,last_command_id=NEW.id,updated_at_ms=NEW.created_at_ms
  WHERE album_id=NEW.album_id
    AND (inactive_days<>NEW.inactive_days OR cleanup_allowed<>NEW.cleanup_allowed);

  INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    action,before_json,after_json,request_id,occurred_at_utc)
  SELECT r.event_id,'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    'album.retention_policy_changed',r.before_json,r.after_json,NEW.request_id,r.occurred_at_utc
  FROM album_retention_policy_results r
  WHERE r.command_id=NEW.id AND r.before_json<>r.after_json;

  INSERT INTO album_inherited_share_transitions(id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json)
  SELECT 'policy:'||NEW.id||':'||n.album_id,'policy',NEW.id,n.album_id,n.workspace_id,n.project_id,n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
  FROM next_album_inherited_share_state n WHERE n.album_id=NEW.album_id AND EXISTS(SELECT 1 FROM album_retention_policy_configurations c WHERE c.album_id=NEW.album_id AND c.last_command_id=NEW.id)
    AND NOT EXISTS(SELECT 1 FROM album_inherited_share_states same
      WHERE same.album_id=n.album_id AND same.workspace_id=n.workspace_id AND same.project_id=n.project_id
        AND same.generation=n.generation AND same.phase=n.phase AND same.expires_at_ms IS n.expires_at_ms AND same.inputs_json=n.inputs_json);
END;

DROP TRIGGER "album_activation_apply";

CREATE TRIGGER album_activation_apply
AFTER INSERT ON album_activation_commands
BEGIN
  UPDATE albums SET state='active',revision=revision+1
  WHERE id=NEW.album_id AND workspace_id=NEW.workspace_id
    AND project_id=NEW.project_id AND state='draft'
    AND revision=NEW.expected_revision;
  SELECT CASE WHEN changes()<>1
    THEN RAISE(ABORT,'CONCURRENT_MODIFICATION') END;

  INSERT INTO audit_events(
    event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,
    action,before_json,after_json,request_id
  )
  SELECT
    'album-activation:'||NEW.actor_id||':'||NEW.request_id,
    'user',NEW.actor_id,NEW.session_id,NEW.workspace_id,NEW.project_id,NEW.album_id,
    'album.activated',
    json_object(
      'id',a.id,'workspaceId',a.workspace_id,'projectId',a.project_id,
      'name',a.name,'state','draft',
      'isPinned',json(CASE WHEN a.is_pinned=1 THEN 'true' ELSE 'false' END),
      'legalHold',json(CASE WHEN a.legal_hold=1 THEN 'true' ELSE 'false' END),
      'revision',NEW.expected_revision,'createdAt',a.created_at
    ),
    json_object(
      'id',a.id,'workspaceId',a.workspace_id,'projectId',a.project_id,
      'name',a.name,'state',a.state,
      'isPinned',json(CASE WHEN a.is_pinned=1 THEN 'true' ELSE 'false' END),
      'legalHold',json(CASE WHEN a.legal_hold=1 THEN 'true' ELSE 'false' END),
      'revision',a.revision,'createdAt',a.created_at
    ),
    NEW.request_id
  FROM albums a
  WHERE a.id=NEW.album_id AND a.workspace_id=NEW.workspace_id
    AND a.project_id=NEW.project_id;

  INSERT INTO album_inherited_share_transitions(id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json)
  SELECT 'activation:'||NEW.actor_id||':'||NEW.request_id||':'||n.album_id,'activation',NEW.actor_id||':'||NEW.request_id,n.album_id,n.workspace_id,n.project_id,n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
  FROM next_album_inherited_share_state n WHERE n.album_id=NEW.album_id
    AND NOT EXISTS(SELECT 1 FROM album_inherited_share_states same
      WHERE same.album_id=n.album_id AND same.workspace_id=n.workspace_id AND same.project_id=n.project_id
        AND same.generation=n.generation AND same.phase=n.phase AND same.expires_at_ms IS n.expires_at_ms AND same.inputs_json=n.inputs_json);
END;

CREATE TRIGGER album_inherited_share_bootstrap AFTER INSERT ON albums BEGIN
  INSERT INTO album_inherited_share_transitions(id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json)
  SELECT 'bootstrap:'||NEW.id||':'||n.album_id,'bootstrap',NEW.id,n.album_id,n.workspace_id,n.project_id,n.prior_transition_id,n.generation,n.phase,n.expires_at_ms,n.inputs_json
  FROM next_album_inherited_share_state n WHERE n.album_id=NEW.id
    AND NOT EXISTS(SELECT 1 FROM album_inherited_share_states same
      WHERE same.album_id=n.album_id AND same.workspace_id=n.workspace_id AND same.project_id=n.project_id
        AND same.generation=n.generation AND same.phase=n.phase AND same.expires_at_ms IS n.expires_at_ms AND same.inputs_json=n.inputs_json);
END;
