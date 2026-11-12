import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runProductionBootstrapCheck,
  validateLocal,
  validateCi,
} from './check-production-bootstrap.mjs';

const sourceSha = 'a'.repeat(40);

test('accepts public and historical private CI receipts for the exact repository', () => {
  const ci = {
    repository: 'kinostudio/kino-pick',
    workflowPath: '.github/workflows/ci.yml',
    workflowName: 'checks',
    headSha: sourceSha,
    event: 'push',
    headBranch: 'main',
    headRepository: 'kinostudio/kino-pick',
    status: 'completed',
    conclusion: 'success',
    runId: 123,
    runNumber: 456,
  };
  for (const privateRepository of [false, true]) {
    validateCi({ ...ci, privateRepository }, sourceSha);
  }
  assert.throws(() => validateCi(ci, sourceSha), { message: 'CI_REPOSITORY' });
  assert.throws(
    () =>
      validateCi(
        { ...ci, privateRepository: false, repository: 'other/repo' },
        sourceSha,
      ),
    { message: 'CI_REPOSITORY' },
  );
  assert.throws(
    () =>
      validateCi(
        { ...ci, privateRepository: false, headRepository: 'other/repo' },
        sourceSha,
      ),
    { message: 'CI_NOT_MAIN_REPOSITORY_PUSH' },
  );
  assert.throws(
    () =>
      validateCi(
        { ...ci, privateRepository: false, conclusion: 'failure' },
        sourceSha,
      ),
    { message: 'CI_NOT_SUCCESSFUL' },
  );
  assert.throws(
    () => validateCi({ ...ci, privateRepository: false }, 'b'.repeat(40)),
    { message: 'CI_SOURCE_SHA' },
  );
});
const databaseId = 'f9ce8433-ba99-4d3e-9029-28a2098e7fc4';
const accountId = 'd3e930465c0df7e89b35de3ca65ea36a';
const migrationNames = Array.from(
  { length: 67 },
  (_, index) => String(index + 1).padStart(4, '0') + '_migration.sql',
);

function localEvidence() {
  const config = {
    env: {
      production: {
        name: 'kino-pick-production',
        account_id: accountId,
        workers_dev: false,
        preview_urls: false,
        routes: [],
        triggers: { crons: [] },
        vars: {
          PRODUCTION_RELEASE_ENABLED: 'false',
          REGISTRATION_MODE: 'closed',
          STORAGE_AUTODELETE_ENABLED: 'false',
          STORAGE_RETENTION_DRY_RUN: 'true',
          R2_BUCKET_NAME: 'kino-pick-production',
          R2_ACCOUNT_ID: accountId,
        },
        d1_databases: [
          {
            binding: 'DB',
            database_id: databaseId,
            database_name: 'kino-pick-production',
          },
        ],
        r2_buckets: [
          { binding: 'PRIMARY_STORAGE', bucket_name: 'kino-pick-production' },
        ],
      },
    },
  };
  const proof = {
    status: 'production_bootstrap_in_progress',
    accountId,
    productionDatabase: {
      id: databaseId,
      name: 'kino-pick-production',
      dataImported: true,
      migrationCount: 67,
      foreignKeyViolationCount: 0,
      exactSourceExportParity: true,
      productionDryRunPassed: true,
      productTables: 151,
      productRows: 3644,
      productSchemaSha256: 'b'.repeat(64),
      productTableDataSha256: 'c'.repeat(64),
      parityProofLocalPath:
        '.local/production-cutover-20261112/production67-parity-proof.json',
    },
  };
  return validateLocal({ config, proof, migrationNames });
}

