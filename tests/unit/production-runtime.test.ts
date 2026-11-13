import {
  configuration,
  collaborationFeatureEnvironment,
  albumActivationCapability,
  photographerRecommendationsCapability,
  humanViewsCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { guestCoreRuntimeAllowed } from '../../apps/worker/src/staging-guest-scope';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_TARGET,
  productionRuntimeAllowed,
} from '../../apps/worker/src/production-runtime';

const validEnv = {
  PRODUCTION_RELEASE_ENABLED: 'true',
  APP_ENV: 'production',
  APP_URL: PRODUCTION_TARGET.origin,
  R2_ACCOUNT_ID: PRODUCTION_TARGET.accountId,
  R2_BUCKET_NAME: PRODUCTION_TARGET.bucket,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  STAGING_GUEST_VALIDATION: 'false',
  STAGING_COLLABORATION_VALIDATION: 'false',
  HUMAN_VIEW_TRACKING_ENABLED: 'true',
} satisfies Parameters<typeof productionRuntimeAllowed>[0];

describe('production runtime tuple', () => {
  it('allows the exact production tuple', () => {
    expect(productionRuntimeAllowed(validEnv)).toBe(true);
  });

  it('rejects every missing or incorrect tuple field', () => {
    for (const key of Object.keys(validEnv) as (keyof typeof validEnv)[]) {
      const missing = { ...validEnv };
      delete missing[key];
      expect(productionRuntimeAllowed(missing), `${key} missing`).toBe(false);

      const wrong = {
        ...validEnv,
        [key]: validEnv[key] === 'true' ? 'false' : 'invalid',
      };
      expect(productionRuntimeAllowed(wrong), `${key} incorrect`).toBe(false);
    }
  });

  it('does not elevate local or existing staging settings without opt-in', () => {
    expect(
      productionRuntimeAllowed({
        APP_ENV: 'development',
        APP_URL: 'http://localhost:8787',
      }),
    ).toBe(false);
    expect(
      productionRuntimeAllowed({
        ...validEnv,
        PRODUCTION_RELEASE_ENABLED: 'false',
        APP_ENV: 'staging',
      }),
    ).toBe(false);
  });
});

it('connects hosted collaboration capabilities only after explicit production admission', () => {
  const env = {
    ...validEnv,
    GUEST_EXCHANGE_ENABLED: 'true',
    GUEST_SELECTION_ENABLED: 'true',
    GUEST_INVITE_ISSUANCE_ENABLED: 'true',
    GUEST_COMMENTS_ENABLED: 'true',
    OWNER_COMMENTS_ENABLED: 'true',
    GUEST_DOWNLOADS_ENABLED: 'true',
    PHOTO_VERSIONS_ENABLED: 'true',
    VERSION_APPROVALS_ENABLED: 'true',
    APPROVED_DELIVERIES_ENABLED: 'true',
    DELIVERY_ZIP_ENABLED: 'true',
    ALBUM_ACTIVATION_ENABLED: 'true',
    PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
  } as unknown as WorkerEnv;
  expect(configuration(env).DELIVERY_ZIP_ENABLED).toBe('true');
  expect(collaborationFeatureEnvironment(env)).toBe(true);
  expect(guestCoreRuntimeAllowed(env)).toBe(true);
  expect(albumActivationCapability(env)).toBe(true);
  expect(photographerRecommendationsCapability(env)).toBe(true);
  expect(humanViewsCapability(env)).toBe(true);
  expect(() =>
    humanViewsCapability({ ...env, HUMAN_VIEW_TRACKING_ENABLED: 'false' }),
  ).toThrow('PRODUCTION_RELEASE_CONTEXT_INVALID');
  expect(() =>
    configuration({ ...env, PRODUCTION_RELEASE_ENABLED: 'false' }),
  ).toThrow();
  expect(() =>
    configuration({
      ...env,
      APP_URL: 'https://other.example',
    } as unknown as WorkerEnv),
  ).toThrow('PRODUCTION_RELEASE_CONTEXT_INVALID');
  expect(() =>
    configuration({ ...env, MATCHING_RULES_ENABLED: 'true' }),
  ).toThrow('MATCHING_RULES_LOCAL_ONLY');
});
