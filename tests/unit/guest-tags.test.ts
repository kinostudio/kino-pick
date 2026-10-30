import { describe, expect, it } from 'vitest';
import {
  guestTagCapabilitiesSchema,
  guestTagItemSchema,
  guestTagLabelSchema,
  guestTagPageSchema,
  guestTagPhotoIdsSchema,
  guestTagRequestSchema,
  guestTagResultSchema,
  guestTagStateSchema,
} from '../../packages/contracts/src/guest-tags';

const makeId = (sequence: number) =>
  '00000000-0000-4000-8000-' + String(sequence).padStart(12, '0');
const guestId = makeId(1);
const photoId = makeId(2);
const versionId = makeId(3);
const requestId = makeId(4);

describe('Guest tag label contract', () => {
  it('normalizes to NFC, trims whitespace and preserves case', () => {
    expect(guestTagLabelSchema.parse('  Cafe\u0301  ')).toBe('Caf\u00e9');
    expect(guestTagLabelSchema.parse('Editorial')).toBe('Editorial');
    expect(guestTagLabelSchema.parse('editorial')).toBe('editorial');
    expect(guestTagLabelSchema.parse('Editorial')).not.toBe(
      guestTagLabelSchema.parse('editorial'),
    );
  });

  it('limits labels by Unicode code points rather than UTF-16 code units', () => {
    const fortyCodePoints = '\u{1f600}'.repeat(40);
    const fortyOneCodePoints = '\u{1f600}'.repeat(41);

    expect([...fortyCodePoints]).toHaveLength(40);
    expect(fortyCodePoints.length).toBe(80);
    expect(guestTagLabelSchema.safeParse(fortyCodePoints).success).toBe(true);
    expect(guestTagLabelSchema.safeParse(fortyOneCodePoints).success).toBe(
      false,
    );
    expect(guestTagLabelSchema.safeParse('e\u0301'.repeat(41)).success).toBe(
      false,
    );
  });

  it('rejects empty labels and Unicode Cc or Cf controls', () => {
    for (const label of ['', ' \t\n ', 'bad\u0000label', 'bad\u200blabel']) {
      expect(guestTagLabelSchema.safeParse(label).success).toBe(false);
    }
  });
});

describe('Guest tag request and read boundaries', () => {
  const request = {
    requestId,
    expectedGuestId: guestId,
    versionId,
    label: '  Portrait  ',
    present: true,
  };

  it('requires the exact version-bound request body and valid UUIDs', () => {
    expect(guestTagRequestSchema.parse(request)).toMatchObject({
      ...request,
      label: 'Portrait',
    });
    expect(
      guestTagRequestSchema.safeParse({ ...request, guestId }).success,
    ).toBe(false);
    expect(
      guestTagRequestSchema.safeParse({
        requestId,
        versionId,
        label: 'Portrait',
        present: true,
      }).success,
    ).toBe(false);
    expect(
      guestTagRequestSchema.safeParse({ ...request, present: 'true' }).success,
    ).toBe(false);

    for (const field of [
      'requestId',
      'expectedGuestId',
      'versionId',
    ] as const) {
      expect(
        guestTagRequestSchema.safeParse({
          ...request,
          [field]: 'not-a-uuid',
        }).success,
      ).toBe(false);
    }
  });

  it('bounds tag state and result collections', () => {
    const tagItems = Array.from({ length: 20 }, (_, index) => ({
      tagId: makeId(index + 10),
      label: 'Tag ' + index,
      versionId,
      updatedAt: '2026-10-26T01:02:03.000Z',
    }));
    expect(guestTagItemSchema.safeParse(tagItems[0]).success).toBe(true);
    expect(
      guestTagItemSchema.safeParse({ ...tagItems[0], extra: true }).success,
    ).toBe(false);
    expect(
      guestTagStateSchema.safeParse({ photoId, tags: tagItems }).success,
    ).toBe(true);
    expect(
      guestTagStateSchema.safeParse({
        photoId,
        tags: [...tagItems, { ...tagItems[0], tagId: makeId(30) }],
      }).success,
    ).toBe(false);

    const pageItems = Array.from({ length: 24 }, (_, index) => ({
      photoId: makeId(index + 100),
      tags: [],
    }));
    expect(
      guestTagPageSchema.safeParse({ guestId, items: pageItems }).success,
    ).toBe(true);
    expect(
      guestTagPageSchema.safeParse({
        guestId,
        items: [...pageItems, { photoId: makeId(124), tags: [] }],
      }).success,
    ).toBe(false);

    expect(guestTagCapabilitiesSchema.parse({ enabled: true })).toEqual({
      enabled: true,
    });
    expect(
      guestTagCapabilitiesSchema.safeParse({
        enabled: true,
        guestId,
      }).success,
    ).toBe(false);

    const result = {
      guestId,
      photoId,
      tagId: null,
      label: '  Portrait  ',
      present: false,
      versionId,
      changed: false,
      eventId: null,
      occurredAt: '2026-10-26T01:02:03.000Z',
    };
    expect(guestTagResultSchema.parse(result).label).toBe('Portrait');
    expect(
      guestTagResultSchema.safeParse({
        ...result,
        eventId: 'e'.repeat(129),
      }).success,
    ).toBe(false);
  });
});

describe('Guest tag photo ID bounds', () => {
  it('accepts 1 to 24 unique UUIDs and rejects empty, duplicate or malformed batches', () => {
    const photoIds = Array.from({ length: 24 }, (_, index) =>
      makeId(index + 200),
    );

    expect(guestTagPhotoIdsSchema.parse([photoId])).toEqual([photoId]);
    expect(guestTagPhotoIdsSchema.parse(photoIds)).toEqual(photoIds);
    for (const ids of [
      [],
      [photoId, photoId],
      ['invalid'],
      [...photoIds, makeId(224)],
    ]) {
      expect(guestTagPhotoIdsSchema.safeParse(ids).success).toBe(false);
    }
  });
});
