import { describe, expect, it } from 'vitest';
import {
  configuration,
  assistedCandidateCatalogCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
function env(mode: 'local' | 'staging' | 'production'): WorkerEnv {
  return {
    APP_ENV: mode,
    APP_URL:
      mode === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  } as WorkerEnv;
}
describe('Assisted candidate catalog gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).ASSISTED_CANDIDATE_CATALOG_ENABLED).toBe(
        'false',
      );
      expect(assistedCandidateCatalogCapability(env(mode))).toBe(false);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({
          ...env(mode),
          ASSISTED_CANDIDATE_CATALOG_ENABLED: 'true',
          INDEXED_VERSION_MATCHING_ENABLED: 'true',
          MATCHING_FILENAME_INDEX_ENABLED: 'true',
          DIRECT_UPLOAD_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
        }),
      ).toThrow('ASSISTED_CANDIDATE_CATALOG_LOCAL_ONLY');
    },
  );
  it('requires supporting upload, version, configuration and index gates', () => {
    expect(
      assistedCandidateCatalogCapability({
        ...env('local'),
        ASSISTED_CANDIDATE_CATALOG_ENABLED: 'true',
        INDEXED_VERSION_MATCHING_ENABLED: 'true',
        MATCHING_FILENAME_INDEX_ENABLED: 'true',
        DIRECT_UPLOAD_ENABLED: 'true',
        PHOTO_VERSION_UPLOADS_ENABLED: 'true',
        PHOTO_VERSION_MATCHING_ENABLED: 'true',
        PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
        PHOTO_VERSIONS_ENABLED: 'true',
        OWNER_ANNOTATIONS_ENABLED: 'false',
        OWNER_COMMENTS_ENABLED: 'false',
        GUEST_EXCHANGE_ENABLED: 'false',
      }),
    ).toBe(true);
  });
  it.each([
    'ASSISTED_CANDIDATE_CATALOG_ENABLED',
    'INDEXED_VERSION_MATCHING_ENABLED',
    'MATCHING_FILENAME_INDEX_ENABLED',
    'DIRECT_UPLOAD_ENABLED',
    'PHOTO_VERSION_UPLOADS_ENABLED',
    'PHOTO_VERSION_MATCHING_ENABLED',
    'PROJECT_VERSIONING_CONFIGURATION_ENABLED',
    'PHOTO_VERSIONS_ENABLED',
  ] as const)('stays disabled without %s', (missing) => {
    const enabled = {
      ...env('local'),
      ASSISTED_CANDIDATE_CATALOG_ENABLED: 'true',
      INDEXED_VERSION_MATCHING_ENABLED: 'true',
      MATCHING_FILENAME_INDEX_ENABLED: 'true',
      DIRECT_UPLOAD_ENABLED: 'true',
      PHOTO_VERSION_UPLOADS_ENABLED: 'true',
      PHOTO_VERSION_MATCHING_ENABLED: 'true',
      PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
      PHOTO_VERSIONS_ENABLED: 'true',
    };
    expect(
      assistedCandidateCatalogCapability({ ...enabled, [missing]: 'false' }),
    ).toBe(false);
  });
  it('rejects malformed activation instead of treating it as enabled', () => {
    expect(() =>
      configuration({
        ...env('local'),
        ASSISTED_CANDIDATE_CATALOG_ENABLED: 'TRUE',
      }),
    ).toThrow();
  });
});
