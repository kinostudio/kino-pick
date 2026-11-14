import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { validateSchemaAdoptions } from './production-schema-adoptions.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const ACCOUNT = 'd3e930465c0df7e89b35de3ca65ea36a';
const DB_ID = 'f9ce8433-ba99-4d3e-9029-28a2098e7fc4';
const DB_NAME = 'kino-pick-production';
const LIVE_DB_ID = '65d2286e-f2ac-4ad2-90e2-4b31e2f24251';
const LIVE_DB_NAME = 'kino-pick-production-live';
const BUCKET = 'kino-pick-production';
const WORKER = 'kino-pick-production';
const REPO = 'kinostudio/kino-pick';
const PROOF = 'docs/releases/production-bootstrap-20261112.json';
const RECEIPT = '.local/production-bootstrap-receipt.json';
const STATUS = 'passed_closed_production_bootstrap';

function need(ok, code) {
  if (!ok) throw new Error(code);
}

function hashSchema(rows) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const lines = rows.map((row) => JSON.stringify(canonical(row))).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

const excludedSchemaName = (name) =>
  typeof name === 'string' &&
  (name === 'd1_migrations' ||
    name.startsWith('_cf_') ||
    name.startsWith('sqlite_'));

export function validateLocal({
  config,
  proof,
  migrationNames,
  release = false,
  adoptions = null,
}) {
  const p = config?.env?.production;
  const d = proof?.productionDatabase;
  const targetId = release ? LIVE_DB_ID : DB_ID;
  const targetName = release ? LIVE_DB_NAME : DB_NAME;
  need(p?.name === WORKER && p.account_id === ACCOUNT, 'PROFILE_TARGET');
  need(
    p.workers_dev === release && p.preview_urls === false,
    'PROFILE_PUBLIC_ENTRY',
  );
  need(Array.isArray(p.routes) && p.routes.length === 0, 'PROFILE_ROUTES');
  need(
    JSON.stringify(p.triggers?.crons) ===
      JSON.stringify(release ? ['*/10 * * * *'] : []),
    'PROFILE_CRONS',
  );
  need(
    p.vars?.PRODUCTION_RELEASE_ENABLED === String(release),
    'PROFILE_RELEASE_FLAG',
  );
  need(p.vars?.REGISTRATION_MODE === 'closed', 'PROFILE_REGISTRATION');
  need(
    p.vars?.STORAGE_AUTODELETE_ENABLED === 'false' &&
      p.vars?.STORAGE_RETENTION_DRY_RUN === 'true',
    'PROFILE_RETENTION_GUARD',
  );
  need(
    p.vars?.R2_BUCKET_NAME === BUCKET && p.vars?.R2_ACCOUNT_ID === ACCOUNT,
    'PROFILE_R2',
  );
  need(
    p.d1_databases?.length === 1 &&
      p.d1_databases[0].binding === 'DB' &&
      p.d1_databases[0].database_name === targetName &&
      p.d1_databases[0].database_id === targetId,
    'PROFILE_D1',
  );
  need(
    p.r2_buckets?.length === 1 &&
      p.r2_buckets[0].binding === 'PRIMARY_STORAGE' &&
      p.r2_buckets[0].bucket_name === BUCKET,
    'PROFILE_R2_BINDING',
  );
  need(proof?.status === 'production_bootstrap_in_progress', 'PROOF_STATUS');
  need(proof?.accountId === ACCOUNT, 'PROOF_ACCOUNT');
  need(d?.id === targetId && d.name === targetName, 'PROOF_DATABASE');
  need(
    d.dataImported === true &&
      d.migrationCount === 67 &&
      d.foreignKeyViolationCount === 0 &&
      d.exactSourceExportParity === true &&
      d.productionDryRunPassed === true,
    'PROOF_PARITY_CHECKPOINT',
  );
  need(
    Number.isInteger(d.productTables) && d.productTables > 0,
    'PROOF_TABLE_SUMMARY',
  );
  need(
    Number.isInteger(d.productRows) && d.productRows >= 0,
    'PROOF_ROW_SUMMARY',
  );
  need(/^[a-f0-9]{64}$/.test(d.productSchemaSha256 ?? ''), 'PROOF_SCHEMA_HASH');
  need(
    /^[a-f0-9]{64}$/.test(d.productTableDataSha256 ?? ''),
    'PROOF_DATA_HASH',
  );
  need(
    d.parityProofLocalPath ===
      (release
        ? '.local/production-cutover-20261112/production67-final-parity-proof.json'
        : '.local/production-cutover-20261112/production67-parity-proof.json'),
    'PROOF_PARITY_PATH',
  );
  const names = [...migrationNames].sort();
  // Later migrations are accepted only with recorded production adoption
  // evidence; without that record the cutover baseline of exactly 67 holds.
  const adopted = adoptions
    ? validateSchemaAdoptions(adoptions.record, {
        names,
        fileSha256: adoptions.fileSha256,
        baselineSchemaSha256: d.productSchemaSha256,
      })
    : null;
  need(
    names.length === (adopted ? adopted.expectedMigrationCount : 67) &&
      names.every(
        (name, i) =>
          /^\d{4}_.+\.sql$/.test(name) && +name.slice(0, 4) === i + 1,
      ),
    'LOCAL_MIGRATION_ORDER',
  );
  return {
    migrationNames: names,
    database: {
      id: d.id,
      name: d.name,
      migrationCount: d.migrationCount,
      foreignKeyViolationCount: d.foreignKeyViolationCount,
      exactSourceExportParity: d.exactSourceExportParity,
      productTables: d.productTables,
      productRows: d.productRows,
      productSchemaSha256: adopted
        ? adopted.expectedSchemaSha256
        : d.productSchemaSha256,
      baselineSchemaSha256: d.productSchemaSha256,
      productTableDataSha256: d.productTableDataSha256,
      parityProofLocalPath: d.parityProofLocalPath,
    },
  };
}

