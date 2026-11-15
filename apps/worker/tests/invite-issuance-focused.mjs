import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { inviteIssuanceChecks } from './invite-issuance.mjs';

const base = 'http://127.0.0.1:8799';
const owner = randomUUID();
const session = randomUUID();
const sessionToken = randomUUID();
const secret = 'invite-label-focused-secret-at-least-forty-characters';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'false',
  GUEST_SELECTION_ENABLED: 'false',
  GUEST_FEEDBACK_ENABLED: 'false',
  GUEST_SHARED_SELECTION_ENABLED: 'false',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'invite-label-test-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-never-for-production',
  R2_BUCKET_NAME: 'invite-label-focused',
  BETTER_AUTH_SECRET: secret,
};
const worker = (name, extraBindings = {}) => ({
  name,
  modules: true,
  scriptPath: resolve('.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  bindings: { ...bindings, ...extraBindings },
  d1Databases: { DB: 'invite-label-focused' },
  r2Buckets: { PRIMARY_STORAGE: 'invite-label-focused' },
  assets: {
    directory: resolve('.static'),
    binding: 'ASSETS',
    run_worker_first: true,
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  },
  outboundService: async () =>
    new Response('Outbound blocked', { status: 503 }),
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      worker('app'),
      worker('upload-disabled', {
        DIRECT_UPLOAD_ENABLED: 'false',
        GUEST_INVITE_ISSUANCE_ENABLED: 'false',
      }),
      {
        name: 'storage-test',
        modules: true,
        scriptPath: resolve('.build-storage/storage-harness.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        d1Databases: { DB: 'invite-label-focused' },
        r2Buckets: { PRIMARY_STORAGE: 'invite-label-focused' },
      },
    ],
  }),
);

try {
  const db = await mf.getD1Database('DB', 'app');
  const migrations = (await readdir('migrations'))
    .filter((name) => /^\d{4}.*\.sql$/u.test(name))
    .sort();
  for (const name of migrations)
    await applyMigration(db, await readFile(`migrations/${name}`, 'utf8'));

  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'invite-label-focused')
    .run();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(session, sessionToken, owner, now + 3600000, now, now)
    .run();

  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const albumId = randomUUID();
  const otherAlbumId = randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(workspaceId, 'Invite label fixture', owner),
    db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(projectId, workspaceId, 'Label project'),
    db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(otherProjectId, workspaceId, 'Other project'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(albumId, workspaceId, projectId, 'Label album'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(otherAlbumId, workspaceId, otherProjectId, 'Other album'),
  ]);

  const cookie =
    'kino-owner.session_token=' +
    encodeURIComponent(
      sessionToken + '.' + (await makeSignature(sessionToken, secret)),
    );
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
  };
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  let count = 0;
  const focusedChecks = new Set([
    'All three Owner invitation modes atomically seal exact scope and reveal secrets only on initial winner',
    'Invite labels trim/validate, atomically persist, replay by value, and stay inside invite scope',
    'Label insert failure rolls back the invite command and invite; the exact intent can retry',
    'Invite list and unlabeled issuance remain compatible with schema 0069 before label adoption',
  ]);
  const check = async (label, test) => {
    if (!focusedChecks.has(label)) {
      process.stdout.write(`skipped unrelated: ${label}\n`);
      return;
    }
    process.stdout.write(`running: ${label}\n`);
    await test();
    count++;
    process.stdout.write(`passed: ${label}\n`);
  };

  await inviteIssuanceChecks({
    db,
    mf,
    request,
    headers,
    projectId,
    workspaceId,
    otherProjectId,
    albumId,
    otherAlbumId,
    owner,
    check,
  });
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  console.log(
    `passed: focused invite issuance (${count} checks, ${migrations.length} migrations)`,
  );
} finally {
  await mf.dispose();
}
