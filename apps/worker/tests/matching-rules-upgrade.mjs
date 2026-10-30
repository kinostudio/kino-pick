import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalizePhotoFilename } from '../../../packages/domain/src/version-matching.ts';
import { ownerAnnotationProcessingCommandSchema } from '../../../packages/contracts/src/annotation-processing.ts';

const quote = (name) => '"' + name.replaceAll('"', '""') + '"';

const OLD_TABLE_COUNT = 119;
const REPLACED_TRIGGER = 'upload_resolved_reservation_guard';

const EXPECTED_ADDED_OBJECTS = [
  'table:matching_rule_filename_index',
  'table:project_matching_rule_commands',
  'table:project_matching_rule_results',
  'table:project_matching_rule_heads',
  'index:matching_rule_filename_index_album_profile',
  'index:matching_rule_filename_index_canonical_scope',
  'index:project_matching_rule_commands_project',
  'index:project_matching_rule_commands_actor',
  'index:project_matching_rule_heads_workspace',
  'view:matching_profile_filename_keys',
  'trigger:matching_rule_filename_index_insert_guard',
  'trigger:matching_rule_filename_index_no_update',
  'trigger:matching_rule_filename_index_no_delete',
  'trigger:project_matching_rule_command_guard',
  'trigger:project_matching_rule_results_insert_guard',
  'trigger:project_matching_rule_audit_insert_guard',
  'trigger:project_matching_rule_command_apply',
  'trigger:project_matching_rule_head_insert_guard',
  'trigger:project_matching_rule_head_update_guard',
  'trigger:project_matching_rule_heads_no_delete',
  'trigger:projects_matching_rule_revision_guard',
  'trigger:project_matching_rule_commands_no_update',
  'trigger:project_matching_rule_commands_no_delete',
  'trigger:project_matching_rule_results_no_update',
  'trigger:project_matching_rule_results_no_delete',
  'trigger:project_matching_rule_commands_no_replace',
  'trigger:project_matching_rule_results_no_replace',
  'trigger:workspace_commands_project_matching_rules_namespace',
  'trigger:request_commands_project_matching_rules_namespace',
  'trigger:upload_requests_project_matching_rules_namespace',
  'trigger:upload_workflow_requests_project_matching_rules_namespace',
  'trigger:processing_review_commands_project_matching_rules_namespace',
  'trigger:invite_revocation_commands_project_matching_rules_namespace',
  'trigger:invite_creation_commands_project_matching_rules_namespace',
  'trigger:selection_policy_commands_project_matching_rules_namespace',
  'trigger:selection_policy_configuration_commands_project_matching_rules_namespace',
  'trigger:shared_review_owner_commands_project_matching_rules_namespace',
  'trigger:photo_version_head_commands_project_matching_rules_namespace',
  'trigger:project_versioning_commands_project_matching_rules_namespace',
  'trigger:owner_comment_commands_project_matching_rules_namespace',
  'trigger:owner_comment_processing_commands_project_matching_rules_namespace',
  'trigger:owner_external_intents_project_matching_rules_namespace',
  'trigger:upload_key_fences_project_matching_rules_namespace',
  'trigger:owner_annotation_processing_commands_project_matching_rules_namespace',
  'trigger:owner_annotation_commands_project_matching_rules_namespace',
  'trigger:selection_reopened_project_matching_rules_namespace',
];

const EXPECTED_REVERSE_NAMESPACE_TABLES = [
  'workspace_commands',
  'request_commands',
  'upload_requests',
  'upload_workflow_requests',
  'processing_review_commands',
  'invite_revocation_commands',
  'invite_creation_commands',
  'selection_policy_commands',
  'selection_policy_configuration_commands',
  'shared_review_owner_commands',
  'photo_version_head_commands',
  'project_versioning_commands',
  'owner_comment_commands',
  'owner_comment_processing_commands',
  'owner_external_intents',
  'upload_key_fences',
  'owner_annotation_processing_commands',
  'owner_annotation_commands',
];

function canonical(value) {
  if (typeof value === 'bigint') return { bigint: value.toString() };
  if (Buffer.isBuffer(value)) return { blob: value.toString('base64') };
  if (value instanceof ArrayBuffer)
    return { blob: Buffer.from(value).toString('base64') };
  if (ArrayBuffer.isView(value))
    return {
      blob: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString('base64'),
    };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

async function productTableNames(db) {
  const result = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  assert.equal(result.success, true);
  return result.results
    .map((row) => row.name)
    .filter(
      (name) =>
        !name.startsWith('sqlite_') &&
        !name.startsWith('_') &&
        name !== 'd1_migrations',
    );
}

async function tableSnapshot(db, names) {
  const entries = [];
  let totalRows = 0;
  for (const name of names) {
    const result = await db.prepare('SELECT * FROM ' + quote(name)).all();
    assert.equal(result.success, true);
    const rows = result.results
      .map((row) => JSON.stringify(canonical(row)))
      .sort();
    totalRows += rows.length;
    entries.push([
      name,
      {
        count: rows.length,
        sha256: createHash('sha256').update(rows.join('\n')).digest('hex'),
      },
    ]);
  }
  return { tables: Object.fromEntries(entries), totalRows };
}

async function schemaObjects(db) {
  const result = await db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name',
    )
    .all();
  assert.equal(result.success, true);
  return result.results;
}

function objectKey(object) {
  return object.type + ':' + object.name;
}