function validateCi(ci, sha) {
  need(
    typeof ci?.privateRepository === 'boolean' && ci.repository === REPO,
    'CI_REPOSITORY',
  );
  need(
    ci.workflowPath === '.github/workflows/ci.yml' &&
      ci.workflowName === 'checks',
    'CI_WORKFLOW',
  );
  need(ci.headSha === sha, 'CI_SOURCE_SHA');
  need(
    ci.event === 'push' &&
      ci.headBranch === 'main' &&
      ci.headRepository === REPO,
    'CI_NOT_MAIN_REPOSITORY_PUSH',
  );
  need(
    ci.status === 'completed' && ci.conclusion === 'success',
    'CI_NOT_SUCCESSFUL',
  );
  need(
    Number.isInteger(ci.runId) && Number.isInteger(ci.runNumber),
    'CI_RUN_ID',
  );
}

function validateBase(state, local) {
  need(state?.accountId === ACCOUNT, 'CF_ACCOUNT');
  need(
    state?.database?.id === local.database.id &&
      state.database.name === local.database.name,
    'CF_DATABASE',
  );
  need(
    JSON.stringify(state.migrationNames) ===
      JSON.stringify(local.migrationNames),
    'CF_MIGRATION_LEDGER',
  );
  need(state.foreignKeyViolationCount === 0, 'CF_FOREIGN_KEYS');
  need(
    Number.isInteger(state.productSchemaObjectCount) &&
      state.productSchemaObjectCount > 0 &&
      state.productSchemaSha256 === local.database.productSchemaSha256,
    'CF_PRODUCT_SCHEMA',
  );
  need(
    typeof state.managedR2DomainEnabled === 'boolean',
    'R2_MANAGED_RESPONSE',
  );
  need(state.managedR2DomainEnabled === false, 'R2_MANAGED_PUBLIC');
  need(state.customR2DomainFlagsValid === true, 'R2_CUSTOM_RESPONSE');
  need(state.enabledCustomR2DomainCount === 0, 'R2_CUSTOM_PUBLIC');
}

