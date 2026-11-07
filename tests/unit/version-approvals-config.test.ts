import { describe, expect, it } from 'vitest';
import {
  approvedDeliveriesCapability,
  configuration,
  versionApprovalsCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { STAGING_GUEST_SCOPE } from '../../apps/worker/src/staging-guest-scope';

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

function collaborationEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ...env('staging'),
    APP_URL: STAGING_GUEST_SCOPE.origin,
    STAGING_GUEST_VALIDATION: 'true',
    STAGING_COLLABORATION_VALIDATION: 'true',
    R2_ACCOUNT_ID: STAGING_GUEST_SCOPE.accountId,
    R2_BUCKET_NAME: STAGING_GUEST_SCOPE.bucket,
    PHOTO_VERSIONS_ENABLED: 'true',
    VERSION_APPROVALS_ENABLED: 'true',
    GUEST_DOWNLOADS_ENABLED: 'true',
    APPROVED_DELIVERIES_ENABLED: 'true',
    ...overrides,
  } as WorkerEnv;
}

describe('Version approval capability', () => {
  it('defaults OFF in all environments', () => {
    for (const mode of ['local', 'staging', 'production'] as const) {
      expect(configuration(env(mode)).VERSION_APPROVALS_ENABLED).toBe('false');
      expect(configuration(env(mode)).APPROVED_DELIVERIES_ENABLED).toBe(
        'false',
      );
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

  it('allows the exact B collaboration profile and rejects other hosted profiles', () => {
    expect(versionApprovalsCapability(collaborationEnv())).toBe(true);
    expect(() =>
      configuration(
        collaborationEnv({ R2_BUCKET_NAME: 'kino-pic-local-private' }),
      ),
    ).toThrow('STAGING_GUEST_VALIDATION_CONTEXT_INVALID');
    for (const mode of ['staging', 'production'] as const) {
      expect(() =>
        configuration({
          ...env(mode),
          VERSION_APPROVALS_ENABLED: 'true',
        }),
      ).toThrow('VERSION_APPROVALS_LOCAL_OR_COLLABORATION_STAGING_ONLY');
    }
  });

  it('requires version approval and Guest download capabilities for deliveries', () => {
    expect(approvedDeliveriesCapability(collaborationEnv())).toBe(true);
    expect(
      approvedDeliveriesCapability(
        collaborationEnv({ VERSION_APPROVALS_ENABLED: 'false' }),
      ),
    ).toBe(false);
    expect(
      approvedDeliveriesCapability(
        collaborationEnv({ GUEST_DOWNLOADS_ENABLED: 'false' }),
      ),
    ).toBe(false);
    expect(() =>
      configuration({
        ...env('production'),
        APPROVED_DELIVERIES_ENABLED: 'true',
      }),
    ).toThrow('APPROVED_DELIVERIES_LOCAL_OR_COLLABORATION_STAGING_ONLY');
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
