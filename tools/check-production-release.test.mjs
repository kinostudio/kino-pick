import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyProductionRelease } from './check-production-release.mjs';

test('production release requires frozen source, exact parent, private storage and signed upstream', () => {
  const account = 'd3e930465c0df7e89b35de3ca65ea36a';
  const database = '65d2286e-f2ac-4ad2-90e2-4b31e2f24251';
  const bootstrapDatabase = 'f9ce8433-ba99-4d3e-9029-28a2098e7fc4';
  const sha = '1'.repeat(40),
    schema = 'a'.repeat(64),
    data = 'b'.repeat(64);
  const version = '11111111-1111-4111-8111-111111111111';
  const features = [
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
  const vars = {
    ...Object.fromEntries(features.map((key) => [key, 'true'])),
    APP_ENV: 'production',
    APP_URL: 'https://pick.kinostudio.tw',
    PRODUCTION_RELEASE_ENABLED: 'true',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    STAGING_GUEST_VALIDATION: 'false',
    STAGING_COLLABORATION_VALIDATION: 'false',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  };
  const secretNames = [
    'BETTER_AUTH_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'KINO_GATEWAY_SECRET',
    'ORACLE_STORAGE_ACCESS_KEY_ID',
    'ORACLE_STORAGE_SECRET_ACCESS_KEY',
  ].map((name) => ({ name }));
  const bindings = (values, id = database) => [
    { name: 'DB', type: 'd1', id },
    {
      name: 'PRIMARY_STORAGE',
      type: 'r2_bucket',
      bucket_name: 'kino-pick-production',
    },
    ...Object.entries(values).map(([name, text]) => ({
      name,
      type: 'plain_text',
      text,
    })),
  ];
  const input = {
    phase: 'predeploy',
    sourceSha: sha,
    headSha: sha,
    repository: 'kinostudio/kino-pick',
    vars,
    local: {
      migrationNames: ['0001_fixture.sql'],
      database: {
        id: database,
        name: 'kino-pick-production-live',
        productSchemaSha256: schema,
        baselineSchemaSha256: schema,
        productTableDataSha256: data,
      },
    },
    cutover: {
      status: 'passed_quiesced_production_data_cutover',
      accountId: account,
      sourceDatabaseId: 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d',
      targetDatabaseId: database,
      bootstrapDatabaseId: bootstrapDatabase,
      schemaVersion: 67,
      exactProductParity: true,
      foreignKeyViolations: 0,
      zeroLiveUploadAuthorizations: true,
      noRunningProcessing: true,
      sourceEntryDisabled: true,
      schedulesDisabled: true,
      productionBeforeWasUnchangedClone: true,
      sourceSchemaSha256: schema,
      sourceDataSha256: data,
      assetManifestSha256: 'c'.repeat(64),
      bootstrapClosedVersionId: version,
    },
    prior: null,
    ci: {
      privateRepository: true,
      repository: 'kinostudio/kino-pick',
      workflowPath: '.github/workflows/ci.yml',
      workflowName: 'checks',
      headSha: sha,
      event: 'push',
      headBranch: 'main',
      headRepository: 'kinostudio/kino-pick',
      status: 'completed',
      conclusion: 'success',
      runId: 1,
      runNumber: 1,
    },
    resources: {
      accountId: account,
      database: { id: database, name: 'kino-pick-production-live' },
      migrationNames: ['0001_fixture.sql'],
      foreignKeyViolationCount: 0,
      productSchemaObjectCount: 1,
      productSchemaSha256: schema,
      managedR2DomainEnabled: false,
      customR2DomainFlagsValid: true,
      enabledCustomR2DomainCount: 0,
    },
    worker: {
      settings: {
        bindings: bindings(
          { ...vars, PRODUCTION_RELEASE_ENABLED: 'false' },
          bootstrapDatabase,
        ),
      },
      subdomain: { enabled: false, previews_enabled: false },
      routes: [],
      deployments: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          versions: [{ version_id: version, percentage: 100 }],
        },
      ],
      version: { id: version, annotations: { 'workers/message': 'bootstrap' } },
    },
    state: {
      stagingEntry: { enabled: false, previews_enabled: false },
      stagingSchedules: { schedules: [] },
      productionSchedules: { schedules: [] },
      secretNames,
    },
  };
  assert.equal(
    verifyProductionRelease(input).status,
    'passed_production_release',
  );
  const denied = [
    [
      { ...input, cutover: { ...input.cutover, exactProductParity: false } },
      'RELEASE_CUTOVER_PROOF',
    ],
    [
      { ...input, state: { ...input.state, stagingEntry: { enabled: true } } },
      'STAGING_WRITER_NOT_CLOSED',
    ],
    [
      { ...input, state: { ...input.state, secretNames: [] } },
      'RELEASE_SECRETS',
    ],
    [{ ...input, prior: {} }, 'RELEASE_RESOURCE_BINDING'],
    [
      { ...input, ci: { ...input.ci, headSha: '2'.repeat(40) } },
      'CI_SOURCE_SHA',
    ],
  ];
  for (const [value, code] of denied)
    assert.throws(() => verifyProductionRelease(value), { message: code });
  const post = {
    ...input,
    phase: 'postdeploy',
    unsignedStatus: 404,
    worker: {
      ...input.worker,
      settings: { bindings: bindings(vars) },
      subdomain: { enabled: true, previews_enabled: false },
      version: {
        id: version,
        annotations: {
          'workers/message': 'Kino Pick production source ' + sha,
        },
      },
    },
    state: {
      ...input.state,
      productionSchedules: { schedules: [{ cron: '*/10 * * * *' }] },
    },
  };
  assert.equal(
    verifyProductionRelease(post).cloudflare.signedUpstreamOnly,
    true,
  );
  assert.equal(
    verifyProductionRelease({
      ...post,
      phase: 'predeploy',
      prior: {
        status: 'verified_prior_production_deployment',
        receipt: {
          status: 'passed_production_release',
          sourceSha: sha,
          cloudflare: { versionId: version, databaseId: database },
        },
      },
    }).status,
    'passed_production_release',
  );
  assert.throws(
    () =>
      verifyProductionRelease({
        ...post,
        worker: {
          ...post.worker,
          settings: { bindings: bindings(vars, bootstrapDatabase) },
        },
      }),
    { message: 'RELEASE_RESOURCE_BINDING' },
  );
  assert.throws(
    () => verifyProductionRelease({ ...post, unsignedStatus: 200 }),
    { message: 'RELEASE_UNSIGNED_ORIGIN_EXPOSED' },
  );
  assert.throws(
    () =>
      verifyProductionRelease({
        ...post,
        worker: {
          ...post.worker,
          subdomain: { enabled: true, previews_enabled: true },
        },
      }),
    { message: 'RELEASE_PUBLIC_ROUTES' },
  );
});
