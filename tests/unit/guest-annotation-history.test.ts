import { describe, expect, it } from 'vitest';
import {
  guestHistoryActionSchema,
  guestHistoryEventSchema,
} from '../../packages/contracts/src/guest-history';

const guestId = '11111111-1111-4111-8111-111111111111';
const albumId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const annotationId = '55555555-5555-4555-8555-555555555555';
const occurredAt = '2026-10-28T12:30:00.000Z';

const annotationActions = [
  'annotation.created',
  'annotation.updated',
  'annotation.deleted',
  'annotation.resolved',
  'annotation.reopened',
] as const;

type AnnotationAction = (typeof annotationActions)[number];

function makeEvent(action: AnnotationAction) {
  const states = {
    'annotation.created': [
      { annotationId, revision: 0, state: 'absent' },
      { annotationId, revision: 1, state: 'open' },
    ],
    'annotation.updated': [
      { annotationId, revision: 1, state: 'open' },
      { annotationId, revision: 2, state: 'open' },
    ],
    'annotation.deleted': [
      { annotationId, revision: 1, state: 'open' },
      { annotationId, revision: 2, state: 'deleted' },
    ],
    'annotation.resolved': [
      { annotationId, revision: 1, state: 'open' },
      { annotationId, revision: 2, state: 'resolved' },
    ],
    'annotation.reopened': [
      { annotationId, revision: 1, state: 'resolved' },
      { annotationId, revision: 2, state: 'open' },
    ],
  } as const;

  const [before, after] = states[action];
  return {
    eventId: 'guest-annotation:' + annotationId + ':1',
    occurredAt,
    albumId,
    photoId,
    versionId,
    photoStatus: 'available',
    action,
    detail: { before, after },
  };
}

describe('Guest annotation history contracts', () => {
  it('allowlists the five version-bound annotation actions and accepts their valid transitions', () => {
    expect(
      guestHistoryActionSchema.options.filter((action) =>
        action.startsWith('annotation.'),
      ),
    ).toEqual(annotationActions);

    for (const action of annotationActions)
      expect(guestHistoryEventSchema.safeParse(makeEvent(action)).success).toBe(
        true,
      );
  });

  it('keeps public history metadata-only and rejects geometry, links, and peer IDs', () => {
    const event = makeEvent('annotation.created');
    const annotationDetails = [
      {
        ...event.detail,
        after: { ...event.detail.after, geometry: { x: 0, y: 0 } },
      },
      {
        ...event.detail,
        after: { ...event.detail.after, style: { color: 'red' } },
      },
      {
        ...event.detail,
        after: { ...event.detail.after, commentId: guestId },
      },
      {
        ...event.detail,
        before: { ...event.detail.before, peerGuestId: guestId },
      },
    ];

    for (const detail of annotationDetails)
      expect(
        guestHistoryEventSchema.safeParse({ ...event, detail }).success,
      ).toBe(false);

    for (const extra of [
      { geometry: { type: 'point', x: 0, y: 0 } },
      { style: { color: 'amber' } },
      { linkedCommentId: guestId },
      { peerGuestId: guestId },
      { authorGuestId: guestId },
    ])
      expect(
        guestHistoryEventSchema.safeParse({ ...event, ...extra }).success,
      ).toBe(false);
  });

  it('requires the same annotation and adjacent revisions with absent exactly at revision zero', () => {
    const event = makeEvent('annotation.updated');

    for (const overrides of [
      {
        before: { annotationId, revision: 1, state: 'open' },
        after: { annotationId: photoId, revision: 2, state: 'open' },
      },
      {
        before: { annotationId, revision: 1, state: 'open' },
        after: { annotationId, revision: 3, state: 'open' },
      },
      {
        before: { annotationId, revision: 0, state: 'open' },
        after: { annotationId, revision: 1, state: 'open' },
      },
      {
        before: { annotationId, revision: 1, state: 'absent' },
        after: { annotationId, revision: 2, state: 'open' },
      },
      {
        before: { annotationId, revision: 1, state: 'open' },
        after: { annotationId, revision: 0, state: 'absent' },
      },
    ])
      expect(
        guestHistoryEventSchema.safeParse({
          ...event,
          detail: overrides,
        }).success,
      ).toBe(false);
  });

  it('enforces each lifecycle transition and requires photo and version scope', () => {
    const invalidTransitions = [
      [
        'annotation.created',
        { annotationId, revision: 1, state: 'open' },
        { annotationId, revision: 2, state: 'open' },
      ],
      [
        'annotation.updated',
        { annotationId, revision: 1, state: 'resolved' },
        { annotationId, revision: 2, state: 'resolved' },
      ],
      [
        'annotation.deleted',
        { annotationId, revision: 1, state: 'resolved' },
        { annotationId, revision: 2, state: 'resolved' },
      ],
      [
        'annotation.resolved',
        { annotationId, revision: 1, state: 'resolved' },
        { annotationId, revision: 2, state: 'open' },
      ],
      [
        'annotation.reopened',
        { annotationId, revision: 1, state: 'open' },
        { annotationId, revision: 2, state: 'resolved' },
      ],
    ] as const;

    for (const [action, before, after] of invalidTransitions) {
      const event = makeEvent(action);
      expect(
        guestHistoryEventSchema.safeParse({
          ...event,
          detail: { before, after },
        }).success,
      ).toBe(false);
    }

    const event = makeEvent('annotation.created');
    expect(
      guestHistoryEventSchema.safeParse({
        ...event,
        photoId: null,
      }).success,
    ).toBe(false);
    expect(
      guestHistoryEventSchema.safeParse({
        ...event,
        versionId: null,
      }).success,
    ).toBe(false);
  });
});
