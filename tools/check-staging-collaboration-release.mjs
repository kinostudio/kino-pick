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
const DELETION_MANIFEST_PATH =
  'docs/releases/manual-album-deletion-0061-restore.json';
const ORACLE_MANIFEST_PATH = 'docs/releases/oracle-storage-0065-restore.json';
const APPROVED_DELIVERY_RESTORE_PATH =
  'docs/releases/approved-deliveries-0066-restore.json';
const ORACLE_ADMISSION_PROOF_PATH =
  'apps/worker/.local/oracle-storage-admission-native-proof.json';
const ORACLE_CAPACITY_BOOTSTRAP_PATH =
  'docs/releases/oracle-storage-capacity-bootstrap.json';
const SECRET_STAGE_BASELINE_PATH =
  'docs/releases/oracle-secret-stage-baseline.json';
const OWNER_WORKSPACE_ID = 'bd927a6d-d5d3-4743-bbae-e4560cdda4c7';
const OWNER_USER_ID = 'c9561837-8400-4262-9cb3-7b989dd9f76d';
const ORACLE_SCHEMA_OBJECTS = [
  ['table', 'client_album_browser_receipts'],
  ['table', 'client_browse_events'],
  ['table', 'guest_download_ip_sidecars'],
  ['table', 'oracle_storage_health'],
  ['table', 'oracle_storage_policy'],
  ['table', 'oracle_storage_policy_commands'],
  ['view', 'client_activity_ready_versions'],
  ['view', 'storage_pending_derivative_capacity'],
];
const APPROVED_DELIVERY_SCHEMA_OBJECTS = [
  ['index', 'approved_delivery_download_unique'],
  ['index', 'approved_delivery_request_unique'],
  ['index', 'approved_delivery_revoke_unique'],
  ['trigger', 'approved_delivery_download_guard'],
  ['trigger', 'approved_delivery_publish_guard'],
  ['trigger', 'approved_delivery_revoke_guard'],
  ['view', 'approved_delivery_live_guests'],
  ['view', 'approved_delivery_sources'],
];
const ORACLE_GUARD_TRIGGERS = [
  'client_album_browser_receipts_insert_guard',
  'client_browse_events_insert_guard',
  'guest_download_ip_sidecars_insert_guard',
  'manual_album_deletion_job_guard',
  'oracle_storage_health_update_guard',
  'oracle_storage_node_identity_guard',
  'oracle_storage_node_insert_guard',
  'oracle_storage_node_quota_guard',
  'oracle_storage_policy_command_guard',
  'processing_review_command_guard',
  'single_active_storage',
  'single_active_storage_update',
  'upload_request_guard',
];
const ORACLE_STAGE_NEW_SECRETS = [
  'ORACLE_STORAGE_ACCESS_KEY_ID',
  'ORACLE_STORAGE_SECRET_ACCESS_KEY',
];
const DELETION_NATIVE_CHECKS = [
  'preview-no-writes',
  'foreign-owner-denied',
  'changed-inventory-denied',
  'all-versions-and-derivatives',
  'r2-fence-after-ledger-failure-recovery',
  'private-assets-denied-during-deletion',
  'exactly-once-quota-and-audit',
  'stale-immutable-put-denied',
  'unrelated-object-and-upload-fence-preserved',
  'project-tombstone-after-album-cleanup',
  'foreign-keys-zero',
];
const DELETION_NATIVE_SOURCES = {
  manualDeletion: 'src/manual-album-deletion.ts',
  r2Storage: 'src/r2-storage.ts',
  projectDeletion: 'src/project-deletion.ts',
  content: 'src/content.ts',
};
const ORACLE_ADMISSION_SOURCES = {
  runner: 'tests/oracle-storage-admission-native.mjs',
  storageAdmission: 'src/storage-admission.ts',
  uploads: 'src/uploads.ts',
  migration65: 'migrations/0065_oracle_storage_admission.sql',
};
const REQUIRED_SECRETS = [
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'ORACLE_STORAGE_ACCESS_KEY_ID',
  'ORACLE_STORAGE_SECRET_ACCESS_KEY',
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
const ORACLE_RESTORE_COMMANDS = [
  'list-B',
  'create-independent-B-drill',
  'verify-empty',
  'restore-independent-B',
  'readback-restored62',
  'upgrade-independent-63-65',
  'readback-upgraded65',
];
const ORACLE_ADOPTION_COMMANDS = [
  'fresh-source-parity-export',
  'adopt-source-63-65',
  'readback-source65',
];
const ORACLE_ADMISSION_CHECKS = [
  'new reservation prefers R2 and exact replay reuses its original session',
  'concurrent last-slot reservations cannot overbook R2; cancellation releases native ledger capacity',
  'unknown node and direct Oracle reservation are rejected while policy is disabled',
  'fresh health admits VM only above its physical free-space floor; missing, stale and direct forged-node writes fail closed',
  'cross-scope and workspace-quota refusals remain enforced when VM capacity is available',
  'native cancellation reclaims R2 capacity for the next upload while a captured VM session remains pinned to VM',
  '30GB VM quota counts original reservations and pending derivative budgets exactly',
];
const COLLABORATION_CHECKS = [
  'full-66-migration-native-d1',
  'missing-guest-flag-closed',
  'missing-collaboration-flag-closed',
  'wrong-origin-closed',
  'wrong-account-closed',
  'wrong-bucket-closed',
  'production-closed',
  'guest-tag-disabled-closed',
  'wrong-origin-host-denied',
  'oracle-policy-platform-only-and-background-activity-routing',
  'owner-auth-and-scoped-collaboration-capabilities',
  'managed-owner-create-read-and-manual-delete-through-profile',
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
  'APPROVED_DELIVERIES_ENABLED',
  'CLIENT_ACTIVITY_ENABLED',
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
  'ORACLE_STORAGE_ENABLED',
  'PHOTOGRAPHER_RECOMMENDATIONS_ENABLED',
  'PHOTO_VERSIONS_ENABLED',
  'PHOTO_VERSION_UPLOADS_ENABLED',
  'PROJECT_VERSIONING_CONFIGURATION_ENABLED',
  'VERSION_APPROVALS_ENABLED',
];
const EXPECTED_VARS = {
  APP_ENV: 'staging',
  APP_URL: 'https://' + PUBLIC_ENTRY,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  CLIENT_ACTIVITY_ENABLED: 'true',
  ORACLE_STORAGE_ENABLED: 'true',
  ORACLE_STORAGE_ENDPOINT: 'https://drive.kinostudio.tw',
  ORACLE_STORAGE_REGION: 'us-east-1',
  ORACLE_STORAGE_BUCKET: 'kino-pick-overflow',
  ORACLE_STORAGE_ADMIN_USER_ID: 'c9561837-8400-4262-9cb3-7b989dd9f76d',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_SELECTION_ENABLED: 'true',
  ALBUM_ACTIVATION_ENABLED: 'true',
  GUEST_FEEDBACK_ENABLED: 'true',
  GUEST_TAGS_ENABLED: 'true',
  GUEST_HISTORY_ENABLED: 'true',
  HUMAN_VIEW_TRACKING_ENABLED: 'false',
  VERSION_APPROVALS_ENABLED: 'true',
  APPROVED_DELIVERIES_ENABLED: 'true',
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
  requireEqual(enabled, [...ACTIVE_FLAGS].sort(), 'PROFILE_ACTIVE_FLAGS');
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

export function validatePinRestoreManifest(manifest, migrationHash) {
  requireThat(
    manifest.schemaVersion === 1 &&
      manifest.status === 'passed_independent_0060_restore_and_B_adoption',
    'PIN_RESTORE_STATUS',
  );
  requireThat(
    manifest.accountId === ACCOUNT_ID &&
      manifest.sourceDatabaseId === DATABASE_ID,
    'PIN_RESTORE_SOURCE',
  );
  requireThat(
    /^[a-f0-9-]{36}$/.test(manifest.restoreDatabaseId ?? '') &&
      manifest.restoreDatabaseId !== DATABASE_ID,
    'PIN_RESTORE_INDEPENDENT',
  );
  requireThat(
    manifest.sourceSchemaVersion === 59 &&
      manifest.targetSchemaVersion === 60 &&
      manifest.sourceWritesDuringRestore === 0,
    'PIN_RESTORE_VERSIONS',
  );
  requireThat(
    manifest.restoreParityPassed === true &&
      manifest.oldTablesPreserved === true &&
      manifest.foreignKeyViolations === 0,
    'PIN_RESTORE_PARITY',
  );
  requireThat(
    manifest.migration60Sha256 === migrationHash,
    'PIN_RESTORE_MIGRATION_HASH',
  );
  for (const field of [
    'sourceBeforeBackupSha256',
    'restored59Sha256',
    'restored60Sha256',
    'sourceAfter60Sha256',
  ])
    requireThat(
      /^[a-f0-9]{64}$/.test(manifest[field] ?? ''),
      'PIN_RESTORE_BACKUP_HASH',
    );
  requireEqual(
    manifest.restoreCommands?.map((c) => [c.label, c.exitCode]),
    [
      ['list-B', 0],
      ['readback-restored59', 0],
      ['upgrade-drill60', 0],
      ['readback-upgraded60', 0],
    ],
    'PIN_RESTORE_COMMANDS',
  );
  requireEqual(
    manifest.adoptionCommands?.map((c) => [c.label, c.exitCode]),
    [
      ['fresh-before-adopt', 0],
      ['adopt-source-0060', 0],
      ['readback-source60', 0],
    ],
    'PIN_ADOPTION_COMMANDS',
  );
}

export function validateManualDeletionRestoreManifest(manifest, migrationHash) {
  requireThat(
    manifest.schemaVersion === 1 &&
      manifest.status === 'passed_independent_0061_restore_and_B_adoption',
    'DELETION_RESTORE_STATUS',
  );
  requireThat(
    manifest.accountId === ACCOUNT_ID &&
      manifest.sourceDatabaseId === DATABASE_ID &&
      manifest.restoreDatabaseId === 'e94143eb-fa9a-44db-9240-73c09264022d',
    'DELETION_RESTORE_RESOURCES',
  );
  requireThat(
    manifest.sourceSchemaVersion === 60 &&
      manifest.targetSchemaVersion === 61 &&
      manifest.sourceWritesDuringRestore === 0,
    'DELETION_RESTORE_VERSIONS',
  );
  requireThat(
    manifest.restoreParityPassed === true &&
      manifest.oldTablesPreserved === true &&
      manifest.oldTableCount === 144 &&
      manifest.oldRowCount === 2997 &&
      manifest.foreignKeyViolations === 0,
    'DELETION_RESTORE_PARITY',
  );
  requireThat(
    manifest.migration61Sha256 === migrationHash,
    'DELETION_RESTORE_MIGRATION_HASH',
  );
  for (const field of [
    'sourceBeforeBackupSha256',
    'restored60Sha256',
    'restored61Sha256',
    'sourceAfter61Sha256',
    'restoreProofSha256',
    'adoptionProofSha256',
  ])
    requireThat(
      /^[a-f0-9]{64}$/.test(manifest[field] ?? ''),
      'DELETION_RESTORE_PROOF_HASH',
    );
  requireEqual(
    manifest.restoreCommands?.map((c) => [c.label, c.exitCode]),
    [
      ['list-B', 0],
      ['create-independent-drill', 0],
      ['verify-empty', 0],
      ['restore-new-drill', 0],
      ['readback-restored60', 0],
      ['upgrade-drill61', 0],
      ['readback-upgraded61', 0],
    ],
    'DELETION_RESTORE_COMMANDS',
  );
  requireEqual(
    manifest.adoptionCommands?.map((c) => [c.label, c.exitCode]),
    [
      ['fresh-before-adopt', 0],
      ['adopt-source-0061', 0],
      ['readback-source61', 0],
    ],
    'DELETION_ADOPTION_COMMANDS',
  );
}

export function validateOracleStorageRestoreManifest(
  manifest,
  migrationHashes,
  rawMigrationHashes,
) {
  const expectedMigrations = [
    '0063_client_activity.sql',
    '0064_oracle_storage_policy.sql',
    '0065_oracle_storage_admission.sql',
  ].map((name) => ({
    name,
    sha256: rawMigrationHashes[name],
    canonicalSha256: migrationHashes[name],
  }));
  requireThat(
    manifest.status === 'passed_independent_0063_0065_restore_and_B_adoption',
    'ORACLE_RESTORE_STATUS',
  );
  requireThat(
    manifest.accountId === ACCOUNT_ID &&
      manifest.sourceDatabaseId === DATABASE_ID &&
      /^[a-f0-9-]{36}$/.test(manifest.restoreDatabaseId ?? '') &&
      manifest.restoreDatabaseId !== DATABASE_ID,
    'ORACLE_RESTORE_RESOURCES',
  );
  requireThat(
    manifest.sourceSchemaVersion === 62 &&
      manifest.targetSchemaVersion === 65 &&
      manifest.sourceWritesDuringRestore === 0,
    'ORACLE_RESTORE_VERSIONS',
  );
  requireThat(
    manifest.oldTablesPreserved === true &&
      manifest.exactSchemaAndRowsMatchSource === true &&
      manifest.oldTableCount === 146 &&
      manifest.oldRowCount === 3035 &&
      manifest.upgradedTableCount === 152 &&
      manifest.upgradedRowCount === 3039 &&
      manifest.foreignKeyViolations === 0,
    'ORACLE_RESTORE_PARITY',
  );
  for (const field of ['beforeSha256', 'restoredSha256', 'upgradedSha256'])
    requireThat(
      /^[a-f0-9]{64}$/.test(manifest[field] ?? ''),
      'ORACLE_RESTORE_DIGEST',
    );
  requireEqual(
    manifest.migrations,
    expectedMigrations,
    'ORACLE_RESTORE_MIGRATION_HASHES',
  );
  requireEqual(
    manifest.commands?.map((command) => [command.label, command.exitCode]),
    ORACLE_RESTORE_COMMANDS.map((label) => [label, 0]),
    'ORACLE_RESTORE_COMMANDS',
  );

  const adoption = manifest.adoption;
  requireThat(
    adoption?.status === 'passed_B_0063_0065_adoption' &&
      adoption.accountId === ACCOUNT_ID &&
      adoption.sourceDatabaseId === DATABASE_ID &&
      adoption.restoreDatabaseId === manifest.restoreDatabaseId &&
      adoption.beforeSha256 === manifest.beforeSha256 &&
      /^[a-f0-9]{64}$/.test(adoption.afterSha256 ?? '') &&
      adoption.oldTablesPreserved === true &&
      adoption.exactIndependentDrillParity === true &&
      adoption.foreignKeyViolations === 0,
    'ORACLE_ADOPTION_PARITY',
  );
  requireEqual(
    adoption.migrations,
    expectedMigrations,
    'ORACLE_ADOPTION_MIGRATION_HASHES',
  );
  requireEqual(
    adoption.commands?.map((command) => [command.label, command.exitCode]),
    ORACLE_ADOPTION_COMMANDS.map((label) => [label, 0]),
    'ORACLE_ADOPTION_COMMANDS',
  );
}

export function validateApprovedDeliveryRestoreManifest(
  manifest,
  migrationHash,
) {
  requireThat(
    manifest.status === 'passed_independent_0066_restore_and_B_adoption',
    'APPROVED_DELIVERY_RESTORE_STATUS',
  );
  requireThat(
    manifest.accountId === ACCOUNT_ID &&
      manifest.sourceDatabaseId === DATABASE_ID &&
      /^[a-f0-9-]{36}$/.test(manifest.restoreDatabaseId ?? '') &&
      manifest.restoreDatabaseId !== DATABASE_ID,
    'APPROVED_DELIVERY_RESTORE_RESOURCES',
  );
  requireThat(
    manifest.sourceSchemaVersion === 65 &&
      manifest.targetSchemaVersion === 66 &&
      manifest.sourceWritesDuringRestore === 0,
    'APPROVED_DELIVERY_RESTORE_VERSIONS',
  );
  for (const field of [
    'backupSha256',
    'restoredSha256',
    'upgradedSha256',
    'sourceAfterSha256',
  ])
    requireThat(
      /^[a-f0-9]{64}$/.test(manifest[field] ?? ''),
      'APPROVED_DELIVERY_RESTORE_DIGEST',
    );
  requireThat(
    manifest.oldTablesPreserved === true &&
      manifest.exactSchemaAndRowsMatchSource === true &&
      manifest.exactIndependentDrillParity === true &&
      manifest.foreignKeyViolations === 0 &&
      manifest.commandsAllSucceeded === true,
    'APPROVED_DELIVERY_RESTORE_PARITY',
  );
  requireThat(
    manifest.migration?.name === '0066_approved_deliveries.sql' &&
      /^[a-f0-9]{64}$/.test(manifest.migration.sha256 ?? '') &&
      manifest.migration.canonicalSha256 === migrationHash,
    'APPROVED_DELIVERY_RESTORE_MIGRATION_HASH',
  );
}

function approvedDeliveryRestoreReceipt(manifest, manifestSha256) {
  return {
    manifestSha256,
    sourceSchemaVersion: manifest.sourceSchemaVersion,
    targetSchemaVersion: manifest.targetSchemaVersion,
    sourceWritesDuringRestore: manifest.sourceWritesDuringRestore,
    restoreDatabaseId: manifest.restoreDatabaseId,
    backupSha256: manifest.backupSha256,
    restoredSha256: manifest.restoredSha256,
    upgradedSha256: manifest.upgradedSha256,
    sourceAfterSha256: manifest.sourceAfterSha256,
    oldTablesPreserved: manifest.oldTablesPreserved,
    exactSchemaAndRowsMatchSource: manifest.exactSchemaAndRowsMatchSource,
    exactIndependentDrillParity: manifest.exactIndependentDrillParity,
    foreignKeyViolations: manifest.foreignKeyViolations,
    commandsAllSucceeded: manifest.commandsAllSucceeded,
    migration: manifest.migration,
  };
}

export function validateOracleAdmissionProof(proof, sourceHashes) {
  requireThat(
    proof.status === 'passed_native_oracle_storage_admission' &&
      proof.schemaVersion === 65 &&
      proof.r2QuotaBytes === 9_000_000_000 &&
      proof.oracleQuotaBytes === 30_000_000_000 &&
      proof.reservationsCreated === 20 &&
      proof.reservationsCancelled === 20 &&
      proof.photoCompletions === 0 &&
      proof.oraclePhotoObjectWrites === 0 &&
      Number.isSafeInteger(proof.mockedS3SignedRequests) &&
      proof.mockedS3SignedRequests > 0 &&
      proof.oracleStorageMocked === true &&
      proof.liveOracleVM === false &&
      proof.physicalPhotoUploads === false,
    'ORACLE_ADMISSION_PROOF',
  );
  requireEqual(
    proof.checks,
    ORACLE_ADMISSION_CHECKS,
    'ORACLE_ADMISSION_CHECKS',
  );
  requireEqual(
    proof.sourceHashes,
    sourceHashes,
    'ORACLE_ADMISSION_SOURCE_HASHES',
  );
}

export function validateOracleCapacityBootstrap(manifest) {
  requireThat(
    manifest.status === 'passed_B_oracle_capacity_registration' &&
      manifest.workspaceId === OWNER_WORKSPACE_ID &&
      manifest.ownerId === OWNER_USER_ID &&
      /^[a-f0-9-]{36}$/.test(manifest.requestId ?? ''),
    'ORACLE_CAPACITY_BOOTSTRAP_IDENTITY',
  );
  requireThat(
    manifest.oldQuotaBytes === 9_000_000_000 &&
      manifest.newQuotaBytes === 39_000_000_000 &&
      manifest.newQuotaBytes - manifest.oldQuotaBytes === 30_000_000_000,
    'ORACLE_CAPACITY_BOOTSTRAP_WORKSPACE_QUOTA',
  );
  requireEqual(
    manifest.oracleNode,
    {
      id: 'oracle-vm',
      provider: 's3',
      bucket_name: 'kino-pick-overflow',
      endpoint: 'https://drive.kinostudio.tw',
      credential_ref: 'env:ORACLE_STORAGE',
      status: 'active',
      quota_bytes: 30_000_000_000,
      used_bytes: 0,
      reserved_bytes: 0,
    },
    'ORACLE_CAPACITY_BOOTSTRAP_NODE',
  );
  requireThat(
    manifest.otherTenantQuotasUnchanged === true &&
      manifest.admissionEnabled === false &&
      manifest.foreignKeyViolations === 0,
    'ORACLE_CAPACITY_BOOTSTRAP_SAFETY',
  );
  requireEqual(
    manifest.auditActions,
    ['storage.oracle_capacity_configured', 'storage.oracle_capacity_requested'],
    'ORACLE_CAPACITY_BOOTSTRAP_AUDIT',
  );
}

function oracleSecretStageTransition(proof, proofSha256) {
  return {
    proofSha256,
    priorReceiptSha256: proof.priorReceiptSha256,
    priorVersionId: proof.priorVersionId,
    baselineVersionId: proof.versionId,
    priorDeploymentId: proof.priorDeploymentId,
    deploymentId: proof.deploymentId,
    onlyTwoSecretsAdded: proof.parity.onlyTwoSecretsAdded,
    assetScope: proof.assetScope,
  };
}

export function validateOracleSecretStageBaseline(
  proof,
  priorDeployment,
  priorReceiptSha256,
  proofSha256,
) {
  const prior = priorDeployment.receipt;
  const established = prior.cloudflare.migrationCount >= 65;
  if (established)
    requireEqual(
      prior.secretStageTransition,
      oracleSecretStageTransition(proof, proofSha256),
      'SECRET_STAGE_HISTORY_LINK',
    );
  const before = proof.before;
  const after = proof.after;
  requireThat(
    proof.schemaVersion === 1 &&
      proof.status === 'passed_B_secret_only_transition' &&
      proof.accountId === ACCOUNT_ID &&
      proof.workerName === WORKER_NAME &&
      /^[a-f0-9]{40}$/.test(proof.sourceSha ?? '') &&
      (established || proof.sourceSha === prior.sourceSha) &&
      proof.priorReceiptSha256 ===
        (established
          ? prior.secretStageTransition.priorReceiptSha256
          : priorReceiptSha256),
    'SECRET_STAGE_IDENTITY',
  );
  requireThat(
    (established ||
      (proof.priorVersionId === prior.cloudflare.versionId &&
        proof.priorDeploymentId === prior.cloudflare.deploymentId)) &&
      proof.versionId === after?.versionMetadata?.id &&
      proof.deploymentId === after?.deployment?.id &&
      before?.versionMetadata?.id === proof.priorVersionId &&
      before?.deployment?.id === proof.priorDeploymentId &&
      before?.latestVersionId === proof.priorVersionId &&
      after?.latestVersionId === proof.versionId &&
      after?.deployment?.versions?.length === 1 &&
      after.deployment.versions[0].version_id === proof.versionId &&
      after.deployment.versions[0].percentage === 100,
    'SECRET_STAGE_VERSIONS',
  );
  requireThat(
    before.versionMetadata.annotations?.['workers/message'] ===
      'Kino Pic collaboration validation source ' + proof.sourceSha &&
      after.versionMetadata.annotations?.['workers/triggered_by'] === 'secret',
    'SECRET_STAGE_ANNOTATIONS',
  );
  requireEqual(
    proof.expectedNewSecrets,
    ORACLE_STAGE_NEW_SECRETS,
    'SECRET_STAGE_EXPECTED_ADDITIONS',
  );
  const oldSecretNames = REQUIRED_SECRETS.filter(
    (name) => !ORACLE_STAGE_NEW_SECRETS.includes(name),
  ).sort();
  requireEqual(before.secretNames, oldSecretNames, 'SECRET_STAGE_OLD_NAMES');
  requireEqual(
    after.secretNames,
    [...REQUIRED_SECRETS].sort(),
    'SECRET_STAGE_NEW_NAMES',
  );
  const parityKeys = [
    'latestWasActive',
    'scriptEtag',
    'handlers',
    'scriptRuntime',
    'nonSecretBindings',
    'plainVars',
    'settingsHash',
    'subdomain',
    'schedules',
    'routes',
    'publicEntryAssets',
    'onlyTwoSecretsAdded',
  ].sort();
  requireEqual(
    Object.keys(proof.parity ?? {}).sort(),
    parityKeys,
    'SECRET_STAGE_PARITY_KEYS',
  );
  requireThat(
    parityKeys.every((key) => proof.parity[key] === true),
    'SECRET_STAGE_PARITY',
  );
  for (const key of [
    'scriptEtag',
    'handlers',
    'scriptRuntime',
    'nonSecretBindings',
  ])
    requireEqual(
      before.versionMetadata[key],
      after.versionMetadata[key],
      'SECRET_STAGE_VERSION_' + key,
    );
  for (const key of [
    'plainVars',
    'settingsHash',
    'subdomain',
    'schedules',
    'routes',
    'publicEntryAssets',
  ])
    requireEqual(before[key], after[key], 'SECRET_STAGE_' + key);
  requireEqual(before.routes, [], 'SECRET_STAGE_ROUTES');
  requireEqual(after.routes, [], 'SECRET_STAGE_ROUTES');
  validateSubdomain(before.subdomain, true);
  validateSubdomain(after.subdomain, true);
  requireEqual(before.schedules, { schedules: [] }, 'SECRET_STAGE_SCHEDULES');
  requireEqual(after.schedules, { schedules: [] }, 'SECRET_STAGE_SCHEDULES');
  requireThat(
    before.settingsHash === after.settingsHash &&
      /^[a-f0-9]{64}$/.test(before.settingsHash ?? '') &&
      proof.assetScope ===
        'Known public entry JS/CSS plus homepage parity; full asset manifest identity unavailable',
    'SECRET_STAGE_SETTINGS_OR_ASSET_SCOPE',
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return (
      '{' +
      entries
        .map(([key, entry]) => JSON.stringify(key) + ':' + stableJson(entry))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

export function validateManualDeletionNative(proof, hashes) {
  requireThat(
    proof.schemaVersion === 1 &&
      proof.status === 'passed_native_d1_r2_manual_deletion' &&
      proof.targetSchemaVersion === 65 &&
      proof.assetCount === 6 &&
      proof.versionCount === 2 &&
      proof.payloadBytesBefore === 11276 &&
      proof.payloadBytesAfter === 0,
    'DELETION_NATIVE_PROOF',
  );
  requireThat(
    proof.migration61Sha256 === hashes.migration61Sha256 &&
      proof.migration62Sha256 === hashes.migration62Sha256 &&
      proof.migration65Sha256 === hashes.migration65Sha256 &&
      proof.runnerSha256 === hashes.runnerSha256,
    'DELETION_NATIVE_HASH',
  );
  requireEqual(
    proof.sourceHashes,
    hashes.sourceHashes,
    'DELETION_NATIVE_SOURCE_HASHES',
  );
  requireEqual(proof.checks, DELETION_NATIVE_CHECKS, 'DELETION_NATIVE_CHECKS');
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
  requireThat(
    migrationNames.length === 66 &&
      migrationNames.at(-1) === '0066_approved_deliveries.sql',
    'MIGRATION_COUNT',
  );
  const migrationHashes = {};
  const rawMigrationHashes = {};
  for (const name of migrationNames) {
    const migrationBytes = await readFile(join(worker, 'migrations', name));
    rawMigrationHashes[name] = sha256(migrationBytes);
    migrationHashes[name] = sha256(
      migrationBytes.toString('utf8').replaceAll('\r\n', '\n'),
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

  const oracleManifestBytes = await readFile(join(ROOT, ORACLE_MANIFEST_PATH));
  const oracleManifest = JSON.parse(oracleManifestBytes.toString('utf8'));
  validateOracleStorageRestoreManifest(
    oracleManifest,
    migrationHashes,
    rawMigrationHashes,
  );
  const approvedDeliveryRestoreBytes = await readFile(
    join(ROOT, APPROVED_DELIVERY_RESTORE_PATH),
  );
  const approvedDeliveryRestoreManifest = JSON.parse(
    approvedDeliveryRestoreBytes.toString('utf8'),
  );
  const approvedDeliveryMigrationSql = await readFile(
    join(worker, 'migrations/0066_approved_deliveries.sql'),
    'utf8',
  );
  validateApprovedDeliveryRestoreManifest(
    approvedDeliveryRestoreManifest,
    migrationHashes['0066_approved_deliveries.sql'],
  );
  const capacityBootstrapBytes = await readFile(
    join(ROOT, ORACLE_CAPACITY_BOOTSTRAP_PATH),
  );
  const capacityBootstrap = JSON.parse(capacityBootstrapBytes.toString('utf8'));
  validateOracleCapacityBootstrap(capacityBootstrap);
  const oracleAdmissionBytes = await readFile(
    join(ROOT, ORACLE_ADMISSION_PROOF_PATH),
  );
  const oracleAdmission = JSON.parse(oracleAdmissionBytes.toString('utf8'));
  const oracleAdmissionSourceHashes = {};
  for (const [key, relative] of Object.entries(ORACLE_ADMISSION_SOURCES))
    oracleAdmissionSourceHashes[key] = sha256(
      (await readFile(join(worker, relative), 'utf8')).replaceAll('\r\n', '\n'),
    );
  validateOracleAdmissionProof(oracleAdmission, oracleAdmissionSourceHashes);
  const clientActivityRunnerSha256 = sha256(
    (
      await readFile(join(worker, 'tests/client-activity-native.mjs'), 'utf8')
    ).replaceAll('\r\n', '\n'),
  );

  const pinRestoreBytes = await readFile(
    join(ROOT, 'docs/releases/photo-pins-0060-restore.json'),
  );
  const pinRestore = JSON.parse(pinRestoreBytes.toString('utf8'));
  validatePinRestoreManifest(
    pinRestore,
    migrationHashes['0060_photo_pins.sql'],
  );
  const pinNative = JSON.parse(
    await readFile(
      join(worker, '.local/photo-pins-upgrade-proof.json'),
      'utf8',
    ),
  );
  requireThat(
    pinNative.status === 'passed_native_populated_0059_to_0060' &&
      pinNative.sourceSchemaVersion === 59 &&
      pinNative.targetSchemaVersion === 60 &&
      pinNative.oldTablesPreserved > 0 &&
      pinNative.foreignKeyViolations === 0 &&
      pinNative.remoteCloudflare === false,
    'PIN_NATIVE_PROOF',
  );
  requireThat(
    pinNative.migration60Sha256 === migrationHashes['0060_photo_pins.sql'] &&
      pinNative.runnerSha256 ===
        sha256(await readFile(join(worker, 'tests/photo-pins-api.test.ts'))),
    'PIN_NATIVE_HASH',
  );

  const deletionRestoreBytes = await readFile(
    join(ROOT, DELETION_MANIFEST_PATH),
  );
  const deletionRestore = JSON.parse(deletionRestoreBytes.toString('utf8'));
  validateManualDeletionRestoreManifest(
    deletionRestore,
    migrationHashes['0061_manual_album_deletion.sql'],
  );
  const deletionNativeBytes = await readFile(
    join(ROOT, '.local/manual-album-deletion-native-proof.json'),
  );
  const deletionNative = JSON.parse(deletionNativeBytes.toString('utf8'));
  const deletionSourceHashes = {};
  for (const [key, relative] of Object.entries(DELETION_NATIVE_SOURCES))
    deletionSourceHashes[key] = sha256(
      (await readFile(join(worker, relative), 'utf8')).replaceAll('\r\n', '\n'),
    );
  const deletionHashes = {
    migration61Sha256: migrationHashes['0061_manual_album_deletion.sql'],
    migration62Sha256:
      migrationHashes['0062_manual_deletion_effective_reservations.sql'],
    migration65Sha256: migrationHashes['0065_oracle_storage_admission.sql'],
    runnerSha256: sha256(
      (
        await readFile(
          join(worker, 'tests/manual-album-deletion-api.test.ts'),
          'utf8',
        )
      ).replaceAll('\r\n', '\n'),
    ),
    sourceHashes: deletionSourceHashes,
  };
  validateManualDeletionNative(deletionNative, deletionHashes);

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
    collaboration.migrationCount === 66,
    'COLLABORATION_PROOF_MIGRATIONS',
  );
  requireThat(
    collaboration.approvedDeliveries === true,
    'COLLABORATION_PROOF_APPROVED_DELIVERIES',
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
    approvedDeliveryService: 'src/approved-deliveries.ts',
    approvedDeliveryRoutes: 'src/approved-delivery-routes.ts',
    approvedDeliveryTest: 'tests/approved-deliveries.mjs',
    approvedDeliveryMigration: 'migrations/0066_approved_deliveries.sql',
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
  validatePriorDeployment(
    priorDeployment,
    migrationHashes,
    sha256(oracleManifestBytes),
    approvedDeliveryRestoreManifest,
    sha256(approvedDeliveryRestoreBytes),
  );
  const secretStageBaselineBytes = await readFile(
    join(ROOT, SECRET_STAGE_BASELINE_PATH),
  );
  const secretStageBaseline = JSON.parse(
    secretStageBaselineBytes.toString('utf8'),
  );
  const priorReceiptSha256 = sha256(
    priorBytes.toString('utf8').replaceAll('\r\n', '\n'),
  );
  validateOracleSecretStageBaseline(
    secretStageBaseline,
    priorDeployment,
    priorReceiptSha256,
    sha256(secretStageBaselineBytes),
  );
  return {
    profile,
    manifest: deletionRestore,
    oracleManifest,
    oracleManifestSha256: sha256(oracleManifestBytes),
    approvedDeliveryRestoreManifest,
    approvedDeliveryRestoreManifestSha256: sha256(approvedDeliveryRestoreBytes),
    approvedDeliveryMigrationSql,
    capacityBootstrap,
    capacityBootstrapSha256: sha256(capacityBootstrapBytes),
    oracleAdmission,
    oracleAdmissionProofSha256: sha256(oracleAdmissionBytes),
    oracleAdmissionSourceHashes,
    clientActivityRunnerSha256,
    pinRestore,
    priorDeployment,
    secretStageBaseline,
    secretStageBaselineSha256: sha256(secretStageBaselineBytes),
    priorReceiptSha256,
    priorManifestSha256: sha256(priorBytes),
    manifestSha256: sha256(deletionRestoreBytes),
    migrationNames,
    migrationHashes,
    rawMigrationHashes,
    deletionHashes,
    deletionNative,
    manualDeletion: {
      status: deletionNative.status,
      targetSchemaVersion: deletionNative.targetSchemaVersion,
      checks: deletionNative.checks.length,
      proofSha256: sha256(deletionNativeBytes),
      runnerSha256: deletionNative.runnerSha256,
      migration61Sha256: deletionNative.migration61Sha256,
      migration62Sha256: deletionNative.migration62Sha256,
      migration65Sha256: deletionNative.migration65Sha256,
      sourceHashes: deletionNative.sourceHashes,
      assetCount: deletionNative.assetCount,
      versionCount: deletionNative.versionCount,
      payloadBytesBefore: deletionNative.payloadBytesBefore,
      payloadBytesAfter: deletionNative.payloadBytesAfter,
    },
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
      approvedDeliveries: collaboration.approvedDeliveries,
      activeProfileFlags: collaboration.activeProfileFlags,
      proofSha256: sha256(collaborationBytes),
      testSha256: collaboration.sourceHashes.nativeTest,
      bundleSha256: collaboration.sourceHashes.bundle,
      profileSha256: collaboration.sourceHashes.profile,
    },
  };
}

function validatePriorDeployment(
  prior,
  migrationHashes,
  oracleManifestSha256,
  approvedDeliveryRestoreManifest,
  approvedDeliveryRestoreManifestSha256,
) {
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
      [59, 60, 61, 62, 65, 66].includes(c.migrationCount) &&
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
  if (c.migrationCount >= 65) {
    requireThat(
      c.oracleSchema === true &&
        c.oracleGuardTriggers === ORACLE_GUARD_TRIGGERS.length,
      'PRIOR_ORACLE_SCHEMA',
    );
    requireEqual(
      c.secretNames,
      [...REQUIRED_SECRETS].sort(),
      'PRIOR_ORACLE_SECRETS',
    );
    const restore = receipt.restore;
    requireThat(
      restore?.manifestSha256 === oracleManifestSha256 &&
        restore.sourceSchemaVersion === 62 &&
        restore.targetSchemaVersion === 65 &&
        restore.sourceWritesDuringRestore === 0 &&
        restore.restoreDatabaseId !== DATABASE_ID &&
        /^[a-f0-9-]{36}$/.test(restore.restoreDatabaseId ?? '') &&
        restore.restoreParityPassed === true &&
        restore.independentUpgradePassed === true &&
        restore.foreignKeyViolations === 0,
      'PRIOR_ORACLE_RESTORE',
    );
    const native = receipt.nativeProofs?.oracleAdmission;
    requireThat(
      native?.schemaVersion === 65 &&
        native.checks === ORACLE_ADMISSION_CHECKS.length &&
        /^[a-f0-9]{64}$/.test(native.proofSha256 ?? '') &&
        native.sourceHashes?.migration65 ===
          migrationHashes['0065_oracle_storage_admission.sql'],
      'PRIOR_ORACLE_NATIVE',
    );
    if (c.migrationCount === 66) {
      const collaborationProof = receipt.nativeProofs?.scopedCollaboration;
      requireThat(
        c.approvedDeliverySchema === true &&
          c.approvedDeliveryViews === 2 &&
          c.approvedDeliveryIndexes === 3 &&
          c.approvedDeliveryTriggers === 3 &&
          collaborationProof?.migrationCount === 66 &&
          collaborationProof.approvedDeliveries === true &&
          collaborationProof.activeProfileFlags?.includes(
            'VERSION_APPROVALS_ENABLED',
          ) &&
          collaborationProof.activeProfileFlags?.includes(
            'APPROVED_DELIVERIES_ENABLED',
          ),
        'PRIOR_APPROVED_DELIVERY_SCHEMA',
      );
      requireEqual(
        receipt.approvedDeliveryRestore,
        approvedDeliveryRestoreReceipt(
          approvedDeliveryRestoreManifest,
          approvedDeliveryRestoreManifestSha256,
        ),
        'PRIOR_APPROVED_DELIVERY_RESTORE',
      );
    }
  }
  requireEqual(
    receipt.restore?.migrationHashes,
    Object.fromEntries(
      Object.entries(migrationHashes).slice(0, Math.min(c.migrationCount, 65)),
    ),
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

function validateOracleSchema(rows) {
  requireEqual(
    rows.map(({ type, name }) => [type, name]),
    ORACLE_SCHEMA_OBJECTS,
    'LIVE_ORACLE_SCHEMA',
  );
}

function normalizeSql(sql) {
  return sql.trim().replace(/;\s*$/, '').replaceAll(/\s+/g, ' ').toLowerCase();
}

function approvedDeliveryMigrationStatements(migrationSql) {
  const statements = {};
  for (const [type, name] of APPROVED_DELIVERY_SCHEMA_OBJECTS) {
    const create =
      type === 'index'
        ? 'CREATE\\s+UNIQUE\\s+INDEX'
        : 'CREATE\\s+' + type.toUpperCase();
    const end = type === 'trigger' ? '[\\s\\S]*?^END\\s*;' : '[^;]*;';
    const pattern = new RegExp(
      '^' + create + '\\s+' + name + '\\b' + end,
      'gim',
    );
    const matches = [...migrationSql.matchAll(pattern)];
    requireThat(
      matches.length === 1,
      'APPROVED_DELIVERY_SOURCE_OBJECT_' + name,
    );
    statements[name] = matches[0][0].trim();
  }
  return statements;
}

export function validateApprovedDeliverySchema(rows, migrationSql) {
  requireEqual(
    rows.map(({ type, name }) => [type, name]),
    APPROVED_DELIVERY_SCHEMA_OBJECTS,
    'LIVE_APPROVED_DELIVERY_SCHEMA',
  );
  const sourceStatements = approvedDeliveryMigrationStatements(migrationSql);
  for (const row of rows)
    requireThat(
      typeof row.sql === 'string' &&
        normalizeSql(row.sql) === normalizeSql(sourceStatements[row.name]),
      'LIVE_APPROVED_DELIVERY_SQL',
    );
  return {
    views: rows.filter((row) => row.type === 'view').length,
    indexes: rows.filter((row) => row.type === 'index').length,
    triggers: rows.filter((row) => row.type === 'trigger').length,
  };
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

function parseJsonRecord(value, code) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(code);
  }
  requireThat(
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
    code,
  );
  return parsed;
}

function requireExactKeys(value, keys, code) {
  requireEqual(Object.keys(value).sort(), [...keys].sort(), code);
}

function isWholeGbQuota(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 1_000_000_000 &&
    value <= 100_000_000_000 &&
    value % 1_000_000_000 === 0
  );
}

function validateOraclePolicyHistory(
  policyRows,
  commands,
  audits,
  nodeQuotaBytes,
) {
  requireThat(
    Array.isArray(policyRows) && policyRows.length === 1,
    'LIVE_ORACLE_POLICY_ROW',
  );
  const policy = policyRows[0];
  requireThat(
    Number.isSafeInteger(policy.revision) &&
      policy.revision >= 0 &&
      (policy.requested_enabled === 0 || policy.requested_enabled === 1) &&
      isWholeGbQuota(policy.quota_bytes) &&
      policy.free_floor_bytes === 20_000_000_000,
    'LIVE_ORACLE_POLICY_VALUES',
  );
  requireThat(
    Array.isArray(commands) && Array.isArray(audits),
    'LIVE_ORACLE_POLICY_HISTORY',
  );

  if (policy.revision === 0) {
    requireThat(
      policy.requested_enabled === 0 &&
        policy.quota_bytes === 30_000_000_000 &&
        commands.length === 0 &&
        audits.length === 0,
      'LIVE_ORACLE_POLICY_INITIAL_STATE',
    );
  } else {
    requireThat(
      commands.length === policy.revision && audits.length === policy.revision,
      'LIVE_ORACLE_POLICY_HISTORY_LENGTH',
    );
  }

  const auditByRequest = new Map();
  for (const audit of audits) {
    requireThat(
      typeof audit.request_id === 'string' &&
        !auditByRequest.has(audit.request_id),
      'LIVE_ORACLE_POLICY_AUDIT_DUPLICATE',
    );
    auditByRequest.set(audit.request_id, audit);
  }

  let expected = {
    requestedEnabled: 0,
    quotaBytes: 30_000_000_000,
    revision: 0,
  };
  const verifiedQuotas = new Set([30_000_000_000]);
  const requestIds = new Set();
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    requireThat(
      command.expected_revision === index &&
        command.actor_id === OWNER_USER_ID &&
        typeof command.session_id === 'string' &&
        command.session_id.length > 0 &&
        /^[a-f0-9-]{36}$/i.test(command.request_id ?? '') &&
        !requestIds.has(command.request_id) &&
        (command.requested_enabled === 0 || command.requested_enabled === 1) &&
        isWholeGbQuota(command.quota_bytes) &&
        Number.isSafeInteger(command.occurred_at_ms) &&
        command.occurred_at_ms >= 0 &&
        typeof command.result_json === 'string',
      'LIVE_ORACLE_POLICY_COMMAND',
    );
    requestIds.add(command.request_id);

    const enabled = command.requested_enabled === 1;
    const payload = parseJsonRecord(
      command.payload_json,
      'LIVE_ORACLE_POLICY_PAYLOAD',
    );
    requireExactKeys(
      payload,
      ['requestId', 'expectedRevision', 'enabled', 'quotaGb'],
      'LIVE_ORACLE_POLICY_PAYLOAD_KEYS',
    );
    requireEqual(
      payload,
      {
        requestId: command.request_id,
        expectedRevision: index,
        enabled,
        quotaGb: command.quota_bytes / 1_000_000_000,
      },
      'LIVE_ORACLE_POLICY_PAYLOAD_MATCH',
    );

    const audit = auditByRequest.get(command.request_id);
    requireThat(
      audit &&
        audit.event_id === 'oracle-policy:' + command.request_id &&
        audit.actor_type === 'user' &&
        audit.actor_id === command.actor_id &&
        audit.session_id === command.session_id &&
        audit.action === 'storage.oracle_policy_changed',
      'LIVE_ORACLE_POLICY_AUDIT_IDENTITY',
    );
    requireEqual(
      audit.request_id,
      command.request_id,
      'LIVE_ORACLE_POLICY_AUDIT_REQUEST',
    );
    const before = parseJsonRecord(
      audit.before_json,
      'LIVE_ORACLE_POLICY_AUDIT_BEFORE',
    );
    const after = parseJsonRecord(
      audit.after_json,
      'LIVE_ORACLE_POLICY_AUDIT_AFTER',
    );
    requireExactKeys(
      before,
      ['requestedEnabled', 'quotaBytes', 'revision'],
      'LIVE_ORACLE_POLICY_AUDIT_BEFORE_KEYS',
    );
    requireExactKeys(
      after,
      ['requestedEnabled', 'quotaBytes', 'revision'],
      'LIVE_ORACLE_POLICY_AUDIT_AFTER_KEYS',
    );
    requireEqual(before, expected, 'LIVE_ORACLE_POLICY_AUDIT_BEFORE_MATCH');

    const next = {
      requestedEnabled: command.requested_enabled,
      quotaBytes: command.quota_bytes,
      revision: index + 1,
    };
    requireEqual(after, next, 'LIVE_ORACLE_POLICY_AUDIT_AFTER_MATCH');
    const result = parseJsonRecord(
      command.result_json,
      'LIVE_ORACLE_POLICY_RESULT',
    );
    requireExactKeys(
      result,
      ['requestedEnabled', 'quotaBytes', 'freeFloorBytes', 'revision'],
      'LIVE_ORACLE_POLICY_RESULT_KEYS',
    );
    requireEqual(
      result,
      {
        requestedEnabled: command.requested_enabled,
        quotaBytes: next.quotaBytes,
        freeFloorBytes: 20_000_000_000,
        revision: next.revision,
      },
      'LIVE_ORACLE_POLICY_RESULT_MATCH',
    );
    expected = next;
    verifiedQuotas.add(command.quota_bytes);
  }

  requireEqual(
    expected,
    {
      requestedEnabled: policy.requested_enabled,
      quotaBytes: policy.quota_bytes,
      revision: policy.revision,
    },
    'LIVE_ORACLE_POLICY_CURRENT_MATCH',
  );
  requireThat(
    isWholeGbQuota(nodeQuotaBytes) && verifiedQuotas.has(nodeQuotaBytes),
    'LIVE_ORACLE_NODE_QUOTA_HISTORY',
  );
  return {
    requestedEnabled: policy.requested_enabled === 1,
    quotaBytes: policy.quota_bytes,
    revision: policy.revision,
    freeFloorBytes: policy.free_floor_bytes,
    nodeQuotaBytes,
  };
}

async function readLiveOracleCapacityState(bootstrap) {
  const [
    ownerRows,
    nodeRows,
    policyRows,
    commandRows,
    auditRows,
    otherWorkspaceRows,
  ] = await Promise.all([
    queryD1(
      "SELECT id,owner_user_id,quota_bytes FROM workspaces WHERE owner_user_id='" +
        OWNER_USER_ID +
        "' ORDER BY id",
    ),
    queryD1(
      "SELECT id,provider,bucket_name,endpoint,credential_ref,status,quota_bytes FROM storage_nodes WHERE status='active' ORDER BY id",
    ),
    queryD1(
      'SELECT requested_enabled,quota_bytes,free_floor_bytes,revision FROM oracle_storage_policy WHERE id=1',
    ),
    queryD1(
      'SELECT request_id,actor_id,session_id,expected_revision,requested_enabled,quota_bytes,occurred_at_ms,payload_json,result_json FROM oracle_storage_policy_commands ORDER BY expected_revision',
    ),
    queryD1(
      "SELECT event_id,actor_type,actor_id,session_id,action,before_json,after_json,request_id FROM audit_events WHERE action='storage.oracle_policy_changed' ORDER BY request_id",
    ),
    queryD1(
      "SELECT id,owner_user_id,quota_bytes FROM workspaces WHERE owner_user_id<>'" +
        OWNER_USER_ID +
        "' ORDER BY id",
    ),
  ]);
  requireEqual(
    ownerRows.map((row) => [row.id, row.owner_user_id, row.quota_bytes]),
    [[OWNER_WORKSPACE_ID, OWNER_USER_ID, 39_000_000_000]],
    'LIVE_ORACLE_OWNER_WORKSPACE_QUOTA',
  );
  requireEqual(
    nodeRows.map((row) => [
      row.id,
      row.provider,
      row.bucket_name,
      row.endpoint,
      row.credential_ref,
      row.status,
    ]),
    [
      [
        'oracle-vm',
        's3',
        'kino-pick-overflow',
        'https://drive.kinostudio.tw',
        'env:ORACLE_STORAGE',
        'active',
      ],
      [
        'primary',
        'r2',
        'PRIMARY_STORAGE',
        null,
        'binding:PRIMARY_STORAGE',
        'active',
      ],
    ],
    'LIVE_ORACLE_ACTIVE_STORAGE_NODES',
  );
  const primaryNode = nodeRows.find((row) => row.id === 'primary');
  const oracleNode = nodeRows.find((row) => row.id === 'oracle-vm');
  requireThat(
    primaryNode?.quota_bytes === 9_000_000_000,
    'LIVE_ORACLE_PRIMARY_QUOTA',
  );
  const livePolicy = validateOraclePolicyHistory(
    policyRows,
    commandRows,
    auditRows,
    oracleNode?.quota_bytes,
  );
  requireThat(
    bootstrap.otherTenantQuotasUnchanged === true,
    'LIVE_ORACLE_OTHER_TENANT_QUOTA_PROOF',
  );
  return {
    workspaceId: OWNER_WORKSPACE_ID,
    ownerId: OWNER_USER_ID,
    workspaceQuotaBytes: 39_000_000_000,
    oracleNodeIdentity: 'oracle-vm/s3/drive.kinostudio.tw/kino-pick-overflow',
    oracleNodeQuotaBytes: livePolicy.nodeQuotaBytes,
    primaryNodeQuotaBytes: 9_000_000_000,
    admissionRequested: livePolicy.requestedEnabled,
    policyRevision: livePolicy.revision,
    policyQuotaBytes: livePolicy.quotaBytes,
    freeFloorBytes: livePolicy.freeFloorBytes,
    otherTenantQuotaRows: otherWorkspaceRows.length,
    otherTenantQuotaRowsSha256: sha256(stableJson(otherWorkspaceRows)),
    otherTenantQuotasUnchanged: bootstrap.otherTenantQuotasUnchanged,
  };
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

function secretBinding(binding) {
  return ['secret_text', 'secret_key', 'secret'].includes(binding?.type);
}

async function publicEntryAssets() {
  const origin = 'https://' + PUBLIC_ENTRY;
  const read = async (path) => {
    const response = await fetch(origin + path, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    requireThat(response.status === 200, 'SECRET_STAGE_ASSET_HTTP');
    const bytes = Buffer.from(await response.arrayBuffer());
    requireThat(bytes.length <= 8 * 1024 * 1024, 'SECRET_STAGE_ASSET_SIZE');
    return bytes;
  };
  const html = await read('/');
  const paths = [
    ...new Set(
      [
        ...html
          .toString('utf8')
          .matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g),
      ].map((match) => match[1]),
    ),
  ].sort();
  requireThat(
    paths.length > 0 && paths.length <= 12,
    'SECRET_STAGE_ASSETS_MISSING',
  );
  const assets = [
    { path: '/', sha256: sha256(html) },
    ...(await Promise.all(
      paths.map(async (path) => ({ path, sha256: sha256(await read(path)) })),
    )),
  ];
  return assets;
}

function validateEstablishedLiveVersion(
  settings,
  deployment,
  version,
  items,
  prior,
) {
  const receipt = prior.receipt;
  const expectedMessage =
    'Kino Pic collaboration validation source ' + receipt.sourceSha;
  requireEqual(
    deployment.id,
    receipt.cloudflare.deploymentId,
    'PRIOR_LIVE_DEPLOYMENT_ID',
  );
  assertSingleVersion(
    deployment,
    receipt.cloudflare.versionId,
    expectedMessage,
  );
  requireEqual(
    settings.annotations?.['workers/message'],
    expectedMessage,
    'PRIOR_LIVE_SETTINGS_MESSAGE',
  );
  requireThat(
    version.id === receipt.cloudflare.versionId &&
      version.annotations?.['workers/message'] === expectedMessage,
    'PRIOR_LIVE_VERSION',
  );
  requireThat(
    Array.isArray(items) && items.length > 0,
    'PRIOR_LIVE_VERSION_LIST',
  );
  requireEqual(
    [...items].sort((a, b) => b.number - a.number)[0]?.id,
    receipt.cloudflare.versionId,
    'PRIOR_LIVE_LATEST_VERSION',
  );
}

async function validateEstablishedDeploymentLive(settings, deployment, prior) {
  const [version, versions] = await Promise.all([
    cloudflareResult(
      '/workers/scripts/' +
        WORKER_NAME +
        '/versions/' +
        prior.receipt.cloudflare.versionId,
    ),
    cloudflareResult('/workers/scripts/' + WORKER_NAME + '/versions'),
  ]);
  const items = Array.isArray(versions)
    ? versions
    : (versions?.items ?? versions?.versions ?? []);
  validateEstablishedLiveVersion(settings, deployment, version, items, prior);
}

async function validateSecretStageLive(
  settings,
  secretNames,
  subdomain,
  scheduleResult,
  scripts,
  deployment,
  transition,
) {
  const capture = transition.after;
  const bindings = settings.bindings;
  requireEqual(
    Object.fromEntries(
      bindings
        .filter((binding) => binding.type === 'plain_text')
        .map((binding) => [binding.name, binding.text])
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
    capture.plainVars,
    'SECRET_STAGE_LIVE_PLAIN_VARS',
  );
  const nonSecretBindings = bindings
    .filter((binding) => !secretBinding(binding))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  requireEqual(
    nonSecretBindings,
    capture.versionMetadata.nonSecretBindings,
    'SECRET_STAGE_LIVE_NON_SECRET_BINDINGS',
  );
  const liveSecretBindings = bindings
    .filter(secretBinding)
    .map((binding) => binding.name)
    .sort();
  requireEqual(
    liveSecretBindings,
    [...REQUIRED_SECRETS].sort(),
    'SECRET_STAGE_LIVE_SECRET_BINDINGS',
  );
  const settingsClean = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) =>
        !['bindings', 'annotations', 'last_deployed_from'].includes(key),
    ),
  );
  requireThat(
    sha256(stableJson(settingsClean)) === capture.settingsHash,
    'SECRET_STAGE_LIVE_SETTINGS_HASH',
  );
  requireEqual(subdomain, capture.subdomain, 'SECRET_STAGE_LIVE_SUBDOMAIN');
  requireEqual(
    scheduleResult,
    capture.schedules,
    'SECRET_STAGE_LIVE_SCHEDULES',
  );
  const matches = scripts.filter((script) => script.id === WORKER_NAME);
  requireEqual(
    matches[0]?.routes ?? [],
    capture.routes,
    'SECRET_STAGE_LIVE_ROUTES',
  );
  requireEqual(
    secretNames,
    capture.secretNames,
    'SECRET_STAGE_LIVE_SECRET_NAMES',
  );
  requireEqual(deployment, capture.deployment, 'SECRET_STAGE_LIVE_DEPLOYMENT');
  requireThat(
    deployment.id === transition.deploymentId &&
      deployment.versions?.length === 1 &&
      deployment.versions[0].version_id === transition.versionId &&
      deployment.versions[0].percentage === 100,
    'SECRET_STAGE_LIVE_ACTIVE_VERSION',
  );

  const version = await cloudflareResult(
    '/workers/scripts/' + WORKER_NAME + '/versions/' + transition.versionId,
  );
  const metadata = capture.versionMetadata;
  requireThat(version.id === metadata.id, 'SECRET_STAGE_LIVE_VERSION_ID');
  requireEqual(
    version.annotations ?? {},
    metadata.annotations,
    'SECRET_STAGE_LIVE_VERSION_ANNOTATIONS',
  );
  requireThat(
    version.resources?.script?.etag === metadata.scriptEtag,
    'SECRET_STAGE_LIVE_SCRIPT_ETAG',
  );
  requireEqual(
    version.resources?.script?.handlers ?? [],
    metadata.handlers,
    'SECRET_STAGE_LIVE_HANDLERS',
  );
  requireEqual(
    version.resources?.script_runtime ?? null,
    metadata.scriptRuntime,
    'SECRET_STAGE_LIVE_RUNTIME',
  );
  const versions = await cloudflareResult(
    '/workers/scripts/' + WORKER_NAME + '/versions',
  );
  const items = Array.isArray(versions)
    ? versions
    : (versions?.items ?? versions?.versions ?? []);
  requireThat(
    Array.isArray(items) && items.length > 0,
    'SECRET_STAGE_LIVE_VERSION_LIST',
  );
  const latest = [...items].sort(
    (left, right) => right.number - left.number,
  )[0];
  requireThat(
    latest?.id === transition.versionId,
    'SECRET_STAGE_LIVE_LATEST_VERSION',
  );
  requireEqual(
    await publicEntryAssets(),
    capture.publicEntryAssets,
    'SECRET_STAGE_LIVE_PUBLIC_ASSETS',
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
  const deployment = await readDeployment();

  const priorMigrationCount =
    evidence.priorDeployment.receipt.cloudflare.migrationCount;
  const established = priorMigrationCount >= 65;
  validateSubdomain(subdomain, phase === 'predeploy');
  if (phase === 'predeploy') {
    if (established && priorMigrationCount === 65) {
      const previousProfile = {
        ...profile,
        vars: { ...profile.vars, VERSION_APPROVALS_ENABLED: 'false' },
      };
      delete previousProfile.vars.APPROVED_DELIVERIES_ENABLED;
      validateSettingsBindings(settings, previousProfile, true);
    } else validateSettingsBindings(settings, profile, established);
    if (established)
      await validateEstablishedDeploymentLive(
        settings,
        deployment,
        evidence.priorDeployment,
      );
    else
      await validateSecretStageLive(
        settings,
        Array.isArray(secretResult)
          ? secretResult.map((secret) => secret.name).sort()
          : [],
        subdomain,
        scheduleResult,
        scripts,
        deployment,
        evidence.secretStageBaseline,
      );
  } else {
    validateSettingsBindings(settings, profile, true);
  }
  validateWorkerRoutes(scripts);
  requireEqual(scheduleResult?.schedules ?? null, [], 'LIVE_CRON_SCHEDULES');
  validatePrivateR2(managed, custom);
  requireThat(Array.isArray(secretResult), 'LIVE_SECRET_LIST');
  const secretNames = secretResult.map((secret) => secret.name).sort();
  requireEqual(secretNames, [...REQUIRED_SECRETS].sort(), 'LIVE_SECRET_NAMES');

  const migrationRows = await queryD1(
    'SELECT id, name FROM d1_migrations ORDER BY id',
  );
  requireThat(migrationRows.length === 66, 'LIVE_D1_MIGRATION_COUNT');
  const oracleSchema = await queryD1(
    "SELECT type,name FROM sqlite_schema WHERE (type='table' OR type='view') AND name IN ('client_album_browser_receipts','client_browse_events','guest_download_ip_sidecars','oracle_storage_health','oracle_storage_policy','oracle_storage_policy_commands','client_activity_ready_versions','storage_pending_derivative_capacity') ORDER BY type,name",
  );
  validateOracleSchema(oracleSchema);
  const approvedDeliverySchemaRows = await queryD1(
    "SELECT type,name,sql FROM sqlite_schema WHERE name IN ('approved_delivery_download_unique','approved_delivery_request_unique','approved_delivery_revoke_unique','approved_delivery_download_guard','approved_delivery_publish_guard','approved_delivery_revoke_guard','approved_delivery_live_guests','approved_delivery_sources') ORDER BY type,name",
  );
  const approvedDeliverySchema = validateApprovedDeliverySchema(
    approvedDeliverySchemaRows,
    evidence.approvedDeliveryMigrationSql,
  );
  const oracleTriggers = await queryD1(
    "SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('client_album_browser_receipts_insert_guard','client_browse_events_insert_guard','guest_download_ip_sidecars_insert_guard','manual_album_deletion_job_guard','oracle_storage_health_update_guard','oracle_storage_node_identity_guard','oracle_storage_node_insert_guard','oracle_storage_node_quota_guard','oracle_storage_policy_command_guard','processing_review_command_guard','single_active_storage','single_active_storage_update','upload_request_guard') ORDER BY name",
  );
  requireEqual(
    oracleTriggers.map((row) => row.name),
    ORACLE_GUARD_TRIGGERS,
    'LIVE_ORACLE_GUARD_TRIGGERS',
  );
  const deletionSchema = await queryD1(
    "SELECT type,name FROM sqlite_schema WHERE (type='table' AND name IN ('manual_album_deletion_jobs','manual_album_deletion_items')) OR (type='view' AND name='manual_album_deletion_blockers') ORDER BY name",
  );
  requireEqual(
    deletionSchema,
    [
      { type: 'view', name: 'manual_album_deletion_blockers' },
      { type: 'table', name: 'manual_album_deletion_items' },
      { type: 'table', name: 'manual_album_deletion_jobs' },
    ],
    'LIVE_DELETION_SCHEMA',
  );
  const pinTables = await queryD1(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('photo_pin_commands','photo_pin_results','photo_pin_states') ORDER BY name",
  );
  requireEqual(
    pinTables.map((row) => row.name),
    ['photo_pin_commands', 'photo_pin_results', 'photo_pin_states'],
    'LIVE_PIN_SCHEMA',
  );
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
  const oracleCapacity = await readLiveOracleCapacityState(
    evidence.capacityBootstrap,
  );

  let versionId;
  let message;
  if (phase === 'predeploy') {
    versionId = established
      ? evidence.priorDeployment.receipt.cloudflare.versionId
      : evidence.secretStageBaseline.versionId;
    requireThat(
      deployment.id ===
        (established
          ? evidence.priorDeployment.receipt.cloudflare.deploymentId
          : evidence.secretStageBaseline.deploymentId),
      'PRIOR_DEPLOYMENT_ID',
    );
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
    oracleSchema: true,
    oracleGuardTriggers: oracleTriggers.length,
    approvedDeliverySchema: true,
    approvedDeliveryViews: approvedDeliverySchema.views,
    approvedDeliveryIndexes: approvedDeliverySchema.indexes,
    approvedDeliveryTriggers: approvedDeliverySchema.triggers,
    oracleCapacity,
    foreignKeyViolations: foreignKeyRows.length,
    recommendationSchema: true,
    secretNames,
    privateR2: true,
    r2DevEnabled: managed.enabled,
    enabledCustomDomains: custom.domains.filter((domain) => domain.enabled)
      .length,
    routes: 0,
    crons: 0,
    publicEntry: { enabled: subdomain.enabled, previewsEnabled: false },
    storageAutodeleteEnabled: false,
    storageRetentionDryRun: true,
    multiAccountStorageEnabled: false,
    deploymentId: deployment.id,
    versionId,
    deploymentMessage:
      message ?? deployment.annotations?.['workers/message'] ?? null,
    secretStageBaselineVersionId:
      phase === 'predeploy' && !established
        ? evidence.secretStageBaseline.versionId
        : null,
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
    secretStageTransition: oracleSecretStageTransition(
      result.evidence.secretStageBaseline,
      result.evidence.secretStageBaselineSha256,
    ),
    oracleCapacityBootstrap: {
      proofSha256: result.evidence.capacityBootstrapSha256,
      workspaceId: result.evidence.capacityBootstrap.workspaceId,
      ownerId: result.evidence.capacityBootstrap.ownerId,
      workspaceQuotaBytes: result.evidence.capacityBootstrap.newQuotaBytes,
      oracleNodeId: result.evidence.capacityBootstrap.oracleNode.id,
      oracleNodeIdentity: result.cloudflare.oracleCapacity.oracleNodeIdentity,
      bootstrapOracleNodeQuotaBytes:
        result.evidence.capacityBootstrap.oracleNode.quota_bytes,
      bootstrapAdmissionEnabled:
        result.evidence.capacityBootstrap.admissionEnabled,
      oracleNodeQuotaBytes:
        result.cloudflare.oracleCapacity.oracleNodeQuotaBytes,
      admissionEnabled: result.cloudflare.oracleCapacity.admissionRequested,
      policyQuotaBytes: result.cloudflare.oracleCapacity.policyQuotaBytes,
      policyRevision: result.cloudflare.oracleCapacity.policyRevision,
      freeFloorBytes: result.cloudflare.oracleCapacity.freeFloorBytes,
      otherTenantQuotasUnchanged:
        result.cloudflare.oracleCapacity.otherTenantQuotasUnchanged,
      live: result.cloudflare.oracleCapacity,
    },
    restore: {
      manifestSha256: result.evidence.oracleManifestSha256,
      sourceSchemaVersion: 62,
      targetSchemaVersion: 65,
      sourceWritesDuringRestore: 0,
      restoreDatabaseId: result.evidence.oracleManifest.restoreDatabaseId,
      restoreParityPassed: true,
      independentUpgradePassed: true,
      foreignKeyViolations: 0,
      migrationHashes: Object.fromEntries(
        Object.entries(result.evidence.migrationHashes).slice(0, 65),
      ),
    },
    approvedDeliveryRestore: approvedDeliveryRestoreReceipt(
      result.evidence.approvedDeliveryRestoreManifest,
      result.evidence.approvedDeliveryRestoreManifestSha256,
    ),
    manualDeletionRestore: {
      manifestSha256: result.evidence.manifestSha256,
      sourceSchemaVersion: 60,
      targetSchemaVersion: 61,
      restoreDatabaseId: result.evidence.manifest.restoreDatabaseId,
      restoreParityPassed: true,
      independentUpgradePassed: true,
    },
    nativeProofs: {
      photographer: result.evidence.photographer,
      scopedCollaboration: result.evidence.collaboration,
      manualDeletion: result.evidence.manualDeletion,
      oracleAdmission: {
        proofSha256: result.evidence.oracleAdmissionProofSha256,
        schemaVersion: result.evidence.oracleAdmission.schemaVersion,
        checks: result.evidence.oracleAdmission.checks.length,
        sourceHashes: result.evidence.oracleAdmission.sourceHashes,
      },
      clientActivityRunnerSha256: result.evidence.clientActivityRunnerSha256,
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
  const apiSchemaRows = ORACLE_SCHEMA_OBJECTS.map(([type, name]) => ({
    type,
    name,
  }));
  validateOracleSchema(apiSchemaRows);
  assert.throws(() => validateOracleSchema(apiSchemaRows.slice(1)));
  for (const changed of [{ type: 'view' }, { name: 'missing_schema_object' }]) {
    assert.throws(() =>
      validateOracleSchema([
        { ...apiSchemaRows[0], ...changed },
        ...apiSchemaRows.slice(1),
      ]),
    );
  }
  const profile = await parseJsonc(
    await readFile(join(ROOT, PROFILE_PATH), 'utf8'),
    PROFILE_PATH,
  );
  validateProfile(profile);
  const policyRequestId = '4d753c41-6dd3-4d1d-8db8-aec3001d8a11';
  const validPolicyState = {
    policyRows: [
      {
        requested_enabled: 1,
        quota_bytes: 40_000_000_000,
        free_floor_bytes: 20_000_000_000,
        revision: 1,
      },
    ],
    commands: [
      {
        request_id: policyRequestId,
        actor_id: OWNER_USER_ID,
        session_id: 'self-test-session-only',
        expected_revision: 0,
        requested_enabled: 1,
        quota_bytes: 40_000_000_000,
        occurred_at_ms: 1,
        payload_json: JSON.stringify({
          requestId: policyRequestId,
          expectedRevision: 0,
          enabled: true,
          quotaGb: 40,
        }),
        result_json: JSON.stringify({
          requestedEnabled: 1,
          quotaBytes: 40_000_000_000,
          freeFloorBytes: 20_000_000_000,
          revision: 1,
        }),
      },
    ],
    audits: [
      {
        event_id: 'oracle-policy:' + policyRequestId,
        actor_type: 'user',
        actor_id: OWNER_USER_ID,
        session_id: 'self-test-session-only',
        action: 'storage.oracle_policy_changed',
        before_json: JSON.stringify({
          requestedEnabled: 0,
          quotaBytes: 30_000_000_000,
          revision: 0,
        }),
        after_json: JSON.stringify({
          requestedEnabled: 1,
          quotaBytes: 40_000_000_000,
          revision: 1,
        }),
        request_id: policyRequestId,
      },
    ],
  };
  const validPolicy = validateOraclePolicyHistory(
    validPolicyState.policyRows,
    validPolicyState.commands,
    validPolicyState.audits,
    30_000_000_000,
  );
  assert.deepEqual(validPolicy, {
    requestedEnabled: true,
    quotaBytes: 40_000_000_000,
    revision: 1,
    freeFloorBytes: 20_000_000_000,
    nodeQuotaBytes: 30_000_000_000,
  });
  assert.throws(() =>
    validateOraclePolicyHistory(
      validPolicyState.policyRows,
      [
        {
          ...validPolicyState.commands[0],
          result_json: JSON.stringify({
            requestedEnabled: true,
            quotaBytes: 40_000_000_000,
            freeFloorBytes: 20_000_000_000,
            revision: 1,
          }),
        },
      ],
      validPolicyState.audits,
      30_000_000_000,
    ),
  );
  assert.throws(() =>
    validateOraclePolicyHistory(
      validPolicyState.policyRows,
      [
        {
          ...validPolicyState.commands[0],
          actor_id: '00000000-0000-0000-0000-000000000000',
        },
      ],
      validPolicyState.audits,
      30_000_000_000,
    ),
  );
  assert.throws(() =>
    validateOraclePolicyHistory(
      validPolicyState.policyRows,
      validPolicyState.commands,
      [
        {
          ...validPolicyState.audits[0],
          after_json: JSON.stringify({
            requestedEnabled: 1,
            quotaBytes: 40_000_000_000,
            revision: 2,
          }),
        },
      ],
      30_000_000_000,
    ),
  );
  const evidence = await validateLocalEvidence();
  assert.equal(evidence.migrationNames.length, 66);
  const sourceStatements = approvedDeliveryMigrationStatements(
    evidence.approvedDeliveryMigrationSql,
  );
  const approvedDeliverySchemaRows = APPROVED_DELIVERY_SCHEMA_OBJECTS.map(
    ([type, name]) => ({ type, name, sql: sourceStatements[name] }),
  );
  assert.deepEqual(
    validateApprovedDeliverySchema(
      approvedDeliverySchemaRows,
      evidence.approvedDeliveryMigrationSql,
    ),
    { views: 2, indexes: 3, triggers: 3 },
  );
  assert.throws(() =>
    validateApprovedDeliverySchema(
      approvedDeliverySchemaRows.slice(1),
      evidence.approvedDeliveryMigrationSql,
    ),
  );
  const changedDeliverySql = structuredClone(approvedDeliverySchemaRows);
  changedDeliverySql[0].sql += ' altered';
  assert.throws(() =>
    validateApprovedDeliverySchema(
      changedDeliverySql,
      evidence.approvedDeliveryMigrationSql,
    ),
  );
  const prior = evidence.priorDeployment;
  validatePriorDeployment(
    prior,
    evidence.migrationHashes,
    evidence.oracleManifestSha256,
    evidence.approvedDeliveryRestoreManifest,
    evidence.approvedDeliveryRestoreManifestSha256,
  );
  if (prior.receipt.cloudflare.migrationCount >= 65) {
    const history = oracleSecretStageTransition(
      evidence.secretStageBaseline,
      evidence.secretStageBaselineSha256,
    );
    requireEqual(
      prior.receipt.secretStageTransition,
      history,
      'SELF_TEST_HISTORY',
    );
    assert.equal(
      history.priorReceiptSha256,
      evidence.secretStageBaseline.priorReceiptSha256,
    );
    const legacyLinkFixture = {
      receipt: {
        sourceSha: evidence.secretStageBaseline.sourceSha,
        cloudflare: {
          migrationCount: 62,
          versionId: evidence.secretStageBaseline.priorVersionId,
          deploymentId: evidence.secretStageBaseline.priorDeploymentId,
        },
      },
    };
    validateOracleSecretStageBaseline(
      evidence.secretStageBaseline,
      legacyLinkFixture,
      evidence.secretStageBaseline.priorReceiptSha256,
    );
    for (const mutate of [
      (receipt) => {
        receipt.cloudflare.accountId = 'wrong-account';
      },
      (receipt) => {
        receipt.cloudflare.secretNames =
          receipt.cloudflare.secretNames.slice(1);
      },
      (receipt) => {
        receipt.restore.manifestSha256 = '0'.repeat(64);
      },
      (receipt) => {
        receipt.restore.restoreParityPassed = false;
      },
      (receipt) => {
        receipt.nativeProofs.oracleAdmission.sourceHashes.migration65 =
          '0'.repeat(64);
      },
    ]) {
      const changed = structuredClone(prior);
      mutate(changed.receipt);
      changed.receiptSha256 = sha256(
        JSON.stringify(changed.receipt, null, 2) + '\n',
      );
      assert.throws(() =>
        validatePriorDeployment(
          changed,
          evidence.migrationHashes,
          evidence.oracleManifestSha256,
          evidence.approvedDeliveryRestoreManifest,
          evidence.approvedDeliveryRestoreManifestSha256,
        ),
      );
    }
    const brokenHistory = structuredClone(prior);
    brokenHistory.receipt.secretStageTransition.proofSha256 = '0'.repeat(64);
    assert.throws(() =>
      validateOracleSecretStageBaseline(
        evidence.secretStageBaseline,
        brokenHistory,
        evidence.priorReceiptSha256,
        evidence.secretStageBaselineSha256,
      ),
    );
    const annotations = {
      'workers/message':
        'Kino Pic collaboration validation source ' + prior.receipt.sourceSha,
    };
    const settings = { annotations };
    const deployment = {
      id: prior.receipt.cloudflare.deploymentId,
      annotations,
      versions: [
        { version_id: prior.receipt.cloudflare.versionId, percentage: 100 },
      ],
    };
    const version = { id: prior.receipt.cloudflare.versionId, annotations };
    const items = [{ id: version.id, number: 2 }];
    validateEstablishedLiveVersion(settings, deployment, version, items, prior);
    assert.throws(() =>
      validateEstablishedLiveVersion(
        settings,
        { ...deployment, id: evidence.secretStageBaseline.deploymentId },
        version,
        items,
        prior,
      ),
    );
    assert.throws(() =>
      validateEstablishedLiveVersion(
        settings,
        {
          ...deployment,
          versions: [
            {
              version_id: evidence.secretStageBaseline.versionId,
              percentage: 100,
            },
          ],
        },
        version,
        items,
        prior,
      ),
    );
    assert.throws(() =>
      validateEstablishedLiveVersion(
        settings,
        deployment,
        version,
        [...items, { id: evidence.secretStageBaseline.versionId, number: 3 }],
        prior,
      ),
    );
  }

  const prior66 = structuredClone(prior);
  prior66.receipt.cloudflare.migrationCount = 66;
  prior66.receipt.cloudflare.approvedDeliverySchema = true;
  prior66.receipt.cloudflare.approvedDeliveryViews = 2;
  prior66.receipt.cloudflare.approvedDeliveryIndexes = 3;
  prior66.receipt.cloudflare.approvedDeliveryTriggers = 3;
  prior66.receipt.nativeProofs.scopedCollaboration = structuredClone(
    evidence.collaboration,
  );
  prior66.receipt.approvedDeliveryRestore = approvedDeliveryRestoreReceipt(
    evidence.approvedDeliveryRestoreManifest,
    evidence.approvedDeliveryRestoreManifestSha256,
  );
  prior66.receiptSha256 = sha256(
    JSON.stringify(prior66.receipt, null, 2) + '\n',
  );
  validatePriorDeployment(
    prior66,
    evidence.migrationHashes,
    evidence.oracleManifestSha256,
    evidence.approvedDeliveryRestoreManifest,
    evidence.approvedDeliveryRestoreManifestSha256,
  );
  for (const mutate of [
    (receipt) => {
      receipt.approvedDeliveryRestore.migration.canonicalSha256 = '0'.repeat(
        64,
      );
    },
    (receipt) => {
      receipt.approvedDeliveryRestore.exactIndependentDrillParity = false;
    },
    (receipt) => {
      receipt.cloudflare.approvedDeliveryTriggers = 2;
    },
  ]) {
    const changed = structuredClone(prior66);
    mutate(changed.receipt);
    changed.receiptSha256 = sha256(
      JSON.stringify(changed.receipt, null, 2) + '\n',
    );
    assert.throws(() =>
      validatePriorDeployment(
        changed,
        evidence.migrationHashes,
        evidence.oracleManifestSha256,
        evidence.approvedDeliveryRestoreManifest,
        evidence.approvedDeliveryRestoreManifestSha256,
      ),
    );
  }

  for (const change of [
    { restoreDatabaseId: DATABASE_ID },
    { foreignKeyViolations: 1 },
    { migration60Sha256: '0'.repeat(64) },
    { sourceWritesDuringRestore: 1 },
  ]) {
    assert.throws(() =>
      validatePinRestoreManifest(
        { ...evidence.pinRestore, ...change },
        evidence.migrationHashes['0060_photo_pins.sql'],
      ),
    );
  }
  for (const change of [
    { status: 'not-passed' },
    { sourceSchemaVersion: 61 },
    { targetSchemaVersion: 64 },
    { sourceWritesDuringRestore: 1 },
    { oldTablesPreserved: false },
    { upgradedRowCount: 3038 },
    { foreignKeyViolations: 1 },
    {
      migrations: evidence.oracleManifest.migrations.map((migration, index) =>
        index === 2 ? { ...migration, sha256: '0'.repeat(64) } : migration,
      ),
    },
    {
      adoption: {
        ...evidence.oracleManifest.adoption,
        exactIndependentDrillParity: false,
      },
    },
  ])
    assert.throws(() =>
      validateOracleStorageRestoreManifest(
        { ...evidence.oracleManifest, ...change },
        evidence.migrationHashes,
        evidence.rawMigrationHashes,
      ),
    );
  for (const change of [
    { status: 'failed' },
    { accountId: 'another-account' },
    { sourceDatabaseId: 'another-database' },
    { restoreDatabaseId: DATABASE_ID },
    { targetSchemaVersion: 65 },
    { sourceWritesDuringRestore: 1 },
    { backupSha256: 'invalid' },
    { oldTablesPreserved: false },
    { exactSchemaAndRowsMatchSource: false },
    { exactIndependentDrillParity: false },
    { foreignKeyViolations: 1 },
    { commandsAllSucceeded: false },
    {
      migration: {
        ...evidence.approvedDeliveryRestoreManifest.migration,
        sha256: 'invalid',
      },
    },
    {
      migration: {
        ...evidence.approvedDeliveryRestoreManifest.migration,
        canonicalSha256: '0'.repeat(64),
      },
    },
  ])
    assert.throws(() =>
      validateApprovedDeliveryRestoreManifest(
        { ...evidence.approvedDeliveryRestoreManifest, ...change },
        evidence.migrationHashes['0066_approved_deliveries.sql'],
      ),
    );
  for (const change of [
    { schemaVersion: 64 },
    { reservationsCancelled: 19 },
    { oraclePhotoObjectWrites: 1 },
    { liveOracleVM: true },
    { checks: ORACLE_ADMISSION_CHECKS.slice(0, -1) },
    {
      sourceHashes: {
        ...evidence.oracleAdmissionSourceHashes,
        uploads: '0'.repeat(64),
      },
    },
  ])
    assert.throws(() =>
      validateOracleAdmissionProof(
        { ...evidence.oracleAdmission, ...change },
        evidence.oracleAdmissionSourceHashes,
      ),
    );
  for (const change of [
    { status: 'not-passed' },
    { workspaceId: '00000000-0000-0000-0000-000000000000' },
    { newQuotaBytes: 40_000_000_000 },
    { admissionEnabled: true },
    { otherTenantQuotasUnchanged: false },
    {
      oracleNode: {
        ...evidence.capacityBootstrap.oracleNode,
        endpoint: 'https://unapproved.invalid',
      },
    },
  ])
    assert.throws(() =>
      validateOracleCapacityBootstrap({
        ...evidence.capacityBootstrap,
        ...change,
      }),
    );
  for (const change of [
    { status: 'failed' },
    { versionId: evidence.secretStageBaseline.priorVersionId },
    { priorReceiptSha256: '0'.repeat(64) },
    { expectedNewSecrets: [] },
    {
      parity: {
        ...evidence.secretStageBaseline.parity,
        onlyTwoSecretsAdded: false,
      },
    },
    {
      after: {
        ...evidence.secretStageBaseline.after,
        plainVars: {
          ...evidence.secretStageBaseline.after.plainVars,
          STORAGE_AUTODELETE_ENABLED: 'true',
        },
      },
    },
  ])
    assert.throws(() =>
      validateOracleSecretStageBaseline(
        { ...evidence.secretStageBaseline, ...change },
        evidence.priorDeployment,
        evidence.priorReceiptSha256,
        evidence.secretStageBaselineSha256,
      ),
    );
  for (const change of [
    { restoreDatabaseId: DATABASE_ID },
    { oldTablesPreserved: false },
    { oldRowCount: 2996 },
    { foreignKeyViolations: 1 },
    { migration61Sha256: '0'.repeat(64) },
    { sourceWritesDuringRestore: 1 },
    { sourceSchemaVersion: 59 },
    { sourceBeforeBackupSha256: 'not-a-digest' },
    { adoptionCommands: [{ label: 'adopt-source-0061', exitCode: 1 }] },
  ])
    assert.throws(() =>
      validateManualDeletionRestoreManifest(
        { ...evidence.manifest, ...change },
        evidence.migrationHashes['0061_manual_album_deletion.sql'],
      ),
    );
  for (const change of [
    { targetSchemaVersion: 64 },
    { payloadBytesAfter: 1 },
    { payloadBytesBefore: 0 },
    { assetCount: 5 },
    { versionCount: 1 },
    { runnerSha256: '0'.repeat(64) },
    { migration61Sha256: '0'.repeat(64) },
    { migration62Sha256: '0'.repeat(64) },
    { migration65Sha256: '0'.repeat(64) },
    {
      sourceHashes: {
        ...evidence.deletionHashes.sourceHashes,
        r2Storage: '0'.repeat(64),
      },
    },
    { checks: DELETION_NATIVE_CHECKS.slice(0, -1) },
  ])
    assert.throws(() =>
      validateManualDeletionNative(
        { ...evidence.deletionNative, ...change },
        evidence.deletionHashes,
      ),
    );
  assert.equal(evidence.collaboration.checks, 26);
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
  for (const name of [
    'VERSION_APPROVALS_ENABLED',
    'APPROVED_DELIVERIES_ENABLED',
  ]) {
    const disabled = structuredClone(profile);
    disabled.vars[name] = 'false';
    assert.throws(() => validateProfile(disabled), /PROFILE_VARS/);
  }
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
    publicEntryEnabled: result.cloudflare.publicEntry.enabled,
  };
  console.log(JSON.stringify(summary));
  return { ...result, sourceSha, summary };
}

export { validateReleaseIdentity, validateEstablishedLiveVersion };

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
