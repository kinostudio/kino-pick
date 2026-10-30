import { describe, expect, it } from 'vitest';
import {
  ownerCommentCommandSchema,
  ownerCommentReadQuerySchema,
  ownerCommentResultSchema,
  ownerCommentThreadItemSchema,
  ownerCommentThreadPageSchema,
  ownerCommentsCapabilitiesSchema,
} from '../../packages/contracts/src/owner-comments';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const timestamp = '2026-10-28T10:00:00.000Z';

const replyCommand = {
  requestId: id(1),
  operation: 'reply' as const,
  inviteId: id(2),
  photoId: id(3),
  versionId: id(4),
  parentCommentId: id(5),
  expectedParentRevision: 1,
  body: '收到，會調整。',
};

const guestItem = {
  commentId: id(5),
  photoId: id(3),
  versionId: id(4),
  revision: 1,
  body: '請調整光線',
  state: 'open' as const,
  authorType: 'guest' as const,
  parentCommentId: null,
  authorLabel: '客戶',
  canEdit: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const ownerItem = {
  commentId: id(6),
  photoId: id(3),
  versionId: id(4),
  revision: 1,
  body: '收到，會調整。',
  state: 'open' as const,
  authorType: 'owner' as const,
  parentCommentId: id(5),
  authorLabel: '攝影師',
  canEdit: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('Owner comment commands', () => {
  it('accepts reply, edit and delete with their explicit compare-and-set fields', () => {
    expect(ownerCommentCommandSchema.safeParse(replyCommand).success).toBe(
      true,
    );
    expect(
      ownerCommentCommandSchema.safeParse({
        requestId: id(7),
        operation: 'edit_reply',
        replyId: id(6),
        expectedRevision: 2,
        body: '修正版回覆',
      }).success,
    ).toBe(true);
    expect(
      ownerCommentCommandSchema.safeParse({
        requestId: id(8),
        operation: 'delete_reply',
        replyId: id(6),
        expectedRevision: 2,
      }).success,
    ).toBe(true);
  });

  it('reuses Guest body normalization and control-character validation', () => {
    const parsed = ownerCommentCommandSchema.parse({
      ...replyCommand,
      body: '  e\u0301\r\n第二行  ',
    });
    if (parsed.operation !== 'reply') throw new Error('Expected a reply');
    expect(parsed.body).toBe('é\n第二行');
    expect(
      ownerCommentCommandSchema.safeParse({
        ...replyCommand,
        body: 'x\u202e',
      }).success,
    ).toBe(false);
  });

  it('requires positive safe CAS revisions and rejects extra actor or tenant identity', () => {
    for (const expectedParentRevision of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(
        ownerCommentCommandSchema.safeParse({
          ...replyCommand,
          expectedParentRevision,
        }).success,
      ).toBe(false);

    for (const expectedRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        ownerCommentCommandSchema.safeParse({
          requestId: id(7),
          operation: 'edit_reply',
          replyId: id(6),
          expectedRevision,
          body: '修正版回覆',
        }).success,
      ).toBe(false);

    for (const expectedRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        ownerCommentCommandSchema.safeParse({
          requestId: id(8),
          operation: 'delete_reply',
          replyId: id(6),
          expectedRevision,
        }).success,
      ).toBe(false);

    for (const extra of [
      { actorId: id(9) },
      { sessionId: id(9) },
      { workspaceId: id(9) },
      { expectedGuestId: id(9) },
    ]) {
      expect(
        ownerCommentCommandSchema.safeParse({
          ...replyCommand,
          ...extra,
        }).success,
      ).toBe(false);
      expect(
        ownerCommentCommandSchema.safeParse({
          requestId: id(7),
          operation: 'edit_reply',
          replyId: id(6),
          expectedRevision: 2,
          body: '修正版回覆',
          ...extra,
        }).success,
      ).toBe(false);
      expect(
        ownerCommentCommandSchema.safeParse({
          requestId: id(8),
          operation: 'delete_reply',
          replyId: id(6),
          expectedRevision: 2,
          ...extra,
        }).success,
      ).toBe(false);
    }

    expect(
      ownerCommentCommandSchema.safeParse({
        requestId: id(8),
        operation: 'delete_reply',
        replyId: id(6),
        expectedRevision: 2,
        body: 'not allowed',
      }).success,
    ).toBe(false);
  });
});

describe('Owner comment read query', () => {
  it('requires an invite and accepts bounded cursor or targeted comment reads', () => {
    expect(ownerCommentReadQuerySchema.parse({ inviteId: id(2) })).toEqual({
      inviteId: id(2),
    });
    expect(
      ownerCommentReadQuerySchema.safeParse({
        inviteId: id(2),
        cursor: 'c'.repeat(1024),
      }).success,
    ).toBe(true);
    expect(
      ownerCommentReadQuerySchema.safeParse({
        inviteId: id(2),
        commentId: id(5),
      }).success,
    ).toBe(true);

    for (const query of [
      {},
      { inviteId: id(2), cursor: '' },
      { inviteId: id(2), cursor: 'c'.repeat(1025) },
      { inviteId: id(2), cursor: 'c', commentId: id(5) },
      { inviteId: id(2), commentId: 'invalid' },
      { inviteId: id(2), guestId: id(10) },
    ])
      expect(ownerCommentReadQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('Owner comment thread items and pages', () => {
  it('enforces tombstones, author provenance, reply parenting and immutability', () => {
    expect(ownerCommentThreadItemSchema.safeParse(guestItem).success).toBe(
      true,
    );
    expect(ownerCommentThreadItemSchema.safeParse(ownerItem).success).toBe(
      true,
    );
    expect(
      ownerCommentThreadItemSchema.safeParse({
        ...guestItem,
        state: 'deleted',
        body: null,
      }).success,
    ).toBe(true);
    expect(
      ownerCommentThreadItemSchema.safeParse({
        ...ownerItem,
        state: 'deleted',
        body: null,
        revision: 2,
      }).success,
    ).toBe(true);

    for (const invalid of [
      { ...guestItem, state: 'deleted' },
      { ...guestItem, body: null },
      { ...guestItem, parentCommentId: id(11) },
      { ...guestItem, canEdit: true },
      { ...ownerItem, parentCommentId: null },
      { ...ownerItem, parentCommentId: id(6) },
      { ...ownerItem, state: 'resolved' },
      { ...ownerItem, isMine: true },
      { ...guestItem, authorGuestId: id(9) },
    ])
      expect(ownerCommentThreadItemSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it('keeps page results within photo/version scope and removes duplicate IDs', () => {
    const page = {
      inviteId: id(2),
      photoId: id(3),
      versionId: id(4),
      items: [guestItem, ownerItem],
      nextCursor: null,
    };
    expect(ownerCommentThreadPageSchema.safeParse(page).success).toBe(true);

    for (const patch of [
      { items: [{ ...guestItem, photoId: id(12) }] },
      { items: [{ ...ownerItem, versionId: id(12) }] },
      { items: [guestItem, guestItem] },
      {
        items: Array.from({ length: 25 }, (_, n) => ({
          ...guestItem,
          commentId: id(n + 30),
        })),
      },
      { items: [{ ...guestItem, inviteId: id(12) }] },
    ])
      expect(
        ownerCommentThreadPageSchema.safeParse({ ...page, ...patch }).success,
      ).toBe(false);
  });
});

describe('Owner comment results and capabilities', () => {
  const result = (
    operation: 'reply' | 'edit_reply' | 'delete_reply',
    item: object,
  ) => ({
    requestId: id(1),
    operation,
    item,
    occurredAt: timestamp,
  });

  it('binds a new reply result to the Owner and revision 1/open state', () => {
    expect(
      ownerCommentResultSchema.safeParse(result('reply', ownerItem)).success,
    ).toBe(true);
    for (const invalid of [
      { ...ownerItem, revision: 2 },
      { ...ownerItem, state: 'deleted', body: null, revision: 2 },
      guestItem,
    ])
      expect(
        ownerCommentResultSchema.safeParse(result('reply', invalid)).success,
      ).toBe(false);
  });

  it('requires edits to be open at revision 2+ and deletes to be tombstones at revision 2+', () => {
    expect(
      ownerCommentResultSchema.safeParse(
        result('edit_reply', { ...ownerItem, revision: 2 }),
      ).success,
    ).toBe(true);
    expect(
      ownerCommentResultSchema.safeParse(
        result('delete_reply', {
          ...ownerItem,
          revision: 2,
          state: 'deleted',
          body: null,
        }),
      ).success,
    ).toBe(true);

    for (const invalid of [
      result('edit_reply', ownerItem),
      result('edit_reply', {
        ...ownerItem,
        revision: 2,
        state: 'deleted',
        body: null,
      }),
      result('delete_reply', {
        ...ownerItem,
        revision: 1,
        state: 'deleted',
        body: null,
      }),
      result('delete_reply', { ...ownerItem, revision: 2 }),
    ])
      expect(ownerCommentResultSchema.safeParse(invalid).success).toBe(false);
  });

  it('exposes only a strict enabled capability', () => {
    expect(ownerCommentsCapabilitiesSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(
      ownerCommentsCapabilitiesSchema.safeParse({
        enabled: true,
        ownerId: id(2),
      }).success,
    ).toBe(false);
  });
});

describe('Owner request UUID canonicalization', () => {
  it('keeps uppercase/lowercase spellings in one idempotency namespace', () => {
    const lower = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const parsed = ownerCommentCommandSchema.parse({
      ...replyCommand,
      requestId: lower.toUpperCase(),
    });
    expect(parsed.requestId).toBe(lower);
  });
});
