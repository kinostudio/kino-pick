import { describe, expect, it } from 'vitest';
import {
  configuration,
  versionUploadCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';

function environment(
  appEnv: 'local' | 'staging' | 'production',
  enabled?: string,
) {
  return {
    APP_ENV: appEnv,
    APP_URL:
      appEnv === 'local'
        ? 'http://127.0.0.1:8787'
        : 'https://versions.example.com',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    ...(enabled === undefined
      ? {}
      : { PHOTO_VERSION_UPLOADS_ENABLED: enabled }),
  } as WorkerEnv;
}

describe('Photo version uploads feature boundary', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults off in %s',
    (appEnv) => {
      expect(
        configuration(environment(appEnv)).PHOTO_VERSION_UPLOADS_ENABLED,
      ).toBe('false');
    },
  );
  it('allows explicit local test activation', () => {
    expect(
      configuration(environment('local', 'true')).PHOTO_VERSION_UPLOADS_ENABLED,
    ).toBe('true');
  });
  it.each(['staging', 'production'] as const)(
    'rejects activation in %s',
    (appEnv) => {
      expect(() => configuration(environment(appEnv, 'true'))).toThrow(
        'PHOTO_VERSION_UPLOADS_LOCAL_ONLY',
      );
    },
  );
  it('rejects unknown flag values', () => {
    expect(() => configuration(environment('local', 'yes'))).toThrow();
  });
});

describe('Version upload capability dependencies', () => {
  it.each(Array.from({ length: 8 }, (_, mask) => mask))(
    'requires direct upload, current versions and version uploads together (mask %i)',
    (mask) => {
      const env = {
        ...environment('local'),
        DIRECT_UPLOAD_ENABLED: mask & 1 ? 'true' : 'false',
        PHOTO_VERSIONS_ENABLED: mask & 2 ? 'true' : 'false',
        PHOTO_VERSION_UPLOADS_ENABLED: mask & 4 ? 'true' : 'false',
      } as WorkerEnv;
      expect(versionUploadCapability(env)).toBe(mask === 7);
    },
  );
});
