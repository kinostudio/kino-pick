import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, writeFile, access } from 'node:fs/promises';

const migrationName = '0072_browser_first_processing.sql';
const profile = 'browser-first-jpeg-82-v1';
const recipeNames = [
  'local-sharp-0.35.5-v1',
  'cloudflare-images-jpeg-82-v1',
  profile,
];
const recipeTables = [
  'image_processing_jobs',
  'workspace_image_processing_policies',
  'workspace_image_processing_policy_commands',
];
const owner = '10000000-0000-4000-8000-000000000001';
const session = '11000000-0000-4000-8000-000000000001';
const seeds = [
  {
    index: 1,
    workspace: '20000000-0000-4000-8000-000000000001',
    project: '30000000-0000-4000-8000-000000000001',
    album: '40000000-0000-4000-8000-000000000001',
    photo: '50000000-0000-4000-8000-000000000001',
    version: '60000000-0000-4000-8000-000000000001',
    asset: '70000000-0000-4000-8000-000000000001',
    recipe: recipeNames[0],
  },
  {
    index: 2,
    workspace: '20000000-0000-4000-8000-000000000002',
    project: '30000000-0000-4000-8000-000000000002',
    album: '40000000-0000-4000-8000-000000000002',
    photo: '50000000-0000-4000-8000-000000000002',
    version: '60000000-0000-4000-8000-000000000002',
    asset: '70000000-0000-4000-8000-000000000002',
    recipe: recipeNames[1],
  },
];

assert.ok(['--check', '--write-new'].includes(process.argv[2]));
assert.equal(process.argv.length, 3);

const ident = (value) => '"' + value.replaceAll('"', '""') + '"';
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const mentions = (sql, name) =>
  new RegExp(
    '(^|[^A-Za-z0-9_])' + escapeRegex(name) + '([^A-Za-z0-9_]|$)',
    'u',
  ).test(sql);
const openDb = () =>
  new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });

async function migrationFiles() {
  return (await readdir('migrations'))
    .filter((name) => /^\d{4}.*\.sql$/u.test(name))
    .sort();
}

async function loadSchema() {
  const files = (await migrationFiles()).filter((name) => name < migrationName);
  assert.equal(files.length, 71, '0071 must remain the complete prior schema');
  assert.equal(files.at(-1), '0071_owner_album_feedback.sql');
  const db = openDb();
  for (const file of files)
    db.exec(await readFile('migrations/' + file, 'utf8'));
  return db;
}

