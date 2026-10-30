import { describe, expect, it } from 'vitest';
import {
  configuration,
  freehandAnnotationsCapability,
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

const requiredFlags = [
  'FREEHAND_ANNOTATIONS_ENABLED',
  'GUEST_EXCHANGE_ENABLED',
  'PHOTO_VERSIONS_ENABLED',
  'GUEST_ANNOTATIONS_ENABLED',
  'OWNER_ANNOTATIONS_ENABLED',
  'OWNER_ANNOTATION_AUTHORING_ENABLED',
] as const;

const fullyEnabledEnv = () =>
  ({
    ...env('local'),
    FREEHAND_ANNOTATIONS_ENABLED: 'true',
    GUEST_EXCHANGE_ENABLED: 'true',
    PHOTO_VERSIONS_ENABLED: 'true',
    GUEST_ANNOTATIONS_ENABLED: 'true',
    OWNER_ANNOTATIONS_ENABLED: 'true',
    OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  }) as WorkerEnv;

describe('freehand annotations feature gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).FREEHAND_ANNOTATIONS_ENABLED).toBe(
        'false',
      );
      expect(freehandAnnotationsCapability(env(mode))).toBe(false);
    },
  );

  it('requires its own flag and both Guest and Owner annotation prerequisites', () => {
    const enabled = fullyEnabledEnv();
    expect(freehandAnnotationsCapability(enabled)).toBe(true);

    for (const flag of requiredFlags) {
      expect(
        freehandAnnotationsCapability({ ...enabled, [flag]: 'false' }),
      ).toBe(false);
    }
  });

  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({
          ...env(mode),
          FREEHAND_ANNOTATIONS_ENABLED: 'true',
        }),
      ).toThrow('FREEHAND_ANNOTATIONS_LOCAL_ONLY');
    },
  );
});
