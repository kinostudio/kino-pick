import { applyMigration } from './apply-migration.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeSignature } from 'better-auth/crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { guestDownloadChecks } from './guest-downloads.mjs';

const base = 'http://127.0.0.1:8797';
const owner = randomUUID();
const ownerSessionId = randomUUID();
const ownerToken = randomUUID();
const authSecret =
  'version-approvals-api-isolated-test-secret-at-least-forty-characters';
const temporary = await mkdtemp(join(tmpdir(), 'kino-version-approvals-api-'));
const migrationDirectory = resolve('migrations');
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_SELECTION_ENABLED: 'true',
  GUEST_DOWNLOADS_ENABLED: 'true',
  GUEST_FEEDBACK_ENABLED: 'true',
  GUEST_SHARED_SELECTION_ENABLED: 'true',
  VERSION_APPROVALS_ENABLED: 'true',
  BETTER_AUTH_SECRET: authSecret,
  R2_ACCOUNT_ID: 'b'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-version-approval-api-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-never-for-production',
  R2_BUCKET_NAME: 'kino-version-approval-api-private',
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        d1Databases: { DB: 'version-approvals-api-isolated' },
        r2Buckets: { PRIMARY_STORAGE: 'version-approvals-api-isolated' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
      },
    ],
    d1Persist: join(temporary, 'd1'),
    r2Persist: join(temporary, 'r2'),
  }),
);

let passed = 0;
async function check(label, action) {
  await action();
  passed++;
  process.stdout.write('passed: ' + label + '\n');
}
async function jsonAt(response, status, label) {
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  assert.equal(response.status, status, label + ': ' + JSON.stringify(value));
  return value;
}
async function errorAt(response, status, code, label) {
  const value = await jsonAt(response, status, label);
  assert.deepEqual(value, { error: { code } }, label);
}
const count = async (db, table, where = '', ...values) => {
  const row = await db
    .prepare('SELECT count(*) AS count FROM ' + table + where)
    .bind(...values)
    .first();
  return Number(row.count);
};
const approvalSnapshot = async (db) => ({
  ownerCommands: await count(db, 'version_approval_owner_commands'),
  requests: await count(db, 'version_approval_requests'),
  members: await count(db, 'version_approval_request_invites'),
  seals: await count(db, 'version_approval_request_seals'),
  ownerResults: await count(db, 'version_approval_owner_results'),
  guestCommands: await count(db, 'version_approval_guest_commands'),
  receipts: await count(db, 'version_approval_receipts'),
  guestResults: await count(db, 'version_approval_guest_results'),
  ownerAudit: await count(
    db,
    'audit_events',
    " WHERE action='version_approval.requested'",
  ),
  guestAudit: await count(
    db,
    'audit_events',
    " WHERE action='version_approval.confirmed'",
  ),
});
const ownerPath = (albumId, photoId) =>
  '/api/v1/albums/' + albumId + '/photos/' + photoId + '/version-approvals';
const guestPath = (albumId, photoId) =>
  '/api/guest/albums/' + albumId + '/photos/' + photoId + '/version-approvals';
const guestConfirmPath = (albumId, photoId, approvalId) =>
  guestPath(albumId, photoId) + '/' + approvalId + '/confirm';

