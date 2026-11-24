import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makeSignature } from 'better-auth/crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigration } from './apply-migration.mjs';
import { runUploadBrowserChecks } from './upload-browser.mjs';

const benchmark = process.env.KINO_UPLOAD_BENCHMARK_DIR;
const baseUrl = 'http://127.0.0.1:8799';
const owner = randomUUID(),
  session = randomUUID(),
  token = randomUUID();
const secret =
  'isolated-upload-queue-synthetic-secret-at-least-forty-characters';
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        ...(benchmark
          ? {
              modules: [
                {
                  type: 'ESModule',
                  path: resolve('.build/benchmark.js'),
                  contents: await readFile(
                    'tests/upload-benchmark-worker.mjs',
                    'utf8',
                  ),
                },
                {
                  type: 'ESModule',
                  path: resolve('.build/index.js'),
                  contents: await readFile('.build/index.js', 'utf8'),
                },
              ],
            }
          : { modules: true, scriptPath: resolve('.build/index.js') }),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          APP_ENV: 'local',
          APP_URL: baseUrl,
          REGISTRATION_MODE: 'closed',
          STORAGE_AUTODELETE_ENABLED: 'false',
          STORAGE_RETENTION_DRY_RUN: 'true',
          MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
          DIRECT_UPLOAD_ENABLED: 'true',
          CLOUDFLARE_IMAGE_PROCESSING_ENABLED: benchmark ? 'true' : 'false',
          BETTER_AUTH_SECRET: secret,
          R2_ACCOUNT_ID: 'a'.repeat(32),
          R2_ACCESS_KEY_ID: 'synthetic-test-access-key',
          R2_SECRET_ACCESS_KEY:
            'synthetic-test-secret-key-never-for-production',
          R2_BUCKET_NAME: 'isolated-upload-queue',
        },
        ...(benchmark ? { images: { binding: 'IMAGES' } } : {}),
        d1Databases: { DB: 'isolated-upload-queue' },
        r2Buckets: { PRIMARY_STORAGE: 'isolated-upload-queue' },
        assets: {
          directory: resolve(
            process.env.KINO_UPLOAD_BENCHMARK_ASSETS ?? '.static',
          ),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
      },
    ],
  }),
);
try {
  const db = await mf.getD1Database('DB', 'app');
  for (const name of (await readdir('migrations'))
    .filter((x) => /^\d{4}.*\.sql$/.test(x))
    .sort())
    await applyMigration(db, await readFile('migrations/' + name, 'utf8'));
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'isolated-upload-queue')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(session, token, owner, now + 3600000, now, now)
    .run();
  const sessionCookie = encodeURIComponent(
    token + '.' + (await makeSignature(token, secret)),
  );
  await runUploadBrowserChecks({
    worker: await mf.getWorker('app'),
    db,
    storage: await mf.getR2Bucket('PRIMARY_STORAGE', 'app'),
    baseUrl,
    sessionCookie,
    bulkOnly: true,
    benchmark,
  });
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  console.log('passed: isolated browser upload queue and FK check');
} finally {
  await mf.dispose();
}
