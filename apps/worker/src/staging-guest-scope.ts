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

/** Extra B boundary only; live Owner/session and Guest permissions remain service checks. */
export async function stagingGuestAlbumScopeAllowed(
  db: D1Database,
  ownerId: string,
  projectId: string,
  albumId: string,
  managedAlbums: boolean,
  requireActive = true,
): Promise<boolean> {
  if (
    !managedAlbums &&
    (projectId !== STAGING_GUEST_SCOPE.projectId ||
      albumId !== STAGING_GUEST_SCOPE.albumId)
  )
    return false;
  return !!(await db
    .prepare(
      `SELECT 1 FROM albums a
    JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
    JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?
    JOIN owners o ON o.user_id=w.owner_user_id AND (?=0 OR o.enabled=1)
    WHERE w.id=? AND p.id=? AND a.id=? AND (?=0 OR (a.state='active'
    AND p.status NOT IN('archived','deleting','deleted')))
    AND (p.id=? OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=w.owner_user_id
      AND c.operation='project.created' AND c.resource_id=p.id AND c.workspace_id=w.id
      AND json_extract(c.result_json,'$.id')=p.id AND json_extract(c.result_json,'$.workspaceId')=w.id))
    AND (a.id=? OR EXISTS(SELECT 1 FROM request_commands c WHERE c.actor_id=w.owner_user_id
      AND c.operation='album.created' AND c.resource_id=a.id AND c.workspace_id=w.id
      AND json_extract(c.result_json,'$.id')=a.id AND json_extract(c.result_json,'$.projectId')=p.id
      AND json_extract(c.result_json,'$.workspaceId')=w.id))`,
    )
    .bind(
      ownerId,
      Number(requireActive),
      STAGING_GUEST_SCOPE.workspaceId,
      projectId,
      albumId,
      Number(requireActive),
      STAGING_GUEST_SCOPE.projectId,
      STAGING_GUEST_SCOPE.albumId,
    )
    .first());
}
