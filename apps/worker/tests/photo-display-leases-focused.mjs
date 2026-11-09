import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { photoDisplayLeaseChecks } from './photo-display-leases-checks.mjs';
import { photoDisplayLeaseBrowserChecks } from './photo-display-leases-browser.mjs';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';

const base = 'http://127.0.0.1:8798';
const owner = randomUUID();
const ownerSessionId = randomUUID();
const ownerToken = randomUUID();
const authSecret =
  'human-views-focused-isolated-secret-at-least-forty-characters';
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
  HUMAN_VIEW_TRACKING_ENABLED: 'true',
  ALBUM_READ_PROTECTION_ENABLED: 'true',
  PHOTO_DISPLAY_LEASE_ENABLED: 'true',
  BETTER_AUTH_SECRET: authSecret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-not-real-secret',
  R2_BUCKET_NAME: 'human-views-focused',
};
const workerConfig = {
  name: 'app',
  modules: true,
  scriptPath: resolve('.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  outboundService: async () =>
    new Response('Outbound blocked', { status: 503 }),
  bindings,
  d1Databases: { DB: 'human-views-focused' },
  r2Buckets: { PRIMARY_STORAGE: 'human-views-focused' },
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
const mf = new Miniflare(
  convertV4MiniflareOptions({ workers: [workerConfig] }),
);

try {
  const db = await mf.getD1Database('DB', 'app');
  const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
  const migrationNames = (await readdir('migrations'))
    .filter((name) => /^\d{4}.*\.sql$/.test(name))
    .sort();
  for (const name of migrationNames)
    await applyMigration(
      db,
      await readFile(resolve('migrations', name), 'utf8'),
    );

  await applyMigration(
    db,
    await readFile(
      resolve('migration-proposals/0071_album_read_protections.sql'),
      'utf8',
    ),
  );

  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'human-views-focused')
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
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const worker = await mf.getWorker('app');
  const { fixture } = await guestDownloadChecks({
    db,
    storage,
    worker,
    request,
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    fixtureOnly: true,
  });

  const native = await photoDisplayLeaseChecks({
    db,
    storage,
    request,
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    authSecret,
    fixture,
  });
  const nativeOnly = process.argv.includes('--native-only');
  const browser = nativeOnly
    ? []
    : await photoDisplayLeaseBrowserChecks({
        worker,
        base,
        ownerCookie,
        guestCookie: 'kino_guest=' + fixture.viewGuest.cookie,
        fixture,
      });
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  const files = [
    'src/config.ts',
    'src/human-view-routes.ts',
    'src/photo-display-leases.ts',
    'src/album-read-protections.ts',
    'src/bounded-asset-stream.ts',
    'src/gallery.ts',
    'src/guest-gallery.ts',
    'src/staging-collaboration-boundary.ts',
    '../../packages/contracts/src/human-views.ts',
    '../../packages/contracts/src/photo-display-leases.ts',
    '../../apps/web/target-ui/human-photo-views.tsx',
    '../../apps/web/target-ui/photo-display-lease-client.ts',
    '.build/index.js',
    '.static/index.html',
    'tests/photo-display-leases-focused.mjs',
    'tests/photo-display-leases-checks.mjs',
    'tests/photo-display-leases-browser.mjs',
  ];
  for (const name of await readdir('.static/assets'))
    files.push('.static/assets/' + name);
  const sourceFiles = {};
  for (const name of files)
    sourceFiles[name] = createHash('sha256')
      .update(await readFile(name))
      .digest('hex');
  const proof = {
    status: nativeOnly ? 'passed_native_only' : 'passed_local_only',
    scope:
      'ephemeral full69 + proposal71 / native D1 and R2 / synthetic sessions',
    native,
    browser,
    sourceFiles,
    realOAuth: false,
    deployed: false,
  };
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(
    resolve(
      nativeOnly
        ? '.local/photo-display-leases-native.json'
        : '.local/photo-display-leases-proof.json',
    ),
    JSON.stringify(proof, null, 2),
  );
  console.log(
    nativeOnly
      ? 'passed: finite photo display native checks only'
      : 'passed: finite photo display native/browser checks',
  );
} finally {
  await mf.dispose();
}
