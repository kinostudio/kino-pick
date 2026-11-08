import { describe, expect, it } from 'vitest';
import { configuration, type WorkerEnv } from '../../apps/worker/src/config';
import { STAGING_GUEST_SCOPE } from '../../apps/worker/src/staging-guest-scope';

const env = (APP_ENV: 'local' | 'staging' | 'production') =>
  ({
    APP_ENV,
    APP_URL:
      APP_ENV === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  }) as WorkerEnv;

describe('inherited share issuance rollout boundary', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).INHERITED_SHARE_ISSUANCE_ENABLED).toBe(
        'false',
      );
    },
  );
  it('allows a local opt-in and rejects malformed flag values', () => {
    expect(
      configuration({
        ...env('local'),
        INHERITED_SHARE_ISSUANCE_ENABLED: 'true',
      }).INHERITED_SHARE_ISSUANCE_ENABLED,
    ).toBe('true');
    expect(() =>
      configuration({
        ...env('local'),
        INHERITED_SHARE_ISSUANCE_ENABLED: 'yes',
      }),
    ).toThrow();
  });
  it('allows only the exact B collaboration context for hosted opt-in', () => {
    const scoped = {
      ...env('staging'),
      APP_URL: STAGING_GUEST_SCOPE.origin,
      STAGING_GUEST_VALIDATION: 'true',
      STAGING_COLLABORATION_VALIDATION: 'true',
      R2_ACCOUNT_ID: STAGING_GUEST_SCOPE.accountId,
      R2_BUCKET_NAME: STAGING_GUEST_SCOPE.bucket,
      INHERITED_SHARE_ISSUANCE_ENABLED: 'true',
    };
    expect(configuration(scoped).INHERITED_SHARE_ISSUANCE_ENABLED).toBe('true');
    for (const patch of [
      { APP_URL: 'https://elsewhere.example' },
      { R2_ACCOUNT_ID: '0'.repeat(32) },
      { STAGING_COLLABORATION_VALIDATION: 'false' },
      { APP_ENV: 'production' },
    ]) {
      expect(() =>
        configuration({ ...scoped, ...patch } as WorkerEnv),
      ).toThrow();
    }
  });
});
