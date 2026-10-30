import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const ownerAnnotationTables = [
  'owner_annotation_commands',
  'owner_annotations',
  'owner_annotation_changes',
  'owner_annotation_results',
];

const hashGuestSession = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');

const hashInviteToken = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

function encodeDatabaseValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint')
    return { type: 'bigint', value: value.toString() };
  if (Buffer.isBuffer(value))
    return { type: 'blob', base64: value.toString('base64') };
  if (value instanceof ArrayBuffer)
    return {
      type: 'blob',
      base64: Buffer.from(value).toString('base64'),
    };
  if (ArrayBuffer.isView(value))
    return {
      type: 'blob',
      base64: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString('base64'),
    };
  if (Array.isArray(value)) return value.map(encodeDatabaseValue);
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, encodeDatabaseValue(value[key])]),
    );
  return value;
}

function canonicalRow(row) {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map((key) => [key, encodeDatabaseValue(row[key])]),
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function quoteIdentifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

async function productTableNames(db) {
  const result = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  return result.results
    .map((row) => row.name)
    .filter(
      (name) =>
        !name.startsWith('sqlite_') &&
        !name.startsWith('_') &&
        name !== 'd1_migrations',
    );
}

async function productTableSnapshot(db, tableNames) {
  const entries = [];
  let rowCount = 0;
  for (const tableName of tableNames) {
    const result = await db
      .prepare('SELECT * FROM ' + quoteIdentifier(tableName))
      .all();
    const rows = result.results.map(canonicalRow).sort(compareText);
    rowCount += rows.length;
    entries.push([
      tableName,
      {
        rowCount: rows.length,
        sha256: createHash('sha256').update(rows.join('\n')).digest('hex'),
      },
    ]);
  }
  const tables = Object.fromEntries(entries);
  const contentHash = createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('hex');
  return { tables, rowCount, contentHash };
}

async function annotationSequences(db) {
  const row = await db
    .prepare(
      "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='comment_thread_changes'),0) AS commentThreadChanges,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='guest_annotation_changes'),0) AS guestAnnotationChanges",
    )
    .first();
  return {
    commentThreadChanges: Number(row.commentThreadChanges),
    guestAnnotationChanges: Number(row.guestAnnotationChanges),
  };
}

/**
 * Seeds real, guarded Guest annotation create/update history in the isolated
 * upgrade D1, applies 0046 there, and proves every existing product row and
 * both relevant AUTOINCREMENT sequences remain unchanged.
 */
export async function seedAndVerifyOwnerAnnotationUpgrade({
  db,
  source46,
  photoScope,
  ownerSessionId,
}) {
  assert.ok(db, 'Owner annotation upgrade requires an isolated D1 database');
  assert.equal(typeof source46, 'string');
  assert.ok(source46.trim());
  assert.ok(photoScope);
  assert.ok(ownerSessionId);

  const ownerSession = await db
    .prepare(
      "SELECT s.userId AS ownerId FROM owner_sessions s JOIN owners o ON o.user_id=s.userId AND o.enabled=1 WHERE s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
    )
    .bind(ownerSessionId)
    .first();
  assert.ok(
    ownerSession?.ownerId,
    'Owner annotation upgrade requires the supplied live Owner session',
  );

  const ownedPhotoVersion = await db
    .prepare(
      "SELECT p.id FROM workspaces w JOIN projects pr ON pr.workspace_id=w.id JOIN albums a ON a.workspace_id=w.id AND a.project_id=pr.id JOIN photos p ON p.workspace_id=w.id AND p.project_id=pr.id AND p.album_id=a.id JOIN photo_versions v ON v.workspace_id=w.id AND v.photo_id=p.id WHERE w.id=? AND w.owner_user_id=? AND pr.id=? AND pr.status NOT IN('archived','deleting','deleted') AND a.id=? AND a.state='active' AND p.id=? AND v.id=?",
    )
    .bind(
      photoScope.workspace_id,
      ownerSession.ownerId,
      photoScope.project_id,
      photoScope.album_id,
      photoScope.photo_id,
      photoScope.version_id,
    )
    .first();
  assert.equal(
    ownedPhotoVersion?.id,
    photoScope.photo_id,
    'Upgrade fixture photo/version must be in the current Owner active scope',
  );
  const eligibleGuestVersion = await db
    .prepare(
      'SELECT version_id FROM guest_annotation_eligible_versions WHERE workspace_id=? AND project_id=? AND album_id=? AND photo_id=? AND version_id=?',
    )
    .bind(
      photoScope.workspace_id,
      photoScope.project_id,
      photoScope.album_id,
      photoScope.photo_id,
      photoScope.version_id,
    )
    .first();
  assert.equal(
    eligibleGuestVersion?.version_id,
    photoScope.version_id,
    'Upgrade fixture version must be a real Guest annotation-eligible version',
  );

  const inviteId = randomUUID();
  const inviteExpiresAt = Date.now() + 60 * 60 * 1000;
  const inviteTokenHash = hashInviteToken(randomBytes(32).toString('hex'));
  await db
    .prepare(
      "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',128,?,NULL,?,?)",
    )
    .bind(
      inviteId,
      photoScope.workspace_id,
      photoScope.project_id,
      inviteTokenHash,
      inviteExpiresAt,
      ownerSession.ownerId,
      ownerSessionId,
    )
    .run();
  await db
    .prepare(
      'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    )
    .bind(
      inviteId,
      photoScope.workspace_id,
      photoScope.project_id,
      photoScope.album_id,
    )
    .run();
  await db
    .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
    .bind(inviteId)
    .run();

  const guestId = randomUUID();
  const guestSessionId = randomUUID();
  const guestSecretHash = hashGuestSession(randomBytes(32).toString('hex'));
  await db
    .prepare(
      'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
    )
    .bind(guestId, inviteId, 'M3g4 upgrade guest')
    .run();
  await db
    .prepare(
      'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
    )
    .bind(
      guestSessionId,
      inviteId,
      guestId,
      guestSecretHash,
      Math.min(inviteExpiresAt, Date.now() + 30 * 60 * 1000),
    )
    .run();

  const annotationId = randomUUID();
  const createRequestId = randomUUID();
  const createGeometry = {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: 123456,
    y: 654321,
  };
  const createStyle = { color: 'amber' };
  const createRequest = {
    requestId: createRequestId,
    expectedGuestId: guestId,
    operation: 'create',
    photoId: photoScope.photo_id,
    versionId: photoScope.version_id,
    geometry: createGeometry,
    style: createStyle,
    commentId: null,
  };
  const createCommandId = randomUUID();
  await db
    .prepare(
      "INSERT INTO guest_annotation_commands(id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'create',NULL,?,?,NULL,?)",
    )
    .bind(
      createCommandId,
      guestId,
      guestId,
      inviteId,
      guestSessionId,
      guestSecretHash,
      createRequestId,
      photoScope.workspace_id,
      photoScope.project_id,
      photoScope.album_id,
      photoScope.photo_id,
      photoScope.version_id,
      annotationId,
      JSON.stringify(createGeometry),
      JSON.stringify(createStyle),
      JSON.stringify(createRequest),
    )
    .run();

  const updateRequestId = randomUUID();
  const updateGeometry = {
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: 100000,
    y: 200000,
    width: 300000,
    height: 400000,
  };
  const updateStyle = { color: 'blue' };
  const updateRequest = {
    requestId: updateRequestId,
    expectedGuestId: guestId,
    operation: 'update',
    annotationId,
    expectedRevision: 1,
    geometry: updateGeometry,
    style: updateStyle,
    commentId: null,
  };
  const updateCommandId = randomUUID();
  await db
    .prepare(
      "INSERT INTO guest_annotation_commands(id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'update',1,?,?,NULL,?)",
    )
    .bind(
      updateCommandId,
      guestId,
      guestId,
      inviteId,
      guestSessionId,
      guestSecretHash,
      updateRequestId,
      photoScope.workspace_id,
      photoScope.project_id,
      photoScope.album_id,
      photoScope.photo_id,
      photoScope.version_id,
      annotationId,
      JSON.stringify(updateGeometry),
      JSON.stringify(updateStyle),
      JSON.stringify(updateRequest),
    )
    .run();

  const annotation = await db
    .prepare(
      'SELECT id,invite_id,author_guest_id,workspace_id,project_id,album_id,photo_id,version_id,revision,state,geometry_json,style_json,linked_comment_id,last_command_id FROM guest_annotations WHERE id=?',
    )
    .bind(annotationId)
    .first();
  assert.deepEqual(annotation, {
    id: annotationId,
    invite_id: inviteId,
    author_guest_id: guestId,
    workspace_id: photoScope.workspace_id,
    project_id: photoScope.project_id,
    album_id: photoScope.album_id,
    photo_id: photoScope.photo_id,
    version_id: photoScope.version_id,
    revision: 2,
    state: 'open',
    geometry_json: JSON.stringify(updateGeometry),
    style_json: JSON.stringify(updateStyle),
    linked_comment_id: null,
    last_command_id: updateCommandId,
  });

  const history = await db
    .prepare(
      'SELECT event_id,operation,revision FROM guest_annotation_changes WHERE annotation_id=? ORDER BY revision',
    )
    .bind(annotationId)
    .all();
  assert.deepEqual(history.results, [
    {
      event_id: 'guest-annotation:' + annotationId + ':1',
      operation: 'create',
      revision: 1,
    },
    {
      event_id: 'guest-annotation:' + annotationId + ':2',
      operation: 'update',
      revision: 2,
    },
  ]);
  const receiptCount = await db
    .prepare(
      'SELECT count(*) AS count FROM guest_annotation_results WHERE guest_id=? AND request_id IN(?,?)',
    )
    .bind(guestId, createRequestId, updateRequestId)
    .first();
  assert.equal(receiptCount?.count, 2);
  const auditEvents = await db
    .prepare(
      'SELECT event_id,actor_type,actor_id,session_id,guest_session_id,action FROM audit_events WHERE event_id IN(?,?) ORDER BY event_id',
    )
    .bind(history.results[0].event_id, history.results[1].event_id)
    .all();
  assert.equal(auditEvents.results.length, 2);
  assert.ok(
    auditEvents.results.every(
      (event) =>
        event.actor_type === 'guest' &&
        event.actor_id === guestId &&
        event.session_id === null &&
        event.guest_session_id === guestSessionId,
    ),
  );

  const oldProductTables = await productTableNames(db);
  assert.equal(
    oldProductTables.length,
    110,
    '0045 upgrade fixture should contain 110 existing product tables',
  );
  const beforeOwnerMigration = await productTableSnapshot(db, oldProductTables);
  const sequencesBeforeOwnerMigration = await annotationSequences(db);
  assert.equal(sequencesBeforeOwnerMigration.guestAnnotationChanges, 2);

  const executableSource = source46
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith('--'))
    .join(' ');
  await db.exec(executableSource);

  const afterOwnerMigrationTables = await productTableNames(db);
  const newProductTables = afterOwnerMigrationTables.filter(
    (name) => !oldProductTables.includes(name),
  );
  assert.deepEqual(
    newProductTables.sort(compareText),
    [...ownerAnnotationTables].sort(compareText),
  );
  const afterOwnerMigration = await productTableSnapshot(db, oldProductTables);
  assert.deepEqual(afterOwnerMigration.tables, beforeOwnerMigration.tables);
  assert.equal(afterOwnerMigration.rowCount, beforeOwnerMigration.rowCount);
  assert.deepEqual(
    await annotationSequences(db),
    sequencesBeforeOwnerMigration,
  );
  for (const table of ownerAnnotationTables) {
    const row = await db
      .prepare('SELECT count(*) AS count FROM ' + quoteIdentifier(table))
      .first();
    assert.equal(row?.count, 0, table + ' must start empty after 0046');
  }
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );

  const replayStateBefore = await productTableSnapshot(db, oldProductTables);
  const replaySequenceBefore = await annotationSequences(db);
  const originalCreateCommand = await db
    .prepare(
      'SELECT annotation_id,geometry_json,style_json,linked_comment_id,request_json FROM guest_annotation_commands WHERE guest_id=? AND request_id=?',
    )
    .bind(guestId, createRequestId)
    .first();
  assert.ok(originalCreateCommand?.annotation_id);
  await db
    .prepare(
      "INSERT INTO guest_annotation_commands(id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'create',NULL,?,?,NULL,?) ON CONFLICT(guest_id,request_id) DO NOTHING",
    )
    .bind(
      randomUUID(),
      guestId,
      guestId,
      inviteId,
      guestSessionId,
      guestSecretHash,
      createRequestId,
      photoScope.workspace_id,
      photoScope.project_id,
      photoScope.album_id,
      photoScope.photo_id,
      photoScope.version_id,
      originalCreateCommand.annotation_id,
      originalCreateCommand.geometry_json,
      originalCreateCommand.style_json,
      originalCreateCommand.request_json,
    )
    .run();
  const replayStateAfter = await productTableSnapshot(db, oldProductTables);
  assert.deepEqual(replayStateAfter.tables, replayStateBefore.tables);
  assert.equal(replayStateAfter.rowCount, replayStateBefore.rowCount);
  assert.deepEqual(await annotationSequences(db), replaySequenceBefore);

  return {
    preservedProductTables: oldProductTables.length,
    preservedProductRows: beforeOwnerMigration.rowCount,
    preservedContentSha256: beforeOwnerMigration.contentHash,
    guestAnnotationRevision: annotation.revision,
    guestAnnotationChangeSequence:
      sequencesBeforeOwnerMigration.guestAnnotationChanges,
    commentThreadChangeSequence:
      sequencesBeforeOwnerMigration.commentThreadChanges,
    ownerAnnotationTablesEmpty: true,
    exactGuestReplayUnchanged: true,
    foreignKeyViolations: 0,
  };
}
