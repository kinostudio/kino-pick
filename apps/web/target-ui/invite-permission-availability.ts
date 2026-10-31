import type { z } from 'zod';
import type { inviteCapabilitiesSchema } from '../../../packages/contracts/src/invites';
import type { GuestPermission } from '../../../packages/contracts/src/guest-access';
type Capabilities = z.infer<typeof inviteCapabilitiesSchema>;
const feature: Partial<Record<GuestPermission, keyof Capabilities>> = {
  can_download_preview: 'downloadsEnabled',
  can_download_original: 'downloadsEnabled',
  can_rate: 'feedbackEnabled',
  can_favorite: 'feedbackEnabled',
  can_tag: 'tagsEnabled',
  can_annotate: 'annotationsEnabled',
  can_comment: 'commentsEnabled',
  can_view_own_history: 'historyEnabled',
  can_compare_versions: 'versionComparisonEnabled',
};
export function supplementalInvitePermissionAvailable(
  capability: Capabilities | null,
  permission: GuestPermission,
): boolean {
  const key = feature[permission];
  return key === undefined || capability?.[key] === true;
}

/** Older scoped servers admit only the original three independently granted rights. */
export function scopedInvitePermissionAvailable(
  capability: Capabilities | null,
  permission: string,
): boolean {
  const scope = capability?.validationScope;
  return (
    !scope ||
    (scope.permissionNames ?? ['can_view', 'can_select', 'can_submit']).some(
      (name) => name === permission,
    )
  );
}
