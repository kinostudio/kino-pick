import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';

// Read-only source inventory, not deployment authorization or hosted acceptance.
export function inspectReleaseSources({
  config,
  readiness,
  configSource,
  stage,
}) {
  if (!['staging', 'production'].includes(stage))
    throw new Error('INVALID_STAGE');
  const target = config?.env?.[stage];
  if (
    !target?.vars ||
    !Array.isArray(target.d1_databases) ||
    !Array.isArray(target.r2_buckets)
  ) {
    throw new Error('INVALID_DEPLOYMENT_CONFIGURATION');
  }
  if (
    !readiness ||
    Array.isArray(readiness) ||
    typeof readiness !== 'object' ||
    Object.keys(readiness).length < 6 ||
    Object.values(readiness).some((value) => typeof value !== 'boolean')
  ) {
    throw new Error('INVALID_READINESS_RECORD');
  }
  const blockers = [];
  let origin;
  try {
    origin = new URL(target.vars.APP_URL);
  } catch {
    /* Report below without echoing input. */
  }
  if (
    !origin ||
    origin.protocol !== 'https:' ||
    origin.hostname.endsWith('.invalid') ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    blockers.push('staging_or_production_https_origin_not_configured');
  }
  if (target.vars.APP_ENV !== stage) blockers.push('environment_mismatch');
  if (target.vars.REGISTRATION_MODE !== 'closed')
    blockers.push('registration_must_remain_closed');
  if (
    target.vars.STORAGE_AUTODELETE_ENABLED !== 'false' ||
    target.vars.STORAGE_RETENTION_DRY_RUN !== 'true'
  )
    blockers.push('retention_must_remain_off_and_dry_run');
  if (target.vars.MULTI_ACCOUNT_STORAGE_ENABLED !== 'false')
    blockers.push('single_storage_node_default_required');
  const database = target.d1_databases.find((item) => item.binding === 'DB');
  const bucket = target.r2_buckets.find(
    (item) => item.binding === 'PRIMARY_STORAGE',
  );
  if (!database?.database_id || /^00000000-/.test(database.database_id))
    blockers.push('database_binding_not_configured');
  if (!bucket?.bucket_name || target.vars.R2_BUCKET_NAME !== bucket.bucket_name)
    blockers.push('storage_binding_mismatch');
  const incompleteAcceptance = Object.entries(readiness)
    .filter(([, value]) => !value)
    .map(([key]) => key)
    .sort();
  const localOnlyErrors = [
    ...new Set(
      [
        ...configSource.matchAll(
          /throw new Error\(['"]([A-Z_]+_LOCAL_ONLY)['"]\)/g,
        ),
      ].map((match) => match[1]),
    ),
  ].sort();
  return {
    kind: 'source_inventory_only',
    stage,
    blockers,
    incompleteAcceptance,
    localOnlyErrors,
    disabledFeatures: Object.entries(target.vars)
      .filter(([key, value]) => key.endsWith('_ENABLED') && value === 'false')
      .map(([key]) => key)
      .sort(),
    externalChecks: {
      workerExists: 'not_checked',
      secretNamesPresent: 'not_checked',
      realOAuth: 'not_checked',
      remoteSchemaAndRestore: 'not_checked',
      hostedProductFlows: 'not_checked',
    },
    // Never echo env/config contents or secret values.
  };
}

export async function collectReleaseInventory(root, stage) {
  const files = [
    'apps/worker/wrangler.jsonc',
    'apps/worker/deployment-readiness.json',
    'apps/worker/src/config.ts',
  ];
  const sources = await Promise.all(
    files.map((file) => readFile(resolve(root, file), 'utf8')),
  );
  const parsed = ts.parseConfigFileTextToJson(files[0], sources[0]);
  if (parsed.error) throw new Error('INVALID_WRANGLER_JSONC');
  const report = inspectReleaseSources({
    config: parsed.config,
    readiness: JSON.parse(sources[1]),
    configSource: sources[2],
    stage,
  });
  const migrations = (await readdir(resolve(root, 'apps/worker/migrations')))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  return {
    ...report,
    migrations: {
      count: migrations.length,
      latest: migrations.at(-1) ?? null,
      appliedRemotely: 'not_checked',
    },
    sourceHashes: Object.fromEntries(
      files.map((file, index) => [
        file,
        createHash('sha256').update(sources[index]).digest('hex'),
      ]),
    ),
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const { values } = parseArgs({
    options: {
      stage: { type: 'string', default: 'staging' },
      check: { type: 'boolean', default: false },
    },
  });
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const report = await collectReleaseInventory(root, values.stage);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (
      values.check &&
      (report.blockers.length || report.incompleteAcceptance.length)
    )
      process.exitCode = 1;
  } catch {
    // Configuration may contain credentials; never serialize raw parse exceptions.
    process.stderr.write(
      'Release inventory failed: invalid or unreadable source configuration.\n',
    );
    process.exitCode = 1;
  }
}
