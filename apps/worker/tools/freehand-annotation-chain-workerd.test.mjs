import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigration } from '../tests/apply-migration.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(testDirectory, '..');
const migrationDirectory = join(workerRoot, 'migrations');
const proposalPath = join(
  workerRoot,
  'migration-proposals',
  'annotation_freehand_geometry_v1.sql',
);
const migrationPath = join(
  migrationDirectory,
  '0058_annotation_freehand_geometry_v1.sql',
);
const configPath = join(workerRoot, 'wrangler.jsonc');
const temporaryRoot = resolve(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, 'kino-freehand-workerd-'));
function validatedTemporaryPath() {
  const resolved = resolve(temporary);
  assert.equal(
    dirname(resolved),
    temporaryRoot,
    'temporary target must be a direct child of tmpdir()',
  );
  assert.match(
    basename(resolved),
    /^kino-freehand-workerd-[A-Za-z0-9]+$/u,
    "temporary target must be this runner's concrete mkdtemp directory",
  );
  return resolved;
}
validatedTemporaryPath();
let mf;

async function check(label, action) {
  await action();
  process.stdout.write('passed: ' + label + '\n');
}

async function expectFailure(action, code) {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'expected D1 failure containing ' + code);
  assert.match(String(failure), new RegExp(code));
  return failure;
}

function migrationStatements(source) {
  const lines = source.split(/\r?\n/u);
  const statements = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    if (/^DROP TRIGGER\b/i.test(trimmed)) {
      assert.match(trimmed, /;$/u);
      statements.push(trimmed);
      continue;
    }
    if (/^CREATE TRIGGER\b/i.test(trimmed)) {
      const body = [line];
      let ended = false;
      for (index++; index < lines.length; index++) {
        body.push(lines[index]);
        if (/^END;\s*$/i.test(lines[index].trim())) {
          ended = true;
          break;
        }
      }
      assert.ok(ended, 'migration trigger must end with a standalone END;');
      statements.push(body.join('\n'));
      continue;
    }
    assert.fail(
      'unexpected migration SQL outside DROP/CREATE trigger statements: ' +
        trimmed,
    );
  }
  return statements;
}

async function applyBaseline(db) {
  const names = (await readdir(migrationDirectory))
    .filter(
      (name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 57,
    )
    .sort();
  assert.equal(names.length, 57);
  assert.deepEqual(
    names.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: 57 }, (_, index) => index + 1),
  );
  assert.equal(names.at(-1), '0057_album_activation_commands.sql');
  for (const name of names) {
    const source = await readFile(join(migrationDirectory, name), 'utf8');
    await applyMigration(db, source);
  }
  return names;
}

const count = async (db, table, where = '', ...values) => {
  const result = await db
    .prepare('SELECT count(*) AS count FROM ' + table + where)
    .bind(...values)
    .first();
  return Number(result.count);
};

const first = async (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .first();

const run = async (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .run();

async function guardDefinitions(db) {
  const result = await db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN (?,?) ORDER BY name",
    )
    .bind(
      'guest_annotation_command_guard',
      'owner_annotation_command_insert_guard',
    )
    .all();
  assert.equal(
    result.results.length,
    2,
    'both annotation command guards must exist',
  );
  return Object.fromEntries(result.results.map((row) => [row.name, row.sql]));
}

async function artifactCounts(db) {
  const tables = [
    'guest_annotation_commands',
    'owner_annotation_commands',
    'guest_annotations',
    'owner_annotations',
    'guest_annotation_changes',
    'owner_annotation_changes',
    'guest_annotation_results',
    'owner_annotation_results',
    'audit_events',
  ];
  const counts = {};
  for (const table of tables) counts[table] = await count(db, table);
  return counts;
}

async function annotationDataSnapshot(db) {
  const tables = [
    'guest_annotation_commands',
    'owner_annotation_commands',
    'guest_annotations',
    'owner_annotations',
    'guest_annotation_changes',
    'owner_annotation_changes',
    'guest_annotation_results',
    'owner_annotation_results',
    'audit_events',
  ];
  const snapshot = {};
  for (const table of tables) {
    const rows = (await db.prepare('SELECT * FROM ' + table).all()).results;
    snapshot[table] = rows
      .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row))))
      .sort();
  }
  return snapshot;
}
async function assertForeignKeysClean(db) {
  const result = await db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(result.results.length, 0, 'D1 foreign_key_check must be empty');
}

