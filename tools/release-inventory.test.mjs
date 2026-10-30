import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectReleaseSources } from './release-inventory.mjs';
const fixture = () => ({
  stage: 'staging',
  config: {
    env: {
      staging: {
        vars: {
          APP_ENV: 'staging',
          APP_URL: 'https://configure-staging.invalid',
          REGISTRATION_MODE: 'closed',
          STORAGE_AUTODELETE_ENABLED: 'false',
          STORAGE_RETENTION_DRY_RUN: 'true',
          MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
          R2_BUCKET_NAME: 'private-test',
          DIRECT_UPLOAD_ENABLED: 'false',
        },
        d1_databases: [
          {
            binding: 'DB',
            database_id: '00000000-0000-4000-8000-000000000001',
          },
        ],
        r2_buckets: [
          { binding: 'PRIMARY_STORAGE', bucket_name: 'private-test' },
        ],
      },
    },
  },
  readiness: {
    oauth: false,
    restore: false,
    upload: false,
    sessions: false,
    abuse: false,
    billing: false,
  },
  configSource: "throw new Error('GUEST_EXCHANGE_LOCAL_ONLY');",
});
test('placeholder bindings and source-only acceptance cannot appear as deployable', () => {
  const report = inspectReleaseSources(fixture());
  assert.ok(
    report.blockers.includes(
      'staging_or_production_https_origin_not_configured',
    ),
  );
  assert.ok(report.blockers.includes('database_binding_not_configured'));
  assert.equal(report.incompleteAcceptance.length, 6);
  assert.deepEqual(report.localOnlyErrors, ['GUEST_EXCHANGE_LOCAL_ONLY']);
  assert.equal(report.externalChecks.realOAuth, 'not_checked');
});
test('configured sources do not fabricate hosted or secret acceptance', () => {
  const input = fixture();
  input.config.env.staging.vars.APP_URL = 'https://staging.example.com';
  input.config.env.staging.d1_databases[0].database_id =
    'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
  input.readiness = Object.fromEntries(
    Object.keys(input.readiness).map((key) => [key, true]),
  );
  input.configSource = '';
  input.config.env.staging.vars.SECRET_ACCESS_KEY = 'must-never-be-printed';
  const report = inspectReleaseSources(input);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.externalChecks.hostedProductFlows, 'not_checked');
  assert.ok(!JSON.stringify(report).includes('must-never-be-printed'));
});
test('security defaults and credential-bearing origins fail source inventory', () => {
  const input = fixture();
  Object.assign(input.config.env.staging.vars, {
    APP_URL: 'https://user:password@example.com',
    REGISTRATION_MODE: 'open',
    STORAGE_AUTODELETE_ENABLED: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'true',
  });
  const report = inspectReleaseSources(input);
  for (const code of [
    'staging_or_production_https_origin_not_configured',
    'registration_must_remain_closed',
    'retention_must_remain_off_and_dry_run',
    'single_storage_node_default_required',
  ])
    assert.ok(report.blockers.includes(code));
  assert.ok(!JSON.stringify(report).includes('password'));
});
test('malformed readiness and unknown environments fail closed', () => {
  assert.throws(
    () => inspectReleaseSources({ ...fixture(), stage: 'local' }),
    /INVALID_STAGE/,
  );
  assert.throws(
    () => inspectReleaseSources({ ...fixture(), readiness: { oauth: true } }),
    /INVALID_READINESS_RECORD/,
  );
  assert.throws(
    () =>
      inspectReleaseSources({
        ...fixture(),
        readiness: { ...fixture().readiness, oauth: 'true' },
      }),
    /INVALID_READINESS_RECORD/,
  );
});
