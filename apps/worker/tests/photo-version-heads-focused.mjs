import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { photoVersionHeadChecks } from './photo-version-heads.mjs';

const base = 'http://127.0.0.1:8797',
  owner = randomUUID(),
  sid = randomUUID(),
  token = randomUUID();
const secret = 'version-heads-isolated-secret-at-least-forty-characters';
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
  BETTER_AUTH_SECRET: secret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-not-real-secret',
  R2_BUCKET_NAME: 'version-heads-isolated',
};
const worker = (name, extra = {}) => ({
  name,
  modules: true,
  scriptPath: resolve('.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  outboundService: async () =>
    new Response('Outbound blocked', { status: 503 }),
  bindings: { ...bindings, ...extra },
  d1Databases: { DB: 'version-heads-isolated' },
  r2Buckets: { PRIMARY_STORAGE: 'version-heads-isolated' },
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
    workers: [
      worker('app'),
      worker('photo-versions-test', {
        GUEST_EXCHANGE_ENABLED: 'true',
        GUEST_SELECTION_ENABLED: 'true',
        GUEST_FEEDBACK_ENABLED: 'true',
        GUEST_TAGS_ENABLED: 'true',
        GUEST_HISTORY_ENABLED: 'true',
        PHOTO_VERSIONS_ENABLED: 'true',
      }),
      worker('version-uploads-test', {
        GUEST_EXCHANGE_ENABLED: 'true',
        GUEST_SELECTION_ENABLED: 'true',
        GUEST_FEEDBACK_ENABLED: 'true',
        GUEST_TAGS_ENABLED: 'true',
        GUEST_HISTORY_ENABLED: 'true',
        PHOTO_VERSIONS_ENABLED: 'true',
        PHOTO_VERSION_UPLOADS_ENABLED: 'true',
      }),
      worker('guest-feedback-test', {
        GUEST_EXCHANGE_ENABLED: 'true',
        GUEST_SELECTION_ENABLED: 'true',
        GUEST_FEEDBACK_ENABLED: 'true',
      }),
      worker('guest-selection-test', { GUEST_SELECTION_ENABLED: 'true' }),
    ],
  }),
);
try {
  const db = await mf.getD1Database('DB', 'app'),
    storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
  for (const name of (await readdir('migrations'))
    .filter((x) => /^\d{4}.*\.sql$/.test(x))
    .sort())
    await applyMigration(db, await readFile('migrations/' + name, 'utf8'));
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'version-heads-focused')
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
  async function create(path, body) {
    const response = await request(path, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: base,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, requestId: randomUUID() }),
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  const { workspace } = await create('/api/v1/workspaces', {
    name: 'Isolated version navigation',
  });
  const { project } = await create('/api/v1/projects', {
    workspaceId: workspace.id,
    name: 'Isolated version conflicts',
  });
  let checks = 0;
  await photoVersionHeadChecks({
    db,
    mf,
    owner,
    base,
    request,
    cookies: {
      headers: () => cookie,
      values: new Map([
        [
          'kino-owner.session_token',
          cookie.slice('kino-owner.session_token='.length),
        ],
      ]),
    },
    galleryFixture: { context: { workspace, project }, storage },
    check: async (label, fn) => {
      console.log('running: ' + label);
      await fn();
      checks++;
      console.log('passed: ' + label);
    },
  });
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  console.log(
    'passed: isolated version conflicts, navigation and ' + checks + ' checks',
  );
} finally {
  await mf.dispose();
}
