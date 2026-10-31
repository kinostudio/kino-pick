import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';
import { runInviteCreateUiChecks } from './invite-create-ui-browser.mjs';
const base = 'http://127.0.0.1:8798',
  owner = randomUUID(),
  sid = randomUUID(),
  token = randomUUID();
const secret = 'invite-create-isolated-secret-at-least-forty-characters';
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
  R2_BUCKET_NAME: 'invite-create-isolated',
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
  d1Databases: { DB: 'invite-create-isolated' },
  r2Buckets: { PRIMARY_STORAGE: 'invite-create-isolated' },
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
    .filter((x) => /^\d{4}.*\.sql$/.test(x))
    .sort())
    await applyMigration(db, await readFile('migrations/' + name, 'utf8'));
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'invite-create-focused')
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
  console.log('Invite creation synthetic fixture ready');
  await runInviteCreateUiChecks({
    worker: app,
    disabledWorker: await mf.getWorker('disabled'),
    base,
    ownerCookie: cookie.slice('kino-owner.session_token='.length),
    projectId: fixture.projectId,
    albumId: fixture.albumId,
    db,
  });
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  await writeFile(
    '.local/invite-create-focused-proof.json',
    JSON.stringify({
      status: 'passed_isolated_invite_creation_modal',
      runner: 'runInviteCreateUiChecks',
      schemaMigrations: 57,
      scope: 'fresh ephemeral D1/R2 only',
      realOAuth: false,
      remoteProvider: false,
    }) + '\n',
  );
  console.log('passed: isolated invite creation modal browser regression');
} finally {
  await mf.dispose();
}
