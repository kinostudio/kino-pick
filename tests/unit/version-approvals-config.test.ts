import { describe, expect, it } from 'vitest';
import {
  configuration,
  versionApprovalsCapability,
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

describe('Version approval capability', () => {
  it('defaults OFF in all environments', () => {
    for (const mode of ['local', 'staging', 'production'] as const) {
      expect(configuration(env(mode)).VERSION_APPROVALS_ENABLED).toBe('false');
    }
  });

  it('requires photo version reads before local activation', () => {
    expect(
      versionApprovalsCapability({
        ...env('local'),
        VERSION_APPROVALS_ENABLED: 'true',
      }),
    ).toBe(false);
    expect(
      versionApprovalsCapability({
        ...env('local'),
        VERSION_APPROVALS_ENABLED: 'true',
        PHOTO_VERSIONS_ENABLED: 'true',
      }),
    ).toBe(true);
  });

  it('rejects hosted activation', () => {
    for (const mode of ['staging', 'production'] as const) {
      expect(() =>
        configuration({
          ...env(mode),
          VERSION_APPROVALS_ENABLED: 'true',
        }),
      ).toThrow('VERSION_APPROVALS_LOCAL_ONLY');
    }
  });

  it('rejects malformed flags', () => {
    expect(() =>
      configuration({
        ...env('local'),
        VERSION_APPROVALS_ENABLED: 'TRUE',
      }),
    ).toThrow();
  });
});
