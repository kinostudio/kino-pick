import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const dto = (albumId, revision, cleanupAllowed, inactiveDays) => ({
  albumId,
  revision,
  cleanupAllowed,
  inactiveDays,
  automaticDeletionEnabled: false,
  dryRun: true,
});

async function expectError(
  request,
  path,
  method,
  body,
  status,
  code,
  label,
  cookie,
  options,
) {
  const response = await request(path, method, body, cookie, options);
  const value = await response
    .clone()
    .json()
    .catch(() => null);
  assert.equal(response.status, status, label + ' status');
  assert.equal(value?.error?.code, code, label + ' code');
  return response;
}

export async function testAlbumRetentionPolicy({
  db,
  request,
  json,
  ownerCookie,
  owner,
  sessionId,
  scope,
  foreignAlbumId,
  record,
}) {
  const capabilityPath = '/api/v1/album-retention-policy/capabilities';
  const policyPath = (albumId) =>
    '/api/v1/albums/' + albumId + '/retention-policy';
  const capabilities = await json(
    await request(capabilityPath, 'GET', undefined, ownerCookie),
    200,
    'album retention policy capability',
  );
  assert.deepEqual(capabilities, { enabled: true });
  const existing = await json(
    await request(policyPath(scope.albumId), 'GET', undefined, ownerCookie),
    200,
    'existing album retention policy',
  );
  assert.deepEqual(existing, dto(scope.albumId, 0, false, 90));

  const newAlbumRequestId = 'deafbeef-dead-4fab-8bad-c0ffee000001';
  const newAlbumResult = await json(
    await request(
      '/api/v1/projects/' + scope.projectId + '/albums',
      'POST',
      { name: 'Retention policy native fixture', requestId: newAlbumRequestId },
      ownerCookie,
    ),
    201,
    'create new retention policy album',
  );
  const album = newAlbumResult.album;
  assert.ok(album?.id);
  const createdPolicy = await json(
    await request(policyPath(album.id), 'GET', undefined, ownerCookie),
    200,
    'new album retention policy',
  );
  assert.deepEqual(createdPolicy, dto(album.id, 0, false, 90));
  const seededRow = await db
    .prepare(
      'SELECT inactive_days,cleanup_allowed,revision,last_command_id FROM album_retention_policy_configurations WHERE album_id=?',
    )
    .bind(album.id)
    .first();
  assert.deepEqual(seededRow, {
    inactive_days: 90,
    cleanup_allowed: 0,
    revision: 0,
    last_command_id: null,
  });

  const uppercaseRequestId = 'ABCDEFAB-CDEF-4ABC-8DEF-0123456789AB';
  const uppercaseRequestPayload = JSON.stringify({
    requestId: uppercaseRequestId,
    expectedOwnerId: owner,
    expectedRevision: 0,
    cleanupAllowed: true,
    inactiveDays: 120,
  });
  await assert.rejects(
    () =>
      db
        .prepare(
          'INSERT INTO album_retention_policy_commands(id,actor_id,session_id,request_id,expected_owner_id,workspace_id,project_id,album_id,expected_revision,inactive_days,cleanup_allowed,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          randomUUID(),
          owner,
          sessionId,
          uppercaseRequestId,
          owner,
          scope.workspaceId,
          scope.projectId,
          album.id,
          0,
          120,
          1,
          uppercaseRequestPayload,
          Date.now(),
        )
        .run(),
    /REQUEST_ID_NOT_NORMALIZED/,
  );

  await expectError(
    request,
    policyPath(album.id),
    'PUT',
    {
      requestId: newAlbumRequestId.toUpperCase(),
      expectedOwnerId: owner,
      expectedRevision: 0,
      cleanupAllowed: true,
      inactiveDays: 120,
    },
    409,
    'REQUEST_ID_CONFLICT',
    'existing Owner ledger and uppercase alias reserve the request ID',
    ownerCookie,
  );
  assert.equal(
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM album_retention_policy_commands WHERE album_id=?',
        )
        .bind(album.id)
        .first()
    ).n,
    0,
  );
  await expectError(
    request,
    policyPath(album.id),
    'GET',
    undefined,
    401,
    'AUTH_REQUIRED',
    'Owner session required',
  );
  await expectError(
    request,
    policyPath(foreignAlbumId),
    'GET',
    undefined,
    404,
    'NOT_FOUND',
    'foreign album is out of scope',
    ownerCookie,
  );
  const initialState = await db
    .prepare(
      'SELECT a.revision AS albumRevision,' +
        '(SELECT count(*) FROM photos p WHERE p.album_id=a.id) AS photos,' +
        '(SELECT count(*) FROM photo_versions v JOIN photos p ON p.id=v.photo_id WHERE p.album_id=a.id) AS versions,' +
        '(SELECT count(*) FROM photo_assets x JOIN photos p ON p.id=x.photo_id WHERE p.album_id=a.id) AS assets,' +
        '(SELECT count(*) FROM human_photo_views h WHERE h.album_id=a.id) AS humanViews,' +
        '(SELECT count(*) FROM album_human_activity h WHERE h.album_id=a.id) AS albumActivity,' +
        '(SELECT count(*) FROM client_browse_events b WHERE b.album_id=a.id) AS browseEvents,' +
        '(SELECT count(*) FROM client_album_browser_receipts b WHERE b.album_id=a.id) AS browserReceipts,' +
        '(SELECT count(*) FROM manual_album_deletion_jobs j WHERE j.album_id=a.id) AS deletionJobs ' +
        'FROM albums a WHERE a.id=?',
    )
    .bind(album.id)
    .first();
  assert.ok(initialState);

  const wrongOriginBody = {
    requestId: 'abcdefab-cdef-4abc-8def-0123456789ab',
    expectedOwnerId: owner,
    expectedRevision: 0,
    cleanupAllowed: true,
    inactiveDays: 120,
  };
  const wrongOrigin = await request(
    policyPath(album.id),
    'PUT',
    wrongOriginBody,
    ownerCookie,
    { origin: 'https://wrong-origin.example' },
  );
  assert.equal(wrongOrigin.status, 403, 'wrong Origin status');
  assert.equal(
    await wrongOrigin.clone().text(),
    'Validation unavailable',
    'wrong Origin is rejected by the closed collaboration wrapper',
  );
  await expectError(
    request,
    policyPath(album.id),
    'PUT',
    { ...wrongOriginBody, expectedOwnerId: randomUUID() },
    403,
    'OWNER_REQUIRED',
    'expected owner identity enforced',
    ownerCookie,
  );
  await expectError(
    request,
    policyPath(album.id),
    'PUT',
    { ...wrongOriginBody, inactiveDays: 0 },
    400,
    'INVALID_INPUT',
    'inactive day bounds enforced',
    ownerCookie,
  );
  const save = await json(
    await request(policyPath(album.id), 'PUT', wrongOriginBody, ownerCookie),
    200,
    'persist album retention policy',
  );
  const savedDto = dto(album.id, 1, true, 120);
  assert.deepEqual(save, savedDto);
  const audit = await db
    .prepare(
      "SELECT event_id,before_json,after_json FROM audit_events WHERE album_id=? AND action='album.retention_policy_changed' ORDER BY occurred_at_utc,event_id",
    )
    .bind(album.id)
    .all();
  assert.equal(audit.results.length, 1);
  assert.deepEqual(JSON.parse(audit.results[0].before_json), {
    inactiveDays: 90,
    cleanupAllowed: false,
    revision: 0,
  });
  assert.deepEqual(JSON.parse(audit.results[0].after_json), {
    inactiveDays: 120,
    cleanupAllowed: true,
    revision: 1,
  });

  const replay = await json(
    await request(policyPath(album.id), 'PUT', wrongOriginBody, ownerCookie),
    200,
    'exact album retention retry',
  );
  assert.deepEqual(replay, savedDto);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action='album.retention_policy_changed'",
        )
        .bind(album.id)
        .first()
    ).n,
    1,
  );

  await expectError(
    request,
    policyPath(album.id),
    'PUT',
    { ...wrongOriginBody, inactiveDays: 121 },
    409,
    'REQUEST_ID_CONFLICT',
    'changed request ID reuse rejected',
    ownerCookie,
  );
  await expectError(
    request,
    policyPath(album.id),
    'PUT',
    {
      ...wrongOriginBody,
      requestId: wrongOriginBody.requestId.toUpperCase(),
      expectedRevision: 1,
      inactiveDays: 121,
    },
    409,
    'REQUEST_ID_CONFLICT',
    'uppercase alias cannot bypass a prior retention command',
    ownerCookie,
  );
  await expectError(
    request,
    policyPath(scope.albumId),
    'PUT',
    wrongOriginBody,
    409,
    'REQUEST_ID_CONFLICT',
    'cross-album request ID reuse rejected',
    ownerCookie,
  );
  await expectError(
    request,
    policyPath(album.id),
    'PUT',
    { ...wrongOriginBody, requestId: randomUUID(), expectedRevision: 0 },
    409,
    'ALBUM_RETENTION_POLICY_REVISION_CONFLICT',
    'stale policy revision rejected',
    ownerCookie,
  );
  const noopRequestId = randomUUID();
  const noop = await json(
    await request(
      policyPath(album.id),
      'PUT',
      {
        requestId: noopRequestId,
        expectedOwnerId: owner,
        expectedRevision: 1,
        cleanupAllowed: true,
        inactiveDays: 120,
      },
      ownerCookie,
    ),
    200,
    'no-op policy save',
  );
  assert.deepEqual(noop, savedDto);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action='album.retention_policy_changed'",
        )
        .bind(album.id)
        .first()
    ).n,
    1,
    'no-op saves do not append a second event',
  );

  const requestLedgerBefore = await db
    .prepare(
      'SELECT count(*) AS requests,(SELECT count(*) FROM albums) AS albums FROM request_commands WHERE actor_id=?',
    )
    .bind(owner)
    .first();
  await expectError(
    request,
    '/api/v1/projects/' + scope.projectId + '/albums',
    'POST',
    { name: 'Conflicting ledger request', requestId: noopRequestId },
    409,
    'REQUEST_ID_CONFLICT',
    'no-op retention ledger reserves a new Owner request',
    ownerCookie,
  );
  const requestLedgerAfter = await db
    .prepare(
      'SELECT count(*) AS requests,(SELECT count(*) FROM albums) AS albums FROM request_commands WHERE actor_id=?',
    )
    .bind(owner)
    .first();
  assert.deepEqual(requestLedgerAfter, requestLedgerBefore);

  const pinnablePhoto = await db
    .prepare(
      'SELECT p.id FROM photos p JOIN photo_version_heads h ON h.photo_id=p.id AND h.workspace_id=p.workspace_id WHERE p.album_id=? ORDER BY p.id LIMIT 1',
    )
    .bind(scope.albumId)
    .first();
  assert.ok(pinnablePhoto?.id, 'synthetic album has a pinnable photo');
  const pinCountsBefore = await db
    .prepare(
      'SELECT (SELECT count(*) FROM photo_pin_commands WHERE actor_id=? AND request_id=?) AS commands,' +
        ' (SELECT count(*) FROM photo_pin_states WHERE photo_id=?) AS states',
    )
    .bind(owner, noopRequestId, pinnablePhoto.id)
    .first();
  await expectError(
    request,
    '/api/v1/photos/' + pinnablePhoto.id + '/pin',
    'PUT',
    {
      requestId: noopRequestId,
      expectedRevision: 0,
      isPinned: true,
    },
    409,
    'REQUEST_ID_CONFLICT',
    'no-op retention ledger reserves the photo-pin namespace',
    ownerCookie,
    { expectedActor: owner, expectedSession: sessionId },
  );
  const pinCountsAfter = await db
    .prepare(
      'SELECT (SELECT count(*) FROM photo_pin_commands WHERE actor_id=? AND request_id=?) AS commands,' +
        ' (SELECT count(*) FROM photo_pin_states WHERE photo_id=?) AS states',
    )
    .bind(owner, noopRequestId, pinnablePhoto.id)
    .first();
  assert.deepEqual(pinCountsAfter, pinCountsBefore);

  const forged = randomUUID();
  await assert.rejects(
    () =>
      db
        .prepare(
          'INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          forged,
          'user',
          owner,
          'native-forged-policy-session',
          scope.workspaceId,
          scope.projectId,
          album.id,
          'album.retention_policy_changed',
          JSON.stringify({
            inactiveDays: 120,
            cleanupAllowed: true,
            revision: 1,
          }),
          JSON.stringify({
            inactiveDays: 121,
            cleanupAllowed: true,
            revision: 2,
          }),
          randomUUID(),
          new Date().toISOString(),
        )
        .run(),
    /INVALID_ALBUM_RETENTION_POLICY_AUDIT/,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT count(*) AS n FROM audit_events WHERE event_id=?')
        .bind(forged)
        .first()
    ).n,
    0,
  );

  const beforeFailure = await db
    .prepare(
      'SELECT c.inactive_days,c.cleanup_allowed,c.revision,' +
        '(SELECT count(*) FROM album_retention_policy_commands WHERE album_id=c.album_id) AS commands,' +
        '(SELECT count(*) FROM album_retention_policy_results r JOIN album_retention_policy_commands cmd ON cmd.id=r.command_id WHERE cmd.album_id=c.album_id) AS results,' +
        "(SELECT count(*) FROM audit_events e WHERE e.album_id=c.album_id AND e.action='album.retention_policy_changed') AS events " +
        'FROM album_retention_policy_configurations c WHERE c.album_id=?',
    )
    .bind(album.id)
    .first();
  await db
    .prepare(
      "CREATE TRIGGER native_album_retention_policy_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='album.retention_policy_changed' BEGIN SELECT RAISE(ABORT,'NATIVE_INJECTED_AUDIT_FAILURE'); END",
    )
    .run();
  try {
    await expectError(
      request,
      policyPath(album.id),
      'PUT',
      {
        requestId: randomUUID(),
        expectedOwnerId: owner,
        expectedRevision: 1,
        cleanupAllowed: true,
        inactiveDays: 121,
      },
      503,
      'ALBUM_RETENTION_POLICY_UNAVAILABLE',
      'audit failure reported without partial save',
      ownerCookie,
    );
  } finally {
    await db
      .prepare('DROP TRIGGER native_album_retention_policy_audit_failure')
      .run();
  }
  const afterFailure = await db
    .prepare(
      'SELECT c.inactive_days,c.cleanup_allowed,c.revision,' +
        '(SELECT count(*) FROM album_retention_policy_commands WHERE album_id=c.album_id) AS commands,' +
        '(SELECT count(*) FROM album_retention_policy_results r JOIN album_retention_policy_commands cmd ON cmd.id=r.command_id WHERE cmd.album_id=c.album_id) AS results,' +
        "(SELECT count(*) FROM audit_events e WHERE e.album_id=c.album_id AND e.action='album.retention_policy_changed') AS events " +
        'FROM album_retention_policy_configurations c WHERE c.album_id=?',
    )
    .bind(album.id)
    .first();
  assert.deepEqual(afterFailure, beforeFailure);

  const unchangedSideEffects = await db
    .prepare(
      'SELECT a.revision AS albumRevision,' +
        '(SELECT count(*) FROM photos p WHERE p.album_id=a.id) AS photos,' +
        '(SELECT count(*) FROM photo_versions v JOIN photos p ON p.id=v.photo_id WHERE p.album_id=a.id) AS versions,' +
        '(SELECT count(*) FROM photo_assets x JOIN photos p ON p.id=x.photo_id WHERE p.album_id=a.id) AS assets,' +
        '(SELECT count(*) FROM human_photo_views h WHERE h.album_id=a.id) AS humanViews,' +
        '(SELECT count(*) FROM album_human_activity h WHERE h.album_id=a.id) AS albumActivity,' +
        '(SELECT count(*) FROM client_browse_events b WHERE b.album_id=a.id) AS browseEvents,' +
        '(SELECT count(*) FROM client_album_browser_receipts b WHERE b.album_id=a.id) AS browserReceipts,' +
        '(SELECT count(*) FROM manual_album_deletion_jobs j WHERE j.album_id=a.id) AS deletionJobs ' +
        'FROM albums a WHERE a.id=?',
    )
    .bind(album.id)
    .first();
  assert.deepEqual(unchangedSideEffects, initialState);
  const archivedAlbumResult = await json(
    await request(
      '/api/v1/projects/' + scope.projectId + '/albums',
      'POST',
      {
        name: 'Archived retention policy native fixture',
        requestId: randomUUID(),
      },
      ownerCookie,
    ),
    201,
    'create archived policy album',
  );
  const archivedAlbum = archivedAlbumResult.album;
  await json(
    await request(
      '/api/v1/albums/' + archivedAlbum.id + '/archive',
      'PATCH',
      {
        archived: true,
        expectedRevision: archivedAlbum.revision,
        requestId: randomUUID(),
      },
      ownerCookie,
    ),
    200,
    'archive policy album',
  );
  const archivedPolicy = await json(
    await request(
      policyPath(archivedAlbum.id),
      'PUT',
      {
        requestId: randomUUID(),
        expectedOwnerId: owner,
        expectedRevision: 0,
        cleanupAllowed: false,
        inactiveDays: 100,
      },
      ownerCookie,
    ),
    200,
    'archived project policy remains editable',
  );
  assert.deepEqual(archivedPolicy, dto(archivedAlbum.id, 1, false, 100));

  const terminalAlbumResult = await json(
    await request(
      '/api/v1/projects/' + scope.projectId + '/albums',
      'POST',
      { name: 'Terminal policy native fixture', requestId: randomUUID() },
      ownerCookie,
    ),
    201,
    'create terminal policy album',
  );
  const terminalAlbum = terminalAlbumResult.album;
  const deletionPreview = await json(
    await request(
      '/api/v1/albums/' + terminalAlbum.id + '/deletion',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'empty synthetic album deletion preview',
  );
  assert.deepEqual(deletionPreview.preview.blockers, []);
  await json(
    await request(
      '/api/v1/albums/' + terminalAlbum.id,
      'DELETE',
      {
        requestId: randomUUID(),
        expectedRevision: deletionPreview.album.revision,
        confirmationName: deletionPreview.album.name,
        inventoryCount: deletionPreview.preview.assetCount,
        bytesBefore: deletionPreview.preview.totalBytes,
        confirmPermanent: true,
      },
      ownerCookie,
    ),
    200,
    'delete empty synthetic album',
  );
  const terminalState = await db
    .prepare('SELECT state FROM albums WHERE id=?')
    .bind(terminalAlbum.id)
    .first();
  assert.ok(['deleting', 'deleted'].includes(terminalState?.state));
  await expectError(
    request,
    policyPath(terminalAlbum.id),
    'PUT',
    {
      requestId: randomUUID(),
      expectedOwnerId: owner,
      expectedRevision: 0,
      cleanupAllowed: false,
      inactiveDays: 100,
    },
    409,
    'RESOURCE_NOT_EDITABLE',
    'terminal album policy edit denied',
    ownerCookie,
  );
  record('album-retention-policy-defaults-existing-and-new-albums');
  record('album-retention-policy-owner-persistence-replay-and-conflict');
  record('album-retention-policy-request-id-namespace-guards');
  record('album-retention-policy-auth-scope-origin-and-terminal-guards');
  record('album-retention-policy-forged-audit-rollback-and-no-side-effects');
}
