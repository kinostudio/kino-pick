import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';
import { createHash } from 'node:crypto';
const base = 'http://127.0.0.1:8798',
  owner = randomUUID(),
  sid = randomUUID(),
  token = randomUUID();
const secret = 'photographer-routes-isolated-secret-at-least-forty-characters';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_DOWNLOADS_ENABLED: 'false',
  GUEST_SELECTION_ENABLED: 'true',
  PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
  BETTER_AUTH_SECRET: secret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-not-real-secret',
  R2_BUCKET_NAME: 'photographer-routes-isolated',
};
const worker = (name, exchange) => ({
  name,
  modules: true,
  scriptPath: resolve('.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  outboundService: async () =>
    new Response('Outbound blocked', { status: 503 }),
  bindings: { ...bindings, GUEST_EXCHANGE_ENABLED: exchange },
  d1Databases: { DB: 'photographer-routes-isolated' },
  r2Buckets: { PRIMARY_STORAGE: 'photographer-routes-isolated' },
  assets: {
    directory: resolve('.static'),
    binding: 'ASSETS',
    run_worker_first: true,
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  },
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [worker('app', 'true'), worker('disabled', 'false')],
  }),
);
try {
  const db = await mf.getD1Database('DB', 'app'),
    storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
  for (const name of (await readdir('migrations'))
    .filter((x) => /^\d{4}.*\.sql$/.test(x) && !x.startsWith('0059'))
    .sort())
    await applyMigration(db, await readFile('migrations/' + name, 'utf8'));
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'photographer-routes-focused')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(sid, token, owner, now + 3600000, now, now)
    .run();
  const cookie =
    'kino-owner.session_token=' +
    encodeURIComponent(token + '.' + (await makeSignature(token, secret)));
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const app = await mf.getWorker('app');
  const { fixture } = await guestDownloadChecks({
    db,
    storage,
    worker: app,
    request,
    owner,
    ownerSessionId: sid,
    ownerCookie: cookie,
    base,
    fixtureOnly: true,
  });
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
    'X-Kino-Expected-Session': sid,
  };
  let groups = 0;
  const call = async (path, status, body, method = 'PUT', extra = {}) => {
    const response = await request(path, {
      method: body === undefined ? 'GET' : method,
      headers: { ...headers, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(
      response.status,
      status,
      JSON.stringify({ phase: path, code: value?.error?.code }),
    );
    return value;
  };
  const cap = '/api/v1/photographer-recommendations/capabilities';
  assert.deepEqual(await call(cap, 200), { enabled: false });
  const migration59 = (await readdir('migrations')).find((name) =>
    name.startsWith('0059'),
  );
  assert.ok(migration59);
  await applyMigration(db, await readFile('migrations/' + migration59, 'utf8'));
  assert.deepEqual(await call(cap, 200), { enabled: true });
  groups++;
  const photoPath =
    '/api/v1/photos/' + fixture.photoId + '/photographer-metadata';
  const policyPath =
    '/api/v1/albums/' + fixture.albumId + '/photographer-recommendations';
  const original = await call(photoPath, 200);
  assert.equal(original.photoId, fixture.photoId);
  assert.equal(original.source, null);
  groups++;
  const completed = await db
    .prepare(
      'SELECT upload_session_id,request_id FROM upload_completions WHERE photo_id=? AND version_id=?',
    )
    .bind(fixture.photoId, fixture.versionId)
    .first();
  assert.ok(completed);
  await call(
    '/api/v1/uploads/' + completed.upload_session_id + '/complete',
    200,
    { requestId: completed.request_id },
    'POST',
  );
  let automatic = original;
  for (let i = 0; i < 20 && automatic.source === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    automatic = await call(photoPath, 200);
  }
  assert.ok(
    automatic.source,
    'completion replay must wake actual metadata import',
  );
  assert.equal(automatic.source.mime, 'image/png');
  groups++;
  const importIntent = {
    requestId: randomUUID(),
    versionId: fixture.versionId,
    expectedRevision: automatic.revision,
  };
  const imported = await call(photoPath + '/import', 200, importIntent, 'POST');
  assert.equal(imported.photo.source.mime, 'image/png');
  assert.equal(imported.photo.rating.imported.state, 'imported');
  assert.equal(imported.photo.rating.imported.field.status, 'missing');
  assert.deepEqual(
    await call(photoPath + '/import', 200, importIntent, 'POST'),
    imported,
  );
  groups++;
  let page = await call(policyPath, 200);
  const policyIntent = {
    requestId: randomUUID(),
    expectedRevision: page.policy.revision,
    visible: true,
    minRating: 3,
    allowedLabels: ['red'],
  };
  const policy = await call(policyPath, 200, policyIntent);
  assert.deepEqual(await call(policyPath, 200, policyIntent), policy);
  groups++;
  let photo = await call(photoPath, 200);
  const setIntent = {
    requestId: randomUUID(),
    versionId: fixture.versionId,
    expectedRevision: photo.revision,
    expectedHeadRevision: photo.headRevision,
    rating: { state: 'set', value: 4 },
    label: { state: 'set', value: 'blue' },
    decision: 'inherit',
  };
  const updated = await call(photoPath, 200, setIntent);
  assert.equal(updated.photo.rating.effective, 4);
  assert.equal(updated.photo.label.effective, 'blue');
  assert.equal(updated.photo.decision.recommended, true);
  assert.deepEqual(await call(photoPath, 200, setIntent), updated);
  await call(photoPath, 409, { ...setIntent, requestId: randomUUID() });
  groups++;
  const guestHeaders = { Cookie: 'kino_guest=' + fixture.viewGuest.cookie };
  const guestPage = await request(
    '/api/guest/albums/' + fixture.albumId + '/photos',
    { headers: guestHeaders },
  );
  assert.equal(guestPage.status, 200);
  const guestJson = await guestPage.json();
  const guestPhoto = guestJson.photos.find((row) => row.id === fixture.photoId);
  assert.equal(guestPhoto.photographerRecommended, true);
  assert.equal(Object.hasOwn(guestPhoto, 'rating'), false);
  assert.equal(Object.hasOwn(guestPhoto, 'source'), false);
  const guestHidden = await call(policyPath, 200, {
    requestId: randomUUID(),
    expectedRevision: policy.policy.revision,
    visible: false,
    minRating: 3,
    allowedLabels: ['red'],
  });
  assert.equal(guestHidden.policy.visible, false);
  const hiddenJson = await (
    await request('/api/guest/albums/' + fixture.albumId + '/photos', {
      headers: guestHeaders,
    })
  ).json();
  assert.equal(
    hiddenJson.photos.find((row) => row.id === fixture.photoId)
      .photographerRecommended,
    false,
  );
  groups++;
  await call(photoPath, 403, { ...setIntent, requestId: randomUUID() }, 'PUT', {
    Origin: 'https://invalid.example',
  });
  await call(photoPath, 409, { ...setIntent, requestId: randomUUID() }, 'PUT', {
    'X-Kino-Expected-Session': randomUUID(),
  });
  await call('/api/v1/photos/' + randomUUID() + '/photographer-metadata', 404);
  await call(photoPath, 401, undefined, 'GET', { Cookie: '' });
  groups++;
  const counts = async () => ({
    ...(await db
      .prepare(
        "SELECT (SELECT count(*) FROM photographer_recommendation_commands) commands,(SELECT count(*) FROM audit_events WHERE action LIKE 'photo.photographer_metadata.%' OR action='album.photographer_recommendations.changed') audits",
      )
      .first()),
  });
  const before = await counts();
  await db.exec(
    "CREATE TRIGGER test_metadata_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action LIKE 'photo.photographer_metadata.%' BEGIN SELECT RAISE(ABORT,'INJECTED_METADATA_AUDIT_FAILURE'); END;",
  );
  photo = await call(photoPath, 200);
  await call(photoPath, 503, {
    ...setIntent,
    requestId: randomUUID(),
    expectedRevision: photo.revision,
    rating: { state: 'clear' },
    label: { state: 'clear' },
  });
  assert.deepEqual(await counts(), before);
  await db.exec('DROP TRIGGER test_metadata_audit_failure;');
  groups++;
  const asset = await db
    .prepare(
      "SELECT object_key FROM photo_assets WHERE photo_id=? AND version_id=? AND asset_kind='original'",
    )
    .bind(fixture.photoId, fixture.versionId)
    .first();
  await storage.put(asset.object_key, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: 'image/png' },
  });
  await call(
    photoPath + '/import',
    503,
    {
      requestId: randomUUID(),
      versionId: fixture.versionId,
      expectedRevision: photo.revision,
    },
    'POST',
  );
  assert.deepEqual(await counts(), before);
  groups++;
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  await writeFile(
    '.local/photographer-routes-focused-proof.json',
    JSON.stringify(
      {
        status: 'passed_isolated_photographer_routes',
        groups,
        migrations: 59,
        realOAuth: false,
        remoteProvider: false,
        workerBundleSha256: hash(await readFile('.build/index.js')),
        migration59Sha256: hash(await readFile('migrations/' + migration59)),
        runnerSha256: hash(
          await readFile('tests/photographer-routes-focused.mjs'),
        ),
        scope: 'fresh ephemeral native D1/R2 only',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'passed: ' + groups + ' isolated photographer route/R2/audit groups',
  );
} finally {
  await mf.dispose();
}