function foreignKeyClosure(db, initial) {
  const names = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  const closure = new Set(initial);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of names) {
      if (closure.has(name)) continue;
      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list(${ident(name)})`)
        .all();
      if (foreignKeys.some((foreignKey) => closure.has(foreignKey.table))) {
        closure.add(name);
        changed = true;
      }
    }
  }
  return [...closure];
}

function topologicalTables(db, tables) {
  const set = new Set(tables);
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  function visit(name) {
    if (visited.has(name)) return;
    assert.equal(visiting.has(name), false, 'table foreign-key cycle: ' + name);
    visiting.add(name);
    for (const foreignKey of db
      .prepare(`PRAGMA foreign_key_list(${ident(name)})`)
      .all()) {
      if (set.has(foreignKey.table)) visit(foreignKey.table);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  }
  for (const name of tables) visit(name);
  return ordered;
}

function schemaRows(db) {
  return db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
    )
    .all();
}

function dependentViews(all, tables) {
  const views = all.filter((object) => object.type === 'view');
  const selected = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const view of views) {
      if (selected.has(view.name)) continue;
      if ([...tables, ...selected].some((name) => mentions(view.sql, name))) {
        selected.add(view.name);
        changed = true;
      }
    }
  }
  return views.filter((view) => selected.has(view.name));
}

function orderedViews(views) {
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  function visit(view) {
    if (visited.has(view.name)) return;
    assert.equal(
      visiting.has(view.name),
      false,
      'view dependency cycle: ' + view.name,
    );
    visiting.add(view.name);
    for (const dependency of views) {
      if (dependency.name !== view.name && mentions(view.sql, dependency.name))
        visit(dependency);
    }
    visiting.delete(view.name);
    visited.add(view.name);
    ordered.push(view);
  }
  for (const view of views) visit(view);
  return ordered;
}

function replaceOnce(sql, from, to, label) {
  assert.equal(sql.split(from).length - 1, 1, label + ' replacement count');
  return sql.replace(from, to);
}

function reviseTrigger(trigger) {
  let sql = trigger.sql;
  if (trigger.name === 'processing_original_outbox') {
    sql = replaceOnce(
      sql,
      "COALESCE((SELECT recipe FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id),'local-sharp-0.35.5-v1')='cloudflare-images-jpeg-82-v1' THEN 16777216 ELSE 67108864 END",
      "COALESCE((SELECT recipe FROM workspace_image_processing_policies WHERE workspace_id=NEW.workspace_id),'local-sharp-0.35.5-v1') IN('cloudflare-images-jpeg-82-v1','browser-first-jpeg-82-v1') THEN 16777216 ELSE 67108864 END",
      trigger.name,
    );
  } else if (trigger.name === 'upload_processing_source_limit') {
    sql = replaceOnce(
      sql,
      "p.recipe='cloudflare-images-jpeg-82-v1'",
      "p.recipe IN('cloudflare-images-jpeg-82-v1','browser-first-jpeg-82-v1')",
      trigger.name,
    );
  } else if (trigger.name === 'processing_job_insert_guard') {
    sql = replaceOnce(
      sql,
      "NEW.status='queued' AND NEW.recipe='cloudflare-images-jpeg-82-v1'",
      "NEW.status='queued' AND NEW.recipe IN('cloudflare-images-jpeg-82-v1','browser-first-jpeg-82-v1')",
      trigger.name,
    );
  } else if (trigger.name === 'processing_job_transition_guard') {
    sql = replaceOnce(
      sql,
      "NEW.recipe='cloudflare-images-jpeg-82-v1' AND NEW.lease_epoch>=3",
      "NEW.recipe IN('cloudflare-images-jpeg-82-v1','browser-first-jpeg-82-v1') AND NEW.lease_epoch>=3",
      trigger.name,
    );
  }
  return sql;
}

function generateMigration(db) {
  const all = schemaRows(db);
  const tables = foreignKeyClosure(db, recipeTables);
  for (const required of [
    'image_processing_outputs',
    'processing_review_commands',
    'owner_external_intents',
  ])
    assert.ok(
      tables.includes(required),
      'missing processing-job FK dependency: ' + required,
    );
  const tableOrder = topologicalTables(db, tables);
  const tableSet = new Set(tables);
  const views = orderedViews(dependentViews(all, tableSet));
  const viewNames = views.map((view) => view.name);
  const dependencyNames = [...tables, ...viewNames];
  const triggers = all.filter(
    (object) =>
      object.type === 'trigger' &&
      dependencyNames.some((name) => mentions(object.sql, name)),
  );
  const indexes = all.filter(
    (object) => object.type === 'index' && tableSet.has(object.tbl_name),
  );
  const replacementName = (name) => name + '_browser_first_replacement';
  const recipeCheck =
    "CHECK(recipe IN('local-sharp-0.35.5-v1','cloudflare-images-jpeg-82-v1'))";
  const expandedRecipeCheck =
    "CHECK(recipe IN('local-sharp-0.35.5-v1','cloudflare-images-jpeg-82-v1','browser-first-jpeg-82-v1'))";
  const lines = [
    '-- Add the immutable browser-first JPEG profile without rewriting existing jobs or policies.',
    '-- This profile admits browser-first derivatives with the Cloudflare Images fallback.',
    '-- Source uploads remain capped at 16 MiB so Cloudflare fallback stays within its existing limit.',
    '-- Recovery: disable new browser-first admission/runners, keep D1 and R2 backups, and repair forward; never down-migrate live jobs.',
    '-- Apply only after populated schema-71 restore/parity and the normal adoption gates.',
    'PRAGMA defer_foreign_keys=ON;',
  ];
  for (const trigger of triggers)
    lines.push('DROP TRIGGER ' + ident(trigger.name) + ';');
  for (const view of [...views].reverse())
    lines.push('DROP VIEW ' + ident(view.name) + ';');
  for (const name of tableOrder) {
    let sql = all.find(
      (object) => object.type === 'table' && object.name === name,
    )?.sql;
    assert.ok(sql, 'missing table SQL: ' + name);
    for (const table of tables)
      sql = sql.replace(
        new RegExp('\\b' + escapeRegex(table) + '\\b', 'gu'),
        replacementName(table),
      );
    if (recipeTables.includes(name))
      sql = replaceOnce(sql, recipeCheck, expandedRecipeCheck, name);
    lines.push(
      sql + ';',
      'INSERT INTO ' +
        ident(replacementName(name)) +
        ' SELECT * FROM ' +
        ident(name) +
        ';',
    );
  }
  for (const name of [...tableOrder].reverse())
    lines.push('DROP TABLE ' + ident(name) + ';');
  for (const name of tableOrder)
    lines.push(
      'ALTER TABLE ' +
        ident(replacementName(name)) +
        ' RENAME TO ' +
        ident(name) +
        ';',
    );
  for (const index of indexes) lines.push(index.sql + ';');
  for (const view of views) lines.push(view.sql + ';');
  for (const trigger of triggers) lines.push(reviseTrigger(trigger) + ';');

  assert.ok(
    triggers.some((trigger) => trigger.name === 'processing_original_outbox'),
  );
  assert.ok(
    triggers.some((trigger) => trigger.name === 'processing_job_insert_guard'),
  );
  assert.ok(
    triggers.some(
      (trigger) => trigger.name === 'processing_job_transition_guard',
    ),
  );
  assert.ok(
    triggers.some(
      (trigger) => trigger.name === 'upload_processing_source_limit',
    ),
  );
  return {
    sql: lines.join('\n\n') + '\n',
    closure: {
      tables: tableOrder,
      views: viewNames,
      triggers: triggers.map((trigger) => trigger.name),
    },
  };
}

function dropTriggers(db) {
  const triggers = db
    .prepare(
      "SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name",
    )
    .all();
  for (const trigger of triggers)
    db.exec('DROP TRIGGER ' + ident(trigger.name) + ';');
  return triggers;
}

function restoreTriggers(db, triggers) {
  for (const trigger of triggers) db.exec(trigger.sql + ';');
}

function seedPopulatedDatabase(db) {
  const triggers = dropTriggers(db);
  const now = Date.now();
  const contentHash = 'a'.repeat(64);
  db.prepare(
    'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
  ).run(
    owner,
    'Schema fixture owner',
    owner + '@schema-fixture.invalid',
    1,
    now,
    now,
  );
  db.prepare('INSERT INTO owners(id,user_id,enabled) VALUES(1,?,1)').run(owner);
  db.prepare(
    'INSERT INTO owner_sessions(id,token,expiresAt,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
  ).run(session, 'schema-fixture-token', now + 3600000, owner, now, now);
  for (const seed of seeds) {
    db.prepare(
      'INSERT INTO workspaces(id,name,owner_user_id,quota_bytes) VALUES(?,?,?,?)',
    ).run(seed.workspace, 'Schema fixture ' + seed.index, owner, 9_000_000_000);
    db.prepare(
      'INSERT INTO workspace_storage_usage(workspace_id,used_bytes,reserved_bytes) VALUES(?,0,0)',
    ).run(seed.workspace);
    db.prepare(
      "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
    ).run(seed.project, seed.workspace, 'Schema project ' + seed.index);
    db.prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?, ?,'draft')",
    ).run(
      seed.album,
      seed.workspace,
      seed.project,
      'Schema album ' + seed.index,
    );
    db.prepare(
      'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
    ).run(
      seed.photo,
      seed.workspace,
      seed.project,
      seed.album,
      'source-' + seed.index + '.jpg',
    );
    db.prepare(
      "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,?,?,100,'image/jpeg',10,10,'private')",
    ).run(seed.version, seed.workspace, seed.photo, owner, contentHash);
    db.prepare(
      "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,?,'original',?,100,'image/jpeg',?,'private')",
    ).run(
      seed.asset,
      seed.workspace,
      seed.photo,
      seed.version,
      'primary',
      seed.workspace +
        '/' +
        seed.project +
        '/' +
        seed.album +
        '/' +
        seed.asset +
        '/original',
      contentHash,
    );
    db.prepare(
      'INSERT INTO workspace_image_processing_policies(workspace_id,recipe,revision,updated_at_ms) VALUES(?,?,1,?)',
    ).run(seed.workspace, seed.recipe, now);
    db.prepare(
      'INSERT INTO workspace_image_processing_policy_commands(actor_id,request_id,session_id,workspace_id,expected_revision,recipe,created_at_ms) VALUES(?,?,?,?,0,?,?)',
    ).run(
      owner,
      '81000000-0000-4000-8000-' + String(seed.index).padStart(12, '0'),
      session,
      seed.workspace,
      seed.recipe,
      now,
    );
    db.prepare(
      "INSERT INTO image_processing_jobs(id,recipe,status,reserved_bytes,lease_epoch,attempts,transition_id,created_at_ms,updated_at_ms) VALUES(?,?,'queued',0,0,0,?,?,?)",
    ).run(
      seed.asset,
      seed.recipe,
      '82000000-0000-4000-8000-' + String(seed.index).padStart(12, '0'),
      now,
      now,
    );
    for (const kind of ['thumbnail', 'preview']) {
      db.prepare(
        'INSERT INTO image_processing_outputs(job_id,kind,asset_id,object_key,max_bytes) VALUES(?,?,?,?,8388608)',
      ).run(
        seed.asset,
        kind,
        '83000000-0000-4000-8000-' +
          String(seed.index * 2 + (kind === 'preview' ? 1 : 0)).padStart(
            12,
            '0',
          ),
        seed.workspace +
          '/' +
          seed.project +
          '/' +
          seed.album +
          '/' +
          seed.asset +
          '/derived/' +
          seed.recipe +
          '/' +
          kind +
          '.jpg',
      );
    }
    db.prepare(
      "INSERT INTO processing_review_commands(actor_id,request_id,session_id,job_id,expected_epoch,payload_json,fences_json,created_at_ms) VALUES(?,?,?,?,1,'{}','{}',?)",
    ).run(
      owner,
      '84000000-0000-4000-8000-' + String(seed.index).padStart(12, '0'),
      session,
      seed.asset,
      now,
    );
  }
  restoreTriggers(db, triggers);
}

function tableRows(db, name) {
  return db
    .prepare('SELECT * FROM ' + ident(name))
    .all()
    .map((row) => JSON.parse(JSON.stringify(row)))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

function foreignKeyViolations(db) {
  return db.prepare('PRAGMA foreign_key_check').all();
}

function applyMigration(db, sql) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(sql);
    db.exec('COMMIT;');
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    throw error;
  }
}

function assertNewProfileRetry(db, jobId, now) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const token =
      '90000000-0000-4000-8000-' + String(attempt).padStart(12, '0');
    db.prepare(
      "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=lease_epoch+1,attempts=attempts+1,lease_until_ms=?,reason_code=NULL,updated_at_ms=?,transition_id=? WHERE id=?",
    ).run(
      token,
      now + 300000,
      now,
      '91000000-0000-4000-8000-' + String(attempt).padStart(12, '0'),
      jobId,
    );
    db.prepare(
      "UPDATE image_processing_jobs SET status=?,lease_token=NULL,lease_until_ms=NULL,reason_code='PROCESSING_IO_UNCERTAIN',updated_at_ms=?,transition_id=? WHERE id=?",
    ).run(
      attempt === 3 ? 'needs_review' : 'retryable',
      now,
      '92000000-0000-4000-8000-' + String(attempt).padStart(12, '0'),
      jobId,
    );
  }
  const job = db
    .prepare(
      'SELECT recipe,status,lease_epoch,reserved_bytes,reason_code FROM image_processing_jobs WHERE id=?',
    )
    .get(jobId);
  assert.deepEqual(
    { ...job },
    {
      recipe: profile,
      status: 'needs_review',
      lease_epoch: 3,
      reserved_bytes: 16777216,
      reason_code: 'PROCESSING_IO_UNCERTAIN',
    },
  );
}

async function verify(sql, closure) {
  const empty = await loadSchema();
  const beforeSchema = schemaRows(empty);
  const beforeObjects = empty
    .prepare(
      "SELECT type,name FROM sqlite_schema WHERE type IN('table','index','view','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => row.type + ':' + row.name);
  applyMigration(empty, sql);
  assert.deepEqual(foreignKeyViolations(empty), []);
  const afterSchema = schemaRows(empty);
  const afterObjects = empty
    .prepare(
      "SELECT type,name FROM sqlite_schema WHERE type IN('table','index','view','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => row.type + ':' + row.name);
  assert.deepEqual(
    afterObjects,
    beforeObjects,
    'migration must not add/drop schema objects',
  );
  const oldTriggers = new Map(
    beforeSchema
      .filter((row) => row.type === 'trigger')
      .map((row) => [row.name, row.sql]),
  );
  const newTriggers = new Map(
    afterSchema
      .filter((row) => row.type === 'trigger')
      .map((row) => [row.name, row.sql]),
  );
  const changedTriggers = [];
  for (const [name, oldSql] of oldTriggers) {
    const definition = reviseTrigger({ name, sql: oldSql });
    assert.equal(
      newTriggers.get(name),
      definition,
      name + ' trigger definition',
    );
    if (definition !== oldSql) changedTriggers.push(name);
  }
  assert.deepEqual(changedTriggers.sort(), [
    'processing_job_insert_guard',
    'processing_job_transition_guard',
    'processing_original_outbox',
    'upload_processing_source_limit',
  ]);
  for (const type of ['index', 'view']) {
    const oldSql = new Map(
      beforeSchema
        .filter((row) => row.type === type)
        .map((row) => [row.name, row.sql]),
    );
    const newSql = new Map(
      afterSchema
        .filter((row) => row.type === type)
        .map((row) => [row.name, row.sql]),
    );
    assert.deepEqual([...newSql], [...oldSql], type + ' definitions unchanged');
  }
  for (const table of recipeTables) {
    const ddl = empty
      .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
      .get(table).sql;
    for (const recipe of recipeNames)
      assert.ok(
        ddl.includes(recipe),
        table + ' recipe check missing ' + recipe,
      );
  }
  assert.equal(closure.tables.length, 6);

  const populated = await loadSchema();
  seedPopulatedDatabase(populated);
  const targetTables = closure.tables;
  const oldRows = Object.fromEntries(
    targetTables.map((table) => [table, tableRows(populated, table)]),
  );
  const oldRecipes = {
    jobs: populated
      .prepare('SELECT id,recipe FROM image_processing_jobs ORDER BY id')
      .all()
      .map((row) => ({ ...row })),
    policies: populated
      .prepare(
        'SELECT workspace_id,recipe FROM workspace_image_processing_policies ORDER BY workspace_id',
      )
      .all()
      .map((row) => ({ ...row })),
    commands: populated
      .prepare(
        'SELECT workspace_id,recipe FROM workspace_image_processing_policy_commands ORDER BY workspace_id',
      )
      .all()
      .map((row) => ({ ...row })),
  };
  applyMigration(populated, sql);
  for (const table of targetTables)
    assert.deepEqual(
      tableRows(populated, table),
      oldRows[table],
      table + ' populated parity',
    );
  assert.deepEqual(foreignKeyViolations(populated), []);
  assert.deepEqual(
    populated
      .prepare('SELECT id,recipe FROM image_processing_jobs ORDER BY id')
      .all()
      .map((row) => ({ ...row })),
    oldRecipes.jobs,
    'existing job recipes must not be rewritten',
  );
  assert.deepEqual(
    populated
      .prepare(
        'SELECT workspace_id,recipe FROM workspace_image_processing_policies ORDER BY workspace_id',
      )
      .all()
      .map((row) => ({ ...row })),
    oldRecipes.policies,
    'existing policies must not be rewritten',
  );
  assert.deepEqual(
    populated
      .prepare(
        'SELECT workspace_id,recipe FROM workspace_image_processing_policy_commands ORDER BY workspace_id',
      )
      .all()
      .map((row) => ({ ...row })),
    oldRecipes.commands,
    'existing policy command recipes must not be rewritten',
  );

  const now = Date.now();
  const uploadInsert = populated.prepare(
    'INSERT INTO upload_sessions(id,actor_id,created_by_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,reserved_bytes,status,created_at_ms,expires_at_ms,updated_at_ms,created_request_id,updated_by_request_id,updated_by_session_id,updated_by_actor_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  const uploadValues = (seed, id, bytes, time, status = 'reserved') => [
    id,
    owner,
    session,
    seed.workspace,
    seed.project,
    seed.album,
    'primary',
    seed.workspace +
      '/' +
      seed.project +
      '/' +
      seed.album +
      '/' +
      id +
      '/original',
    'input.jpg',
    bytes,
    bytes,
    status,
    time,
    time + 900000,
    time,
    id,
    id,
    session,
    'user',
  ];
  const uploadTime = Date.now();
  uploadInsert.run(
    ...uploadValues(
      seeds[0],
      '97000000-0000-4000-8000-000000000000',
      67_108_864,
      uploadTime,
      'cancelled',
    ),
  );
  assert.equal(
    populated
      .prepare('SELECT expected_bytes FROM upload_sessions WHERE id=?')
      .get('97000000-0000-4000-8000-000000000000').expected_bytes,
    67_108_864,
    'local-sharp keeps its 64 MiB source limit',
  );

  const changeRequest = '93000000-0000-4000-8000-000000000001';
  populated
    .prepare(
      'INSERT INTO workspace_image_processing_policy_commands(actor_id,request_id,session_id,workspace_id,expected_revision,recipe,created_at_ms) VALUES(?,?,?,?,1,?,?)',
    )
    .run(owner, changeRequest, session, seeds[0].workspace, profile, now);
  assert.equal(
    populated
      .prepare(
        'SELECT recipe FROM workspace_image_processing_policies WHERE workspace_id=?',
      )
      .get(seeds[0].workspace).recipe,
    profile,
    'new profile policy admission',
  );
  uploadInsert.run(
    ...uploadValues(
      seeds[0],
      '97000000-0000-4000-8000-000000000001',
      16_777_216,
      uploadTime,
    ),
  );
  assert.throws(
    () =>
      uploadInsert.run(
        ...uploadValues(
          seeds[0],
          '97000000-0000-4000-8000-000000000002',
          16_777_217,
          uploadTime,
        ),
      ),
    /PROCESSING_SOURCE_LIMIT/u,
    'browser-first source size is capped at 16 MiB',
  );
  assert.throws(
    () =>
      uploadInsert.run(
        ...uploadValues(
          seeds[1],
          '97000000-0000-4000-8000-000000000003',
          16_777_217,
          uploadTime,
        ),
      ),
    /PROCESSING_SOURCE_LIMIT/u,
    'Cloudflare source size limit remains 16 MiB',
  );
  const newPhoto = '94000000-0000-4000-8000-000000000001';
  const newVersion = '95000000-0000-4000-8000-000000000001';
  const newAsset = '96000000-0000-4000-8000-000000000001';
  populated
    .prepare(
      'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
    )
    .run(
      newPhoto,
      seeds[0].workspace,
      seeds[0].project,
      seeds[0].album,
      'browser-first.jpg',
    );
  populated
    .prepare(
      "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,?,?,100,'image/jpeg',10,10,'private')",
    )
    .run(newVersion, seeds[0].workspace, newPhoto, owner, 'b'.repeat(64));
  populated
    .prepare(
      "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,?,'original',?,100,'image/jpeg',?,'private')",
    )
    .run(
      newAsset,
      seeds[0].workspace,
      newPhoto,
      newVersion,
      'primary',
      seeds[0].workspace +
        '/' +
        seeds[0].project +
        '/' +
        seeds[0].album +
        '/' +
        newAsset +
        '/original',
      'b'.repeat(64),
    );
  const newJob = populated
    .prepare('SELECT recipe,status FROM image_processing_jobs WHERE id=?')
    .get(newAsset);
  assert.deepEqual({ ...newJob }, { recipe: profile, status: 'queued' });
  const slots = populated
    .prepare(
      'SELECT kind,object_key FROM image_processing_outputs WHERE job_id=? ORDER BY kind',
    )
    .all(newAsset);
  assert.equal(slots.length, 2);
  assert.ok(
    slots.every((slot) =>
      slot.object_key.includes('/derived/' + profile + '/'),
    ),
  );
  assertNewProfileRetry(populated, newAsset, Date.now());
  assert.deepEqual(foreignKeyViolations(populated), []);

  empty.close();
  populated.close();
}

const db = await loadSchema();
const { sql, closure } = generateMigration(db);
db.close();
await verify(sql, closure);

if (process.argv[2] === '--check') {
  assert.equal(
    await readFile('migrations/' + migrationName, 'utf8'),
    sql,
    '0072 must match the complete 0071-derived schema',
  );
} else {
  let exists = false;
  try {
    await access('migrations/' + migrationName);
    exists = true;
  } catch {}
  assert.equal(exists, false, 'never overwrite an existing migration');
  await writeFile('migrations/' + migrationName, sql, { flag: 'wx' });
}
console.log(
  JSON.stringify({
    status: 'browser_first_schema_checked',
    rebuiltTables: closure.tables,
    rebuiltViews: closure.views.length,
    replacedTriggers: closure.triggers.length,
    populatedRowsPreserved: true,
    oldRecipesUnchanged: true,
    foreignKeyViolations: 0,
  }),
);
