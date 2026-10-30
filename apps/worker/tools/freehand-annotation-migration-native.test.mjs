import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(testDirectory, '..');
const migrationDirectory = path.join(workerRoot, 'migrations');
const proposalPath = path.join(
  workerRoot,
  'migration-proposals',
  'annotation_freehand_geometry_v1.sql',
);
const migrationNames = [
  '0001_closed_owner.sql',
  '0002_storage_nodes.sql',
  '0003_workspaces.sql',
  '0004_projects_albums.sql',
  '0005_content_parent_guards.sql',
  '0006_actor_scoped_audit_keys.sql',
  '0007_rebind_audit_triggers.sql',
  '0008_upload_reservations.sql',
  '0009_upload_authorization_and_assets.sql',
  '0010_upload_spec_payload_correction.sql',
  '0011_photo_scope_integrity.sql',
  '0012_upload_image_dimensions.sql',
  '0013_image_processing_jobs.sql',
  '0014_archive_busy_scope_replay.sql',
  '0015_processing_review_resolution.sql',
  '0016_guest_access_foundation.sql',
  '0017_invite_revocation_commands.sql',
  '0018_guest_logout_commands.sql',
  '0019_invite_creation_commands.sql',
  '0020_kdf_permits.sql',
  '0021_guest_exchange_buckets.sql',
  '0022_guest_exchange.sql',
  '0023_guest_selection.sql',
  '0024_guest_selection_submissions.sql',
  '0025_guest_selection_empty_guard.sql',
  '0026_guest_selection_snapshot_guards.sql',
  '0027_guest_feedback.sql',
  '0028_selection_policy.sql',
  '0029_reopened_selection_revision.sql',
  '0030_shared_reviews.sql',
  '0031_selection_policy_configuration.sql',
  '0032_immutable_result_insert_integrity.sql',
  '0033_immutable_photo_insert_integrity.sql',
  '0034_guest_tags.sql',
  '0035_guest_history_index.sql',
  '0036_photo_version_heads.sql',
  '0037_photo_version_uploads.sql',
  '0038_project_versioning_configuration.sql',
  '0039_owner_external_intents.sql',
  '0040_album_matching_changes.sql',
  '0041_resolved_upload_reservations.sql',
  '0042_guest_comments.sql',
  '0043_owner_comment_replies.sql',
  '0044_owner_comment_processing.sql',
  '0045_guest_annotations.sql',
  '0046_owner_annotations.sql',
];

assert.equal(migrationNames.length, 46);
assert.equal(migrationNames.at(-1), '0046_owner_annotations.sql');
const migrationConfig = readFileSync(
  path.join(workerRoot, 'wrangler.jsonc'),
  'utf8',
);
assert.match(migrationConfig, /"migrations_dir"\s*:\s*"migrations"/);
assert.ok(
  path.relative(migrationDirectory, proposalPath).startsWith('..'),
  'proposal must remain outside migrations_dir',
);

