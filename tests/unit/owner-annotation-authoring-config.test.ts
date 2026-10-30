import { describe, it, expect } from 'vitest';
import {
  configuration,
  ownerAnnotationAuthoringCapability,
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
describe('Owner annotation authoring activation boundary', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).OWNER_ANNOTATION_AUTHORING_ENABLED).toBe(
        'false',
      );
      expect(ownerAnnotationAuthoringCapability(env(mode))).toBe(false);
    },
  );
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'requires all three private Owner/version gates for %i',
    (mask) => {
      expect(
        ownerAnnotationAuthoringCapability({
          ...env('local'),
          PHOTO_VERSIONS_ENABLED: mask & 1 ? 'true' : 'false',
          OWNER_ANNOTATIONS_ENABLED: mask & 2 ? 'true' : 'false',
          OWNER_ANNOTATION_AUTHORING_ENABLED: mask & 4 ? 'true' : 'false',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
        }),
      ).toBe(mask === 7);
    },
  );
  it.each(['staging', 'production'] as const)(
    'refuses hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({
          ...env(mode),
          OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
        }),
      ).toThrow('OWNER_ANNOTATION_AUTHORING_LOCAL_ONLY');
    },
  );
});