async function createOrdinaryUploadSource(db) {
  const owner = await db
    .prepare(
      "SELECT s.userId AS actor_id,s.id AS session_id,w.id AS workspace_id,p.id AS project_id,a.id AS album_id FROM owner_sessions s JOIN owners o ON o.user_id=s.userId AND o.enabled=1 JOIN workspaces w ON w.owner_user_id=o.user_id JOIN projects p ON p.workspace_id=w.id AND p.status IN('draft','uploading') JOIN albums a ON a.workspace_id=w.id AND a.project_id=p.id AND a.state IN('draft','active') WHERE s.expiresAt>unixepoch('subsec')*1000 ORDER BY s.expiresAt DESC,p.id,a.id LIMIT 1",
    )
    .first();
  assert.ok(
    owner?.actor_id,
    'the populated fixture needs an editable Owner project/album to create one ordinary upload_session source row',
  );
  const uploadSessionId = randomUUID();
  const requestId = randomUUID();
  const originalFilename = 'm3i4-migration-source.jpg';
  const createdAtMs = Date.now();
  const objectKey =
    owner.workspace_id +
    '/' +
    owner.project_id +
    '/' +
    owner.album_id +
    '/' +
    uploadSessionId +
    '/original';
  const result = await db
    .prepare(
      'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      owner.actor_id,
      requestId,
      'upload.reserved',
      JSON.stringify({
        contentType: 'image/png',
        sha256: 'a'.repeat(64),
      }),
      owner.session_id,
      uploadSessionId,
      owner.workspace_id,
      owner.project_id,
      owner.album_id,
      'primary',
      objectKey,
      originalFilename,
      1,
      createdAtMs,
    )
    .run();
  assert.equal(result.success, true);
  const source = await db
    .prepare(
      'SELECT id,workspace_id,project_id,album_id,original_filename FROM upload_sessions WHERE id=?',
    )
    .bind(uploadSessionId)
    .first();
  assert.deepEqual(source, {
    id: uploadSessionId,
    workspace_id: owner.workspace_id,
    project_id: owner.project_id,
    album_id: owner.album_id,
    original_filename: originalFilename,
  });
  return source;
}

async function ensureDefaultWitness(db) {
  let result = await db
    .prepare(
      "SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE profile='default-v1' ORDER BY upload_session_id LIMIT 1",
    )
    .all();
  assert.equal(result.success, true);
  let row = result.results[0];
  if (!row) {
    const sources = await db
      .prepare(
        'SELECT id,workspace_id,project_id,album_id,original_filename FROM upload_sessions WHERE original_filename IS NOT NULL ORDER BY id',
      )
      .all();
    assert.equal(sources.success, true);
    let selected;
    let canonicalized;
    for (const candidate of sources.results) {
      const parsed = canonicalizePhotoFilename(candidate.original_filename);
      if (parsed) {
        selected = candidate;
        canonicalized = parsed;
        break;
      }
    }
    if (!selected) {
      selected = await createOrdinaryUploadSource(db);
      canonicalized = canonicalizePhotoFilename(selected.original_filename);
      assert.ok(canonicalized);
    }
    assert.ok(
      selected,
      'the isolated upgrade fixture must include or create one ordinary canonicalizable upload_session',
    );
    const inserted = await db
      .prepare(
        "INSERT INTO matching_filename_index(upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid) SELECT id,'default-v1',workspace_id,project_id,album_id,original_filename,?,?,0 FROM upload_sessions WHERE id=? AND original_filename=? ON CONFLICT(upload_session_id,profile) DO NOTHING",
      )
      .bind(
        canonicalized.basename,
        canonicalized.extension,
        selected.id,
        selected.original_filename,
      )
      .run();
    assert.equal(inserted.success, true);
    result = await db
      .prepare(
        "SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE upload_session_id=? AND profile='default-v1'",
      )
      .bind(selected.id)
      .all();
    assert.equal(result.success, true);
    row = result.results[0];
    assert.ok(row, 'the guarded INSERT SELECT must create one default witness');
  }

  const expected = canonicalizePhotoFilename(row.original_filename);
  assert.ok(expected, 'default witness must use a valid canonical filename');
  assert.deepEqual(
    {
      basename: row.canonical_basename,
      extension: row.canonical_extension,
      invalid: Number(row.is_invalid),
    },
    {
      basename: expected.basename,
      extension: expected.extension,
      invalid: 0,
    },
    'the existing default-v1 witness must match the pure canonicalizer',
  );
  return row;
}

