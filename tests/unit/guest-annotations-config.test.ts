import { describe, expect, it } from 'vitest';
import {
  configuration,
  guestAnnotationsCapability,
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
describe('independent annotation gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).GUEST_ANNOTATIONS_ENABLED).toBe('false');
      expect(guestAnnotationsCapability(env(mode))).toBe(false);
    },
  );
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'requires local exchange/version/annotation gates, combination %i',
    (mask) => {
      expect(
        guestAnnotationsCapability({
          ...env('local'),
          GUEST_EXCHANGE_ENABLED: mask & 1 ? 'true' : 'false',
          PHOTO_VERSIONS_ENABLED: mask & 2 ? 'true' : 'false',
          GUEST_ANNOTATIONS_ENABLED: mask & 4 ? 'true' : 'false',
          GUEST_COMMENTS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
          GUEST_SELECTION_ENABLED: 'false',
          GUEST_VERSION_COMPARISON_ENABLED: 'false',
        } as WorkerEnv),
      ).toBe(mask === 7);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({ ...env(mode), GUEST_ANNOTATIONS_ENABLED: 'true' }),
      ).toThrow('GUEST_ANNOTATIONS_LOCAL_ONLY');
    },
  );
});
