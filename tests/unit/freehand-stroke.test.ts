import { describe, expect, it } from 'vitest';
import { ANNOTATION_COORDINATE_SCALE } from '../../packages/contracts/src/annotation-geometry';
import {
  FREEHAND_STROKE_MAX_JSON_BYTES,
  FREEHAND_STROKE_MAX_POINTS,
  freehandStrokeGeometrySchema,
  freehandStrokeSchema,
  type FreehandStrokeGeometry,
  type FreehandStrokePoint,
} from '../../packages/contracts/src/freehand-stroke';

const scale = ANNOTATION_COORDINATE_SCALE;
const start: FreehandStrokePoint = { x: 0, y: 0 };
const end: FreehandStrokePoint = { x: scale, y: scale };

function geometry(
  overrides: Partial<FreehandStrokeGeometry> = {},
): FreehandStrokeGeometry {
  return {
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points: [start, end],
    ...overrides,
  };
}

describe('freehand stroke contracts', () => {
  it('accepts normalized image edges and keeps style outside geometry', () => {
    const value = geometry();

    expect(freehandStrokeGeometrySchema.safeParse(value).success).toBe(true);
    expect(
      freehandStrokeSchema.safeParse({
        geometry: value,
        style: { color: 'amber' },
      }).success,
    ).toBe(true);
  });

  it('rejects non-finite, fractional, unsafe, and out-of-range coordinates', () => {
    const invalidCoordinates = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      0.5,
      scale + 1,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const x of invalidCoordinates) {
      expect(
        freehandStrokeGeometrySchema.safeParse({
          ...geometry(),
          points: [{ x, y: 0 }, end],
        }).success,
      ).toBe(false);
    }

    for (const y of invalidCoordinates) {
      expect(
        freehandStrokeGeometrySchema.safeParse({
          ...geometry(),
          points: [{ x: 0, y }, end],
        }).success,
      ).toBe(false);
    }
  });

  it('requires two to 256 points and accepts a closed path', () => {
    expect(
      freehandStrokeGeometrySchema.safeParse(geometry({ points: [start] }))
        .success,
    ).toBe(false);

    const maxPoints = Array.from(
      { length: FREEHAND_STROKE_MAX_POINTS },
      (_, index) => (index % 2 === 0 ? start : end),
    );
    expect(
      freehandStrokeGeometrySchema.safeParse(geometry({ points: maxPoints }))
        .success,
    ).toBe(true);

    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        points: [start, end, start],
      }).success,
    ).toBe(true);

    const tooManyPoints = [...maxPoints, { x: 0, y: 1 }];
    expect(
      freehandStrokeGeometrySchema.safeParse(
        geometry({ points: tooManyPoints }),
      ).success,
    ).toBe(false);
  });

  it('rejects adjacent duplicates but permits a later revisit', () => {
    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        points: [start, start],
      }).success,
    ).toBe(false);

    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        points: [start, end, end, { x: scale, y: 0 }],
      }).success,
    ).toBe(false);

    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        points: [start, end, start],
      }).success,
    ).toBe(true);
  });

  it('pins format version, coordinate space, color allowlist, and strict keys', () => {
    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        version: 2,
      }).success,
    ).toBe(false);
    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        coordinateSpace: 'normalized_1e3',
      }).success,
    ).toBe(false);
    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        svg: '<path d="M0 0" />',
      }).success,
    ).toBe(false);
    expect(
      freehandStrokeGeometrySchema.safeParse({
        ...geometry(),
        points: [{ ...start, path: 'M0 0' }, end],
      }).success,
    ).toBe(false);

    for (const color of ['amber', 'red', 'blue']) {
      expect(
        freehandStrokeSchema.safeParse({
          geometry: geometry(),
          style: { color },
        }).success,
      ).toBe(true);
    }

    expect(
      freehandStrokeSchema.safeParse({
        geometry: geometry(),
        style: { color: 'purple' },
      }).success,
    ).toBe(false);
    expect(
      freehandStrokeSchema.safeParse({
        geometry: geometry(),
        style: { color: 'red', width: 12 },
      }).success,
    ).toBe(false);
  });

  it('keeps the largest valid path under the compact geometry JSON limit', () => {
    const maxPoints = Array.from(
      { length: FREEHAND_STROKE_MAX_POINTS },
      (_, index) => (index % 2 === 0 ? start : end),
    );
    const value = geometry({ points: maxPoints });
    const json = JSON.stringify(value);

    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(
      FREEHAND_STROKE_MAX_JSON_BYTES,
    );
    expect(freehandStrokeGeometrySchema.safeParse(value).success).toBe(true);
  });
});
