import { describe, expect, it } from 'vitest';
import {
  guestHistoryActionSchema,
  guestHistoryCapabilitiesSchema,
  guestHistoryEventSchema,
  guestHistoryPageSchema,
  guestHistoryQuerySchema,
} from '../../packages/contracts/src/guest-history';

const guestId = '11111111-1111-4111-8111-111111111111';
const albumId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const approvalRequestId = '55555555-5555-4555-8555-555555555555';
const occurredAt = '2026-10-26T12:30:00.000Z';

const actions = [
  'selection.added',
  'selection.removed',
  'selection.version_changed',
  'selection.submitted',
  'rating.set',
  'rating.cleared',
  'favorite.added',
  'favorite.removed',
  'tag.added',
  'tag.removed',
  'shared_selection.added',
  'shared_selection.removed',
  'shared_selection.version_changed',
  'shared_selection.submitted',
  'comment.create',
  'comment.edit',
  'comment.delete',
  'comment.resolve',
  'comment.reopen',
  'annotation.created',
  'annotation.updated',
  'annotation.deleted',
  'annotation.resolved',
  'annotation.reopened',
  'download.requested',
  'download.generated',
  'delivery.download_requested',
  'delivery.download_generated',
  'version_approval.confirmed',
] as const;

function makeEvent(action: (typeof actions)[number]) {
  const detail =
    action === 'version_approval.confirmed'
      ? { approvalRequestId, photoId, versionId }
      : action.startsWith('download.') || action.startsWith('delivery.')
        ? {
            assetKind: 'preview',
            assetId: photoId,
            filename: 'portrait.preview.jpg',
            byteSize: 1234,
            mime: 'image/jpeg',
          }
        : action.startsWith('comment.')
          ? {
              before: {
                commentId: guestId,
                revision: action === 'comment.create' ? 0 : 1,
                state:
                  action === 'comment.create'
                    ? 'absent'
                    : action === 'comment.reopen'
                      ? 'resolved'
                      : 'open',
              },
              after: {
                commentId: guestId,
                revision: action === 'comment.create' ? 1 : 2,
                state:
                  action === 'comment.delete'
                    ? 'deleted'
                    : action === 'comment.resolve'
                      ? 'resolved'
                      : 'open',
              },
            }
          : action.startsWith('annotation.')
            ? {
                before: {
                  annotationId: guestId,
                  revision: action === 'annotation.created' ? 0 : 1,
                  state:
                    action === 'annotation.created'
                      ? 'absent'
                      : action === 'annotation.deleted' ||
                          action === 'annotation.resolved'
                        ? 'open'
                        : action === 'annotation.reopened'
                          ? 'resolved'
                          : 'open',
                },
                after: {
                  annotationId: guestId,
                  revision: action === 'annotation.created' ? 1 : 2,
                  state:
                    action === 'annotation.created' ||
                    action === 'annotation.updated' ||
                    action === 'annotation.reopened'
                      ? 'open'
                      : action === 'annotation.deleted'
                        ? 'deleted'
                        : 'resolved',
                },
              }
            : action.endsWith('.submitted')
              ? {
                  before: { roundNo: 1, status: 'open' },
                  after: { roundNo: 1, status: 'submitted', selectedCount: 2 },
                }
              : action.startsWith('selection.') ||
                  action.startsWith('shared_selection.')
                ? {
                    before: { selected: false, versionId: null },
                    after: { selected: true, versionId },
                  }
                : action.startsWith('rating.')
                  ? { before: { stars: null }, after: { stars: 4 } }
                  : action.startsWith('favorite.')
                    ? { before: { favored: false }, after: { favored: true } }
                    : {
                        before: { label: 'Family', present: false },
                        after: { label: 'Family', present: true },
                      };

  const isSubmission = action.endsWith('.submitted');

  return {
    eventId: 'guest-history:event-1',
    occurredAt,
    albumId,
    photoId: isSubmission ? null : photoId,
    versionId: isSubmission ? null : versionId,
    photoStatus: isSubmission ? null : 'available',
    action,
    detail,
  };
}

