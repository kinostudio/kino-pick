import { describe, it, expect } from 'vitest';
import { inviteCapabilitiesSchema } from '../../packages/contracts/src/invites';
import {
  scopedInvitePermissionAvailable as scoped,
  supplementalInvitePermissionAvailable as available,
} from '../../apps/web/target-ui/invite-permission-availability';
import {
  guestDownloadsCapability,
  guestCommentsCapability,
  guestAnnotationsCapability,
  guestVersionComparisonCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
const original = {
  issuanceEnabled: true,
  exchangeEnabled: true,
  selectionEnabled: true,
  feedbackEnabled: false,
  tagsEnabled: false,
  historyEnabled: false,
  maxAlbums: 24,
  maxUses: 10000,
  maxExpiryDays: 365,
};
describe('invitation UI uses actual supported feature capabilities', () => {
  it('honors explicit collaboration rights and keeps older scoped responses restricted', () => {
    const validationScope = {
      albumId: '613487da-e6ff-4ada-9b66-949f21fcfa2c',
      projectId: '08954949-ae90-4353-be2f-ae4a8f40b78d',
    };
    const legacy = inviteCapabilitiesSchema.parse({
      ...original,
      validationScope,
    });
    expect(scoped(legacy, 'can_view')).toBe(true);
    expect(scoped(legacy, 'can_annotate')).toBe(false);
    const modern = inviteCapabilitiesSchema.parse({
      ...original,
      validationScope: {
        ...validationScope,
        permissionNames: ['can_view', 'can_annotate'],
      },
    });
    expect(scoped(modern, 'can_annotate')).toBe(true);
    expect(scoped(modern, 'can_download_original')).toBe(false);
    for (const permissionNames of [['can_view', 'can_view'], ['unknown']])
      expect(() =>
        inviteCapabilitiesSchema.parse({
          ...original,
          validationScope: { ...validationScope, permissionNames },
        }),
      ).toThrow();
  });

  it('keeps old server responses closed and rejects malformed capabilities', () => {
    const c = inviteCapabilitiesSchema.parse(original);
    expect([
      c.downloadsEnabled,
      c.commentsEnabled,
      c.annotationsEnabled,
      c.versionComparisonEnabled,
    ]).toEqual([false, false, false, false]);
    expect(available(c, 'can_comment')).toBe(false);
    expect(available(null, 'can_download_original')).toBe(false);
    expect(() =>
      inviteCapabilitiesSchema.parse({ ...original, commentsEnabled: 'true' }),
    ).toThrow();
  });
  it('enables each independent permission only for its advertised service', () => {
    const c = inviteCapabilitiesSchema.parse({
      ...original,
      commentsEnabled: true,
    });
    expect(available(c, 'can_comment')).toBe(true);
    for (const permission of [
      'can_download_preview',
      'can_download_original',
      'can_annotate',
      'can_compare_versions',
      'can_favorite',
      'can_rate',
      'can_tag',
      'can_view_own_history',
    ] as const)
      expect(available(c, permission)).toBe(false);
    const all = inviteCapabilitiesSchema.parse({
      ...original,
      downloadsEnabled: true,
      annotationsEnabled: true,
      versionComparisonEnabled: true,
      feedbackEnabled: true,
      tagsEnabled: true,
      historyEnabled: true,
    });
    for (const permission of [
      'can_download_preview',
      'can_download_original',
      'can_annotate',
      'can_compare_versions',
      'can_favorite',
      'can_rate',
      'can_tag',
      'can_view_own_history',
    ] as const)
      expect(available(all, permission)).toBe(true);
    expect(available(all, 'can_comment')).toBe(false);
  });
  it('uses existing local-only server gates without expanding hosted authority', () => {
    const base = {
      APP_ENV: 'local',
      APP_URL: 'http://127.0.0.1:8787',
      REGISTRATION_MODE: 'closed',
      STORAGE_AUTODELETE_ENABLED: 'false',
      STORAGE_RETENTION_DRY_RUN: 'true',
      MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    };
    const env = {
      ...base,
      GUEST_EXCHANGE_ENABLED: 'true',
      PHOTO_VERSIONS_ENABLED: 'true',
      GUEST_DOWNLOADS_ENABLED: 'true',
      GUEST_COMMENTS_ENABLED: 'true',
      GUEST_ANNOTATIONS_ENABLED: 'true',
      GUEST_VERSION_COMPARISON_ENABLED: 'true',
    } as unknown as WorkerEnv;
    for (const check of [
      guestDownloadsCapability,
      guestCommentsCapability,
      guestAnnotationsCapability,
      guestVersionComparisonCapability,
    ])
      expect(check(env)).toBe(true);
    expect(
      guestCommentsCapability({ ...env, GUEST_EXCHANGE_ENABLED: 'false' }),
    ).toBe(false);
    const hosted = {
      ...base,
      APP_ENV: 'staging',
      APP_URL: 'https://kino-pic-staging.kino-pick-aaron2026.workers.dev',
    } as unknown as WorkerEnv;
    for (const check of [
      guestDownloadsCapability,
      guestCommentsCapability,
      guestAnnotationsCapability,
      guestVersionComparisonCapability,
    ])
      expect(check(hosted)).toBe(false);
  });
});
