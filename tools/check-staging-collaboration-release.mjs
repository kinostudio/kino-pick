import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
let tsParser;

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const ACCOUNT_ID = 'd3e930465c0df7e89b35de3ca65ea36a';
const DATABASE_ID = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const DATABASE_NAME = 'kino-pick-staging-d3e93046';
const BUCKET_NAME = 'kino-pick-staging-d3e93046';
const WORKER_NAME = 'kino-pic-staging';
const PUBLIC_ENTRY = 'kino-pic-staging.kino-pick-aaron2026.workers.dev';
const PROFILE_PATH = 'apps/worker/wrangler.collaboration-validation.jsonc';
const MANIFEST_PATH = 'docs/releases/collaboration-0059-restore.json';
const REQUIRED_SECRETS = [
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
];
const MIGRATION_COMMANDS = [
  'fresh-post-activation57-backup',
  'create-new-independent-B-drill',
  'restore-fresh57-to-new-empty-drill',
  'readback-independent-restored57',
  'upgrade-independent-drill59',
  'readback-independent-upgraded59',
];
const COLLABORATION_CHECKS = [
  'full-59-migration-native-d1',
  'missing-guest-flag-closed',
  'missing-collaboration-flag-closed',
  'wrong-origin-closed',
  'wrong-account-closed',
  'wrong-bucket-closed',
  'production-closed',
  'guest-tag-disabled-closed',
  'wrong-origin-host-denied',
  'owner-auth-and-scoped-collaboration-capabilities',
  'foreign-project-denied',
  'foreign-album-selection-policy-denied',
  'adjacent-feature-route-denied',
  'owner-cannot-issue-foreign-album-invite',
  'multi-album-invite-rejected-without-write-or-secret-leak',
  'invite-and-upload-recovery-scoped-without-secret-replay',
  'all-supported-rights-issued-only-for-fixed-album',
  'secure-guest-cookie-and-no-bearer-response-leak',
  'internal-worker-exchange-denied-without-secret-leak',
  'selected-guest-owner-and-recommendation-capabilities-active',
  'guest-auth-fixed-album-gallery-and-private-asset',
  'foreign-album-and-real-foreign-asset-denied',
  'foreign-invite-denied-without-session-or-secret-leak',
  'logout-revocation-and-foreign-key-check',
];
const ACTIVE_FLAGS = [
  'ALBUM_ACTIVATION_ENABLED',
  'CLOUDFLARE_IMAGE_PROCESSING_ENABLED',
  'DIRECT_UPLOAD_ENABLED',
  'FREEHAND_ANNOTATIONS_ENABLED',
  'GUEST_ANNOTATIONS_ENABLED',
  'GUEST_COMMENTS_ENABLED',
  'GUEST_DOWNLOADS_ENABLED',
  'GUEST_EXCHANGE_ENABLED',
  'GUEST_FEEDBACK_ENABLED',
  'GUEST_HISTORY_ENABLED',
  'GUEST_INVITE_ISSUANCE_ENABLED',
  'GUEST_SELECTION_ENABLED',
  'GUEST_TAGS_ENABLED',
  'GUEST_VERSION_COMPARISON_ENABLED',
  'OWNER_ANNOTATIONS_ENABLED',
  'OWNER_ANNOTATION_AUTHORING_ENABLED',
  'OWNER_ANNOTATION_PROCESSING_ENABLED',
  'OWNER_COMMENTS_ENABLED',
  'OWNER_COMMENT_PROCESSING_ENABLED',
  'OWNER_HISTORY_ENABLED',
  'PHOTOGRAPHER_RECOMMENDATIONS_ENABLED',
  'PHOTO_VERSIONS_ENABLED',
  'PHOTO_VERSION_UPLOADS_ENABLED',
  'PROJECT_VERSIONING_CONFIGURATION_ENABLED',
];
const EXPECTED_VARS = {
  APP_ENV: 'staging',
  APP_URL: 'https://' + PUBLIC_ENTRY,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_SELECTION_ENABLED: 'true',
  ALBUM_ACTIVATION_ENABLED: 'true',
  GUEST_FEEDBACK_ENABLED: 'true',
  GUEST_TAGS_ENABLED: 'true',
  GUEST_HISTORY_ENABLED: 'true',
  HUMAN_VIEW_TRACKING_ENABLED: 'false',
  VERSION_APPROVALS_ENABLED: 'false',
  GUEST_DOWNLOADS_ENABLED: 'true',
  GUEST_VERSION_COMPARISON_ENABLED: 'true',
  GUEST_COMMENTS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'true',
  PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
  OWNER_COMMENTS_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  OWNER_ANNOTATION_PROCESSING_ENABLED: 'true',
  MATCHING_RULES_ENABLED: 'false',
  RESOLVED_BATCH_UPLOAD_ENABLED: 'false',
  ASSISTED_CANDIDATE_CATALOG_ENABLED: 'false',
  INDEXED_VERSION_MATCHING_ENABLED: 'false',
  MATCHING_FILENAME_INDEX_ENABLED: 'false',
  OWNER_HISTORY_ENABLED: 'true',
  OWNER_COMMENT_PROCESSING_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  PHOTO_VERSION_UPLOADS_ENABLED: 'true',
  PHOTO_VERSION_MATCHING_ENABLED: 'false',
  PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
  GUEST_SHARED_SELECTION_ENABLED: 'false',
  R2_BUCKET_NAME: BUCKET_NAME,
  STAGING_GUEST_VALIDATION: 'true',
  STAGING_COLLABORATION_VALIDATION: 'true',
  CLOUDFLARE_IMAGE_PROCESSING_ENABLED: 'true',
};
const PROFILE_KEYS = [
  '$schema',
  'name',
  'account_id',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'routes',
  'vars',
  'd1_databases',
  'secrets',
  'assets',
  'images',
  'r2_buckets',
].sort();

