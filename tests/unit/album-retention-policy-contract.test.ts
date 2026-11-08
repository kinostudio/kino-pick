import { describe, expect, it } from 'vitest';
import {
  albumRetentionPolicySchema,
  albumRetentionShareProtectionSchema,
  updateAlbumRetentionPolicySchema,
} from '../../packages/contracts/src/album-retention-policy';

const id = '11111111-1111-4111-8111-111111111111';

describe('album retention policy contract', () => {
  it('accepts the default 90-day opt-out policy and the terminal revision', () => {
    expect(
      albumRetentionPolicySchema.parse({
        albumId: id,
        revision: 0,
        cleanupAllowed: false,
        inactiveDays: 90,
        automaticDeletionEnabled: false,
        dryRun: true,
      }),
    ).toMatchObject({ revision: 0, inactiveDays: 90, cleanupAllowed: false });
    expect(
      updateAlbumRetentionPolicySchema.parse({
        requestId: id,
        expectedOwnerId: id,
        expectedRevision: 2147483647,
        cleanupAllowed: false,
        inactiveDays: 90,
      }).expectedRevision,
    ).toBe(2147483647);
  });

  it('rejects out-of-range days and any payload that claims destructive execution', () => {
    const update = {
      requestId: id,
      expectedOwnerId: id,
      expectedRevision: 0,
      cleanupAllowed: false,
      inactiveDays: 90,
    };
    expect(
      updateAlbumRetentionPolicySchema.safeParse({
        ...update,
        inactiveDays: 0,
      }).success,
    ).toBe(false);
    expect(
      updateAlbumRetentionPolicySchema.safeParse({
        ...update,
        inactiveDays: 36501,
      }).success,
    ).toBe(false);
    expect(
      albumRetentionPolicySchema.safeParse({
        albumId: id,
        revision: 1,
        cleanupAllowed: true,
        inactiveDays: 90,
        automaticDeletionEnabled: true,
        dryRun: false,
      }).success,
    ).toBe(false);
  });

  it('accepts the exact verified empty and active share-protection summaries', () => {
    const evaluatedAt = '2026-11-09T12:00:00.000Z';
    expect(
      albumRetentionShareProtectionSchema.parse({
        albumId: id,
        evaluatedAt,
        latestActiveCustomShareExpiresAt: null,
        activeCustomShareCount: 0,
        shareEvidenceVerified: true,
        automaticDeletionEnabled: false,
        dryRun: true,
      }),
    ).toMatchObject({ albumId: id, activeCustomShareCount: 0 });
    expect(
      albumRetentionShareProtectionSchema.parse({
        albumId: id,
        evaluatedAt,
        latestActiveCustomShareExpiresAt: '2026-11-10T12:00:00.000Z',
        activeCustomShareCount: 2,
        shareEvidenceVerified: true,
        automaticDeletionEnabled: false,
        dryRun: true,
      }).activeCustomShareCount,
    ).toBe(2);
  });

  it('rejects inconsistent expiry/count/time, invalid scope and private extra fields', () => {
    const summary = {
      albumId: id,
      evaluatedAt: '2026-11-09T12:00:00.000Z',
      latestActiveCustomShareExpiresAt: null as string | null,
      activeCustomShareCount: 0,
      shareEvidenceVerified: true,
      automaticDeletionEnabled: false,
      dryRun: true,
    };
    for (const invalid of [
      { ...summary, albumId: 'not-an-album-id' },
      { ...summary, evaluatedAt: '2026-11-09T12:00:00' },
      { ...summary, activeCustomShareCount: -1 },
      { ...summary, activeCustomShareCount: 0.5 },
      {
        ...summary,
        latestActiveCustomShareExpiresAt: '2026-11-10T12:00:00.000Z',
      },
      {
        ...summary,
        latestActiveCustomShareExpiresAt: '2026-11-09T11:59:59.000Z',
        activeCustomShareCount: 1,
      },
      {
        ...summary,
        latestActiveCustomShareExpiresAt: null,
        activeCustomShareCount: 1,
      },
      { ...summary, inviteId: id },
      { ...summary, token: 'private-bearer' },
      { ...summary, password: 'private-password' },
      { ...summary, ipAddress: '192.0.2.1' },
    ])
      expect(
        albumRetentionShareProtectionSchema.safeParse(invalid).success,
      ).toBe(false);
  });
});
