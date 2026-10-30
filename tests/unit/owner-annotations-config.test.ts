import { describe, expect, it } from 'vitest';
import {
  configuration,
  ownerAnnotationsCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
const env = (mode: 'local' | 'staging' | 'production') =>
  ({
    APP_ENV: mode,
    APP_URL:
      mode === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  }) as WorkerEnv;
describe('Owner annotations feature gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).OWNER_ANNOTATIONS_ENABLED).toBe('false');
      expect(ownerAnnotationsCapability(env(mode))).toBe(false);
    },
  );
  it.each([0, 1, 2, 3])(
    'requires its own flag and photo versions only, %i',
    (mask) => {
      expect(
        ownerAnnotationsCapability({
          ...env('local'),
          PHOTO_VERSIONS_ENABLED: mask & 1 ? 'true' : 'false',
          OWNER_ANNOTATIONS_ENABLED: mask & 2 ? 'true' : 'false',
          OWNER_COMMENTS_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          GUEST_EXCHANGE_ENABLED: 'false',
        } as WorkerEnv),
      ).toBe(mask === 3);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({ ...env(mode), OWNER_ANNOTATIONS_ENABLED: 'true' }),
      ).toThrow('OWNER_ANNOTATIONS_LOCAL_ONLY');
    },
  );
});
