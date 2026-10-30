import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
// Narrow staging login rehearsal gate; never authorizes the product or production.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');
const sha = (x) => createHash('sha256').update(x).digest('hex');
const prefix = 'apps/worker/';
const configText = await read(prefix + 'wrangler.auth-validation.jsonc');
const cfg = ts.parseConfigFileTextToJson('auth-validation', configText).config;
assert.equal(cfg.account_id, 'd3e930465c0df7e89b35de3ca65ea36a');
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, cfg.account_id);
assert.equal(cfg.name, 'kino-pic-staging');
assert.equal(cfg.main, 'tools/staging-auth-validation-worker.ts');
assert.equal(cfg.vars.APP_ENV, 'staging');
assert.equal(cfg.vars.STAGING_AUTH_VALIDATION, 'true');
assert.equal(
  cfg.vars.APP_URL,
  'https://kino-pic-staging.kino-pick-aaron2026.workers.dev',
);
assert.equal(cfg.vars.REGISTRATION_MODE, 'closed');
assert.equal(cfg.vars.STORAGE_RETENTION_DRY_RUN, 'true');
for (const [key, value] of Object.entries(cfg.vars))
  if (key.endsWith('_ENABLED')) assert.equal(value, 'false');
assert.equal(cfg.workers_dev, false);
assert.equal(cfg.preview_urls, false);
assert.deepEqual(cfg.routes, []);
assert.equal(cfg.assets, undefined);
assert.equal(cfg.r2_buckets, undefined);
assert.equal(cfg.triggers, undefined);
assert.equal(cfg.d1_databases.length, 1);
assert.equal(
  cfg.d1_databases[0].database_id,
  'cdee0ac7-bf91-4852-9c17-a996c0b84f8d',
);
const local = JSON.parse(
  await read(prefix + '.local/staging-r2-rehearsal-current.json'),
);
const remote = JSON.parse(
  await read(prefix + '.local/staging-r2-remote-proof.json'),
);
const restored = JSON.parse(
  await read(prefix + '.local/staging-r2-cloud-restore-proof.json'),
);
assert.equal(local.status, 'passed_local_rehearsal');
assert.equal(remote.status, 'remote_migrations_and_owner_passed');
assert.equal(restored.status, 'passed_remote_restore');
assert.equal(restored.restoreCanonicalParity, true);
assert.equal(restored.sourceDatabaseId, cfg.d1_databases[0].database_id);
assert.notEqual(restored.restoreDatabaseId, restored.sourceDatabaseId);
assert.equal(restored.accountId, cfg.account_id);
assert.equal(restored.sourceBackupSha256, remote.backupSha256);
for (const [name, hash] of Object.entries(local.migrationHashes))
  assert.equal(sha(await read(prefix + 'migrations/' + name)), hash);
assert.equal(sha(await readFile(remote.populatedBackup)), remote.backupSha256);
const source = await read(prefix + cfg.main);
const authLocal = JSON.parse(
  await read(prefix + '.local/staging-auth-validation-local-proof.json'),
);
assert.equal(authLocal.status, 'passed_local_auth_validation');
assert.equal(authLocal.sourceSha256, sha(source));
assert.equal(authLocal.configSha256, sha(configText));
await writeFile(
  resolve(root, prefix + '.local/staging-auth-validation-gate.json'),
  JSON.stringify(
    {
      passed: true,
      scope: 'staging-auth-only',
      accountId: cfg.account_id,
      databaseId: restored.sourceDatabaseId,
      restoreDatabaseId: restored.restoreDatabaseId,
      sourceSha256: sha(source),
      configSha256: sha(configText),
      checkedAt: new Date().toISOString(),
      productReleaseAuthorized: false,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Scoped staging auth rehearsal gate passed; product/production deployment remains closed.',
);
