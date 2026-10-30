import { describe, expect, it } from 'vitest';
import {
  annotationProcessingSnapshotSchema,
  ownerAnnotationProcessingCapabilitiesSchema,
  ownerAnnotationProcessingCommandSchema,
  ownerAnnotationProcessingResultSchema,
} from '../../packages/contracts/src/annotation-processing';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const timestamp = '2026-10-28T10:00:00.000Z';

const initialSnapshot = {
  state: 'open' as const,
  revision: 0 as const,
  annotationRevision: null,
  contentRevision: null,
  updatedAt: null,
  stale: false as const,
};

const recordedSnapshot = {
  state: 'in_progress' as const,
  revision: 3,
  annotationRevision: 7,
  contentRevision: 5,
  updatedAt: timestamp,
  stale: false,
};

const command = {
  requestId: 'abcdefab-cdef-4abc-8def-abcdefabcdef',
  expectedOwnerId: id(1),
  operation: 'set_processing_state' as const,
  inviteId: id(2),
  photoId: id(3),
  versionId: id(4),
  annotationId: id(5),
  expectedAnnotationRevision: 7,
  expectedProcessingRevision: 2,
  state: 'in_progress' as const,
};

const result = {
  ownerId: id(1),
  requestId: command.requestId,
  operation: 'set_processing_state' as const,
  inviteId: command.inviteId,
  photoId: command.photoId,
  versionId: command.versionId,
  annotationId: command.annotationId,
  processing: {
    ...recordedSnapshot,
    revision: 3,
    annotationRevision: 7,
    contentRevision: 5,
    updatedAt: timestamp,
    stale: false,
  },
  occurredAt: timestamp,
};

describe('annotation processing contracts', () => {
  it('requires the exact initial processing snapshot', () => {
    expect(annotationProcessingSnapshotSchema.parse(initialSnapshot)).toEqual(
      initialSnapshot,
    );
    for (const patch of [
      { state: 'in_progress' },
      { revision: 1 },
      { annotationRevision: 1 },
      { contentRevision: 1 },
      { updatedAt: timestamp },
      { stale: true },
      { guestId: id(8) },
    ])
      expect(
        annotationProcessingSnapshotSchema.safeParse({
          ...initialSnapshot,
          ...patch,
        }).success,
      ).toBe(false);
  });

  it('keeps processing, annotation, and content revisions independent', () => {
    expect(
      annotationProcessingSnapshotSchema.safeParse(recordedSnapshot).success,
    ).toBe(true);
    for (const state of ['open', 'in_progress', 'resolved'] as const)
      expect(
        annotationProcessingSnapshotSchema.safeParse({
          ...recordedSnapshot,
          state,
        }).success,
      ).toBe(true);

    const afterLifecycleOnly = {
      ...recordedSnapshot,
      state: 'resolved' as const,
      annotationRevision: 9,
      contentRevision: 5,
      stale: false,
    };
    expect(
      annotationProcessingSnapshotSchema.safeParse(afterLifecycleOnly).success,
    ).toBe(true);

    expect(
      annotationProcessingSnapshotSchema.safeParse({
        ...recordedSnapshot,
        annotationRevision: 4,
        contentRevision: 5,
      }).success,
    ).toBe(false);
    for (const patch of [
      { revision: 0 },
      { annotationRevision: 0 },
      { contentRevision: 0 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
      { updatedAt: 'not-a-timestamp' },
      { stale: 'false' },
      { geometry: { type: 'point' } },
    ])
      expect(
        annotationProcessingSnapshotSchema.safeParse({
          ...recordedSnapshot,
          ...patch,
        }).success,
      ).toBe(false);

    expect(
      annotationProcessingSnapshotSchema.safeParse({
        ...recordedSnapshot,
        annotationRevision: 8,
        contentRevision: 6,
        stale: true,
      }).success,
    ).toBe(true);
  });

  it('validates scoped processing commands and rejects injected identities or content', () => {
    expect(
      ownerAnnotationProcessingCommandSchema.safeParse({
        ...command,
        expectedProcessingRevision: 0,
      }).success,
    ).toBe(true);
    for (const state of ['open', 'in_progress', 'resolved'] as const)
      expect(
        ownerAnnotationProcessingCommandSchema.safeParse({
          ...command,
          state,
        }).success,
      ).toBe(true);

    const uppercaseOwnerId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const unchangedIdentity = ownerAnnotationProcessingCommandSchema.parse({
      ...command,
      expectedOwnerId: uppercaseOwnerId,
    });
    expect(unchangedIdentity.expectedOwnerId).toBe(uppercaseOwnerId);
    expect(
      ownerAnnotationProcessingCommandSchema.safeParse({
        ...command,
        requestId: command.requestId.toUpperCase(),
      }).success,
    ).toBe(false);

    for (const patch of [
      { expectedOwnerId: undefined },
      { inviteId: undefined },
      { photoId: undefined },
      { versionId: undefined },
      { annotationId: undefined },
      { expectedAnnotationRevision: 0 },
      { expectedAnnotationRevision: Number.MAX_SAFE_INTEGER + 1 },
      { expectedProcessingRevision: -1 },
      { expectedProcessingRevision: Number.MAX_SAFE_INTEGER + 1 },
      { operation: 'update' },
      { actorId: id(8) },
      { ownerId: id(8) },
      { guestId: id(8) },
      { sessionId: 'owner-session-secret' },
      { workspaceId: id(9) },
      { geometry: { type: 'point' } },
      { style: { color: 'amber' } },
      { commentId: id(10) },
    ])
      expect(
        ownerAnnotationProcessingCommandSchema.safeParse({
          ...command,
          ...patch,
        }).success,
      ).toBe(false);
  });

  it('accepts immutable positive current receipts only', () => {
    expect(ownerAnnotationProcessingResultSchema.parse(result)).toEqual(result);
    const uppercaseOwnerId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    expect(
      ownerAnnotationProcessingResultSchema.parse({
        ...result,
        ownerId: uppercaseOwnerId,
      }).ownerId,
    ).toBe(uppercaseOwnerId);

    for (const invalid of [
      { processing: initialSnapshot },
      { processing: { ...result.processing, stale: true } },
      {
        processing: {
          ...result.processing,
          updatedAt: '2026-10-28T10:01:00.000Z',
        },
      },
      { occurredAt: '2026-10-28T10:01:00.000Z' },
      { requestId: result.requestId.toUpperCase() },
      { operation: 'update' },
      { geometry: { type: 'point' } },
      { style: { color: 'amber' } },
      { commentId: id(10) },
      { guestId: id(11) },
      { sessionId: 'owner-session-secret' },
    ])
      expect(
        ownerAnnotationProcessingResultSchema.safeParse({
          ...result,
          ...invalid,
        }).success,
      ).toBe(false);
  });

  it('keeps processing capabilities to an explicit enabled flag', () => {
    expect(
      ownerAnnotationProcessingCapabilitiesSchema.parse({ enabled: true }),
    ).toEqual({
      enabled: true,
    });
    expect(
      ownerAnnotationProcessingCapabilitiesSchema.safeParse({
        enabled: true,
        actorId: id(1),
      }).success,
    ).toBe(false);
  });
});
