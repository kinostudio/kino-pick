import { describe, expect, it } from 'vitest';
import {
  createInviteSchema,
  createdInviteSchema,
  inviteCapabilitiesSchema,
  inviteSummarySchema,
} from '../../packages/contracts/src/invites';
import { guestAlbumAccessSchema } from '../../packages/contracts/src/guest-access';

const permissions = {
  can_view: true,
  can_download_preview: false,
  can_download_original: false,
  can_select: false,
  can_rate: false,
  can_favorite: false,
  can_tag: false,
  can_annotate: false,
  can_comment: false,
  can_submit: false,
  can_view_own_history: false,
  can_compare_versions: false,
};
const deadline = '2026-11-10T00:00:00.000Z';

describe('inherited share contracts', () => {
  it('keeps the legacy custom create payload shape unchanged', () => {
    const legacy = {
      requestId: '00000000-0000-4000-8000-000000000001',
      albumIds: ['00000000-0000-4000-8000-000000000002'],
      accessMode: 'link_only',
      permissions,
      expiresAt: deadline,
      maxUses: null,
    };

    expect(createInviteSchema.parse(legacy)).toEqual(legacy);
  });

  it('requires an explicit null only for inherited create expiry', () => {
    const legacy = {
      requestId: '00000000-0000-4000-8000-000000000001',
      albumIds: ['00000000-0000-4000-8000-000000000002'],
      accessMode: 'link_only',
      permissions,
      expiresAt: deadline,
      maxUses: null,
    };
    const inherited = {
      ...legacy,
      expiryMode: 'inherit_album',
      expiresAt: null,
    };

    expect(createInviteSchema.parse(inherited)).toEqual(inherited);
    expect(
      createInviteSchema.safeParse({ ...legacy, expiresAt: null }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({ ...legacy, expiresAt: undefined }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({
        ...inherited,
        expiresAt: deadline,
      }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({ ...legacy, extra: true }).success,
    ).toBe(false);
  });

  it('allows null response deadlines only with inherited mode and preserves old response shape', () => {
    const created = {
      inviteId: '00000000-0000-4000-8000-000000000003',
      workspaceId: '00000000-0000-4000-8000-000000000004',
      projectId: '00000000-0000-4000-8000-000000000005',
      createdAt: deadline,
      expiresAt: deadline,
    };
    const summary = {
      id: created.inviteId,
      workspaceId: created.workspaceId,
      projectId: created.projectId,
      accessMode: 'link_only',
      permissions,
      createdAt: deadline,
      expiresAt: deadline,
      revokedAt: null,
      sealed: true,
      maxUses: null,
      issuedSessions: 0,
      albums: [{ id: '00000000-0000-4000-8000-000000000002', name: 'Album' }],
    };

    expect(createdInviteSchema.parse(created)).toEqual(created);
    expect(inviteSummarySchema.parse(summary)).toEqual(summary);
    expect(
      createdInviteSchema.parse({
        ...created,
        expiryMode: 'inherit_album',
        expiresAt: null,
      }),
    ).toMatchObject({ expiryMode: 'inherit_album', expiresAt: null });
    expect(
      inviteSummarySchema.parse({
        ...summary,
        expiryMode: 'inherit_album',
        expiresAt: null,
      }),
    ).toMatchObject({ expiryMode: 'inherit_album', expiresAt: null });
    expect(
      createdInviteSchema.safeParse({ ...created, expiresAt: null }).success,
    ).toBe(false);
    expect(
      inviteSummarySchema.safeParse({ ...summary, expiresAt: null }).success,
    ).toBe(false);
    expect(
      createdInviteSchema.safeParse({ ...created, extra: true }).success,
    ).toBe(false);
    expect(
      inviteSummarySchema.safeParse({ ...summary, extra: true }).success,
    ).toBe(false);
  });

  it('keeps the guest session deadline separate from per-album invite expiry', () => {
    const inherited = {
      guestId: '00000000-0000-4000-8000-000000000006',
      inviteId: '00000000-0000-4000-8000-000000000003',
      workspaceId: '00000000-0000-4000-8000-000000000004',
      projectId: '00000000-0000-4000-8000-000000000005',
      albumId: '00000000-0000-4000-8000-000000000002',
      permissions,
      expiresAt: '2026-11-10T12:00:00.000Z',
      expiryMode: 'inherit_album',
      inviteExpiresAt: null,
    };

    expect(guestAlbumAccessSchema.parse(inherited)).toEqual(inherited);
    expect(
      guestAlbumAccessSchema.parse({ ...inherited, inviteExpiresAt: deadline }),
    ).toMatchObject({
      expiresAt: inherited.expiresAt,
      inviteExpiresAt: deadline,
    });
    const legacy = { ...inherited };
    delete (legacy as { expiryMode?: string }).expiryMode;
    delete (legacy as { inviteExpiresAt?: string | null }).inviteExpiresAt;
    expect(guestAlbumAccessSchema.parse(legacy)).toEqual(legacy);
    expect(
      guestAlbumAccessSchema.safeParse({
        ...legacy,
        inviteExpiresAt: null,
      }).success,
    ).toBe(false);
    const missingPerAlbumExpiry = { ...inherited };
    delete (missingPerAlbumExpiry as { inviteExpiresAt?: string | null })
      .inviteExpiresAt;
    expect(
      guestAlbumAccessSchema.safeParse(missingPerAlbumExpiry).success,
    ).toBe(false);
    expect(
      guestAlbumAccessSchema.safeParse({ ...inherited, extra: true }).success,
    ).toBe(false);
  });

  it('keeps inherited expiry capability opt-in and rejects false or extra fields', () => {
    const legacy = {
      issuanceEnabled: true,
      exchangeEnabled: true,
      selectionEnabled: false,
      feedbackEnabled: false,
      tagsEnabled: false,
      historyEnabled: false,
      downloadsEnabled: false,
      commentsEnabled: false,
      annotationsEnabled: false,
      versionComparisonEnabled: false,
      maxAlbums: 24,
      maxUses: 10000,
      maxExpiryDays: 365,
    };

    expect(inviteCapabilitiesSchema.parse(legacy)).toEqual(legacy);
    expect(
      inviteCapabilitiesSchema.parse({
        ...legacy,
        inheritedExpiryEnabled: true,
      }).inheritedExpiryEnabled,
    ).toBe(true);
    expect(
      inviteCapabilitiesSchema.safeParse({
        ...legacy,
        inheritedExpiryEnabled: false,
      }).success,
    ).toBe(false);
    expect(
      inviteCapabilitiesSchema.safeParse({ ...legacy, extra: true }).success,
    ).toBe(false);
  });
});