function bindingsOf(worker) {
  need(Array.isArray(worker?.settings?.bindings), 'WORKER_BINDINGS');
  const result = new Map();
  for (const binding of worker.settings.bindings) {
    need(
      typeof binding?.name === 'string' && !result.has(binding.name),
      'WORKER_DUPLICATE_BINDING',
    );
    result.set(binding.name, binding);
  }
  return result;
}

function validateClosedWorker(worker) {
  need(worker?.subdomain?.enabled === false, 'WORKER_SUBDOMAIN_OPEN');
  need(worker.subdomain.previews_enabled === false, 'WORKER_PREVIEWS_OPEN');
  need(
    Array.isArray(worker.routes) && worker.routes.length === 0,
    'WORKER_ROUTES_OPEN',
  );
  const bindings = bindingsOf(worker);
  need(
    bindings.get('PRODUCTION_RELEASE_ENABLED')?.type === 'plain_text' &&
      bindings.get('PRODUCTION_RELEASE_ENABLED').text === 'false',
    'WORKER_RELEASE_ENABLED',
  );
  return bindings;
}

function validateDeployedWorker(worker, sha) {
  const bindings = validateClosedWorker(worker);
  need(
    bindings.get('DB')?.type === 'd1' && bindings.get('DB').id === DB_ID,
    'WORKER_D1_BINDING',
  );
  need(
    bindings.get('PRIMARY_STORAGE')?.type === 'r2_bucket' &&
      bindings.get('PRIMARY_STORAGE').bucket_name === BUCKET,
    'WORKER_R2_BINDING',
  );
  need(
    bindings.get('STORAGE_AUTODELETE_ENABLED')?.type === 'plain_text' &&
      bindings.get('STORAGE_AUTODELETE_ENABLED').text === 'false' &&
      bindings.get('STORAGE_RETENTION_DRY_RUN')?.type === 'plain_text' &&
      bindings.get('STORAGE_RETENTION_DRY_RUN').text === 'true',
    'WORKER_RETENTION_GUARD',
  );
  const deployment = worker.deployments?.[0];
  need(/^[a-f0-9-]{36}$/.test(deployment?.id ?? ''), 'WORKER_DEPLOYMENT');
  need(
    Array.isArray(deployment.versions) &&
      deployment.versions.length === 1 &&
      deployment.versions[0].percentage === 100,
    'WORKER_ACTIVE_VERSION',
  );
  const versionId = deployment.versions[0].version_id;
  const message = 'Kino Pick production bootstrap source ' + sha;
  need(
    /^[a-f0-9-]{36}$/.test(versionId ?? '') &&
      worker.version?.id === versionId &&
      worker.version.annotations?.['workers/message'] === message,
    'WORKER_VERSION_SOURCE',
  );
  return { deploymentId: deployment.id, versionId, sourceMessage: message };
}

export async function runProductionBootstrapCheck({
  phase,
  sourceSha,
  headSha,
  repository,
  local,
  provider,
}) {
  need(phase === 'predeploy' || phase === 'postdeploy', 'PHASE');
  need(
    /^[a-f0-9]{40}$/.test(sourceSha ?? '') && sourceSha === headSha,
    'CHECKOUT_SHA',
  );
  need(repository === REPO, 'REPOSITORY');
  const ci = await provider.readCi(sourceSha);
  validateCi(ci, sourceSha);
  const state = await provider.readBaseResources(local);
  validateBase(state, local);
  const result = {
    schemaVersion: 1,
    status: STATUS,
    repository: REPO,
    phase,
    sourceSha,
    createdAt: new Date().toISOString(),
    ci: {
      workflowPath: '.github/workflows/ci.yml',
      workflowName: 'checks',
      runId: ci.runId,
      runNumber: ci.runNumber,
      headSha: ci.headSha,
      status: ci.status,
      conclusion: ci.conclusion,
      event: ci.event,
      headBranch: ci.headBranch,
    },
    parityCheckpoint: local.database,
    cloudflare: {
      accountId: ACCOUNT,
      databaseId: DB_ID,
      databaseName: DB_NAME,
      migrationCount: 67,
      foreignKeyViolationCount: 0,
      productSchemaObjectCount: state.productSchemaObjectCount,
      productSchemaSha256: state.productSchemaSha256,
      r2Bucket: BUCKET,
      managedR2DomainEnabled: false,
      enabledCustomR2DomainCount: 0,
    },
  };
  const worker = await provider.readWorker(phase);
  if (phase === 'predeploy') {
    if (worker !== null) validateClosedWorker(worker);
    result.cloudflare.existingWorker = worker !== null;
    return result;
  }
  const deployed = validateDeployedWorker(worker, sourceSha);
  Object.assign(result.cloudflare, {
    workerName: WORKER,
    subdomainEnabled: false,
    previewUrlsEnabled: false,
    routes: 0,
    productionReleaseEnabled: false,
    storageAutodeleteEnabled: false,
    storageRetentionDryRun: true,
    deploymentId: deployed.deploymentId,
    versionId: deployed.versionId,
    activeVersionPercentage: 100,
    sourceMessage: deployed.sourceMessage,
  });
  return result;
}

