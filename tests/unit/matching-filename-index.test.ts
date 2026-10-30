import { describe, expect, it } from 'vitest';
import {
  matchingFilenameIndexCapabilitiesSchema,
  matchingFilenameIndexStatusSchema,
} from '../../packages/contracts/src/matching-filename-index';

const scope = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  albumId: '33333333-3333-4333-8333-333333333333',
  profile: 'default-v1' as const,
};

describe('matching filename index status contract', () => {
  it.each([
    {
      indexedSessions: 4,
      missingSessions: 2,
      invalidSessions: 1,
      unlinkedVersions: 0,
      unreadyPhotos: 0,
      state: 'building',
    },
    {
      indexedSessions: 6,
      missingSessions: 0,
      invalidSessions: 1,
      unlinkedVersions: 0,
      unreadyPhotos: 0,
      state: 'blocked',
    },
    {
      indexedSessions: 6,
      missingSessions: 0,
      invalidSessions: 0,
      unlinkedVersions: 0,
      unreadyPhotos: 0,
      state: 'ready',
    },
  ] as const)('accepts the $state state and its counters', (counters) => {
    expect(
      matchingFilenameIndexStatusSchema.parse({ ...scope, ...counters }),
    ).toEqual({ ...scope, ...counters });
  });

  it('requires exact counters, scope, profile, and readiness formula', () => {
    const ready = {
      ...scope,
      indexedSessions: 6,
      missingSessions: 0,
      invalidSessions: 0,
      unlinkedVersions: 0,
      unreadyPhotos: 0,
      state: 'ready',
    };

    expect(
      matchingFilenameIndexStatusSchema.safeParse({
        ...ready,
        canonicalBasename: 'private-name',
      }).success,
    ).toBe(false);
    expect(
      matchingFilenameIndexStatusSchema.safeParse({
        ...ready,
        profile: 'default-v2',
      }).success,
    ).toBe(false);
    expect(
      matchingFilenameIndexStatusSchema.safeParse({
        ...ready,
        indexedSessions: -1,
      }).success,
    ).toBe(false);
    expect(
      matchingFilenameIndexStatusSchema.safeParse({
        ...ready,
        indexedSessions: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      matchingFilenameIndexStatusSchema.safeParse({
        ...ready,
        unlinkedVersions: 1,
      }).success,
    ).toBe(false);
    expect(
      matchingFilenameIndexStatusSchema.safeParse({
        ...ready,
        invalidSessions: 7,
        state: 'blocked',
      }).success,
    ).toBe(false);
    expect(
      matchingFilenameIndexStatusSchema.safeParse({
        ...ready,
        missingSessions: 1,
      }).success,
    ).toBe(false);
  });

  it('strictly exposes only the capability flag', () => {
    expect(
      matchingFilenameIndexCapabilitiesSchema.parse({ enabled: false }),
    ).toEqual({
      enabled: false,
    });
    expect(
      matchingFilenameIndexCapabilitiesSchema.safeParse({
        enabled: true,
        profile: 'default-v1',
      }).success,
    ).toBe(false);
  });
});
