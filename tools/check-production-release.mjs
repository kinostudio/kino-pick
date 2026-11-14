import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  validateLocal,
  validateCi,
  validateBase,
  readCi,
  readBaseResources,
  readWorker,
  readProductionReleaseState,
} from './check-production-bootstrap.mjs';
import { readSchemaAdoptions } from './production-schema-adoptions.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const ACCOUNT = 'd3e930465c0df7e89b35de3ca65ea36a';
const DB = '65d2286e-f2ac-4ad2-90e2-4b31e2f24251';
const BOOTSTRAP_DB = 'f9ce8433-ba99-4d3e-9029-28a2098e7fc4';
const STAGING_DB = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const ORIGIN = 'https://pick.kinostudio.tw';
const WORKER_ORIGIN =
  'https://kino-pick-production.kino-pick-aaron2026.workers.dev';
const secrets = [
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'KINO_GATEWAY_SECRET',
  'ORACLE_STORAGE_ACCESS_KEY_ID',
  'ORACLE_STORAGE_SECRET_ACCESS_KEY',
];
const requiredFeatures = [
  'DIRECT_UPLOAD_ENABLED',
  'GUEST_INVITE_ISSUANCE_ENABLED',
  'GUEST_EXCHANGE_ENABLED',
  'GUEST_SELECTION_ENABLED',
  'GUEST_FEEDBACK_ENABLED',
  'GUEST_TAGS_ENABLED',
  'GUEST_HISTORY_ENABLED',
  'GUEST_DOWNLOADS_ENABLED',
  'GUEST_VERSION_COMPARISON_ENABLED',
  'GUEST_COMMENTS_ENABLED',
  'GUEST_ANNOTATIONS_ENABLED',
  'FREEHAND_ANNOTATIONS_ENABLED',
  'OWNER_COMMENTS_ENABLED',
  'OWNER_ANNOTATIONS_ENABLED',
  'OWNER_ANNOTATION_AUTHORING_ENABLED',
  'OWNER_HISTORY_ENABLED',
  'PHOTO_VERSIONS_ENABLED',
  'PHOTO_VERSION_UPLOADS_ENABLED',
  'VERSION_APPROVALS_ENABLED',
  'APPROVED_DELIVERIES_ENABLED',
  'DELIVERY_ZIP_ENABLED',
  'ALBUM_ACTIVATION_ENABLED',
  'PHOTOGRAPHER_RECOMMENDATIONS_ENABLED',
  'CLOUDFLARE_IMAGE_PROCESSING_ENABLED',
  'CLIENT_ACTIVITY_ENABLED',
  'HUMAN_VIEW_TRACKING_ENABLED',
];
const need = (ok, code) => {
  if (!ok) throw new Error(code);
};
const digest = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function validateReleaseProfile(vars) {
  need(
    vars.APP_ENV === 'production' && vars.APP_URL === ORIGIN,
    'RELEASE_ORIGIN',
  );
  need(
    vars.STAGING_GUEST_VALIDATION === 'false' &&
      vars.STAGING_COLLABORATION_VALIDATION === 'false' &&
      vars.MULTI_ACCOUNT_STORAGE_ENABLED === 'false',
    'RELEASE_EXPERIMENT_FLAGS',
  );
  need(
    requiredFeatures.every((key) => vars[key] === 'true'),
    'RELEASE_REQUIRED_FEATURES',
  );
}

