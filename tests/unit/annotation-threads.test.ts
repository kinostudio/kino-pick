import { describe, expect, it } from 'vitest';
import {
  guestSharedAnnotationItemSchema,
  guestSharedAnnotationsPageSchema,
} from '../../packages/contracts/src/annotation-threads';

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
const guestItem = {
  annotationId: id(1),
  photoId: id(2),
  versionId: id(3),
  revision: 1,
  geometry,
  style,
  commentId: null,
  state: 'open' as const,
  authorLabel: '來賓 A',
  isMine: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('shared annotation thread contracts', () => {
  it('defaults legacy Guest items to Guest authorship without changing ownership', () => {
    const own = guestSharedAnnotationItemSchema.safeParse(guestItem);
    expect(own.success).toBe(true);
    if (own.success)
      expect(own.data).toMatchObject({ authorType: 'guest', isMine: true });

    const peer = guestSharedAnnotationItemSchema.safeParse({
      ...guestItem,
      isMine: false,
    });
    expect(peer.success).toBe(true);
    if (peer.success)
      expect(peer.data).toMatchObject({ authorType: 'guest', isMine: false });
  });

  it('accepts an Owner-authored shared annotation only as read-only to Guests', () => {
    const ownerItem = {
      ...guestItem,
      isMine: false,
      authorType: 'owner',
    };
    expect(guestSharedAnnotationItemSchema.safeParse(ownerItem).success).toBe(
      true,
    );
    expect(
      guestSharedAnnotationItemSchema.safeParse({
        ...ownerItem,
        isMine: true,
      }).success,
    ).toBe(false);
    expect(
      guestSharedAnnotationItemSchema.safeParse({
        ...guestItem,
        authorType: 'owner',
      }).success,
    ).toBe(false);
  });

  it('does not admit peer Guest or user identity fields', () => {
    for (const injected of [
      { authorGuestId: id(9) },
      { guestId: id(9) },
      { ownerId: id(9) },
      { userId: id(9) },
    ])
      expect(
        guestSharedAnnotationItemSchema.safeParse({
          ...guestItem,
          ...injected,
        }).success,
      ).toBe(false);
  });

  it('preserves Guest tombstone redaction rules', () => {
    const tombstone = {
      ...guestItem,
      revision: 2,
      geometry: null,
      style: null,
      commentId: null,
      state: 'deleted' as const,
    };
    expect(guestSharedAnnotationItemSchema.safeParse(tombstone).success).toBe(
      true,
    );
    expect(
      guestSharedAnnotationItemSchema.safeParse({ ...tombstone, geometry })
        .success,
    ).toBe(false);
    expect(
      guestSharedAnnotationItemSchema.safeParse({ ...tombstone, style })
        .success,
    ).toBe(false);
  });

  it('keeps shared pages scoped, unique, and bounded', () => {
    const ownerItem = {
      ...guestItem,
      annotationId: id(4),
      isMine: false,
      authorType: 'owner',
    };
    const page = {
      guestId: id(8),
      photoId: id(2),
      versionId: id(3),
      items: [guestItem, ownerItem],
      nextCursor: null,
    };
    const parsed = guestSharedAnnotationsPageSchema.safeParse(page);
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.items.map((item) => item.authorType)).toEqual([
        'guest',
        'owner',
      ]);

    expect(
      guestSharedAnnotationsPageSchema.safeParse({
        ...page,
        items: [{ ...ownerItem, photoId: id(9) }],
      }).success,
    ).toBe(false);
    expect(
      guestSharedAnnotationsPageSchema.safeParse({
        ...page,
        items: [{ ...ownerItem, versionId: id(9) }],
      }).success,
    ).toBe(false);
    expect(
      guestSharedAnnotationsPageSchema.safeParse({
        ...page,
        items: [
          guestItem,
          { ...ownerItem, annotationId: guestItem.annotationId },
        ],
      }).success,
    ).toBe(false);
    expect(
      guestSharedAnnotationsPageSchema.safeParse({
        ...page,
        items: Array.from({ length: 25 }, (_, index) => ({
          ...guestItem,
          annotationId: id(index + 20),
        })),
      }).success,
    ).toBe(false);
    expect(
      guestSharedAnnotationsPageSchema.safeParse({
        ...page,
        peerGuestId: id(9),
      }).success,
    ).toBe(false);
  });
});
