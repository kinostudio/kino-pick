import { describe, expect, it } from 'vitest';
import { FREEHAND_STROKE_MAX_POINTS } from '../../packages/contracts/src/freehand-stroke-geometry';
import {
  canonicalAnnotationGeometryJson,
  canonicalFreehandStrokeGeometryJson,
} from '../../apps/worker/src/freehand-canonical';

describe('canonical freehand geometry JSON', () => {
  it('keeps legacy point and rectangle serialization byte-for-byte stable', () => {
    expect(
      canonicalAnnotationGeometryJson({
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 1_000_000,
        y: 0,
      }),
    ).toBe(
      '{"type":"point","coordinateSpace":"normalized_1e6","x":1000000,"y":0}',
    );
    expect(
      canonicalAnnotationGeometryJson({
        type: 'rectangle',
        coordinateSpace: 'normalized_1e6',
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      }),
    ).toBe(
      '{"type":"rectangle","coordinateSpace":"normalized_1e6","x":10,"y":20,"width":30,"height":40}',
    );
  });

  it('replays to exact canonical JSON while preserving point order', () => {
    const expected =
      '{"type":"freehand","coordinateSpace":"normalized_1e6","version":1,"points":[{"x":1,"y":10},{"x":2,"y":20},{"x":1,"y":10}]}';

    const first = {
      version: 1,
      points: [
        { y: 10, x: 1 },
        { y: 20, x: 2 },
        { y: 10, x: 1 },
      ],
      coordinateSpace: 'normalized_1e6',
      type: 'freehand',
    };
    const replay = {
      type: 'freehand',
      coordinateSpace: 'normalized_1e6',
      version: 1,
      points: [
        { x: 1, y: 10 },
        { x: 2, y: 20 },
        { x: 1, y: 10 },
      ],
    };

    expect(canonicalFreehandStrokeGeometryJson(first)).toBe(expected);
    expect(canonicalFreehandStrokeGeometryJson(replay)).toBe(expected);
    expect(canonicalAnnotationGeometryJson(first)).toBe(expected);
  });

  it('fails closed for invalid geometry and point-count overflow', () => {
    const valid = {
      type: 'freehand',
      coordinateSpace: 'normalized_1e6',
      version: 1,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const tooManyPoints = Array.from(
      { length: FREEHAND_STROKE_MAX_POINTS + 1 },
      (_, index) => ({ x: index % 2, y: index }),
    );

    expect(() =>
      canonicalFreehandStrokeGeometryJson({
        ...valid,
        points: tooManyPoints,
      }),
    ).toThrow(TypeError);
    expect(() =>
      canonicalFreehandStrokeGeometryJson({
        ...valid,
        points: [
          { x: 0.5, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      canonicalFreehandStrokeGeometryJson({
        ...valid,
        unexpected: true,
      }),
    ).toThrow(TypeError);
  });
});
