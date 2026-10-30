import { describe, expect, it } from 'vitest';
import {
  ownerAnnotationAuthoringCapabilitiesSchema,
  ownerAnnotationCommandSchema,
  ownerAnnotationResultSchema,
  ownerAuthoredAnnotationItemSchema,
  ownerAuthoredAnnotationPageSchema,
} from '../../packages/contracts/src/owner-annotation-authoring';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const timestamp = '2026-10-28T10:00:00.000Z';
const geometry = {
  type: 'point' as const,
  coordinateSpace: 'normalized_1e6' as const,
  x: 250_000,
  y: 750_000,
};
const style = { color: 'amber' as const };
const scope = {
  requestId: 'abcdefab-cdef-4abc-8def-abcdefabcdef',
  expectedOwnerId: id(2),
  inviteId: id(3),
  photoId: id(4),
  versionId: id(5),
};
const createCommand = {
  ...scope,
  operation: 'create' as const,
  geometry,
  style,
  commentId: id(6),
};
const liveItem = {
  annotationId: id(7),
  inviteId: id(3),
  photoId: id(4),
  versionId: id(5),
  revision: 1,
  geometry,
  style,
  commentId: id(6),
  state: 'open' as const,
  authorType: 'owner' as const,
  authorLabel: '作品負責人',
  canEdit: true as const,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('Owner annotation authoring contracts', () => {
  it('requires the exact owner, invite, photo, and version scope on every command', () => {
    const commands = [
      createCommand,
      {
        ...scope,
        operation: 'update' as const,
        annotationId: id(7),
        expectedRevision: 1,
        geometry,
        style,
        commentId: null,
      },
      ...(['delete', 'resolve', 'reopen'] as const).map((operation) => ({
        ...scope,
        operation,
        annotationId: id(7),
        expectedRevision: 1,
      })),
    ];

    for (const command of commands) {
      expect(ownerAnnotationCommandSchema.safeParse(command).success).toBe(
        true,
      );
      for (const missing of [
        'expectedOwnerId',
        'inviteId',
        'photoId',
        'versionId',
      ]) {
        const incomplete = { ...command } as Record<string, unknown>;
        delete incomplete[missing];
        expect(ownerAnnotationCommandSchema.safeParse(incomplete).success).toBe(
          false,
        );
      }
    }
  });

  it('uses strict lowercase request IDs, preserves linked resource spelling, and rejects injected identity', () => {
    const upperCommentId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const upperOwnerId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const command = {
      ...createCommand,
      expectedOwnerId: upperOwnerId,
      commentId: upperCommentId,
    };
    const parsed = ownerAnnotationCommandSchema.safeParse(command);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.expectedOwnerId).toBe(upperOwnerId);
      if (parsed.data.operation === 'create')
        expect(parsed.data.commentId).toBe(upperCommentId);
    }

    expect(
      ownerAnnotationCommandSchema.safeParse({
        ...createCommand,
        requestId: createCommand.requestId.toUpperCase(),
      }).success,
    ).toBe(false);

    const commands = [
      createCommand,
      {
        ...scope,
        operation: 'update' as const,
        annotationId: id(7),
        expectedRevision: 1,
        geometry,
        style,
        commentId: null,
      },
      ...(['delete', 'resolve', 'reopen'] as const).map((operation) => ({
        ...scope,
        operation,
        annotationId: id(7),
        expectedRevision: 1,
      })),
    ];
    const injectedFields = [
      { actorId: id(8) },
      { ownerId: id(8) },
      { guestId: id(8) },
      { sessionId: 'private-session' },
      { workspaceId: id(9) },
      { authorGuestId: id(10) },
      { authorType: 'guest' },
    ];
    for (const command of commands)
      for (const injected of injectedFields)
        expect(
          ownerAnnotationCommandSchema.safeParse({
            ...command,
            ...injected,
          }).success,
        ).toBe(false);
  });

  it('requires write fields only for create and update operations', () => {
    expect(
      ownerAnnotationCommandSchema.safeParse({
        ...createCommand,
        commentId: undefined,
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationCommandSchema.safeParse({
        ...scope,
        operation: 'update',
        annotationId: id(7),
        expectedRevision: 1,
        geometry,
        style,
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationCommandSchema.safeParse({
        ...scope,
        operation: 'delete',
        annotationId: id(7),
        expectedRevision: 1,
        commentId: null,
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationCommandSchema.safeParse({
        ...scope,
        operation: 'resolve',
        annotationId: id(7),
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });

  it('requires Owner authorship, edit permission, and non-peer identity fields', () => {
    expect(ownerAuthoredAnnotationItemSchema.safeParse(liveItem).success).toBe(
      true,
    );
    for (const patch of [
      { canEdit: false },
      { authorType: 'guest' },
      { ownerId: id(2) },
      { authorGuestId: id(10) },
      { sessionId: 'private-session' },
    ])
      expect(
        ownerAuthoredAnnotationItemSchema.safeParse({
          ...liveItem,
          ...patch,
        }).success,
      ).toBe(false);

    for (const state of ['open', 'resolved'] as const)
      expect(
        ownerAuthoredAnnotationItemSchema.safeParse({ ...liveItem, state })
          .success,
      ).toBe(true);
    expect(
      ownerAuthoredAnnotationItemSchema.safeParse({
        ...liveItem,
        geometry: null,
      }).success,
    ).toBe(false);
    expect(
      ownerAuthoredAnnotationItemSchema.safeParse({ ...liveItem, style: null })
        .success,
    ).toBe(false);
  });

  it('accepts only redacted deletion tombstones', () => {
    const tombstone = {
      ...liveItem,
      revision: 2,
      geometry: null,
      style: null,
      commentId: null,
      state: 'deleted' as const,
    };
    expect(ownerAuthoredAnnotationItemSchema.safeParse(tombstone).success).toBe(
      true,
    );
    for (const patch of [{ geometry }, { style }, { commentId: id(6) }])
      expect(
        ownerAuthoredAnnotationItemSchema.safeParse({ ...tombstone, ...patch })
          .success,
      ).toBe(false);
  });

  it('binds every page row to the requested invite/photo/version and rejects duplicate IDs', () => {
    const page = {
      ownerId: id(2),
      inviteId: id(3),
      photoId: id(4),
      versionId: id(5),
      items: [liveItem],
      nextCursor: null,
    };
    expect(ownerAuthoredAnnotationPageSchema.safeParse(page).success).toBe(
      true,
    );
    for (const patch of [
      { inviteId: id(8) },
      { photoId: id(8) },
      { versionId: id(8) },
    ])
      expect(
        ownerAuthoredAnnotationPageSchema.safeParse({
          ...page,
          items: [{ ...liveItem, ...patch }],
        }).success,
      ).toBe(false);
    expect(
      ownerAuthoredAnnotationPageSchema.safeParse({
        ...page,
        items: [liveItem, liveItem],
      }).success,
    ).toBe(false);
    expect(
      ownerAuthoredAnnotationPageSchema.safeParse({
        ...page,
        items: Array.from({ length: 25 }, (_, index) => ({
          ...liveItem,
          annotationId: id(index + 20),
        })),
      }).success,
    ).toBe(false);
    expect(
      ownerAuthoredAnnotationPageSchema.safeParse({
        ...page,
        internalSession: 'private-session',
      }).success,
    ).toBe(false);
  });

  it('enforces operation-specific result state, revision, timestamp, and request ID', () => {
    const result = {
      ownerId: id(2),
      requestId: scope.requestId,
      operation: 'create' as const,
      item: liveItem,
      occurredAt: timestamp,
    };
    expect(ownerAnnotationResultSchema.safeParse(result).success).toBe(true);
    expect(
      ownerAnnotationResultSchema.safeParse({
        ...result,
        requestId: result.requestId.toUpperCase(),
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationResultSchema.safeParse({
        ...result,
        occurredAt: '2026-10-28T11:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationResultSchema.safeParse({
        ...result,
        item: { ...liveItem, revision: 2 },
      }).success,
    ).toBe(false);
    expect(
      ownerAnnotationResultSchema.safeParse({
        ...result,
        item: { ...liveItem, state: 'resolved' },
      }).success,
    ).toBe(false);

    const updatedItem = {
      ...liveItem,
      revision: 2,
      updatedAt: '2026-10-28T11:00:00.000Z',
    };
    for (const [operation, state] of [
      ['update', 'open'],
      ['resolve', 'resolved'],
      ['reopen', 'open'],
      ['delete', 'deleted'],
    ] as const) {
      const item =
        operation === 'delete'
          ? {
              ...updatedItem,
              geometry: null,
              style: null,
              commentId: null,
              state,
            }
          : { ...updatedItem, state };
      expect(
        ownerAnnotationResultSchema.safeParse({
          ...result,
          operation,
          item,
          occurredAt: item.updatedAt,
        }).success,
      ).toBe(true);
      expect(
        ownerAnnotationResultSchema.safeParse({
          ...result,
          operation,
          item: { ...item, revision: 1 },
          occurredAt: item.updatedAt,
        }).success,
      ).toBe(false);
    }
  });

  it('exposes only the independent authoring capability flag', () => {
    expect(
      ownerAnnotationAuthoringCapabilitiesSchema.safeParse({ enabled: true })
        .success,
    ).toBe(true);
    expect(
      ownerAnnotationAuthoringCapabilitiesSchema.safeParse({ enabled: false })
        .success,
    ).toBe(true);
    expect(
      ownerAnnotationAuthoringCapabilitiesSchema.safeParse({
        enabled: true,
        canAnnotate: true,
      }).success,
    ).toBe(false);
  });
});
