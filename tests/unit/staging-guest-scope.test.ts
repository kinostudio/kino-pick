import { describe, expect, it } from 'vitest';
import {
  configuration,
  albumActivationCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import {
  guestCoreRuntimeAllowed,
  STAGING_GUEST_SCOPE,
  stagingGuestValidationEnabled,
} from '../../apps/worker/src/staging-guest-scope';

const stagingEnv = {
  APP_ENV: 'staging',
  APP_URL: STAGING_GUEST_SCOPE.origin,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  STAGING_GUEST_VALIDATION: 'true',
  R2_ACCOUNT_ID: STAGING_GUEST_SCOPE.accountId,
  R2_BUCKET_NAME: STAGING_GUEST_SCOPE.bucket,
};

function configure(overrides: Record<string, string | undefined>) {
  return configuration({ ...stagingEnv, ...overrides } as WorkerEnv);
}

describe('bounded staging Guest validation context', () => {
  it('admits only the exact opt-in B origin, Cloudflare account, and R2 bucket', () => {
    expect(stagingGuestValidationEnabled(stagingEnv)).toBe(true);
    for (const overrides of [
      { STAGING_GUEST_VALIDATION: 'false' },
      { STAGING_GUEST_VALIDATION: '1' },
      { APP_ENV: 'local' },
      { APP_ENV: 'production' },
      { APP_URL: STAGING_GUEST_SCOPE.origin + '/' },
      { APP_URL: 'https://other.workers.dev' },
      { R2_ACCOUNT_ID: 'another-account' },
      { R2_BUCKET_NAME: 'another-bucket' },
    ]) {
      expect(
        stagingGuestValidationEnabled({ ...stagingEnv, ...overrides }),
      ).toBe(false);
    }
  });

  it('keeps local Guest services usable and admits staging only in the exact context', () => {
    expect(guestCoreRuntimeAllowed({ APP_ENV: 'local' })).toBe(true);
    expect(guestCoreRuntimeAllowed(stagingEnv)).toBe(true);
    expect(
      guestCoreRuntimeAllowed({ ...stagingEnv, R2_BUCKET_NAME: 'other' }),
    ).toBe(false);
    expect(guestCoreRuntimeAllowed({ APP_ENV: 'production' })).toBe(false);
  });

  it('defaults the staging validation flag to false', () => {
    expect(
      configure({ STAGING_GUEST_VALIDATION: undefined })
        .STAGING_GUEST_VALIDATION,
    ).toBe('false');
  });

  it('rejects an invalid true validation flag and preserves other local-only gates', () => {
    expect(() => configure({ APP_URL: 'https://other.workers.dev' })).toThrow(
      'STAGING_GUEST_VALIDATION_CONTEXT_INVALID',
    );
    expect(() =>
      configure({
        GUEST_EXCHANGE_ENABLED: 'true',
        STAGING_GUEST_VALIDATION: 'false',
      }),
    ).toThrow('GUEST_EXCHANGE_LOCAL_ONLY');
    expect(() => configure({ GUEST_FEEDBACK_ENABLED: 'true' })).toThrow(
      'GUEST_FEEDBACK_LOCAL_ONLY',
    );
  });

  it('allows only exchange and selection past their old non-local configuration guards', () => {
    const config = configure({
      GUEST_EXCHANGE_ENABLED: 'true',
      GUEST_SELECTION_ENABLED: 'true',
    });
    expect(config.GUEST_EXCHANGE_ENABLED).toBe('true');
    expect(config.GUEST_SELECTION_ENABLED).toBe('true');
    expect(config.STAGING_GUEST_VALIDATION).toBe('true');
  });
});

describe('album activation runtime gate', () => {
  it('is off by default and allows the exact staged profile only with explicit opt-in', () => {
    expect(
      configuration(stagingEnv as WorkerEnv).ALBUM_ACTIVATION_ENABLED,
    ).toBe('false');
    expect(albumActivationCapability(stagingEnv as WorkerEnv)).toBe(false);
    expect(
      albumActivationCapability({
        ...stagingEnv,
        ALBUM_ACTIVATION_ENABLED: 'true',
      } as WorkerEnv),
    ).toBe(true);
  });
  it('retains local testing but rejects production and other staged resources', () => {
    expect(
      albumActivationCapability({
        ...stagingEnv,
        APP_ENV: 'local',
        APP_URL: 'http://127.0.0.1:8787',
        STAGING_GUEST_VALIDATION: 'false',
        ALBUM_ACTIVATION_ENABLED: 'true',
      } as WorkerEnv),
    ).toBe(true);
    for (const env of [
      {
        ...stagingEnv,
        APP_ENV: 'production',
        STAGING_GUEST_VALIDATION: 'false',
      },
      { ...stagingEnv, R2_BUCKET_NAME: 'other' },
    ])
      expect(() =>
        albumActivationCapability({
          ...env,
          ALBUM_ACTIVATION_ENABLED: 'true',
        } as WorkerEnv),
      ).toThrow();
  });
});
