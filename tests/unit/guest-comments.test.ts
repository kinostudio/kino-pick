import { describe, expect, it } from 'vitest';
import {
  guestCommentBodySchema,
  guestCommentCommandSchema,
  guestCommentReadQuerySchema,
  guestCommentResultSchema,
  guestCommentItemSchema,
  guestCommentsPageSchema,
} from '../../packages/contracts/src/guest-comments';
import {
  configuration,
  guestCommentsCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const create = {
  requestId: id(1),
  expectedGuestId: id(2),
  operation: 'create' as const,
  targets: [{ photoId: id(3), versionId: id(4) }],
  body: '請調整光線',
};
const item = {
  commentId: id(5),
  photoId: id(3),
  versionId: id(4),
  revision: 1,
  body: '請調整光線',
  state: 'open' as const,
  authorLabel: '客戶',
  isMine: true,
  createdAt: '2026-10-27T10:00:00.000Z',
  updatedAt: '2026-10-27T10:00:00.000Z',
};
describe('Guest comment input safety', () => {
  it('normalizes NFC/newlines and preserves multiline plain text', () => {
    expect(guestCommentBodySchema.parse('  e\u0301\r\n第二行\r第三行  ')).toBe(
      'é\n第二行\n第三行',
    );
    expect(guestCommentBodySchema.parse('<script>alert(1)</script>')).toBe(
      '<script>alert(1)</script>',
    );
    expect(guestCommentBodySchema.parse('😀'.repeat(2000))).toHaveLength(4000);
  });
  it.each([
    '',
    ' \n ',
    'x\u0000',
    'x\u202e',
    'x\u200b',
    'x\u007f',
    'x'.repeat(2001),
  ])('rejects empty, oversized or hidden controls %#', (body) => {
    expect(guestCommentBodySchema.safeParse(body).success).toBe(false);
  });
  it('bounds batches to24 different photos and refuses duplicate logical targets', () => {
    expect(
      guestCommentCommandSchema.safeParse({
        ...create,
        targets: Array.from({ length: 24 }, (_, n) => ({
          photoId: id(n + 10),
          versionId: id(n + 100),
        })),
      }).success,
    ).toBe(true);
    for (const targets of [
      [],
      [...create.targets, ...create.targets],
      [
        { photoId: id(3), versionId: id(4) },
        { photoId: id(3), versionId: id(6) },
      ],
      Array.from({ length: 25 }, (_, n) => ({
        photoId: id(n + 10),
        versionId: id(n + 100),
      })),
    ]) {
      expect(
        guestCommentCommandSchema.safeParse({ ...create, targets }).success,
      ).toBe(false);
    }
  });
  it('does not accept client tenant/author/session fields or unrelated lifecycle payloads', () => {
    for (const extra of [
      { inviteId: id(7) },
      { authorId: id(7) },
      { sessionId: id(7) },
      { workspaceId: id(7) },
      { commentId: id(7) },
    ])
      expect(
        guestCommentCommandSchema.safeParse({ ...create, ...extra }).success,
      ).toBe(false);
    for (const operation of ['delete', 'resolve', 'reopen'])
      expect(
        guestCommentCommandSchema.safeParse({
          requestId: id(1),
          expectedGuestId: id(2),
          operation,
          commentId: id(5),
          expectedRevision: 1,
          body: 'extra',
        }).success,
      ).toBe(false);
    expect(
      guestCommentCommandSchema.safeParse({
        requestId: id(1),
        expectedGuestId: id(2),
        operation: 'edit',
        commentId: id(5),
        expectedRevision: 0,
        body: 'text',
      }).success,
    ).toBe(false);
  });
});
describe('Guest comment output privacy', () => {
  it('requires deleted tombstones to omit body and active comments to retain body', () => {
    expect(
      guestCommentItemSchema.safeParse({
        ...item,
        state: 'deleted',
        body: null,
      }).success,
    ).toBe(true);
    expect(
      guestCommentItemSchema.safeParse({ ...item, state: 'deleted' }).success,
    ).toBe(false);
    expect(
      guestCommentItemSchema.safeParse({ ...item, body: null }).success,
    ).toBe(false);
  });
  it('rejects other-photo data, duplicate items and peer identity fields', () => {
    const page = {
      guestId: id(2),
      photoId: id(3),
      versionId: id(4),
      items: [item],
      nextCursor: null,
    };
    expect(guestCommentsPageSchema.safeParse(page).success).toBe(true);
    for (const patch of [
      { photoId: id(9) },
      { items: [item, item] },
      { items: [{ ...item, authorGuestId: id(8) }] },
      { items: [{ ...item, inviteId: id(8) }] },
    ])
      expect(
        guestCommentsPageSchema.safeParse({ ...page, ...patch }).success,
      ).toBe(false);
  });
});
const env = (appEnv: 'local' | 'staging' | 'production') =>
  ({
    APP_ENV: appEnv,
    APP_URL:
      appEnv === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  }) as WorkerEnv;
describe('Guest comment feature boundaries', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).GUEST_COMMENTS_ENABLED).toBe('false');
      expect(guestCommentsCapability(env(mode))).toBe(false);
    },
  );
  it.each(Array.from({ length: 8 }, (_, n) => n))(
    'requires only the three supporting flags %i',
    (mask) => {
      expect(
        guestCommentsCapability({
          ...env('local'),
          GUEST_EXCHANGE_ENABLED: mask & 1 ? 'true' : 'false',
          PHOTO_VERSIONS_ENABLED: mask & 2 ? 'true' : 'false',
          GUEST_COMMENTS_ENABLED: mask & 4 ? 'true' : 'false',
          GUEST_SELECTION_ENABLED: 'false',
          GUEST_VERSION_COMPARISON_ENABLED: 'false',
        } as WorkerEnv),
      ).toBe(mask === 7);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (mode) => {
      expect(() =>
        configuration({ ...env(mode), GUEST_COMMENTS_ENABLED: 'true' }),
      ).toThrow('GUEST_COMMENTS_LOCAL_ONLY');
    },
  );
});