async function foreignKeyShape(db, table) {
  const result = await db
    .prepare('PRAGMA foreign_key_list(' + quote(table) + ')')
    .all();
  assert.equal(result.success, true);
  return result.results
    .map((row) => [row.from, row.table, row.to])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

async function assertForeignKeyShape(db) {
  const rows = await foreignKeyShape(db, 'matching_rule_filename_index');
  assert.deepEqual(rows, [
    ['album_id', 'upload_sessions', 'album_id'],
    ['original_filename', 'upload_sessions', 'original_filename'],
    ['project_id', 'upload_sessions', 'project_id'],
    ['upload_session_id', 'upload_sessions', 'id'],
    ['workspace_id', 'upload_sessions', 'workspace_id'],
  ]);
  assert.deepEqual(
    await foreignKeyShape(db, 'project_matching_rule_commands'),
    [
      ['previous_command_id', 'project_matching_rule_commands', 'id'],
      ['project_id', 'projects', 'id'],
      ['workspace_id', 'projects', 'workspace_id'],
    ],
  );
  assert.deepEqual(await foreignKeyShape(db, 'project_matching_rule_results'), [
    ['command_id', 'project_matching_rule_commands', 'id'],
    ['previous_command_id', 'project_matching_rule_commands', 'id'],
  ]);
  assert.deepEqual(await foreignKeyShape(db, 'project_matching_rule_heads'), [
    ['command_id', 'project_matching_rule_commands', 'id'],
    ['project_id', 'projects', 'id'],
    ['workspace_id', 'projects', 'workspace_id'],
  ]);
}

export async function verifyMatchingRulesLookupPlans(db, witness) {
  assert.ok(witness?.workspace_id && witness?.project_id && witness?.album_id);
  const sql = [
    'EXPLAIN QUERY PLAN SELECT upload_session_id',
    'FROM matching_profile_filename_keys',
    'WHERE workspace_id=?1 AND project_id=?2 AND album_id=?3',
    'AND profile=?4 AND is_invalid=0',
    'AND canonical_basename COLLATE BINARY=?5 COLLATE BINARY',
    'AND canonical_extension COLLATE BINARY IS ?6 COLLATE BINARY',
  ].join(' ');
  for (const [profile, index] of [
    ['default-v1', 'matching_filename_index_canonical_scope'],
    ['rules-v1-111', 'matching_rule_filename_index_canonical_scope'],
  ]) {
    const plan = await db
      .prepare(sql)
      .bind(
        witness.workspace_id,
        witness.project_id,
        witness.album_id,
        profile,
        witness.canonical_basename,
        witness.canonical_extension,
      )
      .all();
    assert.equal(plan.success, true);
    const details = plan.results.map((row) => String(row.detail));
    assert.ok(
      details.some((detail) => detail.includes(index)),
      profile +
        ' lookup through the UNION view must choose its partial canonical scope index: ' +
        details.join(' | '),
    );
    assert.equal(
      details.some((detail) =>
        /USE TEMP B-TREE FOR (?:ORDER BY|GROUP BY)/u.test(detail),
      ),
      false,
      profile + ' canonical lookup must not materialize a sort',
    );
  }
}

async function assertProfileIndexContracts(db, source) {
  const foreignKeysEnabled = await db.prepare('PRAGMA foreign_keys').first();
  assert.equal(Number(foreignKeysEnabled.foreign_keys), 1);
  await assertForeignKeyShape(db);

  const sourceMismatch = {
    uploadSessionId: '00000000-0000-4000-8000-000000000000',
    profile: 'rules-v1-111',
    workspaceId: source.workspace_id,
    projectId: source.project_id,
    albumId: source.album_id,
    originalFilename: source.original_filename,
    basename: source.canonical_basename,
    extension: source.canonical_extension,
    invalid: 0,
  };
  const insertSql =
    'INSERT INTO matching_rule_filename_index(upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid) VALUES(?,?,?,?,?,?,?,?,?)';
  await assert.rejects(
    db
      .prepare(insertSql)
      .bind(
        source.upload_session_id,
        'default-v1',
        source.workspace_id,
        source.project_id,
        source.album_id,
        source.original_filename,
        source.canonical_basename,
        source.canonical_extension,
        0,
      )
      .run(),
    /MATCHING_FILENAME_INDEX_PROFILE|CHECK constraint failed/u,
    'the profile index must reject a default-v1 witness',
  );
  await assert.rejects(
    db
      .prepare(insertSql)
      .bind(
        sourceMismatch.uploadSessionId,
        sourceMismatch.profile,
        sourceMismatch.workspaceId,
        sourceMismatch.projectId,
        sourceMismatch.albumId,
        sourceMismatch.originalFilename,
        sourceMismatch.basename,
        sourceMismatch.extension,
        sourceMismatch.invalid,
      )
      .run(),
    /MATCHING_FILENAME_INDEX_SOURCE_MISMATCH|FOREIGN KEY constraint failed/u,
    'the profile index must reject a witness without its matching source row',
  );
  assert.equal(
    Number(
      (
        await db
          .prepare('SELECT count(*) AS n FROM matching_rule_filename_index')
          .first()
      ).n,
    ),
    0,
    'rejected source/default rows must leave the profile index empty',
  );

  const profileOptions = {
    caseSensitive: false,
    allowJpgJpegEquivalence: true,
    stripRecognizedSuffixes: true,
  };
  const profileCanonical = canonicalizePhotoFilename(
    source.original_filename,
    profileOptions,
  );
  const profileRow = {
    uploadSessionId: source.upload_session_id,
    profile: 'rules-v1-111',
    workspaceId: source.workspace_id,
    projectId: source.project_id,
    albumId: source.album_id,
    originalFilename: source.original_filename,
    basename: profileCanonical?.basename ?? null,
    extension: profileCanonical?.extension ?? null,
    invalid: profileCanonical ? 0 : 1,
  };
  const inserted = await db
    .prepare(insertSql)
    .bind(
      profileRow.uploadSessionId,
      profileRow.profile,
      profileRow.workspaceId,
      profileRow.projectId,
      profileRow.albumId,
      profileRow.originalFilename,
      profileRow.basename,
      profileRow.extension,
      profileRow.invalid,
    )
    .run();
  assert.equal(inserted.success, true);
  const readProfileRow = async () =>
    db
      .prepare(
        'SELECT rowid,upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_rule_filename_index WHERE upload_session_id=? AND profile=?',
      )
      .bind(profileRow.uploadSessionId, profileRow.profile)
      .first();
  const before = await readProfileRow();
  assert.ok(before?.rowid);
  assert.deepEqual(
    {
      upload_session_id: before.upload_session_id,
      profile: before.profile,
      workspace_id: before.workspace_id,
      project_id: before.project_id,
      album_id: before.album_id,
      original_filename: before.original_filename,
      canonical_basename: before.canonical_basename,
      canonical_extension: before.canonical_extension,
      is_invalid: Number(before.is_invalid),
    },
    {
      upload_session_id: profileRow.uploadSessionId,
      profile: profileRow.profile,
      workspace_id: profileRow.workspaceId,
      project_id: profileRow.projectId,
      album_id: profileRow.albumId,
      original_filename: profileRow.originalFilename,
      canonical_basename: profileRow.basename,
      canonical_extension: profileRow.extension,
      is_invalid: profileRow.invalid,
    },
  );

  const idempotent = await db
    .prepare(
      'INSERT INTO matching_rule_filename_index(upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(upload_session_id,profile) DO NOTHING',
    )
    .bind(
      profileRow.uploadSessionId,
      profileRow.profile,
      profileRow.workspaceId,
      profileRow.projectId,
      profileRow.albumId,
      profileRow.originalFilename,
      profileRow.basename,
      profileRow.extension,
      profileRow.invalid,
    )
    .run();
  assert.equal(idempotent.success, true);
  assert.deepEqual(await readProfileRow(), before);

  const changedCanonical = [
    profileRow.uploadSessionId,
    profileRow.profile,
    profileRow.workspaceId,
    profileRow.projectId,
    profileRow.albumId,
    profileRow.originalFilename,
    (profileRow.basename ?? 'invalid') + '-changed',
    profileRow.extension,
    profileRow.invalid,
  ];
  await assert.rejects(
    db
      .prepare(
        'INSERT OR REPLACE INTO matching_rule_filename_index(upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(...changedCanonical)
      .run(),
    /MATCHING_FILENAME_INDEX_IMMUTABLE/u,
    'INSERT OR REPLACE must not change an existing canonical pair',
  );
  const changedScope = [
    profileRow.uploadSessionId,
    profileRow.profile,
    '00000000-0000-4000-8000-000000000000',
    profileRow.projectId,
    profileRow.albumId,
    profileRow.originalFilename,
    profileRow.basename,
    profileRow.extension,
    profileRow.invalid,
  ];
  await assert.rejects(
    db
      .prepare(
        'INSERT OR REPLACE INTO matching_rule_filename_index(upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(...changedScope)
      .run(),
    /MATCHING_FILENAME_INDEX_SOURCE_MISMATCH/u,
    'INSERT OR REPLACE must reject a scope that differs from the source upload_session',
  );
  const changedSource = [
    profileRow.uploadSessionId,
    profileRow.profile,
    profileRow.workspaceId,
    profileRow.projectId,
    profileRow.albumId,
    'changed-source-name.jpg',
    profileRow.basename,
    profileRow.extension,
    profileRow.invalid,
  ];
  await assert.rejects(
    db
      .prepare(
        'INSERT OR REPLACE INTO matching_rule_filename_index(upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(...changedSource)
      .run(),
    /MATCHING_FILENAME_INDEX_SOURCE_MISMATCH/u,
    'INSERT OR REPLACE must reject a source filename that differs from upload_sessions',
  );
  assert.deepEqual(
    await readProfileRow(),
    before,
    'rejected changed canonical/scope/source replacements must preserve rowid and all stored fields',
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE matching_rule_filename_index SET canonical_basename=? WHERE upload_session_id=? AND profile=?',
      )
      .bind('mutated', profileRow.uploadSessionId, profileRow.profile)
      .run(),
    /MATCHING_FILENAME_INDEX_IMMUTABLE/u,
  );
  await assert.rejects(
    db
      .prepare(
        'DELETE FROM matching_rule_filename_index WHERE upload_session_id=? AND profile=?',
      )
      .bind(profileRow.uploadSessionId, profileRow.profile)
      .run(),
    /MATCHING_FILENAME_INDEX_IMMUTABLE/u,
  );
  assert.deepEqual(await readProfileRow(), before);
}

async function matchingRulesCommand(db, fixture, intent) {
  const requestId = intent.requestId ?? randomUUID();
  const expectedProjectRevision = intent.expectedProjectRevision;
  const expectedRuleRevision = intent.expectedRuleRevision;
  const beforeProfile = intent.beforeProfile;
  const profile = intent.profile;
  const commandId = intent.id ?? randomUUID();
  const payload = JSON.stringify({
    projectId: fixture.project_id,
    expectedProjectRevision,
    expectedRuleRevision,
    profile,
    confirm: true,
  });
  const result = await db
    .prepare(
      'INSERT INTO project_matching_rule_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,expected_project_revision,expected_rule_revision,before_profile,profile,confirm,previous_command_id,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      commandId,
      fixture.actor_id,
      fixture.session_id,
      requestId,
      'project.matching_rules.set',
      fixture.workspace_id,
      fixture.project_id,
      expectedProjectRevision,
      expectedRuleRevision,
      beforeProfile,
      profile,
      1,
      intent.previousCommandId ?? null,
      payload,
      Date.now(),
    )
    .run();
  assert.equal(result.success, true);
  return { commandId, requestId };
}

async function processingCommandStatement(db, fixture, intent) {
  const requestId = intent.requestId ?? randomUUID();
  const id = intent.id ?? randomUUID();
  const state = intent.state ?? 'in_progress';
  const command = ownerAnnotationProcessingCommandSchema.parse({
    requestId,
    expectedOwnerId: fixture.actor_id,
    operation: 'set_processing_state',
    inviteId: fixture.invite_id,
    photoId: fixture.photo_id,
    versionId: fixture.version_id,
    annotationId: fixture.annotation_id,
    expectedAnnotationRevision: fixture.annotation_revision,
    expectedProcessingRevision: intent.expectedProcessingRevision,
    state,
  });
  // Keep the exact field order used by canonicalAnnotationProcessingCommand()
  // in src/annotation-processing.ts so the D1 witness matches service bytes.
  const requestJson = JSON.stringify({
    requestId: command.requestId,
    expectedOwnerId: command.expectedOwnerId,
    operation: command.operation,
    inviteId: command.inviteId,
    photoId: command.photoId,
    versionId: command.versionId,
    annotationId: command.annotationId,
    expectedAnnotationRevision: command.expectedAnnotationRevision,
    expectedProcessingRevision: command.expectedProcessingRevision,
    state: command.state,
  });
  const createdAtMs = Date.now();
  return {
    id,
    requestId,
    command,
    requestJson,
    createdAtMs,
    statement: db
      .prepare(
        "INSERT INTO owner_annotation_processing_commands(id,actor_id,expected_owner_id,session_id,request_id,workspace_id,project_id,album_id,invite_id,photo_id,version_id,annotation_id,operation,expected_annotation_revision,expected_processing_revision,state,content_revision,request_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'set_processing_state',?,?,?,?,?,?)",
      )
      .bind(
        id,
        fixture.actor_id,
        command.expectedOwnerId,
        fixture.session_id,
        command.requestId,
        fixture.workspace_id,
        fixture.project_id,
        fixture.album_id,
        command.inviteId,
        command.photoId,
        command.versionId,
        command.annotationId,
        command.expectedAnnotationRevision,
        command.expectedProcessingRevision,
        command.state,
        fixture.content_revision,
        requestJson,
        createdAtMs,
      ),
  };
}
async function snapshotNamespaceSideEffects(db) {
  const names = [
    'projects',
    'project_matching_rule_commands',
    'project_matching_rule_results',
    'project_matching_rule_heads',
    'owner_annotation_processing_commands',
    'owner_annotation_processing_states',
    'owner_annotation_processing_changes',
    'owner_annotation_processing_results',
    'audit_events',
  ];
  return {
    ...(await tableSnapshot(db, names)),
    sequences: (
      await db
        .prepare(
          "SELECT name,seq FROM sqlite_sequence WHERE name LIKE 'owner_annotation_processing_%' ORDER BY name",
        )
        .all()
    ).results,
  };
}

async function assertProcessingNamespaceBothDirections(db) {
  const fixture = await db
    .prepare(
      "SELECT c.actor_id,c.session_id,g.invite_id,g.workspace_id,g.project_id,g.album_id,g.photo_id,g.version_id,g.id AS annotation_id,g.revision AS annotation_revision,(SELECT MAX(ch.revision) FROM guest_annotation_changes ch WHERE ch.annotation_id=g.id AND ch.operation IN('create','update')) AS content_revision FROM owner_annotation_commands c JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.id=c.session_id AND s.userId=c.actor_id AND s.expiresAt>unixepoch('subsec')*1000 JOIN guest_annotations g ON g.invite_id=c.invite_id AND g.workspace_id=c.workspace_id AND g.project_id=c.project_id AND g.album_id=c.album_id AND g.photo_id=c.photo_id AND g.version_id=c.version_id AND g.state<>'deleted' WHERE c.operation='create' ORDER BY c.created_at_ms,c.id LIMIT 1",
    )
    .first();
  assert.ok(
    fixture?.annotation_id && fixture?.content_revision,
    'the populated upgrade fixture must supply an editable Guest annotation and its live Owner author session',
  );
  const project = await db
    .prepare(
      "SELECT revision FROM projects WHERE id=? AND workspace_id=? AND status NOT IN('archived','deleting','deleted')",
    )
    .bind(fixture.project_id, fixture.workspace_id)
    .first();
  assert.ok(project?.revision > 0);
  fixture.project_revision = Number(project.revision);

  const matchingFirst = await matchingRulesCommand(db, fixture, {
    expectedProjectRevision: fixture.project_revision,
    expectedRuleRevision: 0,
    beforeProfile: 'default-v1',
    profile: 'rules-v1-001',
  });
  assert.equal(
    Number(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM project_matching_rule_heads WHERE project_id=? AND workspace_id=?',
          )
          .bind(fixture.project_id, fixture.workspace_id)
          .first()
      ).n,
    ),
    1,
    'the accepted matching-rules command must materialize its current head',
  );

  const processingBeforePositive = await db
    .prepare(
      'SELECT revision,state FROM owner_annotation_processing_states WHERE annotation_id=?',
    )
    .bind(fixture.annotation_id)
    .first();
  const processingRevisionBeforePositive = Number(
    processingBeforePositive?.revision ?? 0,
  );
  const processingFirst = await processingCommandStatement(db, fixture, {
    expectedProcessingRevision: processingRevisionBeforePositive,
    state: 'in_progress',
  });
  const processingInputCheck = await db
    .prepare(
      `WITH candidate(id,actor_id,expected_owner_id,request_id,operation,state,request_json,invite_id,photo_id,version_id,annotation_id,expected_annotation_revision,expected_processing_revision) AS (SELECT CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS INTEGER),CAST(? AS INTEGER))
       SELECT
         CASE WHEN expected_owner_id=actor_id THEN 1 ELSE 0 END AS owner_matches,
         CASE WHEN id IS NOT NULL AND length(id)=36 AND id=lower(id)
           AND id NOT GLOB '*[^0-9a-f-]*' THEN 1 ELSE 0 END AS id_valid,
         CASE WHEN request_id IS NOT NULL AND length(request_id)=36 AND request_id=lower(request_id)
           AND request_id NOT GLOB '*[^0-9a-f-]*' THEN 1 ELSE 0 END AS request_id_valid,
         CASE WHEN operation='set_processing_state' THEN 1 ELSE 0 END AS operation_valid,
         CASE WHEN state IN('open','in_progress','resolved') THEN 1 ELSE 0 END AS state_valid,
         CASE WHEN request_json IS NOT NULL AND json_valid(request_json)
           AND json_type(request_json)='object' AND length(request_json)<=20000
           THEN 1 ELSE 0 END AS request_json_valid,
         CASE WHEN request_json=json_object(
           'requestId',request_id,'expectedOwnerId',expected_owner_id,
           'operation','set_processing_state','inviteId',invite_id,
           'photoId',photo_id,'versionId',version_id,'annotationId',annotation_id,
           'expectedAnnotationRevision',expected_annotation_revision,
           'expectedProcessingRevision',expected_processing_revision,'state',state
         ) THEN 1 ELSE 0 END AS request_json_matches
       FROM candidate`,
    )
    .bind(
      processingFirst.id,
      fixture.actor_id,
      processingFirst.command.expectedOwnerId,
      processingFirst.requestId,
      processingFirst.command.operation,
      processingFirst.command.state,
      processingFirst.requestJson,
      processingFirst.command.inviteId,
      processingFirst.command.photoId,
      processingFirst.command.versionId,
      processingFirst.command.annotationId,
      processingFirst.command.expectedAnnotationRevision,
      processingFirst.command.expectedProcessingRevision,
    )
    .first();
  assert.deepEqual(
    processingInputCheck,
    {
      owner_matches: 1,
      id_valid: 1,
      request_id_valid: 1,
      operation_valid: 1,
      state_valid: 1,
      request_json_valid: 1,
      request_json_matches: 1,
    },
    'the positive-control fixture must satisfy every 0047 INVALID_INPUT predicate',
  );
  const processingInsert = await processingFirst.statement.run();
  assert.equal(
    processingInsert.success,
    true,
    'a fresh-ID processing positive control must prove the same command shape is valid',
  );
  const processingRow = await db
    .prepare(
      'SELECT id,actor_id,request_id FROM owner_annotation_processing_commands WHERE id=?',
    )
    .bind(processingFirst.id)
    .first();
  assert.deepEqual(processingRow, {
    id: processingFirst.id,
    actor_id: fixture.actor_id,
    request_id: processingFirst.requestId,
  });
  const processingStateAfterPositive = await db
    .prepare(
      'SELECT revision,state FROM owner_annotation_processing_states WHERE annotation_id=?',
    )
    .bind(fixture.annotation_id)
    .first();
  assert.deepEqual(processingStateAfterPositive, {
    revision: processingRevisionBeforePositive + 1,
    state: 'in_progress',
  });

  const processingAfterRules = await processingCommandStatement(db, fixture, {
    requestId: matchingFirst.requestId,
    expectedProcessingRevision: Number(processingStateAfterPositive.revision),
    state: 'resolved',
  });
  const beforeProcessingConflict = await snapshotNamespaceSideEffects(db);
  await assert.rejects(
    processingAfterRules.statement.run(),
    /REQUEST_ID_CONFLICT/u,
    'a valid processing command after a matching-rules command must conflict in the shared namespace',
  );
  assert.deepEqual(
    await snapshotNamespaceSideEffects(db),
    beforeProcessingConflict,
    'the rejected post-insert processing namespace conflict must roll back all processing, audit and project effects',
  );

  const afterSuccessfulProcessing = await snapshotNamespaceSideEffects(db);
  await assert.rejects(
    matchingRulesCommand(db, fixture, {
      requestId: processingFirst.requestId,
      expectedProjectRevision: fixture.project_revision,
      expectedRuleRevision: 0,
      beforeProfile: 'default-v1',
      profile: 'rules-v1-010',
    }),
    /REQUEST_ID_CONFLICT/u,
    'a stale matching-rules command must see the earlier processing request conflict before rules revision CAS',
  );
  assert.deepEqual(
    await snapshotNamespaceSideEffects(db),
    afterSuccessfulProcessing,
    'the rejected stale rules request must leave the valid processing receipt and every related ledger unchanged',
  );

  const processingState = await db
    .prepare(
      'SELECT revision,state FROM owner_annotation_processing_states WHERE annotation_id=?',
    )
    .bind(fixture.annotation_id)
    .first();
  assert.deepEqual(processingState, {
    revision: processingRevisionBeforePositive + 1,
    state: 'in_progress',
  });
  const ruleCommand = await db
    .prepare(
      'SELECT profile,expected_rule_revision FROM project_matching_rule_commands WHERE id=?',
    )
    .bind(matchingFirst.commandId)
    .first();
  assert.deepEqual(ruleCommand, {
    profile: 'rules-v1-001',
    expected_rule_revision: 0,
  });
  const immutableCommand = await db
    .prepare('SELECT * FROM project_matching_rule_commands WHERE id=?')
    .bind(matchingFirst.commandId)
    .first();
  await assert.rejects(
    db
      .prepare(
        'INSERT OR REPLACE INTO project_matching_rule_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,expected_project_revision,expected_rule_revision,before_profile,profile,confirm,previous_command_id,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        immutableCommand.id,
        immutableCommand.actor_id,
        immutableCommand.session_id,
        immutableCommand.request_id,
        immutableCommand.operation,
        immutableCommand.workspace_id,
        immutableCommand.project_id,
        immutableCommand.expected_project_revision,
        immutableCommand.expected_rule_revision,
        immutableCommand.before_profile,
        immutableCommand.profile,
        immutableCommand.confirm,
        immutableCommand.previous_command_id,
        immutableCommand.payload_json,
        immutableCommand.created_at_ms,
      )
      .run(),
    /IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND/u,
    'INSERT OR REPLACE must not replace an existing command even with its exact payload',
  );
  assert.deepEqual(
    await db
      .prepare('SELECT * FROM project_matching_rule_commands WHERE id=?')
      .bind(matchingFirst.commandId)
      .first(),
    immutableCommand,
  );
  const immutableResult = await db
    .prepare('SELECT * FROM project_matching_rule_results WHERE command_id=?')
    .bind(matchingFirst.commandId)
    .first();
  await assert.rejects(
    db
      .prepare(
        'INSERT OR REPLACE INTO project_matching_rule_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        immutableResult.command_id,
        immutableResult.previous_command_id,
        immutableResult.before_json,
        immutableResult.after_json,
        immutableResult.result_json,
        immutableResult.event_id,
        immutableResult.occurred_at_utc,
      )
      .run(),
    /IMMUTABLE_PROJECT_MATCHING_RULE_RESULT/u,
    'INSERT OR REPLACE must not replace an existing result even with its exact payload',
  );
  assert.deepEqual(
    await db
      .prepare('SELECT * FROM project_matching_rule_results WHERE command_id=?')
      .bind(matchingFirst.commandId)
      .first(),
    immutableResult,
  );
  const processingCounts = await db
    .prepare(
      'SELECT (SELECT count(*) FROM owner_annotation_processing_commands) AS commands,(SELECT count(*) FROM owner_annotation_processing_results) AS results,(SELECT count(*) FROM owner_annotation_processing_changes) AS changes',
    )
    .first();
  assert.deepEqual(processingCounts, { commands: 1, results: 1, changes: 1 });

  await assert.rejects(
    db
      .prepare(
        "UPDATE project_matching_rule_commands SET profile='rules-v1-010' WHERE id=?",
      )
      .bind(matchingFirst.commandId)
      .run(),
    /IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND/u,
  );
  await assert.rejects(
    db
      .prepare('DELETE FROM project_matching_rule_commands WHERE id=?')
      .bind(matchingFirst.commandId)
      .run(),
    /IMMUTABLE_PROJECT_MATCHING_RULE_COMMAND/u,
  );
  await assert.rejects(
    db
      .prepare(
        "UPDATE project_matching_rule_results SET result_json='{}' WHERE command_id=?",
      )
      .bind(matchingFirst.commandId)
      .run(),
    /IMMUTABLE_PROJECT_MATCHING_RULE_RESULT/u,
  );
  await assert.rejects(
    db
      .prepare('DELETE FROM project_matching_rule_results WHERE command_id=?')
      .bind(matchingFirst.commandId)
      .run(),
    /IMMUTABLE_PROJECT_MATCHING_RULE_RESULT/u,
  );
  await assert.rejects(
    db
      .prepare('DELETE FROM project_matching_rule_heads WHERE project_id=?')
      .bind(fixture.project_id)
      .run(),
    /IMMUTABLE_PROJECT_MATCHING_RULE_HEAD/u,
  );
  await assert.rejects(
    db
      .prepare(
        "UPDATE project_matching_rule_heads SET profile='rules-v1-010',revision=revision+1,command_id=? WHERE project_id=?",
      )
      .bind(randomUUID(), fixture.project_id)
      .run(),
    /INVALID_PROJECT_MATCHING_RULE_HEAD/u,
    'the current head may advance only with a valid command/result/audit CAS',
  );
}

function sourceObjectKeys(source) {
  const objects = [];
  for (const match of source.matchAll(
    /\bCREATE\s+(TABLE|VIEW|INDEX|TRIGGER)\s+([A-Za-z0-9_]+)/gimu,
  ))
    objects.push(match[1].toLowerCase() + ':' + match[2]);
  return objects.sort();
}

export async function verifyMatchingRulesUpgrade({ db, source51 }) {
  assert.ok(
    db,
    'matching-rules upgrade requires an isolated native D1 database',
  );
  assert.equal(typeof source51, 'string');
  assert.ok(source51.trim());

  // Seed one guarded default-v1 witness through its real source row before the
  // migration baseline. This proves the 0051 union preserves a populated legacy
  // index without claiming that the migration backfilled any rows.
  const defaultWitness = await ensureDefaultWitness(db);
  const oldTables = await productTableNames(db);
  assert.equal(oldTables.length, OLD_TABLE_COUNT);
  const before = await tableSnapshot(db, oldTables);
  assert.ok(
    before.totalRows > 0,
    'a populated 119-table source state is required',
  );
  assert.ok(before.tables.matching_filename_index.count > 0);
  const beforeObjects = await schemaObjects(db);
  const sequences = (
    await db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()
  ).results;
  const dropped = [
    ...source51.matchAll(
      /\bDROP\s+(TABLE|VIEW|INDEX|TRIGGER)\s+([A-Za-z0-9_]+)/gimu,
    ),
  ].map((match) => match[1].toLowerCase() + ':' + match[2]);
  assert.deepEqual(dropped, ['trigger:' + REPLACED_TRIGGER]);
  const parsedCreated = sourceObjectKeys(source51);
  assert.deepEqual(
    parsedCreated,
    [...EXPECTED_ADDED_OBJECTS, 'trigger:' + REPLACED_TRIGGER].sort(),
    '0051 must create the exact reviewed additive object set plus the one explicitly replaced legacy guard',
  );
  assert.deepEqual(
    EXPECTED_REVERSE_NAMESPACE_TABLES.length,
    18,
    '0051 has eighteen previous Owner ledger insert guards plus one audit-event guard',
  );

  await db.exec(source51);

  const afterTables = await productTableNames(db);
  assert.deepEqual(
    afterTables,
    [
      ...oldTables,
      'matching_rule_filename_index',
      'project_matching_rule_commands',
      'project_matching_rule_heads',
      'project_matching_rule_results',
    ].sort(),
    '0051 may add exactly four tables and may not remove or rebuild an old table',
  );
  assert.deepEqual(
    await tableSnapshot(db, oldTables),
    before,
    'all 119 old tables retain their exact row counts and canonical content hashes',
  );
  assert.deepEqual(
    (
      await db
        .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
        .all()
    ).results,
    sequences,
    '0051 must preserve every existing AUTOINCREMENT sequence',
  );

  const afterObjects = await schemaObjects(db);
  const afterObjectMap = new Map(
    afterObjects.map((object) => [objectKey(object), object]),
  );
  const changedOld = [];
  for (const oldObject of beforeObjects) {
    const current = afterObjectMap.get(objectKey(oldObject));
    if (oldObject.name === REPLACED_TRIGGER && oldObject.type === 'trigger') {
      assert.ok(current, 'the replaced upload guard must remain present');
      assert.equal(current.tbl_name, 'upload_requests');
      assert.notEqual(current.sql, oldObject.sql);
      assert.match(current.sql, /matchingProfile/u);
      assert.match(current.sql, /project_matching_rule_heads/u);
      assert.match(current.sql, /project_matching_rule_commands/u);
      assert.match(current.sql, /matchingProfile\.ruleRevision/u);
      changedOld.push(objectKey(oldObject));
    } else {
      assert.deepEqual(
        current,
        oldObject,
        'old schema object changed outside the documented reservation guard: ' +
          objectKey(oldObject),
      );
    }
  }
  assert.deepEqual(changedOld, ['trigger:' + REPLACED_TRIGGER]);
  const oldObjectKeys = new Set(beforeObjects.map(objectKey));
  const added = afterObjects.filter(
    (object) => !oldObjectKeys.has(objectKey(object)),
  );
  assert.deepEqual(
    added.map(objectKey).sort(),
    [...EXPECTED_ADDED_OBJECTS].sort(),
    '0051 must add exactly the four new tables, their supporting objects, namespace guards and union view',
  );

  for (const table of [
    'matching_rule_filename_index',
    'project_matching_rule_commands',
    'project_matching_rule_results',
    'project_matching_rule_heads',
  ]) {
    const row = await db
      .prepare('SELECT count(*) AS n FROM ' + quote(table))
      .first();
    assert.equal(
      Number(row.n),
      0,
      table + ' must not be backfilled or materialized implicitly by migration',
    );
  }
  const unionCount = await db
    .prepare('SELECT count(*) AS n FROM matching_profile_filename_keys')
    .first();
  assert.equal(
    Number(unionCount.n),
    before.tables.matching_filename_index.count,
    'the union view must expose the existing default-v1 witnesses exactly once',
  );

  const reverseGuards = afterObjects
    .filter(
      (object) =>
        object.type === 'trigger' &&
        object.name.endsWith('_project_matching_rules_namespace') &&
        object.name !== 'selection_reopened_project_matching_rules_namespace',
    )
    .map((object) => {
      const match = /AFTER INSERT ON ([A-Za-z0-9_]+)/iu.exec(object.sql);
      assert.ok(match, object.name + ' must be an AFTER INSERT reverse guard');
      return [object.name, match[1]];
    })
    .sort((a, b) => a[1].localeCompare(b[1]));
  assert.deepEqual(
    reverseGuards.map((entry) => entry[1]),
    [...EXPECTED_REVERSE_NAMESPACE_TABLES].sort(),
    '0051 must install the complete 18-ledger reverse request namespace set',
  );
  assert.equal(
    reverseGuards.length + 1,
    19,
    'the 18 prior Owner ledgers and selection.reopened audit path total nineteen reverse guards',
  );
  assert.ok(
    afterObjectMap.has(
      'trigger:selection_reopened_project_matching_rules_namespace',
    ),
    'the 19th reverse guard must cover selection.reopened audit events',
  );
  assert.match(
    afterObjectMap.get(
      'trigger:selection_reopened_project_matching_rules_namespace',
    ).sql,
    /BEFORE INSERT ON audit_events/u,
  );
  const rulesGuard = afterObjectMap.get(
    'trigger:project_matching_rule_command_guard',
  );
  assert.ok(rulesGuard?.sql);
  for (const table of EXPECTED_REVERSE_NAMESPACE_TABLES)
    assert.ok(
      rulesGuard.sql.toLowerCase().includes('from ' + table.toLowerCase()),
      'the matching-rules command must precheck prior ledger ' + table,
    );
  assert.match(
    rulesGuard.sql,
    /owner_annotation_processing_commands/u,
    'matching-rules requests must precheck the 0047 Owner processing ledger',
  );
  assert.match(
    rulesGuard.sql,
    /FROM audit_events e/u,
    'matching-rules requests must precheck the selection.reopened audit namespace',
  );

  await assertProfileIndexContracts(db, defaultWitness);
  await verifyMatchingRulesLookupPlans(db, defaultWitness);
  await assertProcessingNamespaceBothDirections(db);

  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
    'the populated 0051 upgrade and native namespace probes must remain FK-clean',
  );
  return {
    oldTableCount: oldTables.length,
    preservedRows: before.totalRows,
    newTables: 4,
    addedObjects: added.length,
    changedOldObjects: changedOld,
    defaultWitnessSessionId: defaultWitness.upload_session_id,
    reverseNamespaceLedgers: EXPECTED_REVERSE_NAMESPACE_TABLES.length + 1,
    lookupPlans: ['default-v1', 'rules-v1-111'],
    processingNamespaceDirections: 2,
  };
}