async function jsonApi(url, token, service, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept:
          service === 'github'
            ? 'application/vnd.github+json'
            : 'application/json',
        ...(service === 'github'
          ? {
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'kino-pic-production-bootstrap-gate',
            }
          : { 'Content-Type': 'application/json' }),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(25000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || (service === 'cloudflare' && body?.success !== true))
      throw new Error(service.toUpperCase() + '_HTTP_' + response.status);
    return service === 'cloudflare' ? body.result : body;
  } catch (error) {
    if (
      new RegExp('^' + service.toUpperCase() + '_HTTP_\\d+$').test(
        error?.message ?? '',
      )
    )
      throw error;
    throw new Error(service.toUpperCase() + '_UNAVAILABLE');
  }
}

async function readCi(sha) {
  const token = process.env.GITHUB_TOKEN;
  need(typeof token === 'string' && token.length > 0, 'GITHUB_TOKEN_MISSING');
  const get = (path) =>
    jsonApi('https://api.github.com' + path, token, 'github');
  const repo = await get('/repos/' + REPO);
  need(
    repo.full_name === REPO && typeof repo.private === 'boolean',
    'CI_REPOSITORY',
  );
  const workflow = await get('/repos/' + REPO + '/actions/workflows/ci.yml');
  need(
    workflow.path === '.github/workflows/ci.yml' &&
      workflow.name === 'checks' &&
      Number.isInteger(workflow.id),
    'CI_WORKFLOW',
  );
  const result = await get(
    '/repos/' +
      REPO +
      '/actions/workflows/' +
      workflow.id +
      '/runs?head_sha=' +
      sha +
      '&per_page=100',
  );
  need(Array.isArray(result.workflow_runs), 'CI_RUNS');
  const runs = result.workflow_runs.filter((run) => run.head_sha === sha);
  runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const run = runs[0];
  need(run?.repository?.full_name === REPO, 'CI_RUN_REPOSITORY');
  return {
    privateRepository: repo.private,
    repository: REPO,
    workflowPath: workflow.path,
    workflowName: workflow.name,
    headSha: run.head_sha,
    event: run.event,
    headBranch: run.head_branch,
    headRepository: run.head_repository?.full_name,
    status: run.status,
    conclusion: run.conclusion,
    runId: run.id,
    runNumber: run.run_number,
  };
}

function cfToken() {
  need(process.env.CLOUDFLARE_ACCOUNT_ID === ACCOUNT, 'CF_ACCOUNT_TARGET');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  need(typeof token === 'string' && token.length > 0, 'CF_TOKEN_MISSING');
  return token;
}

export async function readProductionReleaseState() {
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT;
  const get = (path) => jsonApi(base + path, cfToken(), 'cloudflare');
  const [stagingEntry, stagingSchedules, secretNames, productionSchedules] =
    await Promise.all([
      get('/workers/scripts/kino-pic-staging/subdomain'),
      get('/workers/scripts/kino-pic-staging/schedules'),
      get('/workers/scripts/' + WORKER + '/secrets'),
      get('/workers/scripts/' + WORKER + '/schedules'),
    ]);
  return { stagingEntry, stagingSchedules, secretNames, productionSchedules };
}

