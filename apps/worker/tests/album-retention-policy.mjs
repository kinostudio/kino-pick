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
  origin,
  foreignAlbumId,
  record,
}) {
  const capabilityPath = '/api/v1/album-retention-policy/capabilities';
  const policyPath = (albumId) =>
    '/api/v1/albums/' + albumId + '/retention-policy';
  const shareProtectionPath = (albumId) =>
    policyPath(albumId) + '/share-protection';
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
    'unknown album ID is out of scope',
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
  if (origin && new URL(origin).protocol === 'http:')
    assert.deepEqual(
      await wrongOrigin.clone().json(),
      { error: { code: 'FORBIDDEN_ORIGIN' } },
      'wrong Origin is rejected by the local product route',
    );
  else
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
  const archivedShareProtection = await json(
    await request(
      shareProtectionPath(archivedAlbum.id),
      'GET',
      undefined,
      ownerCookie,
      { expectedActor: owner, expectedSession: sessionId },
    ),
    200,
    'archived album share protection remains readable',
  );
  assert.equal(archivedShareProtection.albumId, archivedAlbum.id);
  assert.equal(archivedShareProtection.activeCustomShareCount, 0);
  assert.equal(archivedShareProtection.latestActiveCustomShareExpiresAt, null);

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

  const shareAlbumResult = await json(
    await request(
      '/api/v1/projects/' + scope.projectId + '/albums',
      'POST',
      { name: 'Share protection native fixture', requestId: randomUUID() },
      ownerCookie,
    ),
    201,
    'create active share protection album',
  );
  const shareAlbum = shareAlbumResult.album;
  await json(
    await request(
      '/api/v1/albums/' + shareAlbum.id + '/activate',
      'POST',
      {
        requestId: randomUUID(),
        expectedRevision: shareAlbum.revision,
        confirmActivate: true,
      },
      ownerCookie,
    ),
    200,
    'activate empty share protection album',
  );

  const readShareProtection = async () => {
    const response = await request(
      shareProtectionPath(shareAlbum.id),
      'GET',
      undefined,
      ownerCookie,
      { expectedActor: owner, expectedSession: sessionId },
    );
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    return json(response, 200, 'read album share protection');
  };
  const expectedShareKeys = [
    'albumId',
    'evaluatedAt',
    'latestActiveCustomShareExpiresAt',
    'activeCustomShareCount',
    'shareEvidenceVerified',
    'automaticDeletionEnabled',
    'dryRun',
  ].sort();
  const assertShareProtectionEnvelope = (value) => {
    assert.deepEqual(Object.keys(value).sort(), expectedShareKeys);
    assert.equal(value.albumId, shareAlbum.id);
    assert.ok(Number.isFinite(Date.parse(value.evaluatedAt)));
    assert.equal(
      new Date(value.evaluatedAt).toISOString(),
      value.evaluatedAt,
      'share evaluation time is normalized UTC',
    );
    assert.equal(value.shareEvidenceVerified, true);
    assert.equal(value.automaticDeletionEnabled, false);
    assert.equal(value.dryRun, true);
  };
  const shareReadSideEffects = async () =>
    db
      .prepare(
        'SELECT (SELECT quota_bytes FROM workspaces WHERE id=?) AS quotaBytes,' +
          '(SELECT count(*) FROM photo_assets x JOIN photos p ON p.id=x.photo_id WHERE p.workspace_id=?) AS assets,' +
          '(SELECT count(*) FROM audit_events WHERE workspace_id=? AND (project_id=? OR album_id=?)) AS auditEvents,' +
          '(SELECT count(*) FROM human_photo_views WHERE album_id=?) AS humanViews,' +
          '(SELECT count(*) FROM album_human_activity WHERE album_id=?) AS albumActivity,' +
          '(SELECT count(*) FROM client_browse_events WHERE album_id=?) AS browseEvents,' +
          '(SELECT count(*) FROM client_album_browser_receipts WHERE album_id=?) AS browserReceipts',
      )
      .bind(
        scope.workspaceId,
        scope.workspaceId,
        scope.workspaceId,
        scope.projectId,
        shareAlbum.id,
        shareAlbum.id,
        shareAlbum.id,
        shareAlbum.id,
        shareAlbum.id,
      )
      .first();

  const emptySnapshot = await shareReadSideEffects();
  const emptyProtection = await readShareProtection();
  assertShareProtectionEnvelope(emptyProtection);
  assert.equal(emptyProtection.activeCustomShareCount, 0);
  assert.equal(emptyProtection.latestActiveCustomShareExpiresAt, null);
  assert.deepEqual(await shareReadSideEffects(), emptySnapshot);

  const invitePath = '/api/v1/projects/' + scope.projectId + '/invites';
  const linkPermissions = {
    can_view: true,
    can_download_preview: true,
    can_download_original: false,
    can_select: false,
    can_rate: false,
    can_favorite: false,
    can_tag: false,
    can_annotate: false,
    can_comment: false,
    can_submit: false,
    can_view_own_history: false,
    can_compare_versions: false,
  };
  const createLinkInvite = async (expiresAt, maxUses, label) =>
    json(
      await request(
        invitePath,
        'POST',
        {
          requestId: randomUUID(),
          albumIds: [shareAlbum.id],
          accessMode: 'link_only',
          permissions: linkPermissions,
          expiresAt,
          maxUses,
        },
        ownerCookie,
      ),
      200,
      label,
    );
  const noSessionInvite = await createLinkInvite(
    new Date(Date.now() + 30 * 60_000).toISOString(),
    5,
    'issue unused link-only share',
  );
  const exhaustedInvite = await createLinkInvite(
    new Date(Date.now() + 30 * 60_000).toISOString(),
    1,
    'issue single-use link-only share',
  );
  const guestExchangeResponse = await request(
    '/api/guest/exchange',
    'POST',
    {
      requestId: randomUUID(),
      token: exhaustedInvite.token,
      displayName: 'Retention protection synthetic Guest',
    },
    undefined,
    { cfConnectingIp: '192.0.2.68' },
  );
  await json(guestExchangeResponse, 200, 'consume single-use share');
  const guestCookieName =
    new URL(origin ?? 'https://native.invalid').protocol === 'https:'
      ? '__Host-kino_guest'
      : 'kino_guest';
  const guestCookieMatch = new RegExp(
    '^' + guestCookieName + '=([a-f0-9]{64});',
  ).exec(guestExchangeResponse.headers.get('set-cookie') ?? '');
  assert.ok(guestCookieMatch, 'single-use share created a Guest session');
  const guestCookie = guestCookieName + '=' + guestCookieMatch[1];
  const exhaustedUseCount = await db
    .prepare(
      'SELECT i.max_uses,(SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id) AS sessions FROM guest_invites i WHERE i.id=?',
    )
    .bind(exhaustedInvite.invite.inviteId)
    .first();
  assert.deepEqual(exhaustedUseCount, { max_uses: 1, sessions: 1 });

  const revokedInvite = await createLinkInvite(
    new Date(Date.now() + 30 * 60_000).toISOString(),
    3,
    'issue share for revocation case',
  );
  await json(
    await request(
      '/api/v1/invites/' + revokedInvite.invite.inviteId + '/revoke',
      'POST',
      { requestId: randomUUID(), confirmRevoke: true },
      ownerCookie,
    ),
    200,
    'revoke share protection fixture',
  );

  const expiresAt = new Date(Date.now() + 5000).toISOString();
  const expiringInvite = await createLinkInvite(
    expiresAt,
    3,
    'issue short-lived share for expiry case',
  );
  const expiringAt = Date.parse(expiringInvite.invite.expiresAt);
  assert.ok(expiringAt > Date.now());

  const foreignOwnerId = randomUUID();
  const foreignWorkspaceId = randomUUID();
  const foreignProjectId = randomUUID();
  const foreignOwnerAlbumId = randomUUID();
  const foreignNow = Date.now();
  await db.batch([
    db
      .prepare(
        'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(
        foreignOwnerId,
        'Foreign retention fixture',
        foreignOwnerId + '@retention-test.invalid',
        foreignNow,
        foreignNow,
      ),
    db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(foreignWorkspaceId, 'Foreign retention fixture', foreignOwnerId),
    db
      .prepare(
        "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
      )
      .bind(foreignProjectId, foreignWorkspaceId, 'Foreign retention fixture'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(
        foreignOwnerAlbumId,
        foreignWorkspaceId,
        foreignProjectId,
        'Foreign retention fixture',
      ),
  ]);

  const readsSnapshot = await shareReadSideEffects();
  await expectError(
    request,
    shareProtectionPath(randomUUID()),
    'GET',
    undefined,
    404,
    'NOT_FOUND',
    'unknown album ID is out of scope',
    ownerCookie,
    { expectedActor: owner, expectedSession: sessionId },
  );
  await expectError(
    request,
    shareProtectionPath(foreignOwnerAlbumId),
    'GET',
    undefined,
    404,
    'NOT_FOUND',
    'foreign account album is hidden from the current Owner',
    ownerCookie,
    { expectedActor: owner, expectedSession: sessionId },
  );
  await expectError(
    request,
    shareProtectionPath(shareAlbum.id),
    'GET',
    undefined,
    401,
    'AUTH_REQUIRED',
    'share protection requires an Owner session',
  );
  await expectError(
    request,
    shareProtectionPath(shareAlbum.id),
    'GET',
    undefined,
    401,
    'AUTH_REQUIRED',
    'Guest session cannot read Owner share protection',
    guestCookie,
  );

  const expiryDeadline = Date.now() + 10_000;
  let protection;
  do {
    protection = await readShareProtection();
    if (Date.parse(protection.evaluatedAt) >= expiringAt) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < expiryDeadline);
  assert.ok(
    Date.parse(protection.evaluatedAt) >= expiringAt,
    'D1 evaluation clock passed the short-lived invite expiry',
  );
  assertShareProtectionEnvelope(protection);
  assert.equal(protection.activeCustomShareCount, 2);
  assert.equal(
    protection.latestActiveCustomShareExpiresAt,
    new Date(
      Math.max(
        Date.parse(noSessionInvite.invite.expiresAt),
        Date.parse(exhaustedInvite.invite.expiresAt),
      ),
    ).toISOString(),
  );
  const privateInviteValues = [
    noSessionInvite.invite.inviteId,
    noSessionInvite.token,
    exhaustedInvite.invite.inviteId,
    exhaustedInvite.token,
    revokedInvite.invite.inviteId,
    revokedInvite.token,
    expiringInvite.invite.inviteId,
    expiringInvite.token,
  ];
  for (const privateValue of privateInviteValues)
    assert.ok(!JSON.stringify(protection).includes(privateValue));
  assert.deepEqual(await shareReadSideEffects(), readsSnapshot);

  const unusedSessionCount = await db
    .prepare('SELECT count(*) AS n FROM guest_sessions WHERE invite_id=?')
    .bind(noSessionInvite.invite.inviteId)
    .first();
  assert.equal(unusedSessionCount.n, 0);
  const revokedRow = await db
    .prepare('SELECT 1 AS n FROM guest_invite_revocations WHERE invite_id=?')
    .bind(revokedInvite.invite.inviteId)
    .first();
  assert.equal(revokedRow?.n, 1);

  record('album-retention-policy-defaults-existing-and-new-albums');
  record('album-retention-policy-owner-persistence-replay-and-conflict');
  record('album-retention-policy-request-id-namespace-guards');
  record('album-retention-policy-auth-scope-origin-and-terminal-guards');
  record('album-retention-policy-forged-audit-rollback-and-no-side-effects');
}