try {
  const db = await mf.getD1Database('DB', 'app');
  const migrations = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  assert.ok(migrations.includes('0054_version_approvals.sql'));
  for (const file of migrations) {
    const source = (await readFile(join(migrationDirectory, file), 'utf8'))
      .split(/\r?\n/u)
      .filter((line) => line.trim() && !line.trim().startsWith('--'))
      .join(' ');
    await applyMigration(db, source);
  }

  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'version-approval-api-isolated-owner')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(ownerSessionId, ownerToken, owner, now + 3_600_000, now, now)
    .run();
  const ownerCookie =
    'kino-owner.session_token=' +
    encodeURIComponent(
      ownerToken + '.' + (await makeSignature(ownerToken, authSecret)),
    );
  const worker = await mf.getWorker('app');
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');

  await check(
    'local API capability is enabled only for this isolated Worker',
    async () => {
      const capability = await jsonAt(
        await request('/api/v1/version-approvals/capabilities', {
          headers: { Cookie: ownerCookie },
        }),
        200,
        'Owner capability',
      );
      assert.deepEqual(capability, { enabled: true });
    },
  );

  const fixtureResult = await guestDownloadChecks({
    db,
    worker,
    request,
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    storage,
    fixtureOnly: true,
  });
  const fixture = fixtureResult.fixture;
  const authorizedGuest = await fixture.createGuest(2049);
  const otherInviteGuest = await fixture.createGuest(2049);
  const scope = {
    albumId: fixture.albumId,
    photoId: fixture.photoId,
  };
  const path = ownerPath(scope.albumId, scope.photoId);
  const visiblePath = guestPath(scope.albumId, scope.photoId);
  const ownerHeaders = {
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
  };
  const guestHeaders = (guest) => ({
    Cookie: 'kino_guest=' + guest.cookie,
    Origin: base,
    'Content-Type': 'application/json',
  });
  const sendOwner = (method, body) =>
    request(path, {
      method,
      headers: ownerHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const sendGuest = (guest, method, route, body) =>
    request(route, {
      method,
      headers: guestHeaders(guest),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const ownerRequestBody = {
    requestId: randomUUID(),
    expectedOwnerId: owner,
    expectedHead: { versionId: fixture.versionId, revision: 0 },
    inviteIds: [authorizedGuest.inviteId],
    confirm: true,
  };

  const created = await jsonAt(
    await sendOwner('POST', ownerRequestBody),
    200,
    'Owner create approval request',
  );
  assert.equal(created.requestId, ownerRequestBody.requestId);
  assert.equal(created.request.versionId, fixture.versionId);
  assert.equal(created.request.headRevision, 0);
  assert.equal(created.request.versionNo, 1);
  assert.equal(created.request.status, 'open');
  assert.equal(created.request.confirmedAt, null);
  assert.deepEqual(created.request.inviteIds, [authorizedGuest.inviteId]);
  const createdSnapshot = await approvalSnapshot(db);

  await check(
    'Owner create and exact replay return the same immutable result',
    async () => {
      const replay = await jsonAt(
        await sendOwner('POST', ownerRequestBody),
        200,
        'Owner exact replay',
      );
      assert.deepEqual(replay, created);
      assert.deepEqual(await approvalSnapshot(db), createdSnapshot);
      assert.equal(
        await count(
          db,
          'version_approval_owner_commands',
          ' WHERE actor_id=? AND request_id=?',
          owner,
          ownerRequestBody.requestId,
        ),
        1,
      );
    },
  );

  await check(
    'Owner list returns the exact current version and open state',
    async () => {
      const listed = await jsonAt(await sendOwner('GET'), 200, 'Owner list');
      assert.deepEqual(listed.nextCursor, null);
      assert.equal(listed.requests.length, 1);
      assert.deepEqual(listed.requests[0], {
        ...created.request,
        isCurrent: true,
      });
    },
  );

  const guestOpenList = await jsonAt(
    await sendGuest(authorizedGuest, 'GET', visiblePath),
    200,
    'Authorized Guest list',
  );
  assert.equal(guestOpenList.requests.length, 1);
  assert.equal(guestOpenList.requests[0].id, created.request.id);
  assert.equal(guestOpenList.requests[0].status, 'open');
  assert.equal(guestOpenList.requests[0].isCurrent, true);

  await check(
    'a different sealed invitation cannot list or confirm the request',
    async () => {
      const isolatedList = await jsonAt(
        await sendGuest(otherInviteGuest, 'GET', visiblePath),
        200,
        'Other invitation list',
      );
      assert.deepEqual(isolatedList, { requests: [], nextCursor: null });
      const before = await approvalSnapshot(db);
      await errorAt(
        await sendGuest(
          otherInviteGuest,
          'POST',
          guestConfirmPath(scope.albumId, scope.photoId, created.request.id),
          {
            requestId: randomUUID(),
            expectedGuestId: otherInviteGuest.guestId,
            confirm: true,
          },
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
        'Other invitation confirmation',
      );
      assert.deepEqual(await approvalSnapshot(db), before);
    },
  );

  const confirmationBody = {
    requestId: randomUUID(),
    expectedGuestId: authorizedGuest.guestId,
    confirm: true,
  };
  const confirmationPath = guestConfirmPath(
    scope.albumId,
    scope.photoId,
    created.request.id,
  );
  const confirmation = await jsonAt(
    await sendGuest(
      authorizedGuest,
      'POST',
      confirmationPath,
      confirmationBody,
    ),
    200,
    'Guest confirmation',
  );
  assert.equal(confirmation.requestId, confirmationBody.requestId);
  assert.equal(confirmation.approvalRequestId, created.request.id);
  assert.equal(confirmation.guestId, authorizedGuest.guestId);
  assert.equal(confirmation.photoId, fixture.photoId);
  assert.equal(confirmation.versionId, fixture.versionId);
  assert.equal(confirmation.versionNo, 1);
  assert.equal(confirmation.headRevision, 0);
  assert.equal(confirmation.recorded, true);
  assert.ok(confirmation.eventId);
  const confirmedSnapshot = await approvalSnapshot(db);

  await check(
    'Guest confirm replay returns the same result without extra receipt or audit',
    async () => {
      const replay = await jsonAt(
        await sendGuest(
          authorizedGuest,
          'POST',
          confirmationPath,
          confirmationBody,
        ),
        200,
        'Guest exact replay',
      );
      assert.deepEqual(replay, confirmation);
      assert.deepEqual(await approvalSnapshot(db), confirmedSnapshot);
      assert.equal(
        await count(
          db,
          'version_approval_guest_commands',
          ' WHERE guest_id=? AND request_id=?',
          authorizedGuest.guestId,
          confirmationBody.requestId,
        ),
        1,
      );
    },
  );

  await check(
    'Owner and authorized Guest lists derive confirmed state from the receipt',
    async () => {
      const ownerList = await jsonAt(
        await sendOwner('GET'),
        200,
        'Owner confirmed list',
      );
      assert.equal(ownerList.requests[0].status, 'confirmed');
      assert.ok(ownerList.requests[0].confirmedAt);
      assert.equal(ownerList.requests[0].isCurrent, true);

      const guestList = await jsonAt(
        await sendGuest(authorizedGuest, 'GET', visiblePath),
        200,
        'Guest confirmed list',
      );
      assert.equal(guestList.requests[0].status, 'confirmed');
      assert.ok(guestList.requests[0].confirmedAt);
      assert.equal(guestList.requests[0].isCurrent, true);
    },
  );

  const revocationBody = {
    requestId: randomUUID(),
    confirmRevoke: true,
  };
  const revocation = await jsonAt(
    await request('/api/v1/invites/' + authorizedGuest.inviteId + '/revoke', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(revocationBody),
    }),
    200,
    'Owner invite revoke',
  );
  assert.equal(revocation.revocation.inviteId, authorizedGuest.inviteId);
  const afterRevocation = await approvalSnapshot(db);

  await check(
    'revocation blocks Guest list, exact replay, and a fresh confirmation but preserves Owner history',
    async () => {
      await errorAt(
        await sendGuest(authorizedGuest, 'GET', visiblePath),
        401,
        'GUEST_ACCESS_REQUIRED',
        'Revoked Guest list',
      );
      await errorAt(
        await sendGuest(
          authorizedGuest,
          'POST',
          confirmationPath,
          confirmationBody,
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
        'Revoked Guest exact replay',
      );
      await errorAt(
        await sendGuest(authorizedGuest, 'POST', confirmationPath, {
          requestId: randomUUID(),
          expectedGuestId: authorizedGuest.guestId,
          confirm: true,
        }),
        401,
        'GUEST_ACCESS_REQUIRED',
        'Revoked Guest fresh confirmation',
      );
      assert.deepEqual(await approvalSnapshot(db), afterRevocation);

      const ownerList = await jsonAt(
        await sendOwner('GET'),
        200,
        'Owner list after invite revocation',
      );
      assert.equal(ownerList.requests.length, 1);
      assert.equal(ownerList.requests[0].id, created.request.id);
      assert.equal(ownerList.requests[0].status, 'confirmed');
      assert.equal(
        ownerList.requests[0].inviteIds[0],
        authorizedGuest.inviteId,
      );
    },
  );

  process.stdout.write(
    'Version approval focused API checks passed: ' + passed + '\n',
  );
} finally {
  await mf.dispose();
  const tempRoot = resolve(tmpdir());
  const tempPath = resolve(temporary);
  assert.ok(
    tempPath.startsWith(tempRoot + '\\') || tempPath.startsWith(tempRoot + '/'),
    'refusing to remove an isolated path outside the OS temp directory',
  );
  await rm(temporary, { recursive: true, force: true });
}
