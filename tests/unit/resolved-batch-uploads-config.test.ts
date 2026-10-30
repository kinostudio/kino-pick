import { describe, expect, it } from 'vitest';
import {
  configuration,
  resolvedBatchUploadCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { resolvedBatchUploadCapabilitiesSchema } from '../../packages/contracts/src/resolved-batch-uploads';

type AppEnv = 'local' | 'staging' | 'production';

function environment(appEnv: AppEnv): WorkerEnv {
  return {
    APP_ENV: appEnv,
    APP_URL:
      appEnv === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  } as WorkerEnv;
}

const enabledBatch = {
  RESOLVED_BATCH_UPLOAD_ENABLED: 'true',
  MATCHING_RULES_ENABLED: 'true',
  ASSISTED_CANDIDATE_CATALOG_ENABLED: 'true',
  INDEXED_VERSION_MATCHING_ENABLED: 'true',
  MATCHING_FILENAME_INDEX_ENABLED: 'true',
  DIRECT_UPLOAD_ENABLED: 'true',
  PHOTO_VERSION_UPLOADS_ENABLED: 'true',
  PHOTO_VERSION_MATCHING_ENABLED: 'true',
  PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
} as const;

describe('Resolved batch upload capability', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (appEnv) => {
      expect(
        configuration(environment(appEnv)).RESOLVED_BATCH_UPLOAD_ENABLED,
      ).toBe('false');
      expect(resolvedBatchUploadCapability(environment(appEnv))).toBe(false);
    },
  );

  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (appEnv) => {
      expect(() =>
        configuration({
          ...environment(appEnv),
          RESOLVED_BATCH_UPLOAD_ENABLED: 'true',
        }),
      ).toThrow('RESOLVED_BATCH_UPLOAD_LOCAL_ONLY');
    },
  );

  it('requires the complete local matching-rules chain', () => {
    expect(
      resolvedBatchUploadCapability({
        ...environment('local'),
        ...enabledBatch,
        GUEST_EXCHANGE_ENABLED: 'false',
        GUEST_SELECTION_ENABLED: 'false',
        GUEST_FEEDBACK_ENABLED: 'false',
        GUEST_TAGS_ENABLED: 'false',
        GUEST_HISTORY_ENABLED: 'false',
        GUEST_COMMENTS_ENABLED: 'false',
        GUEST_ANNOTATIONS_ENABLED: 'false',
        OWNER_COMMENTS_ENABLED: 'false',
        OWNER_ANNOTATIONS_ENABLED: 'false',
      }),
    ).toBe(true);
  });

  it.each([
    'RESOLVED_BATCH_UPLOAD_ENABLED',
    'MATCHING_RULES_ENABLED',
    'ASSISTED_CANDIDATE_CATALOG_ENABLED',
    'INDEXED_VERSION_MATCHING_ENABLED',
    'MATCHING_FILENAME_INDEX_ENABLED',
    'DIRECT_UPLOAD_ENABLED',
    'PHOTO_VERSION_UPLOADS_ENABLED',
    'PHOTO_VERSION_MATCHING_ENABLED',
    'PROJECT_VERSIONING_CONFIGURATION_ENABLED',
    'PHOTO_VERSIONS_ENABLED',
  ] as const)('stays disabled without %s', (missing) => {
    expect(
      resolvedBatchUploadCapability({
        ...environment('local'),
        ...enabledBatch,
        [missing]: 'false',
      }),
    ).toBe(false);
  });

  it('rejects unknown activation values', () => {
    expect(() =>
      configuration({
        ...environment('local'),
        RESOLVED_BATCH_UPLOAD_ENABLED: 'yes',
      }),
    ).toThrow();
  });

  it('exposes only the bounded capability contract', () => {
    expect(
      resolvedBatchUploadCapabilitiesSchema.parse({
        enabled: true,
        maxFiles: 1000,
        pageSize: 24,
      }),
    ).toEqual({ enabled: true, maxFiles: 1000, pageSize: 24 });
    expect(() =>
      resolvedBatchUploadCapabilitiesSchema.parse({
        enabled: true,
        maxFiles: 1000,
        pageSize: 24,
        uploadPermission: true,
      }),
    ).toThrow();
    expect(() =>
      resolvedBatchUploadCapabilitiesSchema.parse({
        enabled: true,
        maxFiles: 1001,
        pageSize: 24,
      }),
    ).toThrow();
  });
});
