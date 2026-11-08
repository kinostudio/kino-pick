import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const TEST_CLIENT_IP = '192.0.2.69';
const DAY_MS = 24 * 60 * 60 * 1000;
const GUEST_PERMISSIONS = Object.freeze({
  can_view: true,
  can_download_preview: false,
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
});

function safeErrorCode(value) {
  const code = value?.error?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(code)
    ? code
    : 'UNKNOWN_ERROR';
}

async function responseJson(response) {
  return response
    .clone()
    .json()
    .catch(() => null);
}

function expectStatus(response, value, expected, label) {
  const code = safeErrorCode(value);
  assert.equal(
    response.status,
    expected,
    `${label}: expected HTTP ${expected}, got ${response.status} (${code})`,
  );
}

function expiryDate(value, label) {
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), `${label}: expected an ISO expiry`);
  return parsed;
}

export async function runInheritedShareApiChecks({
  db,
  worker,
  disabledWorker,
  base,
  ownerId,
  ownerSessionId,
  ownerCookie,
  workspaceId,
  projectId,
  historicalAlbumId,
  currentAlbumId,
  secondCurrentAlbumId,
  foreignWorkspaceId,
  foreignProjectId,
  foreignAlbumId,
}) {
  assert.ok(db && worker && base && ownerCookie);
  const origin = new URL(base).origin;
  const checks = [];
  const record = (label) => checks.push(label);
  const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function request(
    targetWorker,
    path,
    { method = 'GET', body, cookie, owner = false } = {},
  ) {
    const headers = new Headers({
      Origin: origin,
      'CF-Connecting-IP': TEST_CLIENT_IP,
    });
    if (cookie) headers.set('Cookie', cookie);
    if (owner) {
      headers.set('Cookie', ownerCookie);
      headers.set('X-Kino-Expected-Actor', ownerId);
      headers.set('X-Kino-Expected-Session', ownerSessionId);
    }
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await targetWorker.fetch(
      new Request(new URL(path, base), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual',
      }),
    );
    return { response, value: await responseJson(response) };
  }

  async function expectOwnerJson(
    path,
    method,
    body,
    status,
    label,
    target = worker,
  ) {
    const result = await request(target, path, {
      method,
      body,
      owner: true,
    });
    expectStatus(result.response, result.value, status, label);
    return result.value;
  }

  async function readPolicy(albumId) {
    return expectOwnerJson(
      `/api/v1/albums/${albumId}/retention-policy`,
      'GET',
      undefined,
      200,
      'read album inheritance policy',
    );
  }

  async function setPolicy(albumId, cleanupAllowed, inactiveDays) {
    const previous = await readPolicy(albumId);
    return expectOwnerJson(
      `/api/v1/albums/${albumId}/retention-policy`,
      'PUT',
      {
        requestId: randomUUID(),
        expectedOwnerId: ownerId,
        expectedRevision: previous.revision,
        cleanupAllowed,
        inactiveDays,
      },
      200,
      'change album inheritance policy',
    );
  }

  function inviteBody(albumIds, requestId = randomUUID()) {
    return {
      requestId,
      albumIds,
      accessMode: 'link_only',
      expiryMode: 'inherit_album',
      expiresAt: null,
      maxUses: null,
      permissions: { ...GUEST_PERMISSIONS },
    };
  }

  function customInviteBody(albumIds) {
    return {
      requestId: randomUUID(),
      albumIds,
      accessMode: 'link_only',
      expiresAt: new Date(Date.now() + 7 * DAY_MS).toISOString(),
      maxUses: null,
      permissions: { ...GUEST_PERMISSIONS },
    };
  }

  async function createInvite(albumIds) {
    const body = inviteBody(albumIds);
    const value = await expectOwnerJson(
      `/api/v1/projects/${projectId}/invites`,
      'POST',
      body,
      200,
      'create inherited-expiry invite',
    );
    assert.equal(
      value?.secretAvailable,
      true,
      'new invite reveals its secret once',
    );
    assert.equal(value?.invite?.expiryMode, 'inherit_album');
    assert.equal(value?.invite?.expiresAt, null);
    assert.match(value?.token ?? '', /^[a-f0-9]{64}$/u);
    return { body, value, token: value.token };
  }

  async function createCustomInvite(albumIds) {
    const body = customInviteBody(albumIds);
    const value = await expectOwnerJson(
      `/api/v1/projects/${projectId}/invites`,
      'POST',
      body,
      200,
      'create valid custom-expiry invite',
    );
    assert.equal(value?.secretAvailable, true);
    assert.equal(value?.invite?.expiryMode, undefined);
    assert.equal(
      Date.parse(value?.invite?.expiresAt),
      Date.parse(body.expiresAt),
    );
    assert.match(value?.token ?? '', /^[a-f0-9]{64}$/u);
    return { body, value, token: value.token };
  }

  async function exchange(token, target = worker) {
    const { response, value } = await request(target, '/api/guest/exchange', {
      method: 'POST',
      body: {
        requestId: randomUUID(),
        token,
        displayName: 'Synthetic expiry check',
      },
    });
    return { response, value, setCookie: response.headers.get('Set-Cookie') };
  }

  function guestCookie(exchangeResult, label) {
    assert.equal(
      exchangeResult.value?.authenticated,
      true,
      `${label}: authenticated`,
    );
    const setCookie = exchangeResult.setCookie ?? '';
    const match = /^kino_guest=([a-f0-9]{64}); Path=\/; Max-Age=(\d+);/u.exec(
      setCookie,
    );
    assert.ok(match, `${label}: expected a bounded guest session cookie`);
    return { cookie: `kino_guest=${match[1]}`, maxAge: Number(match[2]) };
  }

  async function albumAccess(albumId, cookie) {
    const result = await request(
      worker,
      `/api/guest/albums/${albumId}/access`,
      { cookie },
    );
    return result;
  }

  async function expiryRow(inviteId, albumId) {
    return db
      .prepare(
        'SELECT expiry_mode,expires_at_ms,expiry_valid FROM effective_guest_invite_album_expiry WHERE invite_id=? AND workspace_id=? AND project_id=? AND album_id=?',
      )
      .bind(inviteId, workspaceId, projectId, albumId)
      .first();
  }

  const initialPolicy = await readPolicy(historicalAlbumId);
  assert.equal(initialPolicy.cleanupAllowed, false);
  assert.equal(initialPolicy.inactiveDays, 90);
  assert.equal(initialPolicy.revision, 0);
  const initialState = await db
    .prepare(
      'SELECT phase,generation FROM album_inherited_share_states WHERE album_id=? AND workspace_id=? AND project_id=?',
    )
    .bind(historicalAlbumId, workspaceId, projectId)
    .first();
  assert.equal(initialState.phase, 'off');
  record('existing historical album defaults OFF at 90 days');

  const fixtureAlbums = await db
    .prepare(
      'SELECT id,workspace_id,project_id,state,created_at FROM albums WHERE id IN(?,?,?,?) ORDER BY id',
    )
    .bind(
      historicalAlbumId,
      currentAlbumId,
      secondCurrentAlbumId ?? currentAlbumId,
      foreignAlbumId,
    )
    .all();
  const foreignFixture = fixtureAlbums.results.find(
    (album) => album.id === foreignAlbumId,
  );
  const currentFixture = fixtureAlbums.results.find(
    (album) => album.id === currentAlbumId,
  );
  const secondCurrentFixture = fixtureAlbums.results.find(
    (album) => album.id === secondCurrentAlbumId,
  );
  assert.equal(currentFixture?.workspace_id, workspaceId);
  assert.equal(currentFixture?.project_id, projectId);
  assert.equal(secondCurrentFixture?.workspace_id, workspaceId);
  assert.equal(secondCurrentFixture?.project_id, projectId);
  assert.notEqual(secondCurrentAlbumId, currentAlbumId);
  assert.equal(foreignFixture?.workspace_id, foreignWorkspaceId);
  assert.equal(foreignFixture?.project_id, foreignProjectId);
  assert.notEqual(foreignFixture.workspace_id, workspaceId);
  assert.notEqual(foreignFixture.project_id, projectId);
  assert.ok(fixtureAlbums.results.every((album) => album.state === 'active'));
  const inviteCapabilities = await expectOwnerJson(
    '/api/v1/invites/capabilities',
    'GET',
    undefined,
    200,
    'read inherited invite capabilities',
  );
  assert.equal(inviteCapabilities.inheritedExpiryEnabled, true);
  assert.equal(inviteCapabilities.issuanceEnabled, true);
  assert.equal(inviteCapabilities.exchangeEnabled, true);
  record(
    'fixture scopes and enabled inherited-issuance capability are verified',
  );

  // OFF means an inherited invite has no album deadline, while remaining
  // recoverable as metadata without ever returning the bearer token.
  const historicalInvite = await createInvite([historicalAlbumId]);
  const recovered = await expectOwnerJson(
    `/api/v1/invites/creation/${historicalInvite.body.requestId}`,
    'GET',
    undefined,
    200,
    'recover inherited invite metadata',
  );
  assert.equal(recovered.secretAvailable, false);
  assert.equal(recovered.invite.expiryMode, 'inherit_album');
  assert.equal(recovered.invite.expiresAt, null);
  assert.equal(Object.hasOwn(recovered, 'token'), false);
  assert.equal(Object.hasOwn(recovered, 'generatedPassword'), false);
  const inviteList = await expectOwnerJson(
    `/api/v1/projects/${projectId}/invites`,
    'GET',
    undefined,
    200,
    'list inherited invite metadata',
  );
  const listedHistorical = inviteList.invites.find(
    (item) => item.id === historicalInvite.value.invite.inviteId,
  );
  assert.equal(listedHistorical?.expiryMode, 'inherit_album');
  assert.equal(listedHistorical?.expiresAt, null);
  const offRow = await expiryRow(
    historicalInvite.value.invite.inviteId,
    historicalAlbumId,
  );
  assert.equal(offRow.expiry_mode, 'inherit_album');
  assert.equal(offRow.expires_at_ms, null);
  assert.equal(offRow.expiry_valid, 1);
  record('create and recovery expose metadata only with null OFF deadline');

  const oldExchange = await exchange(historicalInvite.token);
  expectStatus(
    oldExchange.response,
    oldExchange.value,
    200,
    'exchange while OFF',
  );
  const oldSession = guestCookie(oldExchange, 'exchange while OFF');
  const offAccess = await albumAccess(historicalAlbumId, oldSession.cookie);
  expectStatus(offAccess.response, offAccess.value, 200, 'access while OFF');
  assert.equal(offAccess.value?.access?.expiryMode, 'inherit_album');
  assert.equal(offAccess.value?.access?.inviteExpiresAt, null);
  assert.ok(oldSession.maxAge > 0 && oldSession.maxAge <= 86400);
  record('OFF inherited exchange and album access have no deadline');

  const historicalOn = await setPolicy(historicalAlbumId, true, 1);
  assert.equal(historicalOn.cleanupAllowed, true);
  const closedState = await db
    .prepare(
      'SELECT phase,generation FROM album_inherited_share_states WHERE album_id=? AND workspace_id=? AND project_id=?',
    )
    .bind(historicalAlbumId, workspaceId, projectId)
    .first();
  assert.equal(closedState.phase, 'closed');
  assert.ok(closedState.generation > initialState.generation);
  const closedOldAccess = await albumAccess(
    historicalAlbumId,
    oldSession.cookie,
  );
  expectStatus(
    closedOldAccess.response,
    closedOldAccess.value,
    401,
    'old session after historical deadline closes',
  );
  const liveCustomInvite = await createCustomInvite([historicalAlbumId]);
  const liveCustomExchange = await exchange(liveCustomInvite.token);
  expectStatus(
    liveCustomExchange.response,
    liveCustomExchange.value,
    200,
    'valid custom invite on closed inherited-policy album',
  );
  const liveCustomSession = guestCookie(
    liveCustomExchange,
    'valid custom invite on closed inherited-policy album',
  );
  const liveCustomAccess = await albumAccess(
    historicalAlbumId,
    liveCustomSession.cookie,
  );
  expectStatus(
    liveCustomAccess.response,
    liveCustomAccess.value,
    200,
    'custom invite access on closed inherited-policy album',
  );
  assert.equal(liveCustomAccess.value?.access?.expiryMode, undefined);
  assert.equal(
    expiryDate(
      liveCustomAccess.value.access.inviteExpiresAt,
      'custom invite deadline',
    ),
    Date.parse(liveCustomInvite.body.expiresAt),
  );
  const liveCustomExpiry = await expiryRow(
    liveCustomInvite.value.invite.inviteId,
    historicalAlbumId,
  );
  const closedInheritedExpiry = await expiryRow(
    historicalInvite.value.invite.inviteId,
    historicalAlbumId,
  );
  assert.equal(liveCustomExpiry.expiry_mode, 'custom');
  assert.equal(liveCustomExpiry.expiry_valid, 1);
  assert.equal(
    liveCustomExpiry.expires_at_ms,
    Date.parse(liveCustomInvite.body.expiresAt),
  );
  assert.equal(closedInheritedExpiry.expiry_mode, 'inherit_album');
  assert.equal(closedInheritedExpiry.expiry_valid, 0);
  const inheritedStillClosed = await albumAccess(
    historicalAlbumId,
    oldSession.cookie,
  );
  expectStatus(
    inheritedStillClosed.response,
    inheritedStillClosed.value,
    401,
    'old inherited session after valid custom invite access',
  );
  const inheritedBearerWhileClosed = await exchange(historicalInvite.token);
  expectStatus(
    inheritedBearerWhileClosed.response,
    inheritedBearerWhileClosed.value,
    401,
    'old inherited bearer while album policy is closed',
  );
  record(
    'closed historical baseline rejects old inherited access while valid custom access remains independent',
  );

  const historicalOff = await setPolicy(historicalAlbumId, false, 1);
  assert.equal(historicalOff.cleanupAllowed, false);
  const revivedOldAccess = await albumAccess(
    historicalAlbumId,
    oldSession.cookie,
  );
  expectStatus(
    revivedOldAccess.response,
    revivedOldAccess.value,
    401,
    'old session after policy returns OFF',
  );
  const oldReexchange = await exchange(historicalInvite.token);
  expectStatus(
    oldReexchange.response,
    oldReexchange.value,
    401,
    'old invite after policy returns OFF',
  );
  const staleRow = await expiryRow(
    historicalInvite.value.invite.inviteId,
    historicalAlbumId,
  );
  assert.equal(staleRow.expiry_valid, 0);
  record('OFF transition does not revive an old invite or session');

  const freshHistoricalInvite = await createInvite([historicalAlbumId]);
  const freshHistoricalExchange = await exchange(freshHistoricalInvite.token);
  expectStatus(
    freshHistoricalExchange.response,
    freshHistoricalExchange.value,
    200,
    'new invite after OFF',
  );
  const freshHistoricalSession = guestCookie(
    freshHistoricalExchange,
    'new invite after OFF',
  );
  const freshHistoricalAccess = await albumAccess(
    historicalAlbumId,
    freshHistoricalSession.cookie,
  );
  expectStatus(
    freshHistoricalAccess.response,
    freshHistoricalAccess.value,
    200,
    'new invite access after OFF',
  );
  assert.equal(freshHistoricalAccess.value?.access?.inviteExpiresAt, null);
  record('new generation invite works while historical policy is OFF');

  if (disabledWorker) {
    const disabledReplay = await expectOwnerJson(
      `/api/v1/projects/${projectId}/invites`,
      'POST',
      freshHistoricalInvite.body,
      200,
      'replay prior invite with issuance disabled',
      disabledWorker,
    );
    assert.equal(disabledReplay.secretAvailable, false);
    assert.equal(
      disabledReplay.invite.inviteId,
      freshHistoricalInvite.value.invite.inviteId,
    );
    assert.equal(Object.hasOwn(disabledReplay, 'token'), false);
    const disabledRecovery = await expectOwnerJson(
      `/api/v1/invites/creation/${freshHistoricalInvite.body.requestId}`,
      'GET',
      undefined,
      200,
      'recover prior metadata with issuance disabled',
      disabledWorker,
    );
    assert.equal(disabledRecovery.secretAvailable, false);
    assert.equal(disabledRecovery.invite.expiryMode, 'inherit_album');
    const disabledRequest = inviteBody([historicalAlbumId]);
    const rejected = await request(
      disabledWorker,
      `/api/v1/projects/${projectId}/invites`,
      {
        method: 'POST',
        body: disabledRequest,
        owner: true,
      },
    );
    expectStatus(
      rejected.response,
      rejected.value,
      503,
      'new inherited issuance with flag OFF',
    );
    assert.equal(safeErrorCode(rejected.value), 'FEATURE_UNAVAILABLE');
    const disabledCommand = await db
      .prepare(
        'SELECT 1 FROM invite_creation_commands WHERE actor_id=? AND request_id=?',
      )
      .bind(ownerId, disabledRequest.requestId)
      .first();
    assert.equal(disabledCommand, null);
    record(
      'issuance flag OFF rejects new inherited issue but preserves metadata recovery',
    );
  }

  // Two finite current-album deadlines are deliberately different. The guest
  // session uses the latest valid scope, capped at 24 hours; it must not inherit
  // the earlier album deadline as a global invite deadline.
  const secondAlbumId = secondCurrentAlbumId ?? currentAlbumId;
  assert.notEqual(
    secondAlbumId,
    currentAlbumId,
    'second current album fixture required for deadline cap check',
  );
  await setPolicy(currentAlbumId, true, 1);
  await setPolicy(secondAlbumId, true, 7);
  const currentRow = await db
    .prepare(
      'SELECT created_at FROM albums WHERE id=? AND workspace_id=? AND project_id=?',
    )
    .bind(currentAlbumId, workspaceId, projectId)
    .first();
  const currentCreatedAt = Date.parse(currentRow.created_at);
  assert.ok(Number.isFinite(currentCreatedAt));
  const cappedInvite = await createInvite([currentAlbumId, secondAlbumId]);
  const earlyDeadline = await expiryRow(
    cappedInvite.value.invite.inviteId,
    currentAlbumId,
  );
  const lateDeadline = await expiryRow(
    cappedInvite.value.invite.inviteId,
    secondAlbumId,
  );
  assert.equal(earlyDeadline.expiry_valid, 1);
  assert.equal(lateDeadline.expiry_valid, 1);
  assert.ok(
    lateDeadline.expires_at_ms - earlyDeadline.expires_at_ms > 5 * DAY_MS,
  );
  await sleep(1100);
  const capExchangeStartedAt = Date.now();
  const cappedExchange = await exchange(cappedInvite.token);
  expectStatus(
    cappedExchange.response,
    cappedExchange.value,
    200,
    'exchange with multiple finite scopes',
  );
  const cappedSession = guestCookie(
    cappedExchange,
    'exchange with multiple finite scopes',
  );
  const cappedExpiresAt = expiryDate(
    cappedExchange.value.expiresAt,
    'multi-scope session',
  );
  assert.ok(cappedSession.maxAge >= 86300 && cappedSession.maxAge <= 86400);
  assert.ok(cappedExpiresAt >= capExchangeStartedAt + DAY_MS - 3000);
  assert.ok(cappedExpiresAt <= capExchangeStartedAt + DAY_MS + 1000);
  assert.ok(cappedExpiresAt > earlyDeadline.expires_at_ms + 500);
  for (const [albumId, expectedExpiry] of [
    [currentAlbumId, earlyDeadline.expires_at_ms],
    [secondAlbumId, lateDeadline.expires_at_ms],
  ]) {
    const access = await albumAccess(albumId, cappedSession.cookie);
    expectStatus(
      access.response,
      access.value,
      200,
      'per-album access under multi-scope invite',
    );
    assert.equal(access.value?.access?.expiryMode, 'inherit_album');
    assert.equal(
      expiryDate(
        access.value.access.inviteExpiresAt,
        'per-album invite deadline',
      ),
      expectedExpiry,
    );
  }
  record(
    'multi-album access returns exact deadlines and session uses latest scope capped at 24 hours',
  );

  // Historical A is OFF when sealed, then transitions to a closed finite
  // generation. A remains inaccessible while current B still authorizes the
  // exchange and exposes only its own later deadline.
  const scopedInvite = await createInvite([historicalAlbumId, secondAlbumId]);
  await setPolicy(historicalAlbumId, true, 1);
  const scopedHistoricalRow = await expiryRow(
    scopedInvite.value.invite.inviteId,
    historicalAlbumId,
  );
  const scopedCurrentRow = await expiryRow(
    scopedInvite.value.invite.inviteId,
    secondAlbumId,
  );
  assert.equal(scopedHistoricalRow.expiry_valid, 0);
  assert.equal(scopedCurrentRow.expiry_valid, 1);
  const scopedExchange = await exchange(scopedInvite.token);
  expectStatus(
    scopedExchange.response,
    scopedExchange.value,
    200,
    'exchange via remaining current album scope',
  );
  const scopedSession = guestCookie(
    scopedExchange,
    'exchange via remaining current album scope',
  );
  const closedAlbumAccess = await albumAccess(
    historicalAlbumId,
    scopedSession.cookie,
  );
  expectStatus(
    closedAlbumAccess.response,
    closedAlbumAccess.value,
    401,
    'closed historical album in multi-scope invite',
  );
  const liveAlbumAccess = await albumAccess(
    secondAlbumId,
    scopedSession.cookie,
  );
  expectStatus(
    liveAlbumAccess.response,
    liveAlbumAccess.value,
    200,
    'live current album in multi-scope invite',
  );
  assert.equal(liveAlbumAccess.value?.access?.expiryMode, 'inherit_album');
  assert.equal(
    expiryDate(
      liveAlbumAccess.value.access.inviteExpiresAt,
      'current album deadline',
    ),
    scopedCurrentRow.expires_at_ms,
  );
  const scopedSessionExpiry = expiryDate(
    scopedExchange.value.expiresAt,
    'remaining-scope session',
  );
  assert.ok(scopedSessionExpiry > Date.now() + 23 * 60 * 60 * 1000);
  record(
    'multi-scope exchange survives closed A through B while A access stays denied',
  );

  const missingCookie = await albumAccess(secondAlbumId, undefined);
  expectStatus(
    missingCookie.response,
    missingCookie.value,
    401,
    'missing guest session',
  );
  const wrongSecret = randomUUID()
    .replaceAll('-', '')
    .padEnd(64, '0')
    .slice(0, 64);
  const wrongSession = await albumAccess(
    secondAlbumId,
    `kino_guest=${wrongSecret}`,
  );
  expectStatus(
    wrongSession.response,
    wrongSession.value,
    401,
    'unknown guest session',
  );
  const outOfScope = await albumAccess(currentAlbumId, scopedSession.cookie);
  expectStatus(
    outOfScope.response,
    outOfScope.value,
    401,
    'unshared album in same project',
  );
  const foreignAlbum = await albumAccess(foreignAlbumId, scopedSession.cookie);
  expectStatus(
    foreignAlbum.response,
    foreignAlbum.value,
    401,
    'foreign workspace and project album',
  );
  record(
    'missing, unknown, out-of-scope, and cross-project guest sessions are denied',
  );

  const foreignOwnerRead = await expectOwnerJson(
    `/api/v1/albums/${foreignAlbumId}/retention-policy`,
    'GET',
    undefined,
    404,
    'foreign owner album policy lookup',
  );
  assert.equal(safeErrorCode(foreignOwnerRead), 'NOT_FOUND');
  assert.ok(foreignWorkspaceId && foreignProjectId);
  record('Owner policy lookup cannot cross workspace/project ownership');

  return {
    checks,
    notChecked: disabledWorker
      ? []
      : ['issuance flag OFF behavior (no disabled Worker fixture supplied)'],
  };
}
