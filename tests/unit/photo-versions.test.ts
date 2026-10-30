import { describe, expect, it } from 'vitest';
import {
  type PhotoVersionItem,
  ownerPhotoVersionsPageSchema,
  photoVersionHeadSchema,
  photoVersionItemSchema,
  photoVersionsCapabilitiesSchema,
  setCurrentPhotoVersionResultSchema,
  setCurrentPhotoVersionSchema,
} from '../../packages/contracts/src/photo-versions';

const makeId = (sequence: number) =>
  '00000000-0000-4000-8000-' + String(sequence).padStart(12, '0');
const photoId = makeId(1);
const firstVersionId = makeId(2);
const secondVersionId = makeId(3);
const requestId = makeId(4);
const occurredAt = '2026-10-26T12:30:00.000Z';

function makeItem(id = firstVersionId, versionNo = 1): PhotoVersionItem {
  return {
    id,
    versionNo,
    createdAt: occurredAt,
    width: 2400,
    height: 1600,
    processing: 'succeeded' as const,
    thumbnailUrl: `/api/v1/photos/${photoId}/versions/${id}/assets/thumbnail`,
    previewUrl: `/api/v1/photos/${photoId}/versions/${id}/assets/preview`,
  };
}

describe('Owner photo version read contracts', () => {
  it('keeps capability, current head, and version metadata strict and bounded', () => {
    expect(photoVersionsCapabilitiesSchema.parse({ enabled: true })).toEqual({
      enabled: true,
    });
    expect(
      photoVersionsCapabilitiesSchema.safeParse({ enabled: true, photoId })
        .success,
    ).toBe(false);

    expect(
      photoVersionHeadSchema.parse({
        versionId: firstVersionId,
        revision: Number.MAX_SAFE_INTEGER,
      }).revision,
    ).toBe(Number.MAX_SAFE_INTEGER);
    for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        photoVersionHeadSchema.safeParse({
          versionId: firstVersionId,
          revision,
        }).success,
      ).toBe(false);
    }

    expect(photoVersionItemSchema.parse(makeItem()).versionNo).toBe(1);
    expect(
      photoVersionItemSchema.safeParse({
        ...makeItem(),
        versionNo: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      photoVersionItemSchema.safeParse({
        ...makeItem(),
        filename: 'private.jpg',
      }).success,
    ).toBe(false);
    expect(
      photoVersionItemSchema.safeParse({
        ...makeItem(),
        width: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts a bounded page with nullable processing metadata and cursor', () => {
    const versions = Array.from({ length: 24 }, (_, index) =>
      makeItem(makeId(index + 100), index + 1),
    );
    versions[0] = {
      ...makeItem(makeId(100), 1),
      width: null,
      height: null,
      thumbnailUrl: null,
      previewUrl: null,
    };
    const page = {
      photoId,
      current: { versionId: firstVersionId, revision: 0 },
      currentVersion: { ...makeItem(firstVersionId, 1), previewUrl: null },
      versions,
      nextCursor: 'c'.repeat(2048),
    };

    const parsedPage = ownerPhotoVersionsPageSchema.parse(page);
    expect(parsedPage.versions).toHaveLength(24);
    expect(parsedPage.currentVersion.previewUrl).toBeNull();
    expect(
      ownerPhotoVersionsPageSchema.safeParse({
        ...page,
        versions: [...versions, makeItem(makeId(124), 25)],
      }).success,
    ).toBe(false);
    expect(
      ownerPhotoVersionsPageSchema.safeParse({
        ...page,
        nextCursor: 'c'.repeat(2049),
      }).success,
    ).toBe(false);
    expect(
      ownerPhotoVersionsPageSchema.safeParse({ ...page, workspaceId: photoId })
        .success,
    ).toBe(false);
  });

  it('requires exact Owner asset routes with matching kind, photo, and version', () => {
    const goodItem = makeItem();
    expect(
      ownerPhotoVersionsPageSchema.safeParse({
        photoId,
        current: { versionId: firstVersionId, revision: 1 },
        currentVersion: goodItem,
        versions: [goodItem],
        nextCursor: null,
      }).success,
    ).toBe(true);

    for (const overrides of [
      {
        thumbnailUrl: `/api/guest/photos/${photoId}/versions/${firstVersionId}/assets/thumbnail`,
      },
      {
        thumbnailUrl: `/api/v1/photos/${photoId}/versions/${firstVersionId}/assets/preview`,
      },
      {
        previewUrl: `/api/v1/photos/${photoId}/versions/${firstVersionId}/assets/thumbnail`,
      },
      {
        thumbnailUrl: `/api/v1/photos/${photoId}/versions/${firstVersionId}/assets/thumbnail?download=1`,
      },
      { thumbnailUrl: 'https://example.test/private.jpg' },
    ]) {
      expect(
        photoVersionItemSchema.safeParse({ ...goodItem, ...overrides }).success,
      ).toBe(false);
    }

    const page = {
      photoId,
      current: { versionId: firstVersionId, revision: 1 },
      currentVersion: goodItem,
      versions: [goodItem],
      nextCursor: null,
    };
    expect(
      ownerPhotoVersionsPageSchema.safeParse({
        ...page,
        versions: [
          {
            ...goodItem,
            thumbnailUrl: `/api/v1/photos/${makeId(9)}/versions/${firstVersionId}/assets/thumbnail`,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ownerPhotoVersionsPageSchema.safeParse({
        ...page,
        versions: [
          {
            ...goodItem,
            previewUrl: `/api/v1/photos/${photoId}/versions/${secondVersionId}/assets/preview`,
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      ownerPhotoVersionsPageSchema.safeParse({
        ...page,
        currentVersion: makeItem(secondVersionId, 2),
      }).success,
    ).toBe(false);
    expect(
      ownerPhotoVersionsPageSchema.safeParse({
        ...page,
        currentVersion: {
          ...goodItem,
          previewUrl:
            '/api/v1/photos/' +
            makeId(9) +
            '/versions/' +
            firstVersionId +
            '/assets/preview',
        },
      }).success,
    ).toBe(false);
  });
});

describe('Set current photo version contracts', () => {
  const request = {
    requestId,
    expectedRevision: 0,
    expectedCurrentVersionId: firstVersionId,
    versionId: secondVersionId,
    confirm: true,
  };

  it('requires a strict UUID-bound CAS request and explicit confirmation', () => {
    expect(setCurrentPhotoVersionSchema.parse(request)).toEqual(request);
    for (const candidate of [
      { ...request, confirm: false },
      { ...request, extra: 'ignored?' },
      { ...request, requestId: 'not-a-uuid' },
      { ...request, versionId: 'not-a-uuid' },
      { ...request, expectedRevision: -1 },
      { ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(setCurrentPhotoVersionSchema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });

  it('ties event IDs to actual changes and rejects private or malformed results', () => {
    const changed = {
      photoId,
      current: { versionId: secondVersionId, revision: 1 },
      changed: true,
      eventId: 'photo-version:event-1',
      occurredAt,
    };
    expect(setCurrentPhotoVersionResultSchema.parse(changed)).toEqual(changed);
    expect(
      setCurrentPhotoVersionResultSchema.safeParse({
        ...changed,
        eventId: null,
      }).success,
    ).toBe(false);
    expect(
      setCurrentPhotoVersionResultSchema.safeParse({
        ...changed,
        changed: false,
      }).success,
    ).toBe(false);
    expect(
      setCurrentPhotoVersionResultSchema.safeParse({
        ...changed,
        changed: false,
        eventId: null,
      }).success,
    ).toBe(true);

    for (const overrides of [
      { eventId: '' },
      { eventId: 'e'.repeat(129) },
      { occurredAt: 'not-a-time' },
      { sessionId: requestId },
      { eventId: 'e'.repeat(129), changed: false },
    ]) {
      expect(
        setCurrentPhotoVersionResultSchema.safeParse({
          ...changed,
          ...overrides,
        }).success,
      ).toBe(false);
    }
  });
});
