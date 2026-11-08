import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';
import { humanViewBrowserChecks } from './human-views-browser.mjs';
import { humanViewChecks } from './human-views.mjs';

const base = 'http://127.0.0.1:8796';
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

  const native = await humanViewChecks({
    db,
    request,
    owner,
    ownerCookie,
    base,
    authSecret,
    fixture,
  });
  const browser = await humanViewBrowserChecks({
    worker,
    base,
    albumId: fixture.albumId,
    photoId: fixture.photoId,
    versionId: fixture.versionId,
    filename: fixture.sourceFilename,
    projectId: fixture.projectId,
    ownerCookie: native.browser.ownerCookie,
    guestCookie: native.browser.guestCookie,
  });
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );

  const sourceFiles = [
    '.build/index.js',
    'src/config.ts',
    'src/human-view-routes.ts',
    'src/human-views.ts',
    '../../packages/contracts/src/human-views.ts',
    '../../apps/web/target-ui/album-gallery.tsx',
    '../../apps/web/target-ui/guest-selection.tsx',
    '../../apps/web/target-ui/human-photo-views.tsx',
    'tests/guest-downloads.mjs',
    'tests/human-views.mjs',
    'tests/human-views-browser.mjs',
    'tests/human-views-focused.mjs',
    'tests/apply-migration.mjs',
  ];
  const sourceHashes = {};
  for (const file of sourceFiles) {
    sourceHashes[file] = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  }
  const sourceHash = createHash('sha256');
  for (const [file, hash] of Object.entries(sourceHashes).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    sourceHash.update(file + '\0' + hash + '\n');

  const migrationHash = createHash('sha256');
  for (const name of migrationNames)
    migrationHash
      .update(name + '\0')
      .update(await readFile(resolve('migrations', name)));
  const browserCheckGroups = Object.keys(browser);
  const proof = {
    status: 'passed_local_only',
    runner: 'human-views-focused.mjs',
    sourceSha256: sourceHash.digest('hex'),
    sourceFiles: sourceHashes,
    schema: {
      migrationCount: migrationNames.length,
      latestMigration: migrationNames.at(-1) ?? null,
      migrationsSha256: migrationHash.digest('hex'),
    },
    checkGroups: {
      native: native.checks,
      browser: browserCheckGroups,
      d1: ['foreign_key_check is empty'],
      count: native.checks.length + browserCheckGroups.length + 1,
    },
    viewportWidth: { owner: 375, guest: 375 },
    scope: 'fresh ephemeral Miniflare D1/R2 only',
    syntheticOwner: true,
    realOAuth: false,
    outboundRequestsBlocked: true,
  };
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/human-views-focused-proof.json',
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    `passed: human views focused local-only checks (${proof.checkGroups.count} named groups)`,
  );
} finally {
  await mf.dispose();
}
