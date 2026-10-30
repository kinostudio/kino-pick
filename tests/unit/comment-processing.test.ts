import { describe, expect, it } from 'vitest';
import {
  commentProcessingSnapshotSchema,
  ownerCommentProcessingCapabilitiesSchema,
  ownerCommentProcessingCommandSchema,
  ownerCommentProcessingResultSchema,
} from '../../packages/contracts/src/comment-processing';

const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const timestamp = '2026-10-28T10:00:00.000Z';

const initialSnapshot = {
  state: 'open' as const,
  revision: 0,
  commentRevision: null,
  contentRevision: null,
  updatedAt: null,
  stale: false,
};

const recordedSnapshot = {
  state: 'in_progress' as const,
  revision: 3,
  commentRevision: 8,
  contentRevision: 7,
  updatedAt: timestamp,
  stale: false,
};

const command = {
  requestId: id(1),
  operation: 'set_processing_state' as const,
  inviteId: id(2),
  photoId: id(3),
  versionId: id(4),
  commentId: id(5),
  expectedCommentRevision: 8,
  expectedProcessingRevision: 0,
  state: 'in_progress' as const,
};

const result = {
  requestId: id(1),
  operation: 'set_processing_state' as const,
  commentId: id(5),
  photoId: id(3),
  versionId: id(4),
  processing: {
    state: 'resolved' as const,
    revision: 1,
    commentRevision: 8,
    contentRevision: 8,
    updatedAt: timestamp,
    stale: false,
  },
  occurredAt: timestamp,
};