function fail(code) {
  throw new Error(code);
}
function requireThat(condition, code) {
  if (!condition) fail(code);
}
function requireEqual(actual, expected, code) {
  if (!isDeepStrictEqual(actual, expected)) fail(code);
}
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function parseJsonc(text, label) {
  tsParser ??= (await import('typescript')).default;
  const parsed = tsParser.parseConfigFileTextToJson(label, text);
  if (parsed.error)
    fail('INVALID_' + label.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_'));
  return parsed.config;
}

export function validateProfile(profile) {
  requireEqual(Object.keys(profile).sort(), PROFILE_KEYS, 'PROFILE_KEYS');
  requireThat(profile.name === WORKER_NAME, 'PROFILE_WORKER');
  requireThat(profile.account_id === ACCOUNT_ID, 'PROFILE_ACCOUNT');
  requireThat(
    profile.main === 'tools/staging-collaboration-validation-worker.ts',
    'PROFILE_ENTRYPOINT',
  );
  requireThat(
    profile.compatibility_date === '2026-10-23',
    'PROFILE_COMPATIBILITY_DATE',
  );
  requireEqual(
    profile.compatibility_flags,
    ['nodejs_compat'],
    'PROFILE_COMPATIBILITY_FLAGS',
  );
  requireThat(profile.workers_dev === false, 'PROFILE_WORKERS_DEV');
  requireThat(profile.preview_urls === false, 'PROFILE_PREVIEW_URLS');
  requireEqual(profile.routes, [], 'PROFILE_ROUTES');
  requireThat(profile.triggers === undefined, 'PROFILE_TRIGGERS');
  requireEqual(profile.vars, EXPECTED_VARS, 'PROFILE_VARS');
  requireEqual(
    profile.d1_databases,
    [
      {
        binding: 'DB',
        database_name: DATABASE_NAME,
        database_id: DATABASE_ID,
        migrations_dir: 'migrations',
      },
    ],
    'PROFILE_D1',
  );
  requireEqual(
    profile.r2_buckets,
    [
      {
        binding: 'PRIMARY_STORAGE',
        bucket_name: BUCKET_NAME,
      },
    ],
    'PROFILE_R2',
  );
  requireEqual(profile.images, { binding: 'IMAGES' }, 'PROFILE_IMAGES');
  requireEqual(
    profile.assets,
    {
      directory: '.static',
      binding: 'ASSETS',
      run_worker_first: true,
    },
    'PROFILE_ASSETS',
  );
  requireEqual(
    [...profile.secrets.required].sort(),
    [...REQUIRED_SECRETS].sort(),
    'PROFILE_SECRET_NAMES',
  );
  const enabled = Object.keys(profile.vars)
    .filter((key) => key.endsWith('_ENABLED') && profile.vars[key] === 'true')
    .sort();
  requireEqual(enabled, ACTIVE_FLAGS, 'PROFILE_ACTIVE_FLAGS');
}

export function validateRestoreManifest(manifest, migrationHashes) {
  requireThat(manifest.schemaVersion === 1, 'RESTORE_MANIFEST_SCHEMA');
  requireThat(
    manifest.migrationHashEncoding === 'UTF-8; CRLF normalized to LF',
    'RESTORE_MIGRATION_HASH_ENCODING',
  );
  requireThat(
    manifest.status === 'passed_independent_0059_restore_upgrade',
    'RESTORE_MANIFEST_STATUS',
  );
  requireThat(manifest.accountId === ACCOUNT_ID, 'RESTORE_MANIFEST_ACCOUNT');
  requireThat(
    manifest.sourceDatabaseId === DATABASE_ID,
    'RESTORE_MANIFEST_SOURCE_D1',
  );
  requireThat(
    manifest.databaseName === DATABASE_NAME,
    'RESTORE_MANIFEST_DATABASE_NAME',
  );
  requireThat(
    manifest.bucketName === BUCKET_NAME,
    'RESTORE_MANIFEST_BUCKET_NAME',
  );
  requireThat(
    manifest.baselineVersion === '0ff58553-e642-47f5-93dc-cbd2ae36ccd7',
    'RESTORE_MANIFEST_BASELINE',
  );
  requireThat(
    manifest.sourceSchemaVersion === 57 && manifest.targetSchemaVersion === 59,
    'RESTORE_MANIFEST_VERSIONS',
  );
  requireThat(
    manifest.sourceWritesDuringRestore === 0,
    'RESTORE_MANIFEST_SOURCE_WRITES',
  );
  requireThat(manifest.restoreParityPassed === true, 'RESTORE_MANIFEST_PARITY');
  requireThat(
    manifest.independentUpgradePassed === true,
    'RESTORE_MANIFEST_UPGRADE',
  );
  requireThat(
    manifest.foreignKeyViolations === 0,
    'RESTORE_MANIFEST_FOREIGN_KEYS',
  );
  requireThat(
    /^[a-f0-9-]{36}$/.test(manifest.restoreDatabaseId ?? ''),
    'RESTORE_MANIFEST_RESTORE_DATABASE',
  );
  requireThat(
    manifest.restoreDatabaseId !== DATABASE_ID,
    'RESTORE_MANIFEST_SOURCE_REUSE',
  );
  requireEqual(
    manifest.migrationHashes,
    migrationHashes,
    'RESTORE_MANIFEST_MIGRATION_HASHES',
  );
  requireEqual(
    manifest.commands?.map((command) => [command.label, command.exitCode]),
    MIGRATION_COMMANDS.map((label) => [label, 0]),
    'RESTORE_MANIFEST_COMMANDS',
  );
}

export function validateSubdomain(subdomain, enabled) {
  requireThat(
    subdomain &&
      subdomain.enabled === enabled &&
      subdomain.previews_enabled === false,
    enabled ? 'SUBDOMAIN_ENABLE_STATE' : 'SUBDOMAIN_NOT_CLOSED',
  );
}

function validateSettingsBindings(settings, profile, exactProfile) {
  const bindings = settings?.bindings;
  requireThat(Array.isArray(bindings), 'LIVE_BINDINGS_MISSING');
  const byName = new Map();
  for (const binding of bindings) {
    requireThat(
      typeof binding.name === 'string' && !byName.has(binding.name),
      'LIVE_BINDING_DUPLICATE',
    );
    byName.set(binding.name, binding);
  }
  const variables = exactProfile
    ? profile.vars
    : {
        STORAGE_AUTODELETE_ENABLED: 'false',
        STORAGE_RETENTION_DRY_RUN: 'true',
        MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
      };
  for (const [name, value] of Object.entries(variables)) {
    const binding = byName.get(name);
    requireThat(
      binding?.type === 'plain_text' && binding.text === value,
      'LIVE_VAR_' + name,
    );
  }
  requireThat(
    byName.get('DB')?.type === 'd1' && byName.get('DB').id === DATABASE_ID,
    'LIVE_D1_BINDING',
  );
  requireThat(
    byName.get('PRIMARY_STORAGE')?.type === 'r2_bucket' &&
      byName.get('PRIMARY_STORAGE').bucket_name === BUCKET_NAME,
    'LIVE_R2_BINDING',
  );
  if (exactProfile) {
    requireThat(byName.get('ASSETS')?.type === 'assets', 'LIVE_ASSETS_BINDING');
    requireThat(byName.get('IMAGES')?.type === 'images', 'LIVE_IMAGES_BINDING');
    const allowed = new Set([
      ...Object.keys(profile.vars),
      'DB',
      'PRIMARY_STORAGE',
      'ASSETS',
      'IMAGES',
      ...REQUIRED_SECRETS,
    ]);
    for (const binding of bindings) {
      requireThat(allowed.has(binding.name), 'LIVE_EXTRA_BINDING');
      if (REQUIRED_SECRETS.includes(binding.name)) {
        requireThat(
          binding.type === 'secret_text' || binding.type === 'secret',
          'LIVE_SECRET_BINDING_TYPE',
        );
      }
    }
  }
}

function validateWorkerRoutes(scriptList) {
  requireThat(Array.isArray(scriptList), 'LIVE_SCRIPT_LIST');
  const matches = scriptList.filter((script) => script.id === WORKER_NAME);
  requireThat(matches.length === 1, 'LIVE_SCRIPT_NOT_UNIQUE');
  requireEqual(matches[0].routes ?? [], [], 'LIVE_WORKER_ROUTES');
}

function validatePrivateR2(managed, custom) {
  requireThat(managed && managed.enabled === false, 'LIVE_R2_R2DEV_PUBLIC');
  requireThat(Array.isArray(custom?.domains), 'LIVE_R2_CUSTOM_DOMAINS');
  requireThat(
    custom.domains.every((domain) => domain.enabled === false),
    'LIVE_R2_CUSTOM_DOMAIN_PUBLIC',
  );
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    }).trim();
  } catch {
    fail('GIT_VALIDATION_FAILED');
  }
}