describe('Authoritative current comment query', () => {
  it('accepts one targeted current read and refuses ambiguous or foreign parameters', () => {
    expect(guestCommentReadQuerySchema.parse({ commentId: id(5) })).toEqual({
      commentId: id(5),
    });
    for (const query of [
      { commentId: 'invalid' },
      { cursor: 'x', commentId: id(5) },
      { inviteId: id(6) },
      { cursor: '' },
    ])
      expect(guestCommentReadQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('Shared thread actor provenance', () => {
  it('reads old immutable Guest receipts without rewriting stored JSON', () => {
    const parsed = guestCommentItemSchema.parse(item);
    expect(parsed.authorType).toBe('guest');
    expect(parsed.parentCommentId).toBeNull();
  });
  it('accepts readonly Owner replies and rejects conflicting actor claims', () => {
    const reply = {
      ...item,
      commentId: id(21),
      authorType: 'owner',
      parentCommentId: item.commentId,
      isMine: false,
      authorLabel: '攝影師',
    };
    expect(guestCommentItemSchema.safeParse(reply).success).toBe(true);
    for (const patch of [
      { isMine: true },
      { parentCommentId: null },
      { parentCommentId: id(21) },
      { state: 'resolved' },
      { authorType: 'guest' },
    ])
      expect(
        guestCommentItemSchema.safeParse({ ...reply, ...patch }).success,
      ).toBe(false);
    expect(
      guestCommentItemSchema.safeParse({
        ...reply,
        state: 'deleted',
        body: null,
      }).success,
    ).toBe(true);
  });
});

describe('Guest receipt actor boundary', () => {
  it('never accepts a peer or Owner reply as the result of a Guest mutation', () => {
    const result = {
      guestId: id(2),
      requestId: id(1),
      operation: 'create',
      items: [item],
      occurredAt: item.createdAt,
    };
    expect(guestCommentResultSchema.safeParse(result).success).toBe(true);
    expect(
      guestCommentResultSchema.safeParse({
        ...result,
        items: [{ ...item, isMine: false }],
      }).success,
    ).toBe(false);
    expect(
      guestCommentResultSchema.safeParse({
        ...result,
        items: [
          {
            ...item,
            commentId: id(21),
            authorType: 'owner',
            parentCommentId: item.commentId,
            isMine: false,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