export function verifyProductionRelease({
  phase,
  sourceSha,
  headSha,
  repository,
  local,
  vars,
  cutover,
  prior,
  ci,
  resources,
  worker,
  state,
  unsignedStatus,
}) {
  need(['predeploy', 'postdeploy'].includes(phase), 'RELEASE_PHASE');
  need(
    repository === 'kinostudio/kino-pick' &&
      /^[a-f0-9]{40}$/.test(sourceSha ?? '') &&
      headSha === sourceSha,
    'RELEASE_SOURCE',
  );
  validateReleaseProfile(vars);
  validateCi(ci, sourceSha);
  validateBase(resources, local);
  need(
    cutover?.status === 'passed_quiesced_production_data_cutover' &&
      cutover.accountId === ACCOUNT &&
      cutover.sourceDatabaseId === STAGING_DB &&
      cutover.targetDatabaseId === DB &&
      cutover.bootstrapDatabaseId === BOOTSTRAP_DB &&
      cutover.schemaVersion === 67 &&
      cutover.exactProductParity === true &&
      cutover.foreignKeyViolations === 0 &&
      cutover.zeroLiveUploadAuthorizations === true &&
      cutover.noRunningProcessing === true &&
      cutover.sourceEntryDisabled === true &&
      cutover.schedulesDisabled === true &&
      cutover.productionBeforeWasUnchangedClone === true &&
      cutover.sourceSchemaSha256 === local.database.baselineSchemaSha256 &&
      cutover.sourceDataSha256 === local.database.productTableDataSha256 &&
      digest(cutover.assetManifestSha256),
    'RELEASE_CUTOVER_PROOF',
  );
  need(
    state?.stagingEntry?.enabled === false &&
      state.stagingEntry.previews_enabled === false &&
      Array.isArray(state.stagingSchedules?.schedules) &&
      state.stagingSchedules.schedules.length === 0,
    'STAGING_WRITER_NOT_CLOSED',
  );
  need(
    Array.isArray(state.secretNames) &&
      secrets.every((name) =>
        state.secretNames.some((secret) => secret.name === name),
      ),
    'RELEASE_SECRETS',
  );
  need(Array.isArray(worker?.settings?.bindings), 'RELEASE_BINDINGS');
  const bindings = new Map();
  for (const binding of worker.settings.bindings) {
    need(
      typeof binding.name === 'string' && !bindings.has(binding.name),
      'RELEASE_DUPLICATE_BINDING',
    );
    bindings.set(binding.name, binding);
  }
  need(
    bindings.get('DB')?.type === 'd1' &&
      bindings.get('DB').id ===
        (phase === 'predeploy' && prior === null ? BOOTSTRAP_DB : DB) &&
      bindings.get('PRIMARY_STORAGE')?.type === 'r2_bucket' &&
      bindings.get('PRIMARY_STORAGE').bucket_name === 'kino-pick-production',
    'RELEASE_RESOURCE_BINDING',
  );
  const text = (name) =>
    bindings.get(name)?.type === 'plain_text' ? bindings.get(name).text : null;
  need(
    text('APP_ENV') === 'production' &&
      text('APP_URL') === ORIGIN &&
      text('STORAGE_AUTODELETE_ENABLED') === 'false' &&
      text('STORAGE_RETENTION_DRY_RUN') === 'true' &&
      text('REGISTRATION_MODE') === 'closed',
    'RELEASE_LIVE_SAFETY',
  );
  need(
    worker.subdomain?.previews_enabled === false &&
      Array.isArray(worker.routes) &&
      worker.routes.length === 0,
    'RELEASE_PUBLIC_ROUTES',
  );
  const deployment = worker.deployments?.[0];
  need(
    deployment?.versions?.length === 1 &&
      deployment.versions[0].percentage === 100 &&
      worker.version?.id === deployment.versions[0].version_id,
    'RELEASE_ACTIVE_VERSION',
  );
  if (phase === 'predeploy') {
    if (prior === null) {
      need(
        text('PRODUCTION_RELEASE_ENABLED') === 'false' &&
          worker.subdomain.enabled === false &&
          Array.isArray(state.productionSchedules?.schedules) &&
          state.productionSchedules.schedules.length === 0 &&
          worker.version.id === cutover.bootstrapClosedVersionId,
        'RELEASE_BOOTSTRAP_PARENT',
      );
    } else {
      need(
        prior.status === 'verified_prior_production_deployment' &&
          prior.receipt?.status === 'passed_production_release' &&
          prior.receipt.cloudflare?.versionId === worker.version.id &&
          prior.receipt.cloudflare.databaseId === DB &&
          text('PRODUCTION_RELEASE_ENABLED') === 'true' &&
          worker.subdomain.enabled === true &&
          worker.version.annotations?.['workers/message'] ===
            'Kino Pick production source ' + prior.receipt.sourceSha,
        'RELEASE_PRIOR_BASELINE',
      );
    }
  } else {
    need(
      worker.version.annotations?.['workers/message'] ===
        'Kino Pick production source ' + sourceSha,
      'RELEASE_VERSION_SOURCE',
    );
    need(
      worker.subdomain.enabled === true &&
        text('PRODUCTION_RELEASE_ENABLED') === 'true',
      'RELEASE_ENTRY_STATE',
    );
    need(
      Object.entries(vars).every(([key, value]) => text(key) === value),
      'RELEASE_VARIABLE_PARITY',
    );
    need(
      state.productionSchedules?.schedules?.length === 1 &&
        state.productionSchedules.schedules[0].cron === '*/10 * * * *',
      'RELEASE_PROCESSING_SCHEDULE',
    );
    need(unsignedStatus === 404, 'RELEASE_UNSIGNED_ORIGIN_EXPOSED');
  }
  return {
    schemaVersion: 1,
    status: 'passed_production_release',
    phase,
    repository,
    sourceSha,
    createdAt: new Date().toISOString(),
    ci,
    cloudflare: {
      accountId: ACCOUNT,
      workerName: 'kino-pick-production',
      databaseId: DB,
      r2Bucket: 'kino-pick-production',
      versionId: worker.version.id,
      deploymentId: deployment.id,
      schemaVersion: 67,
      productSchemaSha256: resources.productSchemaSha256,
      storageAutodeleteEnabled: false,
      storageRetentionDryRun: true,
      signedUpstreamOnly: true,
      unsignedStatus: phase === 'postdeploy' ? unsignedStatus : null,
    },
    hostedOwnerGuestAcceptance: 'not_checked_by_deployment_gate',
  };
}

