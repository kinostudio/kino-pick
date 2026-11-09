import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { makeSignature } from 'better-auth/crypto';
import { humanViewChecks } from './human-views.mjs';
import { guestPermissionNames } from '../../../packages/contracts/src/guest-access.ts';

const proofPath = '.local/human-view-b-profile-proof.json';

function guestSecretFrom(response) {
  const match = /^__Host-kino_guest=([a-f0-9]{64});/u.exec(
    response.headers.get('set-cookie') ?? '',
  );
  assert.ok(match, 'normal Guest exchange returns the sealed secure cookie');
  return match[1];
}

async function exchangeGuest({ request, db, token, displayName }) {
  const requestId = randomUUID();
  const response = await request('/api/guest/exchange', 'POST', {
    requestId,
    token,
    displayName,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const secret = guestSecretFrom(response);
  const row = await db
    .prepare(
      'SELECT s.id,s.guest_id,s.secret_hash FROM guest_exchange_commands c JOIN guest_sessions s ON s.id=c.session_id WHERE c.request_id=?',
    )
    .bind(requestId)
    .first();
  assert.ok(row?.id && row?.guest_id);
  return {
    cookie: secret,
    guestId: row.guest_id,
    sessionId: row.id,
    secretHash: row.secret_hash,
  };
}

async function expectError(response, status, code, label) {
  assert.equal(response.status, status, label + ' status');
  const result = await response
    .clone()
    .json()
    .catch(() => null);
  assert.equal(result?.error?.code, code, label + ' error code');
}

async function activitySnapshot(db, albumId, workspaceId) {
  const count = async (sql, ...values) => {
    const statement = db.prepare(sql);
    return (
      await (values.length ? statement.bind(...values) : statement).first()
    ).n;
  };
  return {
    views: await count('SELECT count(*) AS n FROM human_photo_views'),
    audit: await count(
      "SELECT count(*) AS n FROM audit_events WHERE action='gallery.viewed' AND album_id=?",
      albumId,
    ),
    frontier: (
      await db
        .prepare(
          'SELECT * FROM album_human_activity WHERE album_id=? ORDER BY view_event_id',
        )
        .bind(albumId)
        .all()
    ).results,
    assets: await count('SELECT count(*) AS n FROM photo_assets'),
    quota: await db
      .prepare('SELECT * FROM workspace_storage_usage WHERE workspace_id=?')
      .bind(workspaceId)
      .first(),
  };
}

function requestThrough(dispatch, workerName, base) {
  return (path, init = {}) => {
    const headers = new Headers(init.headers);
    const cookie = headers.get('Cookie');
    if (cookie?.startsWith('kino_guest='))
      headers.set(
        'Cookie',
        cookie.replace(/^kino_guest=/u, '__Host-kino_guest='),
      );
    return dispatch(workerName, base + path, {
      ...init,
      headers,
      redirect: 'manual',
    });
  };
}

export async function testHumanViewsBProfile({
  db,
  request,
  dispatch,
  closedProfiles,
  owner,
  ownerCookie,
  authSecret,
  scope,
  photo,
  foreignPhoto,
  foreignAlbumId,
  validInviteToken,
  origin,
  primaryFlag,
  configuredFlag,
}) {
  assert.equal(
    primaryFlag,
    'false',
    'legacy primary native profile remains OFF',
  );
  assert.equal(configuredFlag, 'true', 'B deployment profile is configured ON');
  const profileChecks = [];
  const snapshot = () => activitySnapshot(db, scope.albumId, scope.workspaceId);
  const beforeClosed = await snapshot();
  const primaryCapability = await request('/api/human-views/capabilities');
  assert.equal(primaryCapability.status, 200);
  assert.deepEqual(await primaryCapability.json(), {
    enabled: false,
    minVisibleMs: 1000,
    dedupeMs: 300000,
  });
  await expectError(
    await request(
      `/api/v1/albums/${scope.albumId}/view-heartbeats`,
      'POST',
      {
        photoId: photo.photoId,
        versionId: photo.versionId,
        expectedActorId: owner,
        visibleForMs: 1000,
      },
      ownerCookie,
    ),
    503,
    'HUMAN_VIEWS_DISABLED',
    'main native profile remains closed',
  );
  for (const profileName of closedProfiles) {
    const response = await dispatch(
      profileName,
      origin + '/api/human-views/capabilities',
    );
    assert.equal(
      response.status,
      503,
      profileName + ' cannot enable Human views',
    );
  }
  assert.deepEqual(await snapshot(), beforeClosed);
  profileChecks.push(
    'Primary profile remains OFF with no writes; ordinary staging, production, and account-mismatch overrides remain closed',
  );

  const enabledCapability = await dispatch(
    'human-views-enabled',
    origin + '/api/human-views/capabilities',
  );
  assert.equal(enabledCapability.status, 200);
  assert.deepEqual(await enabledCapability.json(), {
    enabled: true,
    minVisibleMs: 1000,
    dedupeMs: 300000,
  });

  const viewGuest = await exchangeGuest({
    request,
    db,
    token: validInviteToken,
    displayName: 'Human view native Guest',
  });
  const permissions = Object.fromEntries(
    guestPermissionNames.map((name) => [
      name,
      name === 'can_download_original',
    ]),
  );
  const downloadInvite = await request(
    `/api/v1/projects/${scope.projectId}/invites`,
    'POST',
    {
      requestId: randomUUID(),
      albumIds: [scope.albumId],
      accessMode: 'link_only',
      permissions,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      maxUses: 2,
    },
    ownerCookie,
  );
  assert.equal(downloadInvite.status, 200, await downloadInvite.clone().text());
  const downloadInviteResult = await downloadInvite.json();
  const downloadGuest = await exchangeGuest({
    request,
    db,
    token: downloadInviteResult.token,
    displayName: 'Human view download-only native Guest',
  });
  const unsharedAlbumResponse = await request(
    `/api/v1/projects/${scope.projectId}/albums`,
    'POST',
    { requestId: randomUUID(), name: 'Unshared human view native album' },
    ownerCookie,
  );
  assert.equal(
    unsharedAlbumResponse.status,
    201,
    await unsharedAlbumResponse.clone().text(),
  );
  const unsharedAlbum = (await unsharedAlbumResponse.json()).album;
  const activation = await request(
    `/api/v1/albums/${unsharedAlbum.id}/activate`,
    'POST',
    {
      requestId: randomUUID(),
      expectedRevision: unsharedAlbum.revision,
      confirmActivate: true,
    },
    ownerCookie,
  );
  assert.equal(activation.status, 200, await activation.clone().text());
  const humanViewInviteResponse = await request(
    `/api/v1/projects/${scope.projectId}/invites`,
    'POST',
    {
      requestId: randomUUID(),
      albumIds: [scope.albumId],
      accessMode: 'link_only',
      permissions: Object.fromEntries(
        guestPermissionNames.map((name) => [name, true]),
      ),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      maxUses: 3,
    },
    ownerCookie,
  );
  assert.equal(
    humanViewInviteResponse.status,
    200,
    await humanViewInviteResponse.clone().text(),
  );
  const humanViewInvite = await humanViewInviteResponse.json();
  assert.equal(humanViewInvite.secretAvailable, true);
  assert.match(humanViewInvite.token, /^[a-f0-9]{64}$/);
  const createdGuests = [];
  const createGuest = async () => {
    const guest = await exchangeGuest({
      request,
      db,
      token: humanViewInvite.token,
      displayName: 'Human view frontier native Guest ' + createdGuests.length,
    });
    createdGuests.push(guest);
    return guest;
  };
  const helperRequest = requestThrough(dispatch, 'human-views-enabled', origin);
  const nativeChecks = await humanViewChecks({
    db,
    request: helperRequest,
    owner,
    ownerCookie,
    base: origin,
    authSecret,
    fixture: {
      albumId: scope.albumId,
      photoId: photo.photoId,
      versionId: photo.versionId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      viewGuest,
      downloadGuest,
      unsharedAlbumId: unsharedAlbum.id,
      createGuest,
    },
  });
  const checks = [...profileChecks, ...nativeChecks.checks];

  const activeGuest = createdGuests.at(-1);
  assert.ok(
    activeGuest,
    'frontier helper leaves an active synthetic test Guest',
  );
  const beforeDenied = await snapshot();
  const ownerBody = {
    photoId: photo.photoId,
    versionId: photo.versionId,
    expectedActorId: owner,
    visibleForMs: 1000,
  };
  const sendOwner = (body, cookie = ownerCookie, headers = {}) =>
    dispatch(
      'human-views-enabled',
      origin + `/api/v1/albums/${scope.albumId}/view-heartbeats`,
      {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );
  const sendGuest = (albumId, body, cookie, headers = {}) =>
    dispatch(
      'human-views-enabled',
      origin + `/api/guest/albums/${albumId}/view-heartbeats`,
      {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: cookie,
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );

  await expectError(
    await sendOwner(ownerBody, null),
    401,
    'AUTH_REQUIRED',
    'Owner heartbeat requires a session',
  );
  await expectError(
    await sendOwner({ ...ownerBody, expectedActorId: randomUUID() }),
    409,
    'OWNER_IDENTITY_CHANGED',
    'Owner actor binding is enforced',
  );
  const unknownSessionToken = randomUUID();
  const unknownSessionCookie =
    '__Secure-kino-owner.session_token=' +
    encodeURIComponent(
      unknownSessionToken +
        '.' +
        (await makeSignature(unknownSessionToken, authSecret)),
    );
  await expectError(
    await sendOwner(ownerBody, unknownSessionCookie),
    401,
    'AUTH_REQUIRED',
    'signed Owner cookie without a database session is rejected',
  );

  const guestBody = {
    photoId: photo.photoId,
    versionId: photo.versionId,
    expectedActorId: activeGuest.guestId,
    visibleForMs: 1000,
  };
  const guestCookie = '__Host-kino_guest=' + activeGuest.cookie;
  for (const [headers, label, code] of [
    [{ Purpose: 'prefetch' }, 'Purpose prefetch', 'NON_INTERACTIVE_VIEW'],
    [
      { 'Sec-Purpose': 'prefetch;prerender' },
      'Sec-Purpose prerender',
      'NON_INTERACTIVE_VIEW',
    ],
    [
      { 'User-Agent': 'Googlebot/2.1' },
      'bot User-Agent',
      'NON_INTERACTIVE_VIEW',
    ],
    [
      { Origin: 'https://foreign.invalid' },
      'foreign Origin',
      'FORBIDDEN_ORIGIN',
    ],
    [{ 'CF-Worker': 'internal.invalid' }, 'CF-Worker', 'FORBIDDEN_ORIGIN'],
    [
      { 'Sec-Fetch-Site': 'cross-site' },
      'cross-site fetch',
      'FORBIDDEN_ORIGIN',
    ],
  ]) {
    const response = await sendGuest(
      scope.albumId,
      guestBody,
      guestCookie,
      headers,
    );
    if (label === 'foreign Origin') {
      assert.equal(response.status, 403, label + ' status');
      assert.equal(
        await response.text(),
        'Validation unavailable',
        label + ' exact B wrapper denial body',
      );
      assert.equal(
        response.headers.get('Cache-Control'),
        'private, no-store',
        label + ' response is not cached',
      );
    } else await expectError(response, 403, code, label);
  }
  await expectError(
    await sendGuest(
      scope.albumId,
      {
        ...guestBody,
        photoId: foreignPhoto.photoId,
        versionId: foreignPhoto.versionId,
      },
      guestCookie,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'foreign photo and version are outside the shared album',
  );
  await expectError(
    await sendGuest(
      scope.albumId,
      { ...guestBody, expectedActorId: randomUUID() },
      guestCookie,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'Guest actor binding is enforced',
  );
  await expectError(
    await sendGuest(
      scope.albumId,
      {
        ...guestBody,
        expectedActorId: downloadGuest.guestId,
      },
      '__Host-kino_guest=' + downloadGuest.cookie,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'download-only Guest cannot record a view',
  );
  await expectError(
    await sendGuest(
      scope.albumId,
      guestBody,
      '__Host-kino_guest=' + viewGuest.cookie,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'revoked Guest session cannot record a view',
  );
  await expectError(
    await sendGuest(foreignAlbumId, guestBody, guestCookie),
    404,
    'NOT_FOUND',
    'foreign album outside B boundary remains hidden',
  );
  assert.deepEqual(await snapshot(), beforeDenied);
  checks.push(
    'Wrong Owner/session, foreign scope, download-only, revoked, prefetch, bot, Origin, and Worker requests leave activity, audit, assets, and quota unchanged',
  );

  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
    'human view profile preserves D1 foreign keys',
  );
  const sourceFiles = {
    'wrangler.collaboration-validation.jsonc':
      'wrangler.collaboration-validation.jsonc',
    'tools/staging-collaboration-validation-worker.ts':
      'tools/staging-collaboration-validation-worker.ts',
    'src/config.ts': 'src/config.ts',
    'src/staging-collaboration-boundary.ts':
      'src/staging-collaboration-boundary.ts',
    'src/human-view-routes.ts': 'src/human-view-routes.ts',
    'src/human-views.ts': 'src/human-views.ts',
    'tests/human-views.mjs': 'tests/human-views.mjs',
    'tests/human-views-b-profile.mjs': 'tests/human-views-b-profile.mjs',
    'tools/test-staging-collaboration-validation.mjs':
      'tools/test-staging-collaboration-validation.mjs',
    'migrations/0053_human_photo_views.sql':
      'migrations/0053_human_photo_views.sql',
    'migrations/0069_inherited_share_expiry.sql':
      'migrations/0069_inherited_share_expiry.sql',
    '../../packages/contracts/src/human-views.ts':
      '../../packages/contracts/src/human-views.ts',
    '.local/collaboration-validation-build/staging-collaboration-validation-worker.js':
      '.local/collaboration-validation-build/staging-collaboration-validation-worker.js',
  };
  const sourceDigests = Object.fromEntries(
    await Promise.all(
      Object.entries(sourceFiles).map(async ([path, file]) => [
        path,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]),
    ),
  );
  const proof = {
    status: 'passed_local_only',
    runner: 'tools/test-staging-collaboration-validation.mjs',
    sourceSha256:
      sourceDigests[
        '.local/collaboration-validation-build/staging-collaboration-validation-worker.js'
      ],
    sourceFiles: sourceDigests,
    schema: 69,
    checkGroups: {
      native: checks,
      browser: [],
      d1: ['foreign_key_check is empty'],
      count: checks.length + 1,
    },
    runtime: 'Miniflare native workerd with ephemeral D1 and R2',
    profile: 'exact B collaboration validation sidecar',
    configuredFlag,
    primaryTestOverride: primaryFlag,
    sidecarFlag: 'true',
    syntheticOwner: true,
    realOAuth: false,
    remoteCloudflare: false,
    hostedDeployment: false,
    browserOrPublicTLS: false,
  };
  await mkdir('.local', { recursive: true });
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: proof.status, checks: checks.length }));
  return proof;
}
