import { describe, expect, it } from 'vitest';
import {
  FREEHAND_STROKE_MAX_POINTS,
  freehandStrokeGeometrySchema,
} from '../../packages/contracts/src/freehand-stroke';
import {
  annotationPointToClientPoint,
  type AnnotationClientPoint,
  type AnnotationCoordinateContext,
  type AnnotationPoint,
} from '../../apps/web/target-ui/annotation-coordinates';
import {
  FREEHAND_STROKE_MAX_INPUT_POINTS,
  sampleFreehandStroke,
} from '../../apps/web/target-ui/freehand-sampling';

function context(
  overrides: Partial<AnnotationCoordinateContext> = {},
): AnnotationCoordinateContext {
  return {
    viewport: { x: 0, y: 0, width: 400, height: 300 },
    source: { width: 4, height: 2 },
    zoom: 1,
    pan: { x: 0, y: 0 },
    ...overrides,
  };
}

function normalizedPoint(x: number, y: number): AnnotationPoint {
  return {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x,
    y,
  };
}

function clientSamples(
  points: readonly { x: number; y: number }[],
  view: AnnotationCoordinateContext,
): AnnotationClientPoint[] {
  return points.map(({ x, y }) => {
    const clientPoint = annotationPointToClientPoint(
      normalizedPoint(x, y),
      view,
    );
    if (!clientPoint) throw new Error('Expected a visible client point');
    return clientPoint;
  });
}

describe('freehand stroke sampling', () => {
  it('normalizes oriented image coordinates and removes adjacent duplicates', () => {
    const geometry = sampleFreehandStroke(
      [
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        { x: 100.0001, y: 100 },
        { x: 300, y: 200 },
      ],
      context(),
    );

    expect(geometry).toEqual({
      type: 'freehand',
      coordinateSpace: 'normalized_1e6',
      version: 1,
      points: [
        { x: 250_000, y: 250_000 },
        { x: 750_000, y: 750_000 },
      ],
    });
    expect(freehandStrokeGeometrySchema.safeParse(geometry).success).toBe(true);
  });

  it('produces the same image geometry after zoom, pan, and viewport changes', () => {
    const points = [
      { x: 300_000, y: 400_000 },
      { x: 500_000, y: 500_000 },
      { x: 700_000, y: 600_000 },
    ];
    const firstView = context();
    const transformedView = context({
      viewport: { x: 100, y: 200, width: 800, height: 600 },
      zoom: 1.5,
      pan: { x: 50, y: -30 },
    });

    const first = sampleFreehandStroke(
      clientSamples(points, firstView),
      firstView,
    );
    const transformed = sampleFreehandStroke(
      clientSamples(points, transformedView),
      transformedView,
    );

    expect(first?.points).toEqual(points);
    expect(transformed?.points).toEqual(points);
  });

  it('accepts inclusive image edges and cancels paths with any out-of-image sample', () => {
    const view = context();

    expect(
      sampleFreehandStroke(
        [
          { x: 0, y: 50 },
          { x: 400, y: 250 },
        ],
        view,
      )?.points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1_000_000, y: 1_000_000 },
    ]);

    expect(
      sampleFreehandStroke(
        [
          { x: 0, y: 50 },
          { x: 200, y: 49.999 },
        ],
        view,
      ),
    ).toBeNull();
    expect(
      sampleFreehandStroke(
        [
          { x: 0, y: 50 },
          { x: 400.001, y: 250 },
        ],
        view,
      ),
    ).toBeNull();
  });

  it('fails closed for invalid samples, contexts, single-point paths, and excess raw input', () => {
    const validPoint = { x: 100, y: 100 };

    expect(
      sampleFreehandStroke([validPoint, validPoint], context()),
    ).toBeNull();
    expect(
      sampleFreehandStroke([validPoint, { x: Number.NaN, y: 120 }], context()),
    ).toBeNull();
    expect(
      sampleFreehandStroke(
        [validPoint, { x: Number.POSITIVE_INFINITY, y: 120 }],
        context(),
      ),
    ).toBeNull();
    expect(
      sampleFreehandStroke(
        [validPoint, { x: 300, y: 200 }],
        context({ zoom: 0 }),
      ),
    ).toBeNull();

    const tooManyRawPoints = Array.from(
      { length: FREEHAND_STROKE_MAX_INPUT_POINTS + 1 },
      () => validPoint,
    );
    expect(sampleFreehandStroke(tooManyRawPoints, context())).toBeNull();
  });

  it('deterministically simplifies long paths while preserving endpoints and schema limits', () => {
    const view = context({
      viewport: { x: 0, y: 0, width: 1_000, height: 1_000 },
      source: { width: 1_000, height: 1_000 },
    });
    const rawPath = Array.from({ length: 600 }, (_, index) => ({
      x: index,
      y: index % 20 < 10 ? 300 : 700,
    }));

    const sampled = sampleFreehandStroke(rawPath, view);
    const secondRun = sampleFreehandStroke(rawPath, view);

    expect(sampled).not.toBeNull();
    expect(sampled?.points).toHaveLength(FREEHAND_STROKE_MAX_POINTS);
    expect(sampled).toEqual(secondRun);
    expect(sampled?.points[0]).toEqual({ x: 0, y: 300_000 });
    expect(sampled?.points.at(-1)).toEqual({ x: 599_000, y: 700_000 });
    expect(freehandStrokeGeometrySchema.safeParse(sampled).success).toBe(true);
  });

  it('preserves a closed path when simplifying it', () => {
    const view = context({
      viewport: { x: 0, y: 0, width: 1_000, height: 1_000 },
      source: { width: 1_000, height: 1_000 },
    });
    const rawPath = Array.from({ length: 401 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 400;
      return {
        x: 500 + 300 * Math.cos(angle),
        y: 500 + 300 * Math.sin(angle),
      };
    });

    const sampled = sampleFreehandStroke(rawPath, view);

    expect(sampled).not.toBeNull();
    expect(sampled?.points).toHaveLength(FREEHAND_STROKE_MAX_POINTS);
    expect(sampled?.points[0]).toEqual(sampled?.points.at(-1));
    expect(
      new Set(sampled?.points.map(({ x, y }) => String(x) + ',' + String(y)))
        .size,
    ).toBeGreaterThan(2);
    expect(freehandStrokeGeometrySchema.safeParse(sampled).success).toBe(true);
  });
});
