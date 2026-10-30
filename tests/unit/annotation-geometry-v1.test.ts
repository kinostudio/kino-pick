import { describe, expect, it } from 'vitest';
import {
  FREEHAND_STROKE_MAX_JSON_BYTES,
  FREEHAND_STROKE_MAX_POINTS,
} from '../../packages/contracts/src/freehand-stroke-geometry';
import { canonicalAnnotationGeometryV1Json } from '../../apps/worker/src/annotation-geometry-v1';

describe('canonical v1 annotation geometry JSON', () => {
  it('preserves the existing point and rectangle JSON bytes', () => {
    expect(
      canonicalAnnotationGeometryV1Json({
        y: 750_000,
        x: 250_000,
        coordinateSpace: 'normalized_1e6',
        type: 'point',
      }),
    ).toBe(
      '{"type":"point","coordinateSpace":"normalized_1e6","x":250000,"y":750000}',
    );

    expect(
      canonicalAnnotationGeometryV1Json({
        height: 500_000,
        y: 100_000,
        width: 250_000,
        x: 200_000,
        type: 'rectangle',
        coordinateSpace: 'normalized_1e6',
      }),
    ).toBe(
      '{"type":"rectangle","coordinateSpace":"normalized_1e6","x":200000,"y":100000,"width":250000,"height":500000}',
    );
  });

  it('uses fixed freehand field order and preserves point order', () => {
    const input = {
      points: [
        { y: 10, x: 1 },
        { y: 20, x: 2 },
        { y: 10, x: 1 },
      ],
      version: 1,
      type: 'freehand',
      coordinateSpace: 'normalized_1e6',
    };

    expect(canonicalAnnotationGeometryV1Json(input)).toBe(
      '{"type":"freehand","coordinateSpace":"normalized_1e6","version":1,"points":[{"x":1,"y":10},{"x":2,"y":20},{"x":1,"y":10}]}',
    );
    expect(
      canonicalAnnotationGeometryV1Json({
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 1,
        points: [
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 1, y: 10 },
        ],
      }),
    ).toBe(canonicalAnnotationGeometryV1Json(input));
  });

  it('accepts the maximum freehand point count within the canonical byte bound', () => {
    const points = Array.from({ length: FREEHAND_STROKE_MAX_POINTS }, (_, i) =>
      i % 2 === 0 ? { x: i + 1, y: i } : { x: i + 1, y: i - 1 },
    );
    const json = canonicalAnnotationGeometryV1Json({
      type: 'freehand',
      coordinateSpace: 'normalized_1e6',
      version: 1,
      points,
    });

    expect(JSON.parse(json).points).toHaveLength(FREEHAND_STROKE_MAX_POINTS);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(
      FREEHAND_STROKE_MAX_JSON_BYTES,
    );
  });

  it('fails closed for malformed, non-canonical, and over-limit inputs', () => {
    const duplicateAdjacentPoints = [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ];
    const tooManyPoints = Array.from(
      { length: FREEHAND_STROKE_MAX_POINTS + 1 },
      (_, index) => ({ x: index + 1, y: index }),
    );
    const invalidInputs: unknown[] = [
      null,
      [],
      { type: 'ellipse', coordinateSpace: 'normalized_1e6' },
      {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 1.5,
        y: 2,
      },
      {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 1,
        y: 2,
        extra: true,
      },
      {
        type: 'rectangle',
        coordinateSpace: 'normalized_1e6',
        x: 900_000,
        y: 0,
        width: 200_000,
        height: 1,
      },
      {
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 2,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      {
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 1,
        points: duplicateAdjacentPoints,
      },
      {
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 1,
        points: tooManyPoints,
      },
      {
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 1,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        extra: true,
      },
    ];

    for (const input of invalidInputs)
      expect(() => canonicalAnnotationGeometryV1Json(input)).toThrow(TypeError);
  });
});
