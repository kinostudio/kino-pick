export const PRODUCTION_TARGET = {
  origin: 'https://pick.kinostudio.tw',
  accountId: 'd3e930465c0df7e89b35de3ca65ea36a',
  bucket: 'kino-pick-production',
} as const;

type ProductionRuntimeEnv = {
  PRODUCTION_RELEASE_ENABLED?: string;
  APP_ENV?: string;
  APP_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  REGISTRATION_MODE?: string;
  STORAGE_AUTODELETE_ENABLED?: string;
  STORAGE_RETENTION_DRY_RUN?: string;
  MULTI_ACCOUNT_STORAGE_ENABLED?: string;
  STAGING_GUEST_VALIDATION?: string;
  STAGING_COLLABORATION_VALIDATION?: string;
  HUMAN_VIEW_TRACKING_ENABLED?: string;
};

export function productionRuntimeAllowed(env: ProductionRuntimeEnv): boolean {
  return (
    env.PRODUCTION_RELEASE_ENABLED === 'true' &&
    env.APP_ENV === 'production' &&
    env.APP_URL === PRODUCTION_TARGET.origin &&
    env.R2_ACCOUNT_ID === PRODUCTION_TARGET.accountId &&
    env.R2_BUCKET_NAME === PRODUCTION_TARGET.bucket &&
    env.REGISTRATION_MODE === 'closed' &&
    env.STORAGE_AUTODELETE_ENABLED === 'false' &&
    env.STORAGE_RETENTION_DRY_RUN === 'true' &&
    env.MULTI_ACCOUNT_STORAGE_ENABLED === 'false' &&
    env.STAGING_GUEST_VALIDATION === 'false' &&
    env.STAGING_COLLABORATION_VALIDATION === 'false' &&
    env.HUMAN_VIEW_TRACKING_ENABLED === 'false'
  );
}
