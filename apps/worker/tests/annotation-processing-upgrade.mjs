import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const processingTables = [
  'owner_annotation_processing_commands',
  'owner_annotation_processing_states',
  'owner_annotation_processing_changes',
  'owner_annotation_processing_results',
];

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
  const contentHash = createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('hex');
  return {
    tables: Object.fromEntries(entries),
    rowCount,
    contentHash,
  };
}

async function annotationSequences(db) {
  const row = await db
    .prepare(
      "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='comment_thread_changes'),0) AS commentThreadChanges,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='guest_annotation_changes'),0) AS guestAnnotationChanges,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='owner_annotation_changes'),0) AS ownerAnnotationChanges",
    )
    .first();
  return {
    commentThreadChanges: Number(row.commentThreadChanges),
    guestAnnotationChanges: Number(row.guestAnnotationChanges),
    ownerAnnotationChanges: Number(row.ownerAnnotationChanges),
  };
}

async function explainQueryPlan(db, sql, ...values) {
  const result = await db
    .prepare('EXPLAIN QUERY PLAN ' + sql)
    .bind(...values)
    .all();
  return result.results.map((row) => String(row.detail));
}

function assertProcessingWatermarkPlan(details, label) {
  assert.ok(
    details.some((detail) =>
      detail.includes('guest_annotation_changes_processing_content'),
    ),
    label +
      ' must use the create/update watermark index: ' +
      details.join(' | '),
  );
  assert.ok(
    !details.some((detail) => /MATERIALIZE\s+c\b/i.test(detail)),
    label +
      ' must not materialize a whole-history aggregate: ' +
      details.join(' | '),
  );
  assert.ok(
    !details.some((detail) =>
      /SCAN\s+(?:ch|guest_annotation_changes)\b/i.test(detail),
    ),
    label +
      ' must not scan all Guest annotation history: ' +
      details.join(' | '),
  );
}

async function assertProcessingReadPlans(db, scope) {
  // These SQL shapes mirror the Owner exact-read and scoped-page state joins.
  // The service reader remains private; this migration probe guards the access
  // paths and index behavior without importing or duplicating its implementation.
  const targetPlan = await explainQueryPlan(
    db,
    `SELECT COALESCE(ps.state,'open') AS processing_state,
        COALESCE((SELECT MAX(ch.revision) FROM guest_annotation_changes ch
          WHERE ch.annotation_id=x.id AND ch.operation IN('create','update')),0)
          AS current_content_revision,
        CASE WHEN ps.annotation_id IS NULL THEN 0
          WHEN ps.content_revision<>COALESCE((SELECT MAX(ch.revision)
            FROM guest_annotation_changes ch
            WHERE ch.annotation_id=x.id AND ch.operation IN('create','update')),0)
          THEN 1 ELSE 0 END AS stale
      FROM guest_annotations x
      LEFT JOIN owner_annotation_processing_states ps
        ON ps.annotation_id=x.id AND ps.invite_id=x.invite_id
        AND ps.workspace_id=x.workspace_id AND ps.project_id=x.project_id
        AND ps.album_id=x.album_id AND ps.photo_id=x.photo_id
        AND ps.version_id=x.version_id
      WHERE x.id=? AND x.invite_id=? AND x.workspace_id=? AND x.project_id=?
        AND x.album_id=? AND x.photo_id=? AND x.version_id=?`,
    scope.annotationId,
    scope.inviteId,
    scope.workspaceId,
    scope.projectId,
    scope.albumId,
    scope.photoId,
    scope.versionId,
  );
  assertProcessingWatermarkPlan(targetPlan, 'Exact processing read');

  const pagePlan = await explainQueryPlan(
    db,
    `SELECT x.id,COALESCE(ps.state,'open') AS processing_state,
        CASE WHEN ps.annotation_id IS NULL THEN 0
          WHEN ps.content_revision<>COALESCE((SELECT MAX(ch.revision)
            FROM guest_annotation_changes ch
            WHERE ch.annotation_id=x.id AND ch.operation IN('create','update')),0)
          THEN 1 ELSE 0 END AS stale
      FROM guest_annotations x
      LEFT JOIN owner_annotation_processing_states ps
        ON ps.annotation_id=x.id AND ps.invite_id=x.invite_id
        AND ps.workspace_id=x.workspace_id AND ps.project_id=x.project_id
        AND ps.album_id=x.album_id AND ps.photo_id=x.photo_id
        AND ps.version_id=x.version_id
      WHERE x.invite_id=? AND x.workspace_id=? AND x.project_id=?
        AND x.album_id=? AND x.photo_id=? AND x.version_id=?
      ORDER BY x.created_at_ms,x.id LIMIT 25`,
    scope.inviteId,
    scope.workspaceId,
    scope.projectId,
    scope.albumId,
    scope.photoId,
    scope.versionId,
  );
  assertProcessingWatermarkPlan(pagePlan, 'Scoped processing page');
  assert.ok(
    pagePlan.some((detail) => detail.includes('guest_annotations_page')),
    'Scoped processing page must use the guest annotation page index: ' +
      pagePlan.join(' | '),
  );
}