async function readJson(file, optional = false) {
  try {
    return JSON.parse(await readFile(resolve(ROOT, file), 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw new Error('RELEASE_EVIDENCE_READ');
  }
}

async function main() {
  const phase = process.argv[2]?.replace(/^--/, '');
  need(['predeploy', 'postdeploy'].includes(phase), 'RELEASE_USAGE');
  const sourceSha = process.env.RELEASE_SOURCE_SHA;
  const config = ts.readConfigFile(
    resolve(ROOT, 'apps/worker/wrangler.jsonc'),
    ts.sys.readFile,
  );
  need(!config.error && config.config, 'RELEASE_CONFIG');
  const proof = await readJson(
    'docs/releases/production-bootstrap-20261112.json',
  );
  const migrationNames = (
    await readdir(resolve(ROOT, 'apps/worker/migrations'))
  )
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const local = validateLocal({
    config: config.config,
    proof,
    migrationNames,
    release: true,
    adoptions: await readSchemaAdoptions(ROOT, migrationNames),
  });
  const vars = config.config.env.production.vars;
  const ci = await readCi(sourceSha);
  const [resources, worker, state, cutover, prior] = await Promise.all([
    readBaseResources(local),
    readWorker('postdeploy'),
    readProductionReleaseState(),
    readJson('docs/releases/production-cutover-20261112.json'),
    readJson('docs/releases/production-prior-deployment.json', true),
  ]);
  let unsignedStatus;
  if (phase === 'postdeploy') {
    const response = await fetch(WORKER_ORIGIN + '/api/health', {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    unsignedStatus = response.status;
    await response.body?.cancel();
  }
  const result = verifyProductionRelease({
    phase,
    sourceSha,
    headSha: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim(),
    repository: process.env.GITHUB_REPOSITORY,
    local,
    vars,
    cutover,
    prior,
    ci,
    resources,
    worker,
    state,
    unsignedStatus,
  });
  if (phase === 'postdeploy') {
    await mkdir(resolve(ROOT, '.local'), { recursive: true });
    await writeFile(
      resolve(ROOT, '.local/production-release-receipt.json'),
      JSON.stringify(result, null, 2) + '\n',
      { flag: 'wx' },
    );
  }
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      'production-release: blocked (' +
        (/^[A-Z0-9_]+$/.test(error?.message ?? '')
          ? error.message
          : 'RELEASE_CHECK_FAILED') +
        ')',
    );
    process.exitCode = 1;
  });
