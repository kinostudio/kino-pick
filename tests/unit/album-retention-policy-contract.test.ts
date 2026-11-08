import { describe, expect, it } from 'vitest';
import {
  albumRetentionPolicySchema,
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
});