/**
 * Seeds one real guarded Owner annotation on the retained 0045 Guest fixture,
 * applies 0047 only to the isolated upgrade D1, and verifies additive history
 * plus exact Guest/Owner command recovery.
 */
export async function seedAndVerifyAnnotationProcessingUpgrade({
  db,
  source47,
  photoScope,
  ownerSessionId,
}) {
  assert.ok(
    db,
    'Annotation processing upgrade requires an isolated D1 database',
  );
  assert.equal(typeof source47, 'string');
  assert.ok(source47.trim());
  assert.ok(photoScope?.photo_id && photoScope?.version_id);
  assert.ok(ownerSessionId);

  const ownerSession = await db
    .prepare(
      "SELECT s.userId AS ownerId FROM owner_sessions s JOIN owners o ON o.user_id=s.userId AND o.enabled=1 WHERE s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
    )
    .bind(ownerSessionId)
    .first();
  assert.ok(
    ownerSession?.ownerId,
    'Annotation processing upgrade requires the supplied live Owner session',
  );

  const guestAnnotation = await db
    .prepare(
      'SELECT * FROM guest_annotations WHERE photo_id=? AND version_id=? ORDER BY created_at_ms,id LIMIT 1',
    )
    .bind(photoScope.photo_id, photoScope.version_id)
    .first();
  assert.ok(
    guestAnnotation?.id,
    '0046 upgrade fixture must have a real Guest annotation',
  );
  assert.equal(guestAnnotation.workspace_id, photoScope.workspace_id);
  assert.equal(guestAnnotation.project_id, photoScope.project_id);
  assert.equal(guestAnnotation.album_id, photoScope.album_id);
  assert.ok(
    guestAnnotation.state !== 'deleted',
    '0046 Guest source must be editable for processing metadata setup',
  );
  const invite = await db
    .prepare(
      'SELECT id,created_by FROM guest_invites WHERE id=? AND workspace_id=? AND project_id=?',
    )
    .bind(
      guestAnnotation.invite_id,
      photoScope.workspace_id,
      photoScope.project_id,
    )
    .first();
  assert.equal(invite?.id, guestAnnotation.invite_id);
  assert.equal(invite.created_by, ownerSession.ownerId);
  const guestCreate = await db
    .prepare(
      "SELECT * FROM guest_annotation_commands WHERE annotation_id=? AND operation='create' ORDER BY created_at_ms,id LIMIT 1",
    )
    .bind(guestAnnotation.id)
    .first();
  assert.ok(guestCreate?.id, 'Guest source create command must exist');
  assert.equal(guestCreate.invite_id, guestAnnotation.invite_id);

  const ownerAnnotationId = randomUUID();
  const ownerRequestId = randomUUID();
  const geometry = {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: 450000,
    y: 550000,
  };
  const style = { color: 'blue' };
  const ownerRequest = {
    requestId: ownerRequestId,
    expectedOwnerId: ownerSession.ownerId,
    operation: 'create',
    inviteId: guestAnnotation.invite_id,
    photoId: guestAnnotation.photo_id,
    versionId: guestAnnotation.version_id,
    geometry,
    style,
    commentId: null,
  };
  const ownerCommandId = randomUUID();
  await db
    .prepare(
      "INSERT INTO owner_annotation_commands(id,actor_id,expected_owner_id,session_id,request_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'create',NULL,?,?,NULL,?)",
    )
    .bind(
      ownerCommandId,
      ownerSession.ownerId,
      ownerSession.ownerId,
      ownerSessionId,
      ownerRequestId,
      guestAnnotation.invite_id,
      guestAnnotation.workspace_id,
      guestAnnotation.project_id,
      guestAnnotation.album_id,
      guestAnnotation.photo_id,
      guestAnnotation.version_id,
      ownerAnnotationId,
      JSON.stringify(geometry),
      JSON.stringify(style),
      JSON.stringify(ownerRequest),
    )
    .run();
  const ownerAnnotation = await db
    .prepare(
      'SELECT author_user_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,revision,state FROM owner_annotations WHERE id=?',
    )
    .bind(ownerAnnotationId)
    .first();
  assert.deepEqual(ownerAnnotation, {
    author_user_id: ownerSession.ownerId,
    invite_id: guestAnnotation.invite_id,
    workspace_id: guestAnnotation.workspace_id,
    project_id: guestAnnotation.project_id,
    album_id: guestAnnotation.album_id,
    photo_id: guestAnnotation.photo_id,
    version_id: guestAnnotation.version_id,
    revision: 1,
    state: 'open',
  });

  const oldProductTables = await productTableNames(db);
  assert.equal(
    oldProductTables.length,
    114,
    '0046 upgrade fixture should contain 114 existing product tables',
  );
  const beforeMigration = await productTableSnapshot(db, oldProductTables);
  const sequencesBeforeMigration = await annotationSequences(db);
  assert.ok(sequencesBeforeMigration.guestAnnotationChanges >= 2);
  assert.ok(sequencesBeforeMigration.ownerAnnotationChanges >= 1);

  const executableSource = source47
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith('--'))
    .join(' ');
  await db.exec(executableSource);

  await assertProcessingReadPlans(db, {
    annotationId: guestAnnotation.id,
    inviteId: guestAnnotation.invite_id,
    workspaceId: guestAnnotation.workspace_id,
    projectId: guestAnnotation.project_id,
    albumId: guestAnnotation.album_id,
    photoId: guestAnnotation.photo_id,
    versionId: guestAnnotation.version_id,
  });

  const afterMigrationTables = await productTableNames(db);
  const newProductTables = afterMigrationTables.filter(
    (name) => !oldProductTables.includes(name),
  );
  assert.deepEqual(
    newProductTables.sort(compareText),
    [...processingTables].sort(compareText),
  );
  const afterMigration = await productTableSnapshot(db, oldProductTables);
  assert.deepEqual(afterMigration.tables, beforeMigration.tables);
  assert.equal(afterMigration.rowCount, beforeMigration.rowCount);
  assert.equal(afterMigration.contentHash, beforeMigration.contentHash);
  assert.deepEqual(await annotationSequences(db), sequencesBeforeMigration);
  for (const table of processingTables) {
    const row = await db
      .prepare('SELECT count(*) AS count FROM ' + quoteIdentifier(table))
      .first();
    assert.equal(row?.count, 0, table + ' must start empty after 0047');
  }
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );

  const replaySnapshotBefore = await productTableSnapshot(db, oldProductTables);
  const replaySequencesBefore = await annotationSequences(db);
  await db
    .prepare(
      'INSERT INTO guest_annotation_commands(id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      randomUUID(),
      guestCreate.guest_id,
      guestCreate.expected_guest_id,
      guestCreate.invite_id,
      guestCreate.session_id,
      guestCreate.secret_hash,
      guestCreate.request_id,
      guestCreate.workspace_id,
      guestCreate.project_id,
      guestCreate.album_id,
      guestCreate.photo_id,
      guestCreate.version_id,
      guestCreate.annotation_id,
      guestCreate.operation,
      guestCreate.expected_revision,
      guestCreate.geometry_json,
      guestCreate.style_json,
      guestCreate.linked_comment_id,
      guestCreate.request_json,
    )
    .run();
  const originalOwnerCreate = await db
    .prepare(
      "SELECT * FROM owner_annotation_commands WHERE annotation_id=? AND operation='create' AND request_id=?",
    )
    .bind(ownerAnnotationId, ownerRequestId)
    .first();
  assert.ok(originalOwnerCreate?.id);
  await db
    .prepare(
      'INSERT INTO owner_annotation_commands(id,actor_id,expected_owner_id,session_id,request_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      randomUUID(),
      originalOwnerCreate.actor_id,
      originalOwnerCreate.expected_owner_id,
      originalOwnerCreate.session_id,
      originalOwnerCreate.request_id,
      originalOwnerCreate.invite_id,
      originalOwnerCreate.workspace_id,
      originalOwnerCreate.project_id,
      originalOwnerCreate.album_id,
      originalOwnerCreate.photo_id,
      originalOwnerCreate.version_id,
      originalOwnerCreate.annotation_id,
      originalOwnerCreate.operation,
      originalOwnerCreate.expected_revision,
      originalOwnerCreate.geometry_json,
      originalOwnerCreate.style_json,
      originalOwnerCreate.linked_comment_id,
      originalOwnerCreate.request_json,
    )
    .run();

  const replaySnapshotAfter = await productTableSnapshot(db, oldProductTables);
  assert.deepEqual(replaySnapshotAfter.tables, replaySnapshotBefore.tables);
  assert.equal(replaySnapshotAfter.rowCount, replaySnapshotBefore.rowCount);
  assert.deepEqual(await annotationSequences(db), replaySequencesBefore);
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );

  return {
    preservedProductTables: oldProductTables.length,
    preservedProductRows: beforeMigration.rowCount,
    preservedContentSha256: beforeMigration.contentHash,
    guestAnnotationRevision: guestAnnotation.revision,
    ownerAnnotationRevision: ownerAnnotation.revision,
    sequencesUnchanged: true,
    processingTablesEmpty: true,
    processingReadPlansIndexed: true,
    exactGuestAndOwnerReplayUnchanged: true,
    foreignKeyViolations: 0,
  };
}