function validateReleaseIdentity() {
  const sourceSha = process.env.RELEASE_SOURCE_SHA ?? '';
  requireThat(/^[a-f0-9]{40}$/.test(sourceSha), 'SOURCE_SHA_FORMAT');
  requireThat(
    process.env.GITHUB_REPOSITORY === 'kinostudio/kino-pick',
    'GITHUB_REPOSITORY',
  );
  requireThat(
    process.env.GITHUB_EVENT_NAME === 'workflow_dispatch',
    'WORKFLOW_EVENT',
  );
  requireThat(git(['rev-parse', 'HEAD']) === sourceSha, 'CHECKOUT_SHA');
  requireThat(
    git(['status', '--porcelain', '--untracked-files=no']) === '',
    'TRACKED_WORKTREE_DIRTY',
  );
  return sourceSha;
}

export async function validateLocalEvidence() {
  const profileBytes = await readFile(join(ROOT, PROFILE_PATH));
  const profile = await parseJsonc(profileBytes.toString('utf8'), PROFILE_PATH);
  validateProfile(profile);
  const worker = join(ROOT, 'apps/worker');
  const migrationNames = (await readdir(join(worker, 'migrations')))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  requireThat(migrationNames.length === 59, 'MIGRATION_COUNT');
  const migrationHashes = {};
  for (const name of migrationNames) {
    migrationHashes[name] = sha256(
      (await readFile(join(worker, 'migrations', name), 'utf8')).replaceAll(
        '\r\n',
        '\n',
      ),
    );
  }
  const manifestBytes = await readFile(join(ROOT, MANIFEST_PATH));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  validateRestoreManifest(manifest, {
    '0058_annotation_freehand_geometry_v1.sql':
      migrationHashes['0058_annotation_freehand_geometry_v1.sql'],
    '0059_photographer_recommendations.sql':
      migrationHashes['0059_photographer_recommendations.sql'],
  });

  const photographerPath = join(
    worker,
    '.local/photographer-routes-focused-proof.json',
  );
  const photographerBytes = await readFile(photographerPath);
  const photographer = JSON.parse(photographerBytes.toString('utf8'));
  requireThat(
    photographer.status === 'passed_isolated_photographer_routes',
    'PHOTOGRAPHER_PROOF_STATUS',
  );
  requireThat(
    photographer.groups === 13 && photographer.migrations === 59,
    'PHOTOGRAPHER_PROOF_COUNTS',
  );
  requireThat(
    photographer.realOAuth === false && photographer.remoteProvider === false,
    'PHOTOGRAPHER_PROOF_SCOPE',
  );
  requireThat(
    photographer.migration59Sha256 ===
      migrationHashes['0059_photographer_recommendations.sql'],
    'PHOTOGRAPHER_PROOF_MIGRATION_HASH',
  );
  const photographerRunner = await readFile(
    join(worker, 'tests/photographer-routes-focused.mjs'),
  );
  requireThat(
    photographer.runnerSha256 === sha256(photographerRunner),
    'PHOTOGRAPHER_PROOF_RUNNER_HASH',
  );
  const productBundle = await readFile(join(worker, '.build/index.js'));
  requireThat(
    photographer.workerBundleSha256 === sha256(productBundle),
    'PHOTOGRAPHER_PROOF_BUNDLE_HASH',
  );

  const collaborationPath = join(
    worker,
    '.local/staging-collaboration-validation-local-proof.json',
  );
  const collaborationBytes = await readFile(collaborationPath);
  const collaboration = JSON.parse(collaborationBytes.toString('utf8'));
  requireThat(
    collaboration.status === 'passed_local_staging_collaboration_validation',
    'COLLABORATION_PROOF_STATUS',
  );
  requireThat(
    collaboration.runtime ===
      'Miniflare native workerd with ephemeral D1 and R2',
    'COLLABORATION_PROOF_RUNTIME',
  );
  requireThat(
    collaboration.migrationCount === 59,
    'COLLABORATION_PROOF_MIGRATIONS',
  );
  requireEqual(
    collaboration.checks,
    COLLABORATION_CHECKS,
    'COLLABORATION_PROOF_CHECKS',
  );
  requireThat(
    collaboration.realOAuth === false,
    'COLLABORATION_PROOF_OAUTH_SCOPE',
  );
  requireThat(
    collaboration.remoteCloudflare === false,
    'COLLABORATION_PROOF_REMOTE_SCOPE',
  );
  requireThat(
    collaboration.hostedDeployment === false &&
      collaboration.browserOrPublicTLS === false,
    'COLLABORATION_PROOF_HOSTED_SCOPE',
  );
  const activeFlags = Object.keys(profile.vars)
    .filter((key) => key.endsWith('_ENABLED') && profile.vars[key] === 'true')
    .sort();
  requireEqual(
    collaboration.activeProfileFlags,
    activeFlags,
    'COLLABORATION_PROOF_ACTIVE_FLAGS',
  );
  const sourceFiles = {
    wrapper: 'tools/staging-collaboration-validation-worker.ts',
    boundary: 'src/staging-collaboration-boundary.ts',
    guestPermissions: 'src/staging-guest-permissions.ts',
    config: 'src/config.ts',
    inviteIssuance: 'src/invite-issuance.ts',
    guestExchange: 'src/guest-exchange.ts',
    index: 'src/index.ts',
  };
  for (const [key, relative] of Object.entries(sourceFiles)) {
    requireThat(
      collaboration.sourceHashes?.[key] ===
        sha256(await readFile(join(worker, relative))),
      'COLLABORATION_PROOF_HASH_' + key,
    );
  }
  requireThat(
    collaboration.sourceHashes?.profile === sha256(profileBytes),
    'COLLABORATION_PROOF_HASH_PROFILE',
  );
  const collaborationTest = await readFile(
    join(worker, 'tools/test-staging-collaboration-validation.mjs'),
  );
  requireThat(
    collaboration.sourceHashes?.nativeTest === sha256(collaborationTest),
    'COLLABORATION_PROOF_HASH_TEST',
  );
  const profileBundle = await readFile(
    join(
      worker,
      '.local/collaboration-validation-build/staging-collaboration-validation-worker.js',
    ),
  );
  requireThat(
    collaboration.sourceHashes?.bundle === sha256(profileBundle),
    'COLLABORATION_PROOF_HASH_BUNDLE',
  );

  const priorBytes = await readFile(
    join(ROOT, 'docs/releases/collaboration-prior-deployment.json'),
  );
  const priorDeployment = JSON.parse(priorBytes.toString('utf8'));
  validatePriorDeployment(priorDeployment, migrationHashes);
  return {
    profile,
    manifest,
    priorDeployment,
    priorManifestSha256: sha256(priorBytes),
    manifestSha256: sha256(manifestBytes),
    migrationNames,
    migrationHashes,
    photographer: {
      status: photographer.status,
      groups: photographer.groups,
      migrations: photographer.migrations,
      proofSha256: sha256(photographerBytes),
      runnerSha256: photographer.runnerSha256,
      workerBundleSha256: photographer.workerBundleSha256,
      migration59Sha256: photographer.migration59Sha256,
    },
    collaboration: {
      status: collaboration.status,
      checks: collaboration.checks.length,
      migrationCount: collaboration.migrationCount,
      proofSha256: sha256(collaborationBytes),
      testSha256: collaboration.sourceHashes.nativeTest,
      bundleSha256: collaboration.sourceHashes.bundle,
      profileSha256: collaboration.sourceHashes.profile,
    },
  };
}