describe('Owner comment processing snapshots', () => {
  it('accepts only the exact initial open projection at revision zero', () => {
    expect(commentProcessingSnapshotSchema.parse(initialSnapshot)).toEqual(
      initialSnapshot,
    );

    for (const invalid of [
      { ...initialSnapshot, state: 'in_progress' },
      { ...initialSnapshot, revision: 1 },
      { ...initialSnapshot, commentRevision: 1 },
      { ...initialSnapshot, contentRevision: 0 },
      { ...initialSnapshot, updatedAt: timestamp },
      { ...initialSnapshot, stale: true },
      { ...initialSnapshot, actorId: id(9) },
    ])
      expect(commentProcessingSnapshotSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it('accepts recorded states, safe revisions, and an explicitly stale projection', () => {
    expect(commentProcessingSnapshotSchema.parse(recordedSnapshot)).toEqual(
      recordedSnapshot,
    );
    for (const state of ['open', 'in_progress', 'resolved'] as const)
      expect(
        commentProcessingSnapshotSchema.safeParse({
          ...recordedSnapshot,
          state,
          stale: true,
        }).success,
      ).toBe(true);

    expect(
      commentProcessingSnapshotSchema.safeParse({
        ...recordedSnapshot,
        revision: Number.MAX_SAFE_INTEGER,
        commentRevision: Number.MAX_SAFE_INTEGER,
        contentRevision: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(true);
  });

  it('keeps recorded content within the comment watermark and rejects invalid revisions', () => {
    for (const invalid of [
      { ...recordedSnapshot, revision: 0 },
      { ...recordedSnapshot, revision: -1 },
      { ...recordedSnapshot, revision: 1.5 },
      { ...recordedSnapshot, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...recordedSnapshot, commentRevision: 0 },
      { ...recordedSnapshot, commentRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...recordedSnapshot, contentRevision: 0 },
      { ...recordedSnapshot, contentRevision: 1.5 },
      { ...recordedSnapshot, contentRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...recordedSnapshot, commentRevision: 6, contentRevision: 7 },
      { ...recordedSnapshot, updatedAt: 'not-a-time' },
      { ...recordedSnapshot, guestId: id(9) },
    ])
      expect(commentProcessingSnapshotSchema.safeParse(invalid).success).toBe(
        false,
      );
  });
});

describe('Owner comment processing commands', () => {
  it('accepts the strict state command and canonicalizes its request UUID', () => {
    expect(ownerCommentProcessingCommandSchema.parse(command)).toEqual(command);

    const uppercaseRequestId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const parsed = ownerCommentProcessingCommandSchema.parse({
      ...command,
      requestId: uppercaseRequestId,
    });
    expect(parsed.requestId).toBe(uppercaseRequestId.toLowerCase());
  });

  it('checks comment and processing compare-and-set revisions at safe integer bounds', () => {
    expect(
      ownerCommentProcessingCommandSchema.safeParse({
        ...command,
        expectedCommentRevision: Number.MAX_SAFE_INTEGER,
        expectedProcessingRevision: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(true);

    for (const expectedCommentRevision of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(
        ownerCommentProcessingCommandSchema.safeParse({
          ...command,
          expectedCommentRevision,
        }).success,
      ).toBe(false);

    for (const expectedProcessingRevision of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(
        ownerCommentProcessingCommandSchema.safeParse({
          ...command,
          expectedProcessingRevision,
        }).success,
      ).toBe(false);
  });

  it('rejects body, actor, session, Guest identity, and unknown state fields', () => {
    for (const extra of [
      { body: 'must stay Guest-authored' },
      { actorId: id(9) },
      { sessionId: id(9) },
      { guestId: id(9) },
      { expectedGuestId: id(9) },
    ])
      expect(
        ownerCommentProcessingCommandSchema.safeParse({
          ...command,
          ...extra,
        }).success,
      ).toBe(false);

    for (const state of ['deleted', 'closed', 'unknown'])
      expect(
        ownerCommentProcessingCommandSchema.safeParse({
          ...command,
          state,
        }).success,
      ).toBe(false);
  });
});

describe('Owner comment processing results and capability', () => {
  it('accepts only a fresh recorded receipt whose update time matches its receipt time', () => {
    expect(ownerCommentProcessingResultSchema.parse(result)).toEqual(result);

    expect(
      ownerCommentProcessingResultSchema.safeParse({
        ...result,
        processing: initialSnapshot,
      }).success,
    ).toBe(false);
    expect(
      ownerCommentProcessingResultSchema.safeParse({
        ...result,
        processing: { ...result.processing, stale: true },
      }).success,
    ).toBe(false);
    expect(
      ownerCommentProcessingResultSchema.safeParse({
        ...result,
        processing: {
          ...result.processing,
          updatedAt: '2026-10-28T10:01:00.000Z',
        },
      }).success,
    ).toBe(false);
    expect(
      ownerCommentProcessingResultSchema.safeParse({
        ...result,
        occurredAt: 'not-a-time',
      }).success,
    ).toBe(false);
  });

  it('rejects receipt body and actor/session/Guest identity fields', () => {
    for (const extra of [
      { body: 'historical Guest content must not replay' },
      { actorId: id(9) },
      { sessionId: id(9) },
      { guestId: id(9) },
    ])
      expect(
        ownerCommentProcessingResultSchema.safeParse({
          ...result,
          ...extra,
        }).success,
      ).toBe(false);

    for (const extra of [
      { actorId: id(9) },
      { sessionId: id(9) },
      { guestId: id(9) },
      { body: 'Guest-authored text is not part of this projection' },
    ])
      expect(
        commentProcessingSnapshotSchema.safeParse({
          ...recordedSnapshot,
          ...extra,
        }).success,
      ).toBe(false);
  });

  it('exposes only the enabled flag', () => {
    expect(
      ownerCommentProcessingCapabilitiesSchema.parse({ enabled: false }),
    ).toEqual({ enabled: false });
    expect(
      ownerCommentProcessingCapabilitiesSchema.parse({ enabled: true }),
    ).toEqual({ enabled: true });
    expect(
      ownerCommentProcessingCapabilitiesSchema.safeParse({
        enabled: true,
        ownerId: id(9),
      }).success,
    ).toBe(false);
  });
});
