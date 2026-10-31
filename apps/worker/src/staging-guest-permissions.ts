import {
  guestPermissionBit,
  guestPermissionNames,
  type GuestPermission,
} from '../../../packages/contracts/src/guest-access';
import {
  stagingCollaborationValidationEnabled,
  stagingGuestValidationEnabled,
} from './staging-guest-scope';

type StagingInviteEnvironment = {
  STAGING_GUEST_VALIDATION?: string;
  STAGING_COLLABORATION_VALIDATION?: string;
  GUEST_EXCHANGE_ENABLED?: string;
  GUEST_SELECTION_ENABLED?: string;
  GUEST_DOWNLOADS_ENABLED?: string;
  GUEST_FEEDBACK_ENABLED?: string;
  GUEST_TAGS_ENABLED?: string;
  GUEST_COMMENTS_ENABLED?: string;
  GUEST_ANNOTATIONS_ENABLED?: string;
  GUEST_HISTORY_ENABLED?: string;
  GUEST_VERSION_COMPARISON_ENABLED?: string;
};

/** Permissions admitted by the staged profile; each right requires its matching feature gate. */
export function stagingGuestAllowedPermissionNames(
  env: StagingInviteEnvironment,
): ReadonlySet<GuestPermission> {
  if (!stagingGuestValidationEnabled(env)) return new Set();
  const allowed = new Set<GuestPermission>();
  if (env.GUEST_EXCHANGE_ENABLED === 'true') allowed.add('can_view');
  if (env.GUEST_SELECTION_ENABLED === 'true') {
    allowed.add('can_select');
    allowed.add('can_submit');
  }
  if (!stagingCollaborationValidationEnabled(env)) return allowed;
  if (env.GUEST_DOWNLOADS_ENABLED === 'true') {
    allowed.add('can_download_preview');
    allowed.add('can_download_original');
  }
  if (env.GUEST_FEEDBACK_ENABLED === 'true') {
    allowed.add('can_rate');
    allowed.add('can_favorite');
  }
  if (env.GUEST_TAGS_ENABLED === 'true') allowed.add('can_tag');
  if (env.GUEST_ANNOTATIONS_ENABLED === 'true') allowed.add('can_annotate');
  if (env.GUEST_COMMENTS_ENABLED === 'true') allowed.add('can_comment');
  if (env.GUEST_HISTORY_ENABLED === 'true') allowed.add('can_view_own_history');
  if (env.GUEST_VERSION_COMPARISON_ENABLED === 'true')
    allowed.add('can_compare_versions');
  return allowed;
}

export function stagingGuestAllowedPermissionMask(
  env: StagingInviteEnvironment,
): number {
  let mask = 0;
  for (const permission of stagingGuestAllowedPermissionNames(env))
    mask |= guestPermissionBit(permission);
  return mask;
}

export function stagingGuestPermissionsSupported(
  env: StagingInviteEnvironment,
  permissions: Record<GuestPermission, boolean>,
): boolean {
  const allowed = stagingGuestAllowedPermissionNames(env);
  return guestPermissionNames.every(
    (permission) => allowed.has(permission) || !permissions[permission],
  );
}

export function stagingGuestPermissionMaskSupported(
  env: StagingInviteEnvironment,
  mask: number,
): boolean {
  return (
    Number.isInteger(mask) &&
    mask >= 0 &&
    mask <= 4095 &&
    (mask & ~stagingGuestAllowedPermissionMask(env)) === 0
  );
}