try {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'freehand-migration',
          modules: true,
          script:
            "export default { async fetch() { return new Response('ok'); } };",
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'freehand-migration-isolated' },
          r2Buckets: { TEST_R2: 'freehand-migration-isolated' },
        },
      ],
      d1Persist: join(temporary, 'd1'),
      r2Persist: join(temporary, 'r2'),
    }),
  );
  const db = await mf.getD1Database('DB', 'freehand-migration');
  const wrangler = await readFile(configPath, 'utf8');
  assert.match(wrangler, /"migrations_dir"\s*:\s*"migrations"/u);
  assert.notEqual(dirname(resolve(proposalPath)), resolve(migrationDirectory));
  assert.ok(
    !resolve(proposalPath).startsWith(
      resolve(migrationDirectory) + join('', ''),
    ),
    'review proposal must remain outside the configured migrations directory',
  );

  const migrationNames = await applyBaseline(db);
  await assertForeignKeysClean(db);
  await check(
    'native workerd D1 applies the complete immutable migrations 0001-0057 chain before 0058',
    async () => {
      assert.equal(migrationNames.at(-1), '0057_album_activation_commands.sql');
      assert.equal(await count(db, 'guest_annotation_commands'), 0);
      assert.equal(await count(db, 'owner_annotation_commands'), 0);
    },
  );

  const proposal = await readFile(proposalPath, 'utf8');
  assert.match(proposal, /REVIEW-ONLY PROPOSAL\. DO NOT APPLY/u);
  assert.match(proposal, /length\(CAST\(NEW\.geometry_json AS BLOB\)\)<=8192/u);
  const proposalStatements = migrationStatements(proposal);
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /Forward-only migration 0058/u);
  assert.match(
    migration,
    /length\(CAST\(NEW\.geometry_json AS BLOB\)\)<=8192/u,
  );
  assert.doesNotMatch(migration, /^\s*(CREATE|ALTER|DROP)\s+TABLE\b/imu);
  const statements = migrationStatements(migration);
  assert.deepEqual(
    statements,
    proposalStatements,
    '0058 must match the reviewed trigger definitions',
  );
  assert.equal(
    statements.length,
    4,
    '0058 must contain exactly two DROP/CREATE pairs',
  );
  assert.match(
    statements[0],
    /^DROP TRIGGER guest_annotation_command_guard;$/u,
  );
  assert.match(
    statements[1],
    /^CREATE TRIGGER guest_annotation_command_guard\b/u,
  );
  assert.match(
    statements[2],
    /^DROP TRIGGER owner_annotation_command_insert_guard;$/u,
  );
  assert.match(
    statements[3],
    /^CREATE TRIGGER owner_annotation_command_insert_guard\b/u,
  );

  const originalGuards = await guardDefinitions(db);
  const emptyArtifacts = await artifactCounts(db);
  async function expectBatchRollback(label, batchStatements) {
    await check(label, async () => {
      await expectFailure(
        () => db.batch(batchStatements.map((sql) => db.prepare(sql))),
        'D1_ERROR|no such trigger|no such table|syntax error',
      );
      assert.deepEqual(
        await guardDefinitions(db),
        originalGuards,
        'failed D1 batch must restore both original guard SQL definitions',
      );
      assert.deepEqual(
        await artifactCounts(db),
        emptyArtifacts,
        'failed DDL batch must not change annotation/audit rows',
      );
      await assertForeignKeysClean(db);
    });
  }

  await expectBatchRollback('D1 batch rolls back when the first DROP fails', [
    statements[0],
    statements[0],
  ]);
  const invalidGuestCreate = statements[1].replace(
    'BEFORE INSERT ON guest_annotation_commands',
    'BEFORE INSERT ON freehand_missing_guest_table',
  );
  assert.notEqual(invalidGuestCreate, statements[1]);
  await expectBatchRollback(
    'D1 batch rolls back the Guest DROP when Guest CREATE fails',
    [statements[0], invalidGuestCreate],
  );
  await expectBatchRollback(
    'D1 batch rolls back both guards when the second DROP fails',
    [statements[0], statements[1], statements[2], statements[2]],
  );
  const invalidOwnerCreate = statements[3].replace(
    'BEFORE INSERT ON owner_annotation_commands',
    'BEFORE INSERT ON freehand_missing_owner_table',
  );
  assert.notEqual(invalidOwnerCreate, statements[3]);
  await expectBatchRollback(
    'D1 batch rolls back both guards when Owner CREATE fails',
    [statements[0], statements[1], statements[2], invalidOwnerCreate],
  );

  const now = Date.now();
  const ids = {
    owner: '11111111-1111-4111-8111-111111111111',
    ownerSession: '12121212-1212-4121-8121-121212121212',
    workspace: '22222222-2222-4222-8222-222222222222',
    project: '33333333-3333-4333-8333-333333333333',
    album: '44444444-4444-4444-8444-444444444444',
    invite: '55555555-5555-4555-8555-555555555555',
    photo: '66666666-6666-4666-8666-666666666666',
    version: '77777777-7777-4777-8777-777777777777',
    uploadSession: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    guest: '88888888-8888-4888-8888-888888888888',
    guestSession: '99999999-9999-4999-9999-999999999999',
    original: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  };
  const guestSecretHash = 'a'.repeat(64);
  const sourceHash = 'b'.repeat(64);
  const previewHash = 'c'.repeat(64);
  const thumbnailHash = 'd'.repeat(64);
  const ownerSessionExpires = now + 3_600_000;
  const guestSessionExpires = now + 3_600_000;
  const guestInviteExpires = now + 30 * 86_400_000;

  await run(
    db,
    'INSERT INTO users(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
    ids.owner,
    'Fixture Owner',
    'owner@example.invalid',
    1,
    null,
    now,
    now,
  );
  await run(
    db,
    'INSERT INTO owners(id,user_id,enabled) VALUES(1,?,1)',
    ids.owner,
  );
  await run(
    db,
    'INSERT INTO owner_sessions(id,token,expiresAt,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    ids.ownerSession,
    'fixture-owner-token',
    ownerSessionExpires,
    ids.owner,
    now,
    now,
  );
  await run(
    db,
    'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
    ids.workspace,
    'Fixture',
    ids.owner,
  );
  await run(
    db,
    "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'uploading')",
    ids.project,
    ids.workspace,
    'Fixture project',
  );
  await run(
    db,
    "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    ids.album,
    ids.workspace,
    ids.project,
    'Fixture album',
  );
  await run(
    db,
    "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id,created_at_ms) VALUES(?,?,?,?,'link_only',NULL,128,?,NULL,?,?,?)",
    ids.invite,
    ids.workspace,
    ids.project,
    'e'.repeat(64),
    guestInviteExpires,
    ids.owner,
    ids.ownerSession,
    now,
  );
  await run(
    db,
    'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    ids.invite,
    ids.workspace,
    ids.project,
    ids.album,
  );
  await run(
    db,
    'INSERT INTO guest_invite_seals(invite_id,sealed_at_ms) VALUES(?,?)',
    ids.invite,
    now,
  );
  await run(
    db,
    'INSERT INTO guest_identities(id,invite_id,display_name,created_at_ms) VALUES(?,?,?,?)',
    ids.guest,
    ids.invite,
    'Fixture Guest',
    now,
  );
  await run(
    db,
    'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms,created_at_ms) VALUES(?,?,?,?,?,?)',
    ids.guestSession,
    ids.invite,
    ids.guest,
    guestSecretHash,
    guestSessionExpires,
    now,
  );
  const sourceObjectKey = [
    ids.workspace,
    ids.project,
    ids.album,
    ids.uploadSession,
    'original',
  ].join('/');
  const reservationRequestId = randomUUID();
  const authorizationRequestId = randomUUID();
  const completionRequestId = randomUUID();
  const uploadPayloadJson = JSON.stringify({
    workspaceId: ids.workspace,
    projectId: ids.project,
    albumId: ids.album,
    originalFilename: 'fixture.png',
    expectedBytes: 100,
    contentType: 'image/png',
    sha256: sourceHash,
  });
  const uploadWorkflowPayloadJson = JSON.stringify({
    uploadSessionId: ids.uploadSession,
  });

  await run(
    db,
    'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    reservationRequestId,
    'upload.reserved',
    uploadPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    ids.workspace,
    ids.project,
    ids.album,
    'primary',
    sourceObjectKey,
    'fixture.png',
    100,
    now,
  );
  await run(
    db,
    'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    authorizationRequestId,
    'upload.authorized',
    uploadWorkflowPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    now,
    now,
    now + 600_000,
    'image/png',
    sourceHash,
  );
  await run(
    db,
    'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,content_type,sha256_hex,actual_bytes,photo_id,version_id,asset_id,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    completionRequestId,
    'upload.completed',
    uploadWorkflowPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    now + 1,
    'image/png',
    sourceHash,
    100,
    ids.photo,
    ids.version,
    ids.original,
    10,
    10,
  );

  const processingStartedAt = Date.now();
  await run(
    db,
    "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=1,attempts=1,lease_until_ms=?,updated_at_ms=?,transition_id=? WHERE id=?",
    randomUUID(),
    processingStartedAt + 300_000,
    processingStartedAt,
    randomUUID(),
    ids.original,
  );
  const processingResult = JSON.stringify([
    {
      kind: 'thumbnail',
      bytes: 10,
      mime: 'image/jpeg',
      sha256: thumbnailHash,
      width: 10,
      height: 10,
    },
    {
      kind: 'preview',
      bytes: 20,
      mime: 'image/jpeg',
      sha256: previewHash,
      width: 10,
      height: 10,
    },
  ]);
  const processingFinishedAt = Date.now();
  await run(
    db,
    "UPDATE image_processing_jobs SET status='succeeded',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,reason_code=NULL,result_json=?,updated_at_ms=?,transition_id=? WHERE id=?",
    processingResult,
    processingFinishedAt,
    randomUUID(),
    ids.original,
  );
  assert.equal(
    Number(
      (
        await first(
          db,
          'SELECT count(*) AS count FROM guest_annotation_eligible_versions WHERE version_id=?',
          ids.version,
        )
      ).count,
    ),
    1,
  );
  await assertForeignKeysClean(db);

  const point = (x, y) => ({ x, y });
  const freehand = (points) => ({
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points,
  });
  const style = { color: 'red' };
  const guestInsert = db.prepare(
    'INSERT INTO guest_annotation_commands(' +
      'id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,' +
      'workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,' +
      'expected_revision,geometry_json,style_json,linked_comment_id,request_json,created_at_ms' +
      ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'create',NULL,?,?,NULL,?,?)",
  );
  const ownerInsert = db.prepare(
    'INSERT INTO owner_annotation_commands(' +
      'id,actor_id,expected_owner_id,session_id,request_id,workspace_id,project_id,album_id,' +
      'invite_id,photo_id,version_id,annotation_id,operation,expected_revision,' +
      'geometry_json,style_json,linked_comment_id,request_json,created_at_ms' +
      ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'create',NULL,?,?,NULL,?,?)",
  );

  async function insertGuest(
    geometryJson,
    requestId = randomUUID(),
    annotationId = randomUUID(),
    commandId = randomUUID(),
    sessionId = ids.guestSession,
    secretHash = guestSecretHash,
  ) {
    const geometry = JSON.parse(geometryJson);
    const requestJson = JSON.stringify({
      requestId,
      expectedGuestId: ids.guest,
      operation: 'create',
      photoId: ids.photo,
      versionId: ids.version,
      geometry,
      style,
      commentId: null,
    });
    await guestInsert
      .bind(
        commandId,
        ids.guest,
        ids.guest,
        ids.invite,
        sessionId,
        secretHash,
        requestId,
        ids.workspace,
        ids.project,
        ids.album,
        ids.photo,
        ids.version,
        annotationId,
        geometryJson,
        JSON.stringify(style),
        requestJson,
        Date.now(),
      )
      .run();
    return { requestId, annotationId, geometryJson, requestJson };
  }

  async function insertOwner(
    geometryJson,
    requestId = randomUUID(),
    annotationId = randomUUID(),
    commandId = randomUUID(),
    sessionId = ids.ownerSession,
  ) {
    const geometry = JSON.parse(geometryJson);
    const requestJson = JSON.stringify({
      requestId,
      expectedOwnerId: ids.owner,
      operation: 'create',
      inviteId: ids.invite,
      photoId: ids.photo,
      versionId: ids.version,
      geometry,
      style,
      commentId: null,
    });
    await ownerInsert
      .bind(
        commandId,
        ids.owner,
        ids.owner,
        sessionId,
        requestId,
        ids.workspace,
        ids.project,
        ids.album,
        ids.invite,
        ids.photo,
        ids.version,
        annotationId,
        geometryJson,
        JSON.stringify(style),
        requestJson,
        Date.now(),
      )
      .run();
    return { requestId, annotationId, geometryJson, requestJson };
  }

  async function expectRejected(write, code = 'INVALID_INPUT') {
    const before = await artifactCounts(db);
    await expectFailure(write, code);
    assert.deepEqual(
      await artifactCounts(db),
      before,
      code + ' rejection must be atomic',
    );
  }

  async function assertGuestWitness(receipt) {
    const row = await first(
      db,
      'SELECT geometry_json,state,revision,last_session_id,last_request_id FROM guest_annotations WHERE id=?',
      receipt.annotationId,
    );
    assert.equal(row.geometry_json, receipt.geometryJson);
    assert.equal(row.state, 'open');
    assert.equal(row.revision, 1);
    assert.equal(row.last_session_id, ids.guestSession);
    assert.equal(row.last_request_id, receipt.requestId);
    const change = await first(
      db,
      'SELECT operation,revision,session_id,request_id,after_json FROM guest_annotation_changes WHERE annotation_id=? AND revision=1',
      receipt.annotationId,
    );
    assert.equal(change.operation, 'create');
    assert.equal(change.session_id, ids.guestSession);
    assert.equal(change.request_id, receipt.requestId);
    assert.deepEqual(
      JSON.parse(change.after_json).geometry,
      JSON.parse(receipt.geometryJson),
    );
    const audit = await first(
      db,
      'SELECT actor_type,actor_id,guest_session_id,session_id,action,request_id FROM audit_events WHERE event_id=?',
      'guest-annotation:' + receipt.annotationId + ':1',
    );
    assert.deepEqual(
      { ...audit },
      {
        actor_type: 'guest',
        actor_id: ids.guest,
        guest_session_id: ids.guestSession,
        session_id: null,
        action: 'annotation.created',
        request_id: receipt.requestId,
      },
    );
    assert.equal(
      await count(
        db,
        'guest_annotation_results',
        ' WHERE request_id=?',
        receipt.requestId,
      ),
      1,
    );
  }

  async function assertOwnerWitness(receipt) {
    const row = await first(
      db,
      'SELECT geometry_json,state,revision,created_session_id,last_request_id FROM owner_annotations WHERE id=?',
      receipt.annotationId,
    );
    assert.equal(row.geometry_json, receipt.geometryJson);
    assert.equal(row.state, 'open');
    assert.equal(row.revision, 1);
    assert.equal(row.created_session_id, ids.ownerSession);
    assert.equal(row.last_request_id, receipt.requestId);
    const change = await first(
      db,
      'SELECT operation,revision,session_id,request_id,after_json FROM owner_annotation_changes WHERE annotation_id=? AND revision=1',
      receipt.annotationId,
    );
    assert.equal(change.operation, 'create');
    assert.equal(change.session_id, ids.ownerSession);
    assert.equal(change.request_id, receipt.requestId);
    assert.deepEqual(
      JSON.parse(change.after_json).geometry,
      JSON.parse(receipt.geometryJson),
    );
    const audit = await first(
      db,
      'SELECT actor_type,actor_id,session_id,guest_session_id,action,request_id FROM audit_events WHERE event_id=?',
      'owner-annotation:' + receipt.annotationId + ':1',
    );
    assert.deepEqual(
      { ...audit },
      {
        actor_type: 'user',
        actor_id: ids.owner,
        session_id: ids.ownerSession,
        guest_session_id: null,
        action: 'owner.annotation_created',
        request_id: receipt.requestId,
      },
    );
    assert.equal(
      await count(
        db,
        'owner_annotation_results',
        ' WHERE request_id=?',
        receipt.requestId,
      ),
      1,
    );
  }

  const legacyPointJson = JSON.stringify({
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: 123,
    y: 456,
  });
  const legacyRectangleJson = JSON.stringify({
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: 20,
    y: 30,
    width: 100,
    height: 200,
  });
  let legacyGuest;
  let legacyOwner;
  await check(
    'legacy guards create existing Guest/Owner annotation and audit witnesses before migration 0058',
    async () => {
      legacyGuest = await insertGuest(legacyPointJson);
      legacyOwner = await insertOwner(legacyRectangleJson);
      await assertGuestWitness(legacyGuest);
      await assertOwnerWitness(legacyOwner);
      assert.equal(await count(db, 'guest_annotations'), 1);
      assert.equal(await count(db, 'owner_annotations'), 1);
      assert.equal(
        await count(
          db,
          'audit_events',
          " WHERE action='annotation.created' OR action='owner.annotation_created'",
        ),
        2,
      );
    },
  );

  const populatedSnapshot = await annotationDataSnapshot(db);
  const populatedOldGuards = await guardDefinitions(db);
  async function expectPopulatedBatchRollback(label, batchStatements) {
    await check(label, async () => {
      await expectFailure(
        () => db.batch(batchStatements.map((sql) => db.prepare(sql))),
        'D1_ERROR|no such trigger|no such table|syntax error',
      );
      assert.deepEqual(
        await guardDefinitions(db),
        populatedOldGuards,
        'failed batch must restore both original guard SQL definitions',
      );
      assert.deepEqual(
        await annotationDataSnapshot(db),
        populatedSnapshot,
        'failed batch must preserve all annotation rows and audit evidence',
      );
      await assertForeignKeysClean(db);
    });
  }

  await expectPopulatedBatchRollback(
    'populated D1 batch rolls back when the first DROP fails',
    [statements[0], statements[0]],
  );
  await expectPopulatedBatchRollback(
    'populated D1 batch rolls back Guest DROP when Guest CREATE fails',
    [
      statements[0],
      statements[1].replace(
        'BEFORE INSERT ON guest_annotation_commands',
        'BEFORE INSERT ON freehand_missing_guest_table',
      ),
    ],
  );
  await expectPopulatedBatchRollback(
    'populated D1 batch rolls back both guards when the second DROP fails',
    [statements[0], statements[1], statements[2], statements[2]],
  );
  await expectPopulatedBatchRollback(
    'populated D1 batch rolls back both DROPs when Owner CREATE fails',
    [
      statements[0],
      statements[1],
      statements[2],
      statements[3].replace(
        'BEFORE INSERT ON owner_annotation_commands',
        'BEFORE INSERT ON freehand_missing_owner_table',
      ),
    ],
  );

  await applyMigration(db, migration);
  await check(
    'successful 0058 migration replaces both guards and preserves seeded annotations/audits',
    async () => {
      const replaced = await guardDefinitions(db);
      assert.equal(Object.keys(replaced).length, 2);
      assert.notEqual(
        replaced.guest_annotation_command_guard,
        populatedOldGuards.guest_annotation_command_guard,
      );
      assert.notEqual(
        replaced.owner_annotation_command_insert_guard,
        populatedOldGuards.owner_annotation_command_insert_guard,
      );
      assert.deepEqual(
        await annotationDataSnapshot(db),
        populatedSnapshot,
        'successful guard replacement must retain preexisting annotation and audit rows',
      );
      await assertForeignKeysClean(db);
    },
  );
  const minStroke = freehand([point(0, 0), point(1, 1)]);
  const maxStroke = freehand(
    Array.from({ length: 256 }, (_, index) => point(index, index + 1)),
  );
  const maxJson = JSON.stringify(maxStroke);
  assert.ok(Buffer.byteLength(maxJson, 'utf8') <= 8192);

  let guestMin;
  let guestMax;
  let guestLoop;
  let ownerMin;
  let ownerMax;
  await check(
    'Guest and Owner accept valid freehand and retain history/audit witnesses',
    async () => {
      guestMin = await insertGuest(JSON.stringify(minStroke));
      await assertGuestWitness(guestMin);
      guestMax = await insertGuest(maxJson);
      await assertGuestWitness(guestMax);
      guestLoop = await insertGuest(
        JSON.stringify(freehand([point(0, 0), point(1, 1), point(0, 0)])),
      );
      await assertGuestWitness(guestLoop);
      ownerMin = await insertOwner(JSON.stringify(minStroke));
      await assertOwnerWitness(ownerMin);
      ownerMax = await insertOwner(maxJson);
      await assertOwnerWitness(ownerMax);
    },
  );

  const pointJson = JSON.stringify({
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: 12,
    y: 34,
  });
  const rectangleJson = JSON.stringify({
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: 20,
    y: 30,
    width: 100,
    height: 200,
  });
  await check(
    'existing point and rectangle geometry remains valid for both writers',
    async () => {
      await assertGuestWitness(await insertGuest(pointJson));
      await assertGuestWitness(await insertGuest(rectangleJson));
      await assertOwnerWitness(await insertOwner(pointJson));
      await assertOwnerWitness(await insertOwner(rectangleJson));
    },
  );

  await check(
    'Guest and Owner exact replay is idempotent and changed replay conflicts',
    async () => {
      const guestReplayCounts = await artifactCounts(db);
      await insertGuest(
        guestMin.geometryJson,
        guestMin.requestId,
        guestMin.annotationId,
      );
      assert.deepEqual(await artifactCounts(db), guestReplayCounts);
      await expectRejected(
        () =>
          insertGuest(
            JSON.stringify(freehand([point(0, 0), point(2, 2)])),
            guestMin.requestId,
            guestMin.annotationId,
          ),
        'REQUEST_ID_CONFLICT',
      );

      const ownerReplayCounts = await artifactCounts(db);
      await insertOwner(
        ownerMin.geometryJson,
        ownerMin.requestId,
        ownerMin.annotationId,
      );
      assert.deepEqual(await artifactCounts(db), ownerReplayCounts);
      await expectRejected(
        () =>
          insertOwner(
            JSON.stringify(freehand([point(0, 0), point(2, 2)])),
            ownerMin.requestId,
            ownerMin.annotationId,
          ),
        'REQUEST_ID_CONFLICT',
      );
    },
  );

  const invalidGeometries = [
    ['one point', JSON.stringify(freehand([point(0, 0)]))],
    [
      '257 points',
      JSON.stringify(
        freehand(
          Array.from({ length: 257 }, (_, index) => point(index, index + 1)),
        ),
      ),
    ],
    [
      'adjacent duplicate',
      JSON.stringify(freehand([point(1, 1), point(1, 1)])),
    ],
    [
      'fractional coordinate',
      JSON.stringify(freehand([point(1.5, 1), point(2, 2)])),
    ],
    [
      'out of range',
      JSON.stringify(freehand([point(0, 0), point(1_000_001, 2)])),
    ],
    ['wrong version', JSON.stringify({ ...minStroke, version: 2 })],
    [
      'wrong coordinate space',
      JSON.stringify({ ...minStroke, coordinateSpace: 'pixels' }),
    ],
    ['extra root property', JSON.stringify({ ...minStroke, opacity: 1 })],
    [
      'extra point property',
      JSON.stringify(freehand([{ x: 0, y: 0, pressure: 1 }, point(1, 1)])),
    ],
    [
      'point key order',
      '{"type":"freehand","coordinateSpace":"normalized_1e6","version":1,"points":[{"y":0,"x":0},{"x":1,"y":1}]}',
    ],
    [
      'root key order',
      '{"coordinateSpace":"normalized_1e6","type":"freehand","version":1,"points":[{"x":0,"y":0},{"x":1,"y":1}]}',
    ],
  ];
  await check(
    'invalid freehand geometry is rejected atomically by both writers',
    async () => {
      for (const [label, geometryJson] of invalidGeometries) {
        await expectRejected(() => insertGuest(geometryJson), 'INVALID_INPUT');
        await expectRejected(() => insertOwner(geometryJson), 'INVALID_INPUT');
        process.stdout.write('rejected: ' + label + ' for Guest + Owner\n');
      }

      const oversizedJson = maxJson.replace(
        '"points":[',
        '"points":[' + ' '.repeat(9000),
      );
      assert.ok(Buffer.byteLength(oversizedJson, 'utf8') > 8192);
      assert.equal(
        Number(
          (
            await first(
              db,
              'SELECT length(CAST(? AS BLOB)) AS count',
              oversizedJson,
            )
          ).count,
        ),
        Buffer.byteLength(oversizedJson, 'utf8'),
      );
      assert.equal(
        Number(
          (
            await first(
              db,
              'SELECT length(CAST(? AS BLOB))<=8192 AS withinLimit',
              oversizedJson,
            )
          ).withinLimit,
        ),
        0,
      );
      await expectRejected(() => insertGuest(oversizedJson), 'INVALID_INPUT');
      await expectRejected(() => insertOwner(oversizedJson), 'INVALID_INPUT');
    },
  );

  await check(
    'Guest and Owner authorization denials write no annotation artifacts',
    async () => {
      const before = await artifactCounts(db);
      await expectRejected(
        () =>
          insertGuest(
            JSON.stringify(minStroke),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
          ),
        'GUEST_ACCESS_REQUIRED',
      );
      await expectRejected(
        () =>
          insertOwner(
            JSON.stringify(minStroke),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
          ),
        'OWNER_REQUIRED',
      );
      assert.deepEqual(await artifactCounts(db), before);
      await assertForeignKeysClean(db);
    },
  );

  process.stdout.write(
    JSON.stringify(
      {
        result: 'pass',
        runtime: 'Miniflare workerd D1',
        completeMigrationChain: '0001-0057 plus migration 0058',
        populatedRollbackFailures: 4,
        baselineMigrations: migrationNames.length,
        lastBaselineMigration: migrationNames.at(-1),
        successfulD1BatchStatements: statements.length,
        injectedTransactionalFailures: 4,
        validGuestWrites: await count(db, 'guest_annotation_commands'),
        validOwnerWrites: await count(db, 'owner_annotation_commands'),
        rejectedInvalidCasesPerWriter: invalidGeometries.length + 1,
        guardsPresent: Object.keys(await guardDefinitions(db)).length === 2,
        foreignKeyViolations: (
          await db.prepare('PRAGMA foreign_key_check').all()
        ).results.length,
        remoteOrPersistentDatabaseUsed: false,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  if (mf) await mf.dispose();
  const cleanupPath = validatedTemporaryPath();
  await rm(cleanupPath, { recursive: true, force: true });
}
