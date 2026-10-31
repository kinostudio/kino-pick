import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url)),
  worker = join(root, 'apps/worker');
const account = 'd3e930465c0df7e89b35de3ca65ea36a',
  database = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const sha = (x) => createHash('sha256').update(x).digest('hex');
const read = (p) => readFile(join(worker, p), 'utf8');
const configText = await read('wrangler.activation-validation.jsonc');
const cfg = ts.parseConfigFileTextToJson('activation', configText).config;
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, account);
assert.equal(cfg.account_id, account);
assert.equal(cfg.name, 'kino-pic-staging');
assert.equal(cfg.main, 'tools/staging-upload-validation-worker.ts');
assert.equal(cfg.workers_dev, false);
assert.equal(cfg.preview_urls, false);
assert.deepEqual(cfg.routes, []);
assert.equal(cfg.triggers, undefined);
assert.equal(cfg.vars.APP_ENV, 'staging');
assert.equal(
  cfg.vars.APP_URL,
  'https://kino-pic-staging.kino-pick-aaron2026.workers.dev',
);
assert.equal(cfg.vars.STAGING_UPLOAD_VALIDATION, 'true');
assert.equal(cfg.vars.STAGING_GUEST_VALIDATION, 'true');
assert.equal(cfg.vars.REGISTRATION_MODE, 'closed');
assert.equal(cfg.vars.STORAGE_RETENTION_DRY_RUN, 'true');
const enabled = new Set([
  'DIRECT_UPLOAD_ENABLED',
  'CLOUDFLARE_IMAGE_PROCESSING_ENABLED',
  'ALBUM_ACTIVATION_ENABLED',
]);
for (const [key, value] of Object.entries(cfg.vars))
  if (key.endsWith('_ENABLED'))
    assert.equal(value, enabled.has(key) ? 'true' : 'false');
for (const key of enabled) assert.equal(cfg.vars[key], 'true');
assert.equal(cfg.d1_databases.length, 1);
assert.equal(cfg.d1_databases[0].database_id, database);
assert.equal(cfg.d1_databases[0].binding, 'DB');
assert.deepEqual(cfg.r2_buckets, [
  { binding: 'PRIMARY_STORAGE', bucket_name: 'kino-pick-staging-d3e93046' },
]);
assert.equal(cfg.vars.R2_BUCKET_NAME, 'kino-pick-staging-d3e93046');
assert.deepEqual(cfg.images, { binding: 'IMAGES' });
assert.equal(cfg.assets.directory, '.static');
assert.equal(cfg.assets.binding, 'ASSETS');
assert.equal(cfg.assets.run_worker_first, true);
assert.deepEqual(
  [...cfg.secrets.required].sort(),
  [
    'BETTER_AUTH_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ].sort(),
);
const native = JSON.parse(
  await read('.local/album-activation-local-proof.json'),
);
assert.equal(native.status, 'passed_isolated_album_activation');
assert.equal(native.checks, 13);
assert.equal(native.source.activationConfigSha256, sha(configText));
assert.equal(
  native.source.testSha256,
  sha(await readFile(join(worker, 'tests/album-activation.mjs'))),
);
const migration = await readFile(
  join(worker, 'migrations/0057_album_activation_commands.sql'),
);
assert.equal(native.migration.sha256, sha(migration));
assert.equal(native.migration.old56MigrationCount, 56);
const bundle = await readFile(
  join(
    worker,
    '.local/activation-validation-build/staging-upload-validation-worker.js',
  ),
);
assert.equal(native.source.workerBundleSha256, sha(bundle));
const adopted = JSON.parse(await read('.local/staging-0057-apply-proof.json'));
assert.equal(adopted.status, 'passed_staging_0057_apply');
assert.equal(adopted.accountId, account);
assert.equal(adopted.sourceDatabaseId, database);
assert.notEqual(adopted.restoreDatabaseId, database);
assert.equal(adopted.migrationSha256, sha(migration));
assert.equal(adopted.restoreParityPassed, true);
assert.equal(adopted.independentUpgradePassed, true);
assert.equal(adopted.migrationCount, 57);
assert.equal(adopted.foreignKeyViolations, 0);
assert.equal(adopted.albumStillDraft, true);
assert.equal(adopted.activationCommands, 0);
assert.equal(adopted.publicClosedDuringAdoption, true);
assert.equal(
  sha(await readFile(adopted.beforeBackup)),
  adopted.beforeBackupSha256,
);
assert.equal(
  sha(await readFile(adopted.afterBackup)),
  adopted.afterBackupSha256,
);
const readiness = JSON.parse(await read('deployment-readiness.json'));
assert.equal(readiness.real_oauth_and_owner_bootstrap_verified, true);
assert.equal(readiness.private_direct_upload_verified, false);
const ci = JSON.parse(await read('.local/album-activation-ci.json'));
assert.equal(ci.repository, 'kinostudio/kino-pick');
assert.equal(ci.event, 'push');
assert.equal(ci.head_branch, 'main');
assert.equal(ci.path, '.github/workflows/ci.yml');
assert.equal(ci.status, 'completed');
assert.equal(ci.conclusion, 'success');
assert.match(ci.head_sha, /^[a-f0-9]{40}$/);
assert.equal(ci.head_sha, adopted.sourceSha);
const critical = [
  'apps/worker/src',
  'apps/web',
  'packages',
  'apps/worker/migrations',
  'package.json',
  'pnpm-lock.yaml',
  'apps/worker/tools/staging-upload-validation-worker.ts',
  'apps/worker/wrangler.activation-validation.jsonc',
  'apps/worker/tests/album-activation.mjs',
  'apps/worker/tests/activate-album-fixture.mjs',
];
const git = (args, env) =>
  execFileSync('git', ['-c', 'safe.directory=' + root, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
const oldHead = git(['rev-parse', 'HEAD']);
const oldIndex = await readFile(join(root, '.git/index'));
const temp = await mkdtemp(join(tmpdir(), 'kino-activation-preflight-'));
const index = join(temp, 'index');
try {
  const env = { ...process.env, GIT_INDEX_FILE: index };
  git(['read-tree', ci.head_sha], env);
  git(['add', '--', ...critical], env);
  git(['diff', '--cached', '--quiet', ci.head_sha, '--', ...critical], env);
} finally {
  for (const p of [index, index + '.lock'])
    try {
      await unlink(p);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  await rmdir(temp);
}
assert.equal(git(['rev-parse', 'HEAD']), oldHead);
assert.deepEqual(await readFile(join(root, '.git/index')), oldIndex);
const result = {
  status: 'passed_owner_activation_staging_preflight',
  accountId: account,
  worker: cfg.name,
  sourceSha: ci.head_sha,
  ciRun: ci.id,
  configSha256: sha(configText),
  bundleSha256: sha(bundle),
  migrationSha256: sha(migration),
  restoreDatabaseId: adopted.restoreDatabaseId,
  guestEnabled: false,
  publicEntryDefault: 'closed',
  productDeploymentAuthorized: false,
  checkedAt: new Date().toISOString(),
};
await writeFile(
  join(worker, '.local/staging-activation-validation-preflight.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
