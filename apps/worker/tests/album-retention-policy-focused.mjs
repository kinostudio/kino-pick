import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';
import { testAlbumRetentionPolicy } from './album-retention-policy.mjs';
import { runAlbumRetentionPolicyBrowserChecks } from './album-retention-policy-browser.mjs';

const base = 'http://127.0.0.1:8797';
const owner = randomUUID();
const ownerSessionId = randomUUID();
const ownerToken = randomUUID();
const authSecret =
  'album-retention-focused-isolated-secret-at-least-forty-characters';
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
  ALBUM_ACTIVATION_ENABLED: 'true',
  ALBUM_RETENTION_POLICY_ENABLED: 'true',
  HUMAN_VIEW_TRACKING_ENABLED: 'false',
  BETTER_AUTH_SECRET: authSecret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-not-real-secret',
  R2_BUCKET_NAME: 'album-retention-focused',
};
const config = {
  name: 'album-retention-focused',
  modules: true,
  scriptPath: resolve('.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  outboundService: async () =>
    new Response('Outbound blocked', { status: 503 }),
  bindings,
  d1Databases: { DB: 'album-retention-focused' },
  r2Buckets: { PRIMARY_STORAGE: 'album-retention-focused' },
  assets: {
    directory: resolve('.static'),
    binding: 'ASSETS',
    run_worker_first: true,
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  },
};
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [config] }));

try {
  const db = await mf.getD1Database('DB', config.name);
  const storage = await mf.getR2Bucket('PRIMARY_STORAGE', config.name);
  const migrationNames = (await readdir('migrations'))
    .filter((name) => /^\d{4}.*\.sql$/.test(name))
    .sort();
  for (const name of migrationNames)
    await applyMigration(
      db,
      await readFile(resolve('migrations', name), 'utf8'),
    );

  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'album-retention-focused')
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
  const nativeRequest = (path, method = 'GET', body, cookie, options = {}) => {
    const headers = new Headers();
    if (!options.noOrigin) headers.set('Origin', options.origin ?? base);
    if (cookie) headers.set('Cookie', cookie);
    if (options.expectedActor)
      headers.set('X-Kino-Expected-Actor', options.expectedActor);
    if (options.expectedSession)
      headers.set('X-Kino-Expected-Session', options.expectedSession);
    if (options.cfConnectingIp)
      headers.set('CF-Connecting-IP', options.cfConnectingIp);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    return mf.dispatchFetch(base + path, {
      method,
      headers,
      redirect: 'manual',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const json = async (response, expected, label) => {
    const value = await response
      .clone()
      .json()
      .catch(() => null);
    const code =
      typeof value?.error?.code === 'string' &&
      /^[A-Z0-9_]{1,80}$/.test(value.error.code)
        ? value.error.code
        : 'UNKNOWN_ERROR';
    assert.equal(
      response.status,
      expected,
      `${label}: expected HTTP ${expected}, got ${response.status} (${code})`,
    );
    return value;
  };
  const fetchRequest = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const worker = await mf.getWorker(config.name);
  const { fixture } = await guestDownloadChecks({
    db,
    storage,
    worker,
    request: fetchRequest,
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    fixtureOnly: true,
  });

  const nativeGroups = [];
  await testAlbumRetentionPolicy({
    db,
    request: nativeRequest,
    json,
    ownerCookie,
    owner,
    sessionId: ownerSessionId,
    scope: {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      albumId: fixture.albumId,
    },
    origin: base,
    foreignAlbumId: randomUUID(),
    record: (name) => nativeGroups.push(name),
  });
  assert.equal(nativeGroups.length, 5);

  await runAlbumRetentionPolicyBrowserChecks({
    worker,
    base,
    ownerCookie,
    galleryFixture: { context: { workspace: { id: fixture.workspaceId } } },
  });
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  console.log('passed: focused album retention Owner browser checks');
} finally {
  await mf.dispose();
}