describe('Guest history contracts', () => {
  it('accepts only the strict, bounded query and requires an album for photo filtering', () => {
    expect(guestHistoryQuerySchema.parse({})).toEqual({});
    expect(guestHistoryQuerySchema.parse({ albumId })).toEqual({ albumId });
    expect(
      guestHistoryQuerySchema.parse({
        albumId,
        photoId,
        cursor: 'x'.repeat(2048),
      }).photoId,
    ).toBe(photoId);

    for (const query of [
      { photoId },
      { cursor: 'x'.repeat(2049) },
      { albumId, guestId },
      { albumId: 'bad-id' },
    ])
      expect(guestHistoryQuerySchema.safeParse(query).success).toBe(false);
  });

  it('keeps capability and page shapes strict and bounded', () => {
    expect(guestHistoryCapabilitiesSchema.parse({ enabled: true })).toEqual({
      enabled: true,
    });
    expect(
      guestHistoryCapabilitiesSchema.safeParse({
        enabled: false,
        actorId: guestId,
      }).success,
    ).toBe(false);

    const event = makeEvent('selection.added');
    expect(
      guestHistoryPageSchema.parse({
        guestId,
        items: [event],
        nextCursor: 'x'.repeat(2048),
      }).items,
    ).toHaveLength(1);

    expect(
      guestHistoryPageSchema.safeParse({
        guestId,
        items: Array.from({ length: 25 }, () => event),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      guestHistoryPageSchema.safeParse({
        guestId,
        items: [],
        nextCursor: 'x'.repeat(2049),
      }).success,
    ).toBe(false);
    expect(
      guestHistoryPageSchema.safeParse({
        guestId,
        items: [],
        nextCursor: null,
        projectId: albumId,
      }).success,
    ).toBe(false);
  });

  it('accepts every current action variant with its projected detail state', () => {
    expect(guestHistoryActionSchema.options).toEqual(actions);

    for (const action of actions)
      expect(guestHistoryEventSchema.safeParse(makeEvent(action)).success).toBe(
        true,
      );
  });

  it('binds approval confirmations to the exact photo and version without private fields', () => {
    const event = makeEvent('version_approval.confirmed');
    expect(guestHistoryEventSchema.safeParse(event).success).toBe(true);

    for (const override of [
      { photoId: albumId },
      { versionId: albumId },
      { detail: { ...event.detail, photoId: albumId } },
      { detail: { ...event.detail, versionId: albumId } },
      { detail: { ...event.detail, inviteId: guestId } },
      { detail: { ...event.detail, guestId } },
      { detail: { ...event.detail, requestId: 'raw-request-id' } },
      { detail: { ...event.detail, sessionId: guestId } },
    ])
      expect(
        guestHistoryEventSchema.safeParse({ ...event, ...override }).success,
      ).toBe(false);
  });

  it('bounds event IDs and validates ISO timestamps and UUID scopes', () => {
    const event = makeEvent('selection.added');
    expect(
      guestHistoryEventSchema.safeParse({
        ...event,
        eventId: 'e'.repeat(128),
      }).success,
    ).toBe(true);
    for (const overrides of [
      { eventId: '' },
      { eventId: 'e'.repeat(129) },
      { occurredAt: 'not-a-date' },
      { albumId: 'not-a-uuid' },
      { photoStatus: 'deleted' },
    ])
      expect(
        guestHistoryEventSchema.safeParse({ ...event, ...overrides }).success,
      ).toBe(false);
  });

  it('accepts 40 Unicode code points for tag labels and rejects 41', () => {
    const event = makeEvent('tag.added');
    const label40 = '😀'.repeat(40);
    const label41 = '😀'.repeat(41);
    const detail = {
      before: { label: label40, present: false },
      after: { label: label40, present: true },
    };
    expect(
      guestHistoryEventSchema.safeParse({ ...event, detail }).success,
    ).toBe(true);
    expect(
      guestHistoryEventSchema.safeParse({
        ...event,
        detail: {
          before: { label: label41, present: false },
          after: { label: label41, present: true },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts download audit fields but rejects private storage and credential data', () => {
    const event = makeEvent('download.generated');
    expect(guestHistoryEventSchema.safeParse(event).success).toBe(true);
    for (const extra of [
      { objectKey: 'private/originals/photo.jpg' },
      { signedUrl: 'https://private.example/signed' },
      { sha256: 'a'.repeat(64) },
      { guestSessionId: guestId },
      { requestId: guestId },
    ])
      expect(
        guestHistoryEventSchema.safeParse({
          ...event,
          detail: { ...event.detail, ...extra },
        }).success,
      ).toBe(false);
  });

  it('rejects malformed action-specific state and private or raw payload fields', () => {
    const selection = makeEvent('selection.added');
    expect(
      guestHistoryEventSchema.safeParse({
        ...selection,
        detail: {
          before: { selected: false, versionId: 'bad' },
          after: { selected: true, versionId },
        },
      }).success,
    ).toBe(false);

    const rating = makeEvent('rating.set');
    expect(
      guestHistoryEventSchema.safeParse({
        ...rating,
        detail: {
          before: { stars: null },
          after: { stars: 6 },
        },
      }).success,
    ).toBe(false);

    for (const extra of [
      { sessionId: guestId },
      { requestId: guestId },
      { filename: 'private.jpg' },
      { url: 'https://example.test/photo.jpg' },
      { beforeJson: '{}' },
    ])
      expect(
        guestHistoryEventSchema.safeParse({
          ...selection,
          ...extra,
        }).success,
      ).toBe(false);

    expect(
      guestHistoryEventSchema.safeParse({
        ...makeEvent('shared_selection.added'),
        detail: {
          before: { selected: false, versionId: null, reviewId: guestId },
          after: { selected: true, versionId },
        },
      }).success,
    ).toBe(false);
    expect(
      guestHistoryEventSchema.safeParse({
        ...makeEvent('tag.added'),
        detail: {
          before: { label: 'Family', present: false, tagId: guestId },
          after: { label: 'Family', present: true },
        },
      }).success,
    ).toBe(false);
  });
});

describe('Comment activity privacy and adjacent revisions', () => {
  it('rejects body or peer identity fields in public comment history', () => {
    const event = makeEvent('comment.create');
    expect(
      guestHistoryEventSchema.safeParse({
        ...event,
        detail: {
          ...event.detail,
          after: { ...event.detail.after, body: 'previous deleted text' },
        },
      }).success,
    ).toBe(false);
    expect(
      guestHistoryEventSchema.safeParse({ ...event, authorGuestId: guestId })
        .success,
    ).toBe(false);
  });
  it('rejects absent/deleted transitions, revision jumps and cross-comment chains', () => {
    const event = makeEvent('comment.resolve');
    for (const after of [
      { ...event.detail.after, state: 'deleted' },
      { ...event.detail.after, revision: 10 },
      { ...event.detail.after, commentId: photoId },
    ])
      expect(
        guestHistoryEventSchema.safeParse({
          ...event,
          detail: { ...event.detail, after },
        }).success,
      ).toBe(false);
  });
});