function validatePriorDeployment(prior, migrationHashes) {
  requireThat(
    prior.schemaVersion === 1 &&
      prior.status === 'verified_prior_scoped_b_deployment',
    'PRIOR_DEPLOYMENT_MANIFEST',
  );
  requireThat(
    Number.isSafeInteger(prior.workflowRunId) && prior.workflowRunId > 0,
    'PRIOR_DEPLOYMENT_RUN_ID',
  );
  const receipt = prior.receipt;
  requireThat(
    sha256(JSON.stringify(receipt, null, 2) + '\n') === prior.receiptSha256,
    'PRIOR_RECEIPT_DIGEST',
  );
  requireThat(
    receipt?.schemaVersion === 1 &&
      receipt.repository === 'kinostudio/kino-pick' &&
      receipt.status === 'passed_scoped_b_collaboration_deployment_pre_enable',
    'PRIOR_RECEIPT_IDENTITY',
  );
  requireThat(
    /^[a-f0-9]{40}$/.test(receipt.sourceSha ?? ''),
    'PRIOR_RECEIPT_SOURCE',
  );
  requireThat(
    receipt.ci?.status === 'completed' &&
      receipt.ci.conclusion === 'success' &&
      receipt.ci.headSha === receipt.sourceSha,
    'PRIOR_RECEIPT_CI',
  );
  const c = receipt.cloudflare;
  requireThat(
    c?.accountId === ACCOUNT_ID &&
      c.workerName === WORKER_NAME &&
      c.databaseId === DATABASE_ID &&
      c.bucketName === BUCKET_NAME &&
      c.migrationCount === 59 &&
      c.foreignKeyViolations === 0,
    'PRIOR_RECEIPT_RESOURCES',
  );
  requireThat(
    /^[a-f0-9-]{36}$/.test(c.versionId ?? '') &&
      c.privateR2 === true &&
      c.crons === 0 &&
      c.routes === 0 &&
      c.storageAutodeleteEnabled === false &&
      c.storageRetentionDryRun === true &&
      c.multiAccountStorageEnabled === false,
    'PRIOR_RECEIPT_SAFETY',
  );
  requireEqual(
    receipt.restore?.migrationHashes,
    migrationHashes,
    'PRIOR_RECEIPT_MIGRATION_HASHES',
  );
}

