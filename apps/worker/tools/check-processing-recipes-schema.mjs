import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
assert.ok(['--check', '--write-new'].includes(process.argv[2]));
assert.equal(process.argv.length, 3);
const db = new DatabaseSync(':memory:');
const files = (await readdir('migrations'))
  .filter((x) => /^\d{4}.*\.sql$/.test(x) && x < '0055')
  .sort();
assert.equal(files.length, 54);
for (const f of files) db.exec(await readFile('migrations/' + f, 'utf8'));
const tables = [
  'image_processing_jobs',
  'image_processing_outputs',
  'processing_review_commands',
  'owner_external_intents',
];
const ident = (x) => '"' + x.replaceAll('"', '""') + '"';
const all = db
  .prepare(
    'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid',
  )
  .all();
const match = new RegExp(
  '\\b(' +
    tables.join('|') +
    '|guest_comment_eligible_versions|guest_annotation_eligible_versions)\\b',
);
const triggers = all.filter((x) => x.type === 'trigger' && match.test(x.sql));
const views = all.filter((x) => x.type === 'view' && match.test(x.sql));
assert.equal(views.length, 2);
const indexes = all.filter(
  (x) => x.type === 'index' && tables.includes(x.tbl_name),
);
const recipe = "'local-sharp-0.35.5-v1','cloudflare-images-jpeg-82-v1'";
const lines = [
  '-- Generated from the complete 0054 schema; only recipe admission/outbox are changed.',
  '-- Recovery: disable new admission/runners; retain DB+R2 backups and repair forward. Never down-migrate live Cloudflare jobs.',
  '-- Apply as one D1 migration after isolated populated restore/parity. Historical rows and keys are copied verbatim.',
  'PRAGMA defer_foreign_keys=ON;',
];
for (const t of triggers) lines.push('DROP TRIGGER ' + ident(t.name) + ';');
for (const v of [...views].reverse())
  lines.push('DROP VIEW ' + ident(v.name) + ';');
for (const name of tables) {
  let sql = all.find((x) => x.type === 'table' && x.name === name).sql;
  for (const table of tables)
    sql = sql.replace(
      new RegExp('\\b' + table + '\\b', 'g'),
      table + '_recipe_replacement',
    );
  if (name === 'image_processing_jobs') {
    assert.ok(sql.includes("CHECK(recipe='local-sharp-0.35.5-v1')"));
    sql = sql.replace(
      "CHECK(recipe='local-sharp-0.35.5-v1')",
      'CHECK(recipe IN(' + recipe + '))',
    );
  }
  lines.push(
    sql + ';',
    'INSERT INTO ' +
      ident(name + '_recipe_replacement') +
      ' SELECT * FROM ' +
      ident(name) +
      ';',
  );
}
for (const name of [...tables.slice(1)].reverse())
  lines.push('DROP TABLE ' + ident(name) + ';');
lines.push('DROP TABLE image_processing_jobs;');
for (const name of tables)
  lines.push(
    'ALTER TABLE ' +
      ident(name + '_recipe_replacement') +
      ' RENAME TO ' +
      ident(name) +
      ';',
  );
for (const index of indexes) lines.push(index.sql + ';');
lines.push(`
CREATE TABLE workspace_image_processing_policies(
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 recipe TEXT NOT NULL CHECK(recipe IN(${recipe})),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991),
 updated_at_ms INTEGER NOT NULL
);
CREATE TABLE workspace_image_processing_policy_commands(
 actor_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, session_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision>=0 AND expected_revision<9007199254740991),
 recipe TEXT NOT NULL CHECK(recipe IN(${recipe})), created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer'),
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
`);
for (const view of views) lines.push(view.sql + ';');
for (const t of triggers) {
  let sql = t.sql;
  if (t.name === 'processing_original_outbox') {
    const selected =
      "COALESCE((SELECT recipe FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id),'local-sharp-0.35.5-v1')";
    sql = sql
      .replace(
        "SELECT NEW.id,'local-sharp-0.35.5-v1',",
        'SELECT NEW.id,' + selected + ',',
      )
      .replace(
        'v.byte_size<=67108864',
        'v.byte_size<=CASE WHEN ' +
          selected +
          "='cloudflare-images-jpeg-82-v1' THEN 16777216 ELSE 67108864 END",
      );
  }
  if (t.name === 'processing_job_insert_guard') {
    sql = sql.replace(
      'BEGIN',
      `BEGIN
 SELECT CASE WHEN NEW.recipe<>COALESCE((SELECT p.recipe FROM workspace_image_processing_policies p JOIN photo_assets a ON a.workspace_id=p.workspace_id WHERE a.id=NEW.id),'local-sharp-0.35.5-v1') THEN RAISE(ABORT,'PROCESSING_RECIPE_MISMATCH') END;
 SELECT CASE WHEN NEW.status='queued' AND NEW.recipe='cloudflare-images-jpeg-82-v1' AND EXISTS(SELECT 1 FROM photo_assets WHERE id=NEW.id AND byte_size>16777216) THEN RAISE(ABORT,'PROCESSING_SOURCE_LIMIT') END;`,
    );
  }
  lines.push(sql + ';');
}
const sql = lines.join('\n\n') + '\n';
// Verify schema construction before writing source; the populated native-D1 test is separate.
db.exec('BEGIN');
db.exec(sql);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
db.exec('COMMIT');
assert.equal(
  db.prepare('SELECT count(*) n FROM guest_comment_eligible_versions').get().n,
  0,
);
if (process.argv[2] === '--check') {
  assert.equal(
    await readFile('migrations/0055_processing_recipes.sql', 'utf8'),
    sql,
    'Applied migration must remain immutable',
  );
} else {
  let exists = false;
  try {
    await access('migrations/0055_processing_recipes.sql');
    exists = true;
  } catch {}
  assert.equal(exists, false, 'Never overwrite an existing migration');
  await writeFile('migrations/0055_processing_recipes.sql', sql, {
    flag: 'wx',
  });
}
console.log(
  JSON.stringify({
    status: 'processing_recipe_schema_checked',
    tables: tables.length,
    triggers: triggers.length,
    views: views.length,
    sha256: createHash('sha256').update(sql).digest('hex'),
  }),
);
