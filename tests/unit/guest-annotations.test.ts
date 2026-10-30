import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_COORDINATE_SCALE,
  annotationGeometrySchema,
} from '../../packages/contracts/src/annotation-geometry.ts';
import type { GuestAnnotationItem } from '../../packages/contracts/src/guest-annotations.ts';
import {
  guestAnnotationCommandSchema,
  guestAnnotationItemSchema,
  guestAnnotationReadQuerySchema,
  guestAnnotationResultSchema,
  guestAnnotationsCapabilitiesSchema,
  guestAnnotationsPageSchema,
} from '../../packages/contracts/src/guest-annotations.ts';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const timestamp = '2026-10-28T10:00:00.000Z';

const point = {
  type: 'point' as const,
  coordinateSpace: 'normalized_1e6' as const,
  x: 0,
  y: ANNOTATION_COORDINATE_SCALE,
};
const rectangle = {
  type: 'rectangle' as const,
  coordinateSpace: 'normalized_1e6' as const,
  x: ANNOTATION_COORDINATE_SCALE - 1,
  y: 0,
  width: 1,
  height: ANNOTATION_COORDINATE_SCALE,
};
const style = { color: 'amber' as const };
const item: GuestAnnotationItem = {
  annotationId: id(10),
  photoId: id(3),
  versionId: id(4),
  revision: 1,
  geometry: point,
  style,
  commentId: id(5),
  state: 'open' as const,
  authorLabel: '客戶',
  isMine: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const createCommand = {
  requestId: id(1),
  expectedGuestId: id(2),
  operation: 'create' as const,
  photoId: id(3),
  versionId: id(4),
  geometry: point,
  style,
  commentId: id(5),
};

const result = (
  operation: 'create' | 'update' | 'delete' | 'resolve' | 'reopen',
  resultItem: GuestAnnotationItem = item,
) => ({ requestId: id(1), operation, item: resultItem, occurredAt: timestamp });

describe('normalized annotation geometry', () => {
  it('accepts points and rectangles on normalized image boundaries', () => {
    expect(annotationGeometrySchema.safeParse(point).success).toBe(true);
    expect(annotationGeometrySchema.safeParse(rectangle).success).toBe(true);
    expect(
      annotationGeometrySchema.safeParse({
        ...point,
        x: ANNOTATION_COORDINATE_SCALE,
        y: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects non-finite, fractional, unsafe and out-of-range coordinates', () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, 0.5, -1, 1_000_001])
      expect(annotationGeometrySchema.safeParse({ ...point, x }).success).toBe(
        false,
      );
    for (const y of [Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])
      expect(annotationGeometrySchema.safeParse({ ...point, y }).success).toBe(
        false,
      );
  });

  it('rejects invalid rectangle extents and boundary overflow', () => {
    for (const width of [0, -1, 0.5, 1_000_001, Number.POSITIVE_INFINITY])
      expect(
        annotationGeometrySchema.safeParse({ ...rectangle, width }).success,
      ).toBe(false);
    expect(
      annotationGeometrySchema.safeParse({
        ...rectangle,
        x: ANNOTATION_COORDINATE_SCALE,
      }).success,
    ).toBe(false);
    expect(
      annotationGeometrySchema.safeParse({
        ...rectangle,
        y: 1,
        height: ANNOTATION_COORDINATE_SCALE,
      }).success,
    ).toBe(false);
  });

  it('fixes the coordinate space and rejects injected geometry fields', () => {
    expect(
      annotationGeometrySchema.safeParse({
        ...point,
        coordinateSpace: 'pixels',
      }).success,
    ).toBe(false);
    expect(
      annotationGeometrySchema.safeParse({ ...point, imageWidth: 4000 })
        .success,
    ).toBe(false);
  });
});

describe('Guest annotation commands', () => {
  it('accepts all command variants and nullable comment links', () => {
    expect(guestAnnotationCommandSchema.safeParse(createCommand).success).toBe(
      true,
    );
    expect(
      guestAnnotationCommandSchema.safeParse({
        ...createCommand,
        commentId: null,
      }).success,
    ).toBe(true);
    expect(
      guestAnnotationCommandSchema.safeParse({
        requestId: id(6),
        expectedGuestId: id(2),
        operation: 'update',
        annotationId: id(10),
        expectedRevision: 1,
        geometry: rectangle,
        style: { color: 'red' },
        commentId: null,
      }).success,
    ).toBe(true);
    for (const operation of ['delete', 'resolve', 'reopen'] as const)
      expect(
        guestAnnotationCommandSchema.safeParse({
          requestId: id(7),
          expectedGuestId: id(2),
          operation,
          annotationId: id(10),
          expectedRevision: 2,
        }).success,
      ).toBe(true);
  });

  it('rejects actor, session, workspace and unknown-field injection', () => {
    for (const extra of [
      { actorId: id(8) },
      { sessionId: id(8) },
      { workspaceId: id(8) },
      { guestId: id(8) },
      { unexpected: true },
    ])
      expect(
        guestAnnotationCommandSchema.safeParse({
          ...createCommand,
          ...extra,
        }).success,
      ).toBe(false);
    expect(
      guestAnnotationCommandSchema.safeParse({
        ...createCommand,
        geometry: { ...point, actorId: id(8) },
      }).success,
    ).toBe(false);
  });

  it('validates strict allowlisted annotation colors rather than CSS values', () => {
    for (const color of ['#ff0000', 'rgb(0 0 0)', 'url(javascript:alert(1))'])
      expect(
        guestAnnotationCommandSchema.safeParse({
          ...createCommand,
          style: { color },
        }).success,
      ).toBe(false);
    expect(
      guestAnnotationCommandSchema.safeParse({
        ...createCommand,
        style: { color: 'blue', opacity: 0.5 },
      }).success,
    ).toBe(false);
  });

  it('requires positive safe revisions and canonicalizes request UUID casing', () => {
    for (const expectedRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        guestAnnotationCommandSchema.safeParse({
          requestId: id(6),
          expectedGuestId: id(2),
          operation: 'update',
          annotationId: id(10),
          expectedRevision,
          geometry: point,
          style,
          commentId: id(5),
        }).success,
      ).toBe(false);

    const parsed = guestAnnotationCommandSchema.parse({
      ...createCommand,
      requestId: id(1).toUpperCase(),
    });
    expect(parsed.requestId).toBe(id(1));
  });
});

describe('Guest annotation items and pages', () => {
  it('requires complete live items or a full deleted tombstone', () => {
    expect(guestAnnotationItemSchema.safeParse(item).success).toBe(true);
    const tombstone = {
      ...item,
      revision: 2,
      geometry: null,
      style: null,
      commentId: null,
      state: 'deleted',
    };
    expect(guestAnnotationItemSchema.safeParse(tombstone).success).toBe(true);
    expect(
      guestAnnotationItemSchema.safeParse({
        ...tombstone,
        geometry: point,
      }).success,
    ).toBe(false);
    expect(
      guestAnnotationItemSchema.safeParse({
        ...tombstone,
        commentId: id(5),
      }).success,
    ).toBe(false);
    expect(
      guestAnnotationItemSchema.safeParse({ ...item, style: null }).success,
    ).toBe(false);
    expect(
      guestAnnotationItemSchema.safeParse({ ...item, geometry: null }).success,
    ).toBe(false);
  });

  it('enforces photo/version scope and unique annotation IDs in each page', () => {
    const page = {
      guestId: id(2),
      photoId: id(3),
      versionId: id(4),
      items: [item],
      nextCursor: null,
    };
    expect(guestAnnotationsPageSchema.safeParse(page).success).toBe(true);
    expect(
      guestAnnotationsPageSchema.safeParse({
        ...page,
        items: [{ ...item, photoId: id(11) }],
      }).success,
    ).toBe(false);
    expect(
      guestAnnotationsPageSchema.safeParse({
        ...page,
        items: [item, { ...item, versionId: id(12) }],
      }).success,
    ).toBe(false);
    expect(
      guestAnnotationsPageSchema.safeParse({
        ...page,
        items: [item, { ...item, annotationId: id(13) }],
      }).success,
    ).toBe(true);
    expect(
      guestAnnotationsPageSchema.safeParse({
        ...page,
        items: [...page.items, item],
      }).success,
    ).toBe(false);
  });
});

describe('Guest annotation results and reads', () => {
  it('binds every operation to its required lifecycle state and timestamp', () => {
    expect(
      guestAnnotationResultSchema.safeParse(result('create')).success,
    ).toBe(true);
    expect(
      guestAnnotationResultSchema.safeParse(
        result('update', { ...item, revision: 2 }),
      ).success,
    ).toBe(true);
    expect(
      guestAnnotationResultSchema.safeParse(
        result('delete', {
          ...item,
          revision: 2,
          geometry: null,
          style: null,
          commentId: null,
          state: 'deleted',
        }),
      ).success,
    ).toBe(true);
    expect(
      guestAnnotationResultSchema.safeParse(
        result('resolve', { ...item, revision: 2, state: 'resolved' }),
      ).success,
    ).toBe(true);
    expect(
      guestAnnotationResultSchema.safeParse(
        result('reopen', { ...item, revision: 2, state: 'open' }),
      ).success,
    ).toBe(true);
    expect(
      guestAnnotationResultSchema.safeParse(
        result('resolve', { ...item, revision: 2, state: 'open' }),
      ).success,
    ).toBe(false);
    expect(
      guestAnnotationResultSchema.safeParse({
        ...result('create'),
        item: { ...item, revision: 2 },
      }).success,
    ).toBe(false);
    expect(
      guestAnnotationResultSchema.safeParse({
        ...result('update', { ...item, revision: 2 }),
        occurredAt: '2026-10-28T10:01:00.000Z',
      }).success,
    ).toBe(false);

    const parsed = guestAnnotationResultSchema.parse({
      ...result('create'),
      requestId: id(1).toUpperCase(),
    });
    expect(parsed.requestId).toBe(id(1));
  });

  it('keeps query shapes strict and disallows pagination with a targeted read', () => {
    expect(guestAnnotationReadQuerySchema.safeParse({}).success).toBe(true);
    expect(
      guestAnnotationReadQuerySchema.safeParse({ cursor: 'next-page' }).success,
    ).toBe(true);
    expect(
      guestAnnotationReadQuerySchema.safeParse({ annotationId: id(10) })
        .success,
    ).toBe(true);
    expect(
      guestAnnotationReadQuerySchema.safeParse({
        cursor: 'next-page',
        annotationId: id(10),
      }).success,
    ).toBe(false);
    expect(
      guestAnnotationReadQuerySchema.safeParse({ cursor: 'x'.repeat(1025) })
        .success,
    ).toBe(false);
    expect(
      guestAnnotationReadQuerySchema.safeParse({ cursor: 'x', actorId: id(8) })
        .success,
    ).toBe(false);
  });

  it('accepts only the capability flag', () => {
    expect(
      guestAnnotationsCapabilitiesSchema.safeParse({ enabled: true }).success,
    ).toBe(true);
    expect(
      guestAnnotationsCapabilitiesSchema.safeParse({
        enabled: false,
        canDelete: true,
      }).success,
    ).toBe(false);
  });
});