async function verifyPriorDeploymentRun(prior) {
  const run = await githubJson(
    '/repos/kinostudio/kino-pick/actions/runs/' + prior.workflowRunId,
  );
  requireThat(
    run.status === 'completed' &&
      run.conclusion === 'success' &&
      run.event === 'workflow_dispatch' &&
      run.head_sha === prior.receipt.sourceSha &&
      run.path === '.github/workflows/deploy-collaboration-validation.yml',
    'PRIOR_DEPLOYMENT_RUN_NOT_VERIFIED',
  );
}

async function githubJson(path) {
  const token = process.env.GITHUB_TOKEN;
  requireThat(
    typeof token === 'string' && token.length > 0,
    'GITHUB_TOKEN_MISSING',
  );
  try {
    const response = await fetch('https://api.github.com' + path, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'kino-pic-staging-release-gate',
      },
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) fail('GITHUB_API_HTTP_' + response.status);
    return body;
  } catch (error) {
    if (/^GITHUB_API_HTTP_/.test(error?.message ?? '')) throw error;
    fail('GITHUB_API_UNAVAILABLE');
  }
}

async function requireExactCiRun(sourceSha) {
  const repository = process.env.GITHUB_REPOSITORY;
  const workflow = await githubJson(
    '/repos/' + repository + '/actions/workflows/ci.yml',
  );
  requireThat(
    workflow.path === '.github/workflows/ci.yml' && workflow.name === 'checks',
    'CI_WORKFLOW_IDENTITY',
  );
  requireThat(Number.isInteger(workflow.id), 'CI_WORKFLOW_ID');
  const runs = [];
  let totalCount = 0;
  for (let page = 1; page <= 10; page++) {
    const result = await githubJson(
      '/repos/' +
        repository +
        '/actions/workflows/' +
        workflow.id +
        '/runs?head_sha=' +
        sourceSha +
        '&per_page=100&page=' +
        page,
    );
    requireThat(Array.isArray(result.workflow_runs), 'CI_RUNS_RESPONSE');
    totalCount = result.total_count;
    runs.push(
      ...result.workflow_runs.filter((run) => run.head_sha === sourceSha),
    );
    if (runs.length >= totalCount || result.workflow_runs.length < 100) break;
  }
  requireThat(runs.length > 0, 'CI_RUN_NOT_FOUND');
  runs.sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  );
  const latest = runs[0];
  requireThat(latest.repository?.full_name === repository, 'CI_RUN_REPOSITORY');
  requireThat(latest.head_sha === sourceSha, 'CI_RUN_SHA');
  requireThat(
    latest.status === 'completed' && latest.conclusion === 'success',
    'CI_RUN_NOT_SUCCESSFUL',
  );
  return {
    workflowPath: workflow.path,
    workflowName: workflow.name,
    workflowId: workflow.id,
    runId: latest.id,
    runNumber: latest.run_number,
    runUrl: latest.html_url,
    event: latest.event,
    status: latest.status,
    conclusion: latest.conclusion,
    headSha: latest.head_sha,
  };
}