export { readCi, readBaseResources, readWorker, validateCi, validateBase };

async function readBaseResources(local) {
  const targetId = local.database.id;
  const targetName = local.database.name;
  need(
    (targetId === DB_ID && targetName === DB_NAME) ||
      (targetId === LIVE_DB_ID && targetName === LIVE_DB_NAME),
    'CF_DATABASE_TARGET',
  );
  const token = cfToken();
  const cf = (path, init) =>
    jsonApi(
      'https://api.cloudflare.com/client/v4' + path,
      token,
      'cloudflare',
      init,
    );
  const query = async (sql) => {
    const result = await cf(
      '/accounts/' + ACCOUNT + '/d1/database/' + targetId + '/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      },
    );
    need(Array.isArray(result) && result.length === 1, 'D1_QUERY_RESULT');
    const item = result[0];
    need(
      item.success === true && Array.isArray(item.results),
      'D1_QUERY_FAILED',
    );
    need(
      item.meta?.changed_db !== true &&
        (item.meta?.changes ?? 0) === 0 &&
        (item.meta?.rows_written ?? 0) === 0,
      'D1_QUERY_NOT_READONLY',
    );
    return item.results;
  };
  const [account, databases, managed, custom, ledger, fk, schema] =
    await Promise.all([
      cf('/accounts/' + ACCOUNT),
      cf('/accounts/' + ACCOUNT + '/d1/database?per_page=100'),
      cf('/accounts/' + ACCOUNT + '/r2/buckets/' + BUCKET + '/domains/managed'),
      cf('/accounts/' + ACCOUNT + '/r2/buckets/' + BUCKET + '/domains/custom'),
      query('SELECT id, name FROM d1_migrations ORDER BY id'),
      query('SELECT * FROM pragma_foreign_key_check'),
      query(
        'SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name',
      ),
    ]);
  need(account?.id === ACCOUNT, 'CF_ACCOUNT');
  const dbs = databases.filter(
    (db) => db.uuid === targetId || db.database_id === targetId,
  );
  need(
    dbs.length === 1 &&
      (dbs[0].name === targetName || dbs[0].database_name === targetName),
    'CF_DATABASE',
  );
  need(typeof managed?.enabled === 'boolean', 'R2_MANAGED_RESPONSE');
  need(Array.isArray(custom?.domains), 'R2_CUSTOM_RESPONSE');
  need(
    custom.domains.every((domain) => typeof domain?.enabled === 'boolean'),
    'R2_CUSTOM_RESPONSE',
  );
  const productSchema = schema.filter(
    (row) => !excludedSchemaName(row.name) && !excludedSchemaName(row.tbl_name),
  );
  return {
    accountId: account.id,
    database: { id: targetId, name: targetName },
    migrationNames: ledger.map((row) => row.name),
    foreignKeyViolationCount: fk.length,
    productSchemaObjectCount: productSchema.length,
    productSchemaSha256: hashSchema(productSchema),
    managedR2DomainEnabled: managed.enabled,
    enabledCustomR2DomainCount: custom.domains.filter((d) => d.enabled).length,
    customR2DomainFlagsValid: true,
    expectedSchemaSha256: local.database.productSchemaSha256,
  };
}