const db = new DatabaseSync(':memory:');
try {
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of migrationNames)
    db.exec(readFileSync(path.join(migrationDirectory, name), 'utf8'));
  db.exec('PRAGMA foreign_keys=ON');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);

  // Keep all annotation command/projection/history/result/audit and symmetric namespace
  // triggers. Drop unrelated product guards only to seed a compact synthetic fixture.
  const annotationTrigger =
    /^(guest_annotation|guest_annotations|owner_annotation|owner_annotations|guest_(selection|submission|logout|exchange|feedback|tag|comment)_annotation_namespace|shared_review_annotation_namespace)/;
  for (const { name } of db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
    .all()) {
    if (!annotationTrigger.test(name))
      db.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
  }

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
    guest: '88888888-8888-4888-8888-888888888888',
    guestSession: '99999999-9999-4999-8999-999999999999',
    storage: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    original: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    preview: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    thumbnail: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  };
  const guestSecretHash = 'a'.repeat(64);
  const sourceHash = 'b'.repeat(64);
  const previewHash = 'c'.repeat(64);
  const thumbnailHash = 'd'.repeat(64);
  const run = (sql, ...values) => db.prepare(sql).run(...values);

  run(
    'INSERT INTO users(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
    ids.owner,
    'Fixture Owner',
    'owner@example.invalid',
    1,
    null,
    now,
    now,
  );
  run('INSERT INTO owners(id,user_id,enabled) VALUES(1,?,1)', ids.owner);
  run(
    'INSERT INTO owner_sessions(id,token,expiresAt,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    ids.ownerSession,
    'fixture-owner-token',
    now + 3_600_000,
    ids.owner,
    now,
    now,
  );
  run(
    'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
    ids.workspace,
    'Fixture',
    ids.owner,
  );
  run(
    "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'reviewing')",
    ids.project,
    ids.workspace,
    'Fixture project',
  );
  run(
    "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    ids.album,
    ids.workspace,
    ids.project,
    'Fixture album',
  );
  run(
    `INSERT INTO guest_invites(
      id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,
      expires_at_ms,max_uses,created_by,owner_session_id,created_at_ms
    ) VALUES(?,?,?,?,'link_only',NULL,128,?,NULL,?,?,?)`,
    ids.invite,
    ids.workspace,
    ids.project,
    'e'.repeat(64),
    now + 30 * 86_400_000,
    ids.owner,
    ids.ownerSession,
    now,
  );
  run(
    'INSERT INTO guest_invite_seals(invite_id,sealed_at_ms) VALUES(?,?)',
    ids.invite,
    now,
  );
  run(
    'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    ids.invite,
    ids.workspace,
    ids.project,
    ids.album,
  );
  run(
    'INSERT INTO guest_identities(id,invite_id,display_name,created_at_ms) VALUES(?,?,?,?)',
    ids.guest,
    ids.invite,
    'Fixture Guest',
    now,
  );
  run(
    `INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms,created_at_ms)
    VALUES(?,?,?,?,?,?)`,
    ids.guestSession,
    ids.invite,
    ids.guest,
    guestSecretHash,
    now + 3_600_000,
    now,
  );
  run(
    'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
    ids.photo,
    ids.workspace,
    ids.project,
    ids.album,
    'fixture.png',
  );
  run(
    `INSERT INTO photo_versions(
      id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status
    ) VALUES(?,?,?,1,?,?,100,'image/png',10,10,'current')`,
    ids.version,
    ids.workspace,
    ids.photo,
    ids.owner,
    sourceHash,
  );
  run(
    `INSERT INTO photo_version_heads(photo_id,workspace_id,project_id,album_id,version_id,revision,last_command_id)
    VALUES(?,?,?,?,?,0,NULL)`,
    ids.photo,
    ids.workspace,
    ids.project,
    ids.album,
    ids.version,
  );
  run(
    `INSERT INTO storage_nodes(id,provider,account_id,bucket_name,credential_ref,status,priority,quota_bytes)
    VALUES(?,'r2','isolated-test','fixture','test-only','active',1,1000000)`,
    ids.storage,
  );
  run(
    `INSERT INTO photo_assets(
      id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state
    ) VALUES(?,?,?,?,?,'original','fixture/original',100,'image/png',?,'private')`,
    ids.original,
    ids.workspace,
    ids.photo,
    ids.version,
    ids.storage,
    sourceHash,
  );
  run(
    `INSERT INTO photo_assets(
      id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state
    ) VALUES(?,?,?,?,?,'preview','fixture/preview',20,'image/jpeg',?,'private')`,
    ids.preview,
    ids.workspace,
    ids.photo,
    ids.version,
    ids.storage,
    previewHash,
  );
  run(
    `INSERT INTO photo_assets(
      id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state
    ) VALUES(?,?,?,?,?,'thumbnail','fixture/thumbnail',10,'image/jpeg',?,'private')`,
    ids.thumbnail,
    ids.workspace,
    ids.photo,
    ids.version,
    ids.storage,
    thumbnailHash,
  );
  run(
    `INSERT INTO image_processing_jobs(
      id,recipe,status,reserved_bytes,lease_epoch,attempts,result_json,transition_id,created_at_ms,updated_at_ms
    ) VALUES(?,'local-sharp-0.35.5-v1','succeeded',0,1,1,'{}',?,?,?)`,
    ids.original,
    crypto.randomUUID(),
    now,
    now,
  );
  run(
    "INSERT INTO image_processing_outputs(job_id,kind,asset_id,object_key,max_bytes) VALUES(?, 'preview', ?, 'fixture/preview', 8388608)",
    ids.original,
    ids.preview,
  );
  run(
    "INSERT INTO image_processing_outputs(job_id,kind,asset_id,object_key,max_bytes) VALUES(?, 'thumbnail', ?, 'fixture/thumbnail', 8388608)",
    ids.original,
    ids.thumbnail,
  );
  assert.equal(
    db
      .prepare(
        'SELECT count(*) AS n FROM guest_annotation_eligible_versions WHERE version_id=?',
      )
      .get(ids.version).n,
    1,
  );
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);

  const proposal = readFileSync(proposalPath, 'utf8');
  assert.match(proposal, /REVIEW-ONLY PROPOSAL\. DO NOT APPLY/);
  assert.match(proposal, /length\(CAST\(NEW\.geometry_json AS BLOB\)\)<=8192/);
  assert.equal((proposal.match(/DROP TRIGGER /g) ?? []).length, 2);
  assert.equal((proposal.match(/^CREATE TRIGGER /gm) ?? []).length, 2);
  assert.doesNotMatch(proposal, /^\s*(CREATE|ALTER|DROP)\s+TABLE\b/im);
  const beforeDDLCounts = dataCounts();
  db.exec(proposal);
  assert.deepEqual(
    dataCounts(),
    beforeDDLCounts,
    'forward proposal must not rewrite table rows',
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN (?,?)",
      )
      .get(
        'guest_annotation_command_guard',
        'owner_annotation_command_insert_guard',
      ).n,
    2,
  );
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);

  const point = (x, y) => ({ x, y });
  const freehand = (points) => ({
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points,
  });
  const style = { color: 'red' };
  const guestInsert = db.prepare(`INSERT INTO guest_annotation_commands(
      id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,
      workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,
      expected_revision,geometry_json,style_json,linked_comment_id,request_json,created_at_ms
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'create',NULL,?,?,NULL,?,?)`);
  const ownerInsert = db.prepare(`INSERT INTO owner_annotation_commands(
      id,actor_id,expected_owner_id,session_id,request_id,workspace_id,project_id,album_id,
      invite_id,photo_id,version_id,annotation_id,operation,expected_revision,
      geometry_json,style_json,linked_comment_id,request_json,created_at_ms
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'create',NULL,?,?,NULL,?,?)`);

  function insertGuest(
    geometryJson,
    requestId = crypto.randomUUID(),
    annotationId = crypto.randomUUID(),
    commandId = crypto.randomUUID(),
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
    guestInsert.run(
      commandId,
      ids.guest,
      ids.guest,
      ids.invite,
      ids.guestSession,
      guestSecretHash,
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
    );
    return { requestId, annotationId, geometryJson, requestJson };
  }

  function insertOwner(
    geometryJson,
    requestId = crypto.randomUUID(),
    annotationId = crypto.randomUUID(),
    commandId = crypto.randomUUID(),
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
    ownerInsert.run(
      commandId,
      ids.owner,
      ids.owner,
      ids.ownerSession,
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
    );
    return { requestId, annotationId, geometryJson, requestJson };
  }

  function dataCounts() {
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
    return Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n,
      ]),
    );
  }

  function expectRejected(write, code = 'INVALID_INPUT') {
    const before = dataCounts();
    assert.throws(write, (error) => String(error.message).includes(code));
    assert.deepEqual(dataCounts(), before, `${code} rejection must be atomic`);
  }

  function assertGuestWitness(receipt) {
    const row = db
      .prepare(
        'SELECT geometry_json,state,revision,last_session_id,last_request_id FROM guest_annotations WHERE id=?',
      )
      .get(receipt.annotationId);
    assert.equal(row.geometry_json, receipt.geometryJson);
    assert.equal(row.state, 'open');
    assert.equal(row.revision, 1);
    assert.equal(row.last_session_id, ids.guestSession);
    assert.equal(row.last_request_id, receipt.requestId);
    const change = db
      .prepare(
        'SELECT operation,revision,session_id,request_id,after_json FROM guest_annotation_changes WHERE annotation_id=? AND revision=1',
      )
      .get(receipt.annotationId);
    assert.equal(change.operation, 'create');
    assert.equal(change.session_id, ids.guestSession);
    assert.equal(change.request_id, receipt.requestId);
    assert.deepEqual(
      JSON.parse(change.after_json).geometry,
      JSON.parse(receipt.geometryJson),
    );
    const audit = db
      .prepare(
        'SELECT actor_type,actor_id,guest_session_id,session_id,action,request_id FROM audit_events WHERE event_id=?',
      )
      .get(`guest-annotation:${receipt.annotationId}:1`);
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
      db
        .prepare(
          'SELECT count(*) AS n FROM guest_annotation_results WHERE request_id=?',
        )
        .get(receipt.requestId).n,
      1,
    );
  }

  function assertOwnerWitness(receipt) {
    const row = db
      .prepare(
        'SELECT geometry_json,state,revision,created_session_id,last_request_id FROM owner_annotations WHERE id=?',
      )
      .get(receipt.annotationId);
    assert.equal(row.geometry_json, receipt.geometryJson);
    assert.equal(row.state, 'open');
    assert.equal(row.revision, 1);
    assert.equal(row.created_session_id, ids.ownerSession);
    assert.equal(row.last_request_id, receipt.requestId);
    const change = db
      .prepare(
        'SELECT operation,revision,session_id,request_id,after_json FROM owner_annotation_changes WHERE annotation_id=? AND revision=1',
      )
      .get(receipt.annotationId);
    assert.equal(change.operation, 'create');
    assert.equal(change.session_id, ids.ownerSession);
    assert.equal(change.request_id, receipt.requestId);
    assert.deepEqual(
      JSON.parse(change.after_json).geometry,
      JSON.parse(receipt.geometryJson),
    );
    const audit = db
      .prepare(
        'SELECT actor_type,actor_id,session_id,guest_session_id,action,request_id FROM audit_events WHERE event_id=?',
      )
      .get(`owner-annotation:${receipt.annotationId}:1`);
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
      db
        .prepare(
          'SELECT count(*) AS n FROM owner_annotation_results WHERE request_id=?',
        )
        .get(receipt.requestId).n,
      1,
    );
  }

  const minStroke = freehand([point(0, 0), point(1, 1)]);
  const maxStroke = freehand(
    Array.from({ length: 256 }, (_, index) => point(index, index + 1)),
  );
  const maxJson = JSON.stringify(maxStroke);
  assert.ok(Buffer.byteLength(maxJson, 'utf8') <= 8192);
  const guestMin = insertGuest(JSON.stringify(minStroke));
  assertGuestWitness(guestMin);
  const guestMax = insertGuest(maxJson);
  assertGuestWitness(guestMax);
  const guestLoop = insertGuest(
    JSON.stringify(freehand([point(0, 0), point(1, 1), point(0, 0)])),
  );
  assertGuestWitness(guestLoop);
  const ownerMin = insertOwner(JSON.stringify(minStroke));
  assertOwnerWitness(ownerMin);
  const ownerMax = insertOwner(maxJson);
  assertOwnerWitness(ownerMax);

  // Existing point and rectangle canonical geometry remains accepted by both writers.
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
  assertGuestWitness(insertGuest(pointJson));
  assertGuestWitness(insertGuest(rectangleJson));
  assertOwnerWitness(insertOwner(pointJson));
  assertOwnerWitness(insertOwner(rectangleJson));

  // Identical command replay stays idempotent; changing geometry under the same UUID conflicts.
  const replayCounts = dataCounts();
  insertGuest(guestMin.geometryJson, guestMin.requestId, guestMin.annotationId);
  assert.deepEqual(dataCounts(), replayCounts);
  expectRejected(
    () =>
      insertGuest(
        JSON.stringify(freehand([point(0, 0), point(2, 2)])),
        guestMin.requestId,
        guestMin.annotationId,
      ),
    'REQUEST_ID_CONFLICT',
  );
  const ownerReplayCounts = dataCounts();
  insertOwner(ownerMin.geometryJson, ownerMin.requestId, ownerMin.annotationId);
  assert.deepEqual(dataCounts(), ownerReplayCounts);
  expectRejected(
    () =>
      insertOwner(
        JSON.stringify(freehand([point(0, 0), point(2, 2)])),
        ownerMin.requestId,
        ownerMin.annotationId,
      ),
    'REQUEST_ID_CONFLICT',
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
      `{"type":"freehand","coordinateSpace":"normalized_1e6","version":1,"points":[{"y":0,"x":0},{"x":1,"y":1}]}`,
    ],
    [
      'root key order',
      `{"coordinateSpace":"normalized_1e6","type":"freehand","version":1,"points":[{"x":0,"y":0},{"x":1,"y":1}]}`,
    ],
  ];
  for (const [label, geometryJson] of invalidGeometries) {
    expectRejected(() => insertGuest(geometryJson), 'INVALID_INPUT');
    expectRejected(() => insertOwner(geometryJson), 'INVALID_INPUT');
    console.log(`reject ${label}: Guest + Owner`);
  }

  const oversizedJson = maxJson.replace(
    '"points":[',
    `"points":[${' '.repeat(9000)}`,
  );
  assert.ok(Buffer.byteLength(oversizedJson, 'utf8') > 8192);
  assert.equal(
    db.prepare('SELECT length(CAST(? AS BLOB)) AS n').get(oversizedJson).n,
    Buffer.byteLength(oversizedJson, 'utf8'),
  );
  assert.equal(
    db
      .prepare('SELECT length(CAST(? AS BLOB))<=8192 AS withinLimit')
      .get(oversizedJson).withinLimit,
    0,
  );
  expectRejected(() => insertGuest(oversizedJson), 'INVALID_INPUT');
  expectRejected(() => insertOwner(oversizedJson), 'INVALID_INPUT');

  const authCounts = dataCounts();
  run('UPDATE guest_invites SET permissions_mask=0 WHERE id=?', ids.invite);
  expectRejected(
    () => insertGuest(JSON.stringify(minStroke)),
    'GUEST_ACCESS_REQUIRED',
  );
  run('UPDATE guest_invites SET permissions_mask=128 WHERE id=?', ids.invite);
  run('UPDATE owners SET enabled=0 WHERE user_id=?', ids.owner);
  expectRejected(
    () => insertOwner(JSON.stringify(minStroke)),
    'OWNER_REQUIRED',
  );
  run('UPDATE owners SET enabled=1 WHERE user_id=?', ids.owner);
  assert.deepEqual(
    dataCounts(),
    authCounts,
    'authorization denials must not write annotation artifacts',
  );

  console.log(
    JSON.stringify(
      {
        result: 'pass',
        sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get()
          .version,
        migrationsLoaded: migrationNames.length,
        lastMigration: migrationNames.at(-1),
        validGuestWrites: db
          .prepare('SELECT count(*) AS n FROM guest_annotation_commands')
          .get().n,
        validOwnerWrites: db
          .prepare('SELECT count(*) AS n FROM owner_annotation_commands')
          .get().n,
        rejectedGeometryCasesPerWriter: invalidGeometries.length + 1,
        guardsPresent: true,
        foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all()
          .length,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
