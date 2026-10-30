import { describe, expect, it } from 'vitest';
import {
  configuration,
  matchingFilenameIndexCapability,
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
describe('Canonical filename index maintenance gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).MATCHING_FILENAME_INDEX_ENABLED).toBe(
        'false',
      );
      expect(matchingFilenameIndexCapability(env(mode))).toBe(false);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({
          ...env(mode),
          MATCHING_FILENAME_INDEX_ENABLED: 'true',
        }),
      ).toThrow('MATCHING_FILENAME_INDEX_LOCAL_ONLY');
    },
  );
  it('does not enable or require Guest or photo matching rights', () => {
    expect(
      matchingFilenameIndexCapability({
        ...env('local'),
        MATCHING_FILENAME_INDEX_ENABLED: 'true',
        PHOTO_VERSIONS_ENABLED: 'false',
        OWNER_ANNOTATIONS_ENABLED: 'false',
        OWNER_COMMENTS_ENABLED: 'false',
        GUEST_EXCHANGE_ENABLED: 'false',
      }),
    ).toBe(true);
  });
  it('rejects malformed activation instead of treating it as enabled', () => {
    expect(() =>
      configuration({
        ...env('local'),
        MATCHING_FILENAME_INDEX_ENABLED: 'TRUE',
      }),
    ).toThrow();
  });
});
