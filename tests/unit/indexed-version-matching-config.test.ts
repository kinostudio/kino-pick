import { describe, expect, it } from 'vitest';
import {
  configuration,
  indexedVersionMatchingCapability,
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
describe('Indexed automatic version matching gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).INDEXED_VERSION_MATCHING_ENABLED).toBe(
        'false',
      );
      expect(indexedVersionMatchingCapability(env(mode))).toBe(false);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({
          ...env(mode),
          INDEXED_VERSION_MATCHING_ENABLED: 'true',
          MATCHING_FILENAME_INDEX_ENABLED: 'true',
          DIRECT_UPLOAD_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
        }),
      ).toThrow('INDEXED_VERSION_MATCHING_LOCAL_ONLY');
    },
  );
  it('requires supporting upload, version, configuration and index gates', () => {
    expect(
      indexedVersionMatchingCapability({
        ...env('local'),
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
      INDEXED_VERSION_MATCHING_ENABLED: 'true',
      MATCHING_FILENAME_INDEX_ENABLED: 'true',
      DIRECT_UPLOAD_ENABLED: 'true',
      PHOTO_VERSION_UPLOADS_ENABLED: 'true',
      PHOTO_VERSION_MATCHING_ENABLED: 'true',
      PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
      PHOTO_VERSIONS_ENABLED: 'true',
    };
    expect(
      indexedVersionMatchingCapability({ ...enabled, [missing]: 'false' }),
    ).toBe(false);
  });
  it('rejects malformed activation instead of treating it as enabled', () => {
    expect(() =>
      configuration({
        ...env('local'),
        INDEXED_VERSION_MATCHING_ENABLED: 'TRUE',
      }),
    ).toThrow();
  });
});