function cloudflareHeaders() {
  requireThat(
    process.env.CLOUDFLARE_ACCOUNT_ID === ACCOUNT_ID,
    'CLOUDFLARE_ACCOUNT_TARGET',
  );
  const token = process.env.CLOUDFLARE_API_TOKEN;
  requireThat(
    typeof token === 'string' && token.length > 0,
    'CLOUDFLARE_TOKEN_MISSING',
  );
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function cloudflareEnvelope(path, init = {}) {
  try {
    const response = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT_ID + path,
      {
        ...init,
        headers: { ...cloudflareHeaders(), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(25000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true)
      fail('CLOUDFLARE_API_HTTP_' + response.status);
    return body;
  } catch (error) {
    if (/^CLOUDFLARE_API_HTTP_/.test(error?.message ?? '')) throw error;
    if (/^CLOUDFLARE_/.test(error?.message ?? '')) throw error;
    fail('CLOUDFLARE_API_UNAVAILABLE');
  }
}

async function cloudflareResult(path, init = {}) {
  return (await cloudflareEnvelope(path, init)).result;
}

async function listWorkerScripts() {
  const scripts = [];
  for (let page = 1; page <= 20; page++) {
    const envelope = await cloudflareEnvelope(
      '/workers/scripts?per_page=100&page=' + page,
    );
    requireThat(Array.isArray(envelope.result), 'LIVE_SCRIPT_LIST_RESPONSE');
    scripts.push(...envelope.result);
    const totalPages = envelope.result_info?.total_pages;
    if (Number.isInteger(totalPages)) {
      if (page >= totalPages) break;
    } else if (envelope.result.length < 100) {
      break;
    }
    if (page === 20) fail('LIVE_SCRIPT_LIST_TOO_LARGE');
  }
  return scripts;
}

async function queryD1(sql) {
  const result = await cloudflareResult(
    '/d1/database/' + DATABASE_ID + '/query',
    {
      method: 'POST',
      body: JSON.stringify({ sql }),
    },
  );
  requireThat(
    Array.isArray(result) && result.length === 1,
    'LIVE_D1_QUERY_RESULT',
  );
  const query = result[0];
  requireThat(
    query.success === true && Array.isArray(query.results),
    'LIVE_D1_QUERY_FAILED',
  );
  requireThat(
    query.meta?.changed_db !== true &&
      (query.meta?.changes ?? 0) === 0 &&
      (query.meta?.rows_written ?? 0) === 0,
    'LIVE_D1_QUERY_NOT_READONLY',
  );
  return query.results;
}

async function readDeployment() {
  const result = await cloudflareResult(
    '/workers/scripts/' + WORKER_NAME + '/deployments',
  );
  requireThat(
    Array.isArray(result?.deployments) && result.deployments.length > 0,
    'LIVE_DEPLOYMENT_MISSING',
  );
  return [...result.deployments].sort(
    (left, right) => Date.parse(right.created_on) - Date.parse(left.created_on),
  )[0];
}

function assertSingleVersion(deployment, expectedVersion, expectedMessage) {
  requireThat(
    /^[a-f0-9-]{36}$/.test(deployment?.id ?? ''),
    'LIVE_DEPLOYMENT_ID',
  );
  requireThat(/^[a-f0-9-]{36}$/.test(expectedVersion ?? ''), 'LIVE_VERSION_ID');
  requireEqual(
    deployment.versions?.map((version) => [
      version.version_id,
      version.percentage,
    ]),
    [[expectedVersion, 100]],
    'LIVE_DEPLOYMENT_TRAFFIC',
  );
  requireThat(
    deployment.annotations?.['workers/message'] === expectedMessage,
    'LIVE_DEPLOYMENT_MESSAGE',
  );
}

async function readLiveState(phase, evidence, sourceSha) {
  const profile = evidence.profile;
  const [
    settings,
    subdomain,
    secretResult,
    scheduleResult,
    managed,
    custom,
    scripts,
  ] = await Promise.all([
    cloudflareResult('/workers/scripts/' + WORKER_NAME + '/settings'),
    cloudflareResult('/workers/scripts/' + WORKER_NAME + '/subdomain'),
    cloudflareResult('/workers/scripts/' + WORKER_NAME + '/secrets'),
    cloudflareResult('/workers/scripts/' + WORKER_NAME + '/schedules'),
    cloudflareResult('/r2/buckets/' + BUCKET_NAME + '/domains/managed'),
    cloudflareResult('/r2/buckets/' + BUCKET_NAME + '/domains/custom'),
    listWorkerScripts(),
  ]);

  validateSubdomain(subdomain, false);
  validateSettingsBindings(settings, profile, true);
  validateWorkerRoutes(scripts);
  requireEqual(scheduleResult?.schedules ?? null, [], 'LIVE_CRON_SCHEDULES');
  validatePrivateR2(managed, custom);
  requireThat(Array.isArray(secretResult), 'LIVE_SECRET_LIST');
  const secretNames = secretResult.map((secret) => secret.name).sort();
  requireEqual(secretNames, [...REQUIRED_SECRETS].sort(), 'LIVE_SECRET_NAMES');

  const migrationRows = await queryD1(
    'SELECT id, name FROM d1_migrations ORDER BY id',
  );
  requireThat(migrationRows.length === 59, 'LIVE_D1_MIGRATION_COUNT');
  requireEqual(
    migrationRows.map((row) => row.name),
    evidence.migrationNames,
    'LIVE_D1_MIGRATION_LEDGER',
  );
  const foreignKeyRows = await queryD1(
    'SELECT * FROM pragma_foreign_key_check',
  );
  requireThat(foreignKeyRows.length === 0, 'LIVE_D1_FOREIGN_KEYS');
  const schemaRows = await queryD1(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('album_photographer_recommendation_policy','photographer_photo_metadata','photographer_recommendation_commands','photographer_recommendation_results') ORDER BY name",
  );
  requireEqual(
    schemaRows.map((row) => row.name),
    [
      'album_photographer_recommendation_policy',
      'photographer_photo_metadata',
      'photographer_recommendation_commands',

      'photographer_recommendation_results',
    ],
    'LIVE_RECOMMENDATION_SCHEMA',
  );

  const deployment = await readDeployment();
  let versionId;
  let message;
  if (phase === 'predeploy') {
    requireThat(
      deployment.versions?.length === 1 &&
        deployment.versions[0].percentage === 100,
      'BASELINE_DEPLOYMENT_TRAFFIC',
    );
    versionId = deployment.versions[0].version_id;
    requireThat(
      versionId === evidence.priorDeployment.receipt.cloudflare.versionId,
      'BASELINE_DEPLOYMENT_VERSION',
    );
    const previousMessage =
      'Kino Pic collaboration validation source ' +
      evidence.priorDeployment.receipt.sourceSha;
    requireThat(
      settings.annotations?.['workers/message'] === previousMessage,
      'BASELINE_VERSION_MESSAGE',
    );
    assertSingleVersion(deployment, versionId, previousMessage);
  } else {
    message = 'Kino Pic collaboration validation source ' + sourceSha;
    requireThat(
      settings.annotations?.['workers/message'] === message,
      'LIVE_VERSION_MESSAGE',
    );
    versionId = deployment.versions?.[0]?.version_id;
    assertSingleVersion(deployment, versionId, message);
  }

  return {
    accountId: ACCOUNT_ID,
    workerName: WORKER_NAME,
    databaseId: DATABASE_ID,
    bucketName: BUCKET_NAME,
    migrationCount: migrationRows.length,
    foreignKeyViolations: foreignKeyRows.length,
    recommendationSchema: true,
    secretNames,
    privateR2: true,
    r2DevEnabled: managed.enabled,
    enabledCustomDomains: custom.domains.filter((domain) => domain.enabled)
      .length,
    routes: 0,
    crons: 0,
    publicEntry: { enabled: false, previewsEnabled: false },
    storageAutodeleteEnabled: false,
    storageRetentionDryRun: true,
    multiAccountStorageEnabled: false,
    deploymentId: deployment.id,
    versionId,
    deploymentMessage:
      message ?? deployment.annotations?.['workers/message'] ?? null,
  };
}

async function validateEvidenceAndRemote(sourceSha, phase) {
  const evidence = await validateLocalEvidence();
  const ci = await requireExactCiRun(sourceSha);
  await verifyPriorDeploymentRun(evidence.priorDeployment);
  const cloudflare = await readLiveState(phase, evidence, sourceSha);
  return { evidence, ci, cloudflare };
}

async function writeReceipt(path, sourceSha, result) {
  const receipt = {
    schemaVersion: 1,
    status: 'passed_scoped_b_collaboration_deployment_pre_enable',
    repository: 'kinostudio/kino-pick',
    sourceSha,
    createdAt: new Date().toISOString(),
    ci: result.ci,
    priorDeployment: {
      sourceSha: result.evidence.priorDeployment.receipt.sourceSha,
      versionId: result.evidence.priorDeployment.receipt.cloudflare.versionId,
      workflowRunId: result.evidence.priorDeployment.workflowRunId,
      manifestSha256: result.evidence.priorManifestSha256,
    },
    restore: {
      manifestSha256: result.evidence.manifestSha256,
      sourceSchemaVersion: 57,
      targetSchemaVersion: 59,
      sourceWritesDuringRestore: 0,
      restoreDatabaseId: result.evidence.manifest.restoreDatabaseId,
      restoreParityPassed: true,
      independentUpgradePassed: true,
      foreignKeyViolations: 0,
      migrationHashes: result.evidence.migrationHashes,
    },
    nativeProofs: {
      photographer: result.evidence.photographer,
      scopedCollaboration: result.evidence.collaboration,
    },
    cloudflare: result.cloudflare,
    contents: 'Non-secret validation receipt; contains no SQL or backup data.',
  };
  const receiptPath = resolve(ROOT, path);
  requireThat(
    receiptPath.startsWith(ROOT + '\\') || receiptPath.startsWith(ROOT + '/'),
    'RECEIPT_PATH',
  );
  await mkdir(resolve(ROOT, '.local'), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'w',
  });
}

async function selfTest() {
  const profile = await parseJsonc(
    await readFile(join(ROOT, PROFILE_PATH), 'utf8'),
    PROFILE_PATH,
  );
  validateProfile(profile);
  const evidence = await validateLocalEvidence();
  assert.equal(evidence.migrationNames.length, 59);
  assert.equal(evidence.collaboration.checks, 24);
  assert.equal(evidence.photographer.groups, 13);
  assert.doesNotThrow(() =>
    validateSubdomain({ enabled: false, previews_enabled: false }, false),
  );
  assert.throws(
    () => validateSubdomain({ enabled: true, previews_enabled: false }, false),
    /SUBDOMAIN_NOT_CLOSED/,
  );
  const unsafe = structuredClone(profile);
  unsafe.vars.STORAGE_AUTODELETE_ENABLED = 'true';
  assert.throws(() => validateProfile(unsafe), /PROFILE_VARS/);
  const previewEnabled = structuredClone(profile);
  previewEnabled.preview_urls = true;
  assert.throws(() => validateProfile(previewEnabled), /PROFILE_PREVIEW_URLS/);
  console.log('passed scoped collaboration release checker self-test');
}

export async function runReleaseCheck(phase, options = {}) {
  requireThat(phase === 'predeploy' || phase === 'postdeploy', 'RELEASE_PHASE');
  const sourceSha = validateReleaseIdentity();
  const result = await validateEvidenceAndRemote(sourceSha, phase);
  if (phase === 'postdeploy' && options.receiptPath) {
    await writeReceipt(options.receiptPath, sourceSha, result);
  }
  const summary = {
    status:
      phase === 'predeploy'
        ? 'passed_scoped_b_release_preflight'
        : 'passed_scoped_b_postdeploy_verification',
    sourceSha,
    ciRunId: result.ci.runId,
    latestVersionId: result.cloudflare.versionId,
    deploymentId: result.cloudflare.deploymentId,
    migrationCount: result.cloudflare.migrationCount,
    foreignKeyViolations: result.cloudflare.foreignKeyViolations,
    publicEntryEnabled: false,
  };
  console.log(JSON.stringify(summary));
  return { ...result, sourceSha, summary };
}

export { validateReleaseIdentity };

async function main() {
  const argument = process.argv[2];
  if (argument === '--validate-input') {
    const sourceSha = validateReleaseIdentity();
    console.log(JSON.stringify({ status: 'passed_source_pin', sourceSha }));
    return;
  }
  if (argument === '--self-test') {
    await selfTest();
    return;
  }
  if (argument === '--predeploy') {
    await runReleaseCheck('predeploy');
    return;
  }
  if (argument === '--postdeploy') {
    await runReleaseCheck('postdeploy', {
      receiptPath:
        '.local/staging-collaboration-validation-release-receipt.json',
    });
    return;
  }
  fail('USAGE: --validate-input | --self-test | --predeploy | --postdeploy');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const code = /^[A-Z][A-Z0-9_:-]{2,100}$/.test(error?.message ?? '')
      ? error.message
      : 'SCOPED_RELEASE_CHECK_FAILED';
    console.error(
      JSON.stringify({ status: 'failed_scoped_b_release_check', code }),
    );
    process.exitCode = 1;
  });
}
