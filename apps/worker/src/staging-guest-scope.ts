/** Exact B staging data boundary for the first link-only Guest validation slice. */
export const STAGING_GUEST_SCOPE = Object.freeze({
  origin: 'https://kino-pic-staging.kino-pick-aaron2026.workers.dev',
  accountId: 'd3e930465c0df7e89b35de3ca65ea36a',
  bucket: 'kino-pick-staging-d3e93046',
  workspaceId: 'bd927a6d-d5d3-4743-bbae-e4560cdda4c7',
  projectId: '08954949-ae90-4353-be2f-ae4a8f40b78d',
  albumId: '613487da-e6ff-4ada-9b66-949f21fcfa2c',
} as const);

type StagingGuestValidationEnvironment = {
  STAGING_GUEST_VALIDATION?: string;
  STAGING_COLLABORATION_VALIDATION?: string;
  APP_ENV?: string;
  APP_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
};

/** True only for the explicitly selected account, bucket, and unnormalized B origin. */
export function stagingGuestValidationEnabled(
  env: StagingGuestValidationEnvironment,
): boolean {
  return (
    env.STAGING_GUEST_VALIDATION === 'true' &&
    env.APP_ENV === 'staging' &&
    env.APP_URL === STAGING_GUEST_SCOPE.origin &&
    env.R2_ACCOUNT_ID === STAGING_GUEST_SCOPE.accountId &&
    env.R2_BUCKET_NAME === STAGING_GUEST_SCOPE.bucket
  );
}

/** Collaboration requires the old exact B Guest scope plus its separate opt-in. */
export function stagingCollaborationValidationEnabled(
  env: StagingGuestValidationEnvironment,
): boolean {
  return (
    env.STAGING_COLLABORATION_VALIDATION === 'true' &&
    stagingGuestValidationEnabled(env)
  );
}

/** Guest entry remains local by default; staging is admitted only by the exact predicate. */
export function guestCoreRuntimeAllowed(
  env: StagingGuestValidationEnvironment,
): boolean {
  return env.APP_ENV === 'local' || stagingGuestValidationEnabled(env);
}