function mockProvider({
  openSubdomain = false,
  existingWorker = false,
  ciEvent = 'push',
  managedR2DomainEnabled = false,
} = {}) {
  const sourceMessage = 'Kino Pick production bootstrap source ' + sourceSha;
  return {
    async readCi() {
      return {
        privateRepository: true,
        repository: 'kinostudio/kino-pick',
        workflowPath: '.github/workflows/ci.yml',
        workflowName: 'checks',
        headSha: sourceSha,
        status: 'completed',
        conclusion: 'success',
        event: ciEvent,
        headBranch: 'main',
        headRepository: 'kinostudio/kino-pick',
        runId: 123,
        runNumber: 456,
      };
    },
    async readBaseResources() {
      return {
        accountId,
        database: { id: databaseId, name: 'kino-pick-production' },
        migrationNames,
        foreignKeyViolationCount: 0,
        productSchemaObjectCount: 1203,
        productSchemaSha256: 'b'.repeat(64),
        managedR2DomainEnabled,
        enabledCustomR2DomainCount: 0,
        customR2DomainFlagsValid: true,
      };
    },
    async readWorker(phase) {
      if (phase === 'predeploy' && !existingWorker) return null;
      return {
        routes: [],
        settings: {
          bindings: [
            { name: 'DB', type: 'd1', id: databaseId },
            {
              name: 'PRIMARY_STORAGE',
              type: 'r2_bucket',
              bucket_name: 'kino-pick-production',
            },
            {
              name: 'PRODUCTION_RELEASE_ENABLED',
              type: 'plain_text',
              text: 'false',
            },
            {
              name: 'STORAGE_AUTODELETE_ENABLED',
              type: 'plain_text',
              text: 'false',
            },
            {
              name: 'STORAGE_RETENTION_DRY_RUN',
              type: 'plain_text',
              text: 'true',
            },
          ],
        },
        subdomain: { enabled: openSubdomain, previews_enabled: false },
        deployments: [
          {
            id: '01234567-89ab-cdef-0123-456789abcdef',
            created_on: '2026-11-12T00:00:00.000Z',
            versions: [
              {
                version_id: 'abcdef01-2345-6789-abcd-ef0123456789',
                percentage: 100,
              },
            ],
          },
        ],
        version: {
          id: 'abcdef01-2345-6789-abcd-ef0123456789',
          annotations: { 'workers/message': sourceMessage },
        },
      };
    },
  };
}

test('production bootstrap gate accepts exact closed state and rejects an open subdomain', async () => {
  const local = localEvidence();
  const base = {
    sourceSha,
    headSha: sourceSha,
    repository: 'kinostudio/kino-pick',
    local,
  };
  const predeploy = await runProductionBootstrapCheck({
    ...base,
    phase: 'predeploy',
    provider: mockProvider(),
  });
  assert.equal(predeploy.status, 'passed_closed_production_bootstrap');
  assert.equal(predeploy.phase, 'predeploy');
  assert.equal(predeploy.cloudflare.existingWorker, false);

  const postdeploy = await runProductionBootstrapCheck({
    ...base,
    phase: 'postdeploy',
    provider: mockProvider(),
  });
  assert.equal(postdeploy.cloudflare.activeVersionPercentage, 100);
  assert.equal(postdeploy.cloudflare.subdomainEnabled, false);

  await assert.rejects(
    () =>
      runProductionBootstrapCheck({
        ...base,
        phase: 'postdeploy',
        provider: mockProvider({ openSubdomain: true }),
      }),
    { message: 'WORKER_SUBDOMAIN_OPEN' },
  );

  await assert.rejects(
    () =>
      runProductionBootstrapCheck({
        ...base,
        phase: 'predeploy',
        provider: mockProvider({ existingWorker: true, openSubdomain: true }),
      }),
    { message: 'WORKER_SUBDOMAIN_OPEN' },
  );
  await assert.rejects(
    () =>
      runProductionBootstrapCheck({
        ...base,
        phase: 'predeploy',
        provider: mockProvider({ ciEvent: 'pull_request' }),
      }),
    { message: 'CI_NOT_MAIN_REPOSITORY_PUSH' },
  );
  await assert.rejects(
    () =>
      runProductionBootstrapCheck({
        ...base,
        phase: 'predeploy',
        provider: mockProvider({ managedR2DomainEnabled: 'unknown' }),
      }),
    { message: 'R2_MANAGED_RESPONSE' },
  );
});
