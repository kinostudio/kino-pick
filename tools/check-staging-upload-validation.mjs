import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
// An operator-only staging rehearsal gate. Never authorizes product/production cutover.
const root = fileURLToPath(new URL('../', import.meta.url)),
  prefix = 'apps/worker/';
const read = (p) => readFile(resolve(root, p), 'utf8');
const sha = (x) => createHash('sha256').update(x).digest('hex');
const account = 'd3e930465c0df7e89b35de3ca65ea36a';
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, account);
const configText = await read(prefix + 'wrangler.upload-validation.jsonc');
const cfg = ts.parseConfigFileTextToJson(
  'upload-validation',
  configText,
).config;
assert.equal(cfg.account_id, account);
assert.equal(cfg.name, 'kino-pic-staging');
assert.equal(cfg.main, 'tools/staging-upload-validation-worker.ts');
assert.equal(cfg.workers_dev, false);
assert.equal(cfg.preview_urls, false);
assert.deepEqual(cfg.routes, []);
assert.equal(cfg.triggers, undefined);
assert.equal(cfg.vars.STAGING_UPLOAD_VALIDATION, 'true');
assert.equal(cfg.vars.APP_ENV, 'staging');
assert.equal(
  cfg.vars.APP_URL,
  'https://kino-pic-staging.kino-pick-aaron2026.workers.dev',
);
assert.equal(cfg.vars.REGISTRATION_MODE, 'closed');
assert.equal(cfg.vars.STORAGE_RETENTION_DRY_RUN, 'true');
for (const [key, value] of Object.entries(cfg.vars))
  if (key.endsWith('_ENABLED'))
    assert.equal(
      value,
      ['DIRECT_UPLOAD_ENABLED', 'CLOUDFLARE_IMAGE_PROCESSING_ENABLED'].includes(
        key,
      )
        ? 'true'
        : 'false',
    );
assert.equal(cfg.assets.directory, '.static');
assert.equal(cfg.assets.binding, 'ASSETS');
assert.equal(cfg.assets.run_worker_first, true);
assert.deepEqual(cfg.images, { binding: 'IMAGES' });
assert.deepEqual(cfg.r2_buckets, [
  { binding: 'PRIMARY_STORAGE', bucket_name: 'kino-pick-staging-d3e93046' },
]);
assert.equal(cfg.d1_databases.length, 1);
assert.equal(
  cfg.d1_databases[0].database_id,
  'cdee0ac7-bf91-4852-9c17-a996c0b84f8d',
);
assert.equal(cfg.d1_databases[0].binding, 'DB');
const required = [
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
];
assert.deepEqual([...cfg.secrets.required].sort(), required.sort());
const local = JSON.parse(
  await read(prefix + '.local/staging-upload-validation-local-proof.json'),
);
assert.equal(local.status, 'passed_local_upload_validation');
assert.equal(local.checks.length, 14);
assert.equal(local.sourceSha256, sha(await read(prefix + cfg.main)));
assert.equal(local.configSha256, sha(configText));
assert.equal(
  local.bundleSha256,
  sha(
    await readFile(
      resolve(
        root,
        prefix +
          '.local/upload-validation-build/staging-upload-validation-worker.js',
      ),
    ),
  ),
);
const db = JSON.parse(
  await read(prefix + '.local/staging-0056-apply-proof.json'),
);
assert.equal(db.status, 'passed_staging_0056_apply');
assert.equal(db.accountId, account);
assert.equal(db.sourceDatabaseId, cfg.d1_databases[0].database_id);
assert.notEqual(db.restoreDatabaseId, db.sourceDatabaseId);
assert.equal(db.independentUpgradePassed, true);
assert.equal(db.publicEntryClosed, true);
assert.equal(db.foreignKeyViolations, 0);
assert.equal(db.migrationCount, 56);
assert.equal(
  db.migrationSha256,
  sha(
    await readFile(
      resolve(
        root,
        prefix + 'migrations/0056_processing_policy_and_retry_guards.sql',
      ),
    ),
  ),
);
const readiness = JSON.parse(await read(prefix + 'deployment-readiness.json'));
assert.equal(readiness.real_oauth_and_owner_bootstrap_verified, true);
assert.equal(readiness.private_direct_upload_verified, false);
const secrets = JSON.parse(
  await read(prefix + '.local/staging-r3-secrets-proof.json'),
);
assert.equal(secrets.accountId, account);
assert.equal(secrets.worker, cfg.name);
assert.equal(secrets.allSecretText, true);
assert.deepEqual([...secrets.names].sort(), required.sort());
const ci = JSON.parse(
  await read(prefix + '.local/processing-integration-ci.json'),
);
assert.equal(ci.id, 41147833540);
assert.equal(ci.head_sha, '6709d0bdab307f9ddb7b76ce47f0b5e0a91f2ae2');
assert.equal(ci.status, 'completed');
assert.equal(ci.conclusion, 'success');
// Keep the user's real branch/index intact while comparing actual backend/UI inputs to accepted CI.
const dir = await mkdtemp(join(tmpdir(), 'kino-upload-gate-')),
  index = join(dir, 'index');
try {
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), ...args],
      { cwd: root, env, stdio: 'pipe' },
    );
  git('read-tree', ci.head_sha);
  try {
    git(
      'diff',
      '--quiet',
      '--',
      'apps/worker/src',
      'packages',
      'apps/web',
      'package.json',
      'pnpm-lock.yaml',
    );
  } catch {
    throw new Error(
      'Backend/UI changed since accepted CI; rerun relevant acceptance before staging deployment',
    );
  }
} finally {
  await unlink(index).catch(() => {});
  await rmdir(dir).catch(() => {});
}
const report = {
  status: 'passed_owner_upload_staging_preflight',
  accountId: account,
  worker: cfg.name,
  baseCiSha: ci.head_sha,
  configSha256: local.configSha256,
  bundleSha256: local.bundleSha256,
  publicEntryDefault: 'closed',
  productDeploymentAuthorized: false,
  checkedAt: new Date().toISOString(),
};
await writeFile(
  resolve(root, prefix + '.local/staging-upload-validation-preflight.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