async function readWorker(phase) {
  const token = cfToken();
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT;
  const prefix = '/workers/scripts/' + WORKER;
  const cf = (path) => jsonApi(base + path, token, 'cloudflare');
  let settings;
  try {
    settings = await cf(prefix + '/settings');
  } catch (error) {
    if (phase === 'predeploy' && error?.message === 'CLOUDFLARE_HTTP_404')
      return null;
    throw error;
  }
  const [subdomain, scripts] = await Promise.all([
    cf(prefix + '/subdomain'),
    cf('/workers/scripts?per_page=100'),
  ]);
  need(Array.isArray(scripts), 'WORKER_SCRIPT_LIST');
  const found = scripts.filter((script) => script.id === WORKER);
  need(found.length === 1, 'WORKER_SCRIPT_IDENTITY');
  const worker = { settings, subdomain, routes: found[0].routes ?? [] };
  if (phase === 'predeploy') return worker;
  const result = await cf(prefix + '/deployments');
  need(
    Array.isArray(result?.deployments) && result.deployments.length > 0,
    'WORKER_DEPLOYMENTS',
  );
  const deployment = [...result.deployments].sort(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on),
  )[0];
  const versionId = deployment.versions?.[0]?.version_id;
  need(/^[a-f0-9-]{36}$/.test(versionId ?? ''), 'WORKER_VERSION_ID');
  worker.deployments = [deployment];
  worker.version = await cf(prefix + '/versions/' + versionId);
  return worker;
}

async function localEvidence() {
  const parsed = ts.readConfigFile(
    resolve(ROOT, 'apps/worker/wrangler.jsonc'),
    ts.sys.readFile,
  );
  need(!parsed.error && parsed.config, 'PROFILE_JSONC');
  let proof;
  try {
    proof = JSON.parse(await readFile(resolve(ROOT, PROOF), 'utf8'));
  } catch {
    throw new Error('PROOF_READ');
  }
  const migrations = (await readdir(resolve(ROOT, 'apps/worker/migrations')))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  return validateLocal({
    config: parsed.config,
    proof,
    migrationNames: migrations,
  });
}

async function saveReceipt(receipt) {
  const path = resolve(ROOT, RECEIPT);
  try {
    const prior = JSON.parse(await readFile(path, 'utf8'));
    need(
      prior.repository === REPO &&
        prior.sourceSha === receipt.sourceSha &&
        prior.status === STATUS &&
        prior.cloudflare?.deploymentId === receipt.cloudflare.deploymentId &&
        prior.cloudflare?.versionId === receipt.cloudflare.versionId,
      'RECEIPT_CONFLICT',
    );
    const current = { ...receipt };
    const previous = { ...prior };
    delete current.createdAt;
    delete previous.createdAt;
    need(
      JSON.stringify(previous) === JSON.stringify(current),
      'RECEIPT_CONFLICT',
    );
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
    });
  } catch (error) {
    throw new Error(
      error?.code === 'EEXIST' ? 'RECEIPT_CONFLICT' : 'RECEIPT_WRITE',
    );
  }
}

async function main() {
  const phase = process.argv[2]?.replace(/^--/, '');
  need(phase === 'predeploy' || phase === 'postdeploy', 'USAGE');
  const sourceSha = process.env.RELEASE_SOURCE_SHA ?? '';
  let headSha;
  try {
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('GIT_HEAD');
  }
  const result = await runProductionBootstrapCheck({
    phase,
    sourceSha,
    headSha,
    repository: process.env.GITHUB_REPOSITORY,
    local: await localEvidence(),
    provider: { readCi, readBaseResources, readWorker },
  });
  if (phase === 'postdeploy') await saveReceipt(result);
  console.log(
    'production-bootstrap-' +
      phase +
      ': passed source=' +
      sourceSha +
      ' ci-run=' +
      result.ci.runId +
      ' database=' +
      DB_NAME +
      ' migrations=67 fk=0 schema=' +
      result.cloudflare.productSchemaSha256 +
      ' r2-public-domains=0' +
      (phase === 'postdeploy'
        ? ' deployment=' +
          result.cloudflare.deploymentId +
          ' version=' +
          result.cloudflare.versionId +
          ' traffic=100% closed=true receipt=' +
          RECEIPT
        : ' closed=true'),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const code = /^[A-Z0-9_]+$/.test(error?.message ?? '')
      ? error.message
      : 'PRODUCTION_BOOTSTRAP_FAILED';
    console.error('production-bootstrap: blocked (' + code + ')');
    process.exitCode = 1;
  });
}
