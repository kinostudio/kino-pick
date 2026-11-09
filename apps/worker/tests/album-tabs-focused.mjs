import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { runWorkerUiBrowserChecks } from './ui-browser.mjs';

const baseUrl = 'http://127.0.0.1:8794';
const secret = 'synthetic-album-tabs-focused-secret-never-a-real-credential';
const actor = randomUUID();
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: 'album-tabs-focused',
    modules: true,
    scriptPath: resolve('.build/index.js'),
    compatibilityDate: '2026-10-23',
    compatibilityFlags: ['nodejs_compat'],
    outboundService: async () =>
      new Response('Outbound blocked', { status: 503 }),
    bindings: {
      APP_ENV: 'local',
      APP_URL: baseUrl,
      REGISTRATION_MODE: 'closed',
      STORAGE_AUTODELETE_ENABLED: 'false',
      STORAGE_RETENTION_DRY_RUN: 'true',
      MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
      BETTER_AUTH_SECRET: secret,
      ORACLE_STORAGE_ADMIN_USER_ID: actor,
    },
    d1Databases: { DB: 'album-tabs-focused' },
    r2Buckets: { PRIMARY_STORAGE: 'album-tabs-focused' },
    assets: {
      directory: resolve('.static'),
      binding: 'ASSETS',
      run_worker_first: true,
      routerConfig: {
        has_user_worker: true,
        invoke_user_worker_ahead_of_assets: true,
      },
    },
  }),
);
try {
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir('migrations'))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort())
    await applyMigration(db, await readFile('migrations/' + name, 'utf8'));
  const token = randomUUID(),
    now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(actor, 'synthetic-album-tabs-owner')
    .run();
  await db
    .prepare(
      "INSERT INTO storage_nodes(id,provider,account_id,bucket_name,endpoint,credential_ref,status,priority,quota_bytes) VALUES('oracle-vm','s3','synthetic-capacity-account','kino-pick-overflow','https://drive.kinostudio.tw','env:ORACLE_STORAGE','active',2,30000000000)",
    )
    .run();
  await db
    .prepare(
      'INSERT INTO oracle_storage_health(id,observed_at_ms,mounted,free_bytes,maximum_quota_bytes,quota_bytes) VALUES(1,?,1,155800000000,100000000000,30000000000)',
    )
    .bind(now)
    .run();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(randomUUID(), token, actor, now + 3600000, now, now)
    .run();
  const result = await runWorkerUiBrowserChecks({
    worker: await mf.getWorker(),
    baseUrl,
    checkStorageCapacity: true,
    sessionCookie: encodeURIComponent(
      token + '.' + (await makeSignature(token, secret)),
    ),
  });
  await writeFile(
    '.local/card-width-local-acceptance.json',
    JSON.stringify(
      { status: 'passed_local_only', cardLayouts: result.cardLayouts },
      null,
      2,
    ),
  );
  console.log(
    'passed: native Owner workspace/project/album flow, sliding tabs, URL/back/reload, 375px and reduced-motion',
  );
} finally {
  await mf.dispose();
}
