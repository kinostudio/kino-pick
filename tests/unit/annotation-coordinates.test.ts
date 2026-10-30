import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_COORDINATE_SCALE,
  annotationGeometrySchema,
} from '../../packages/contracts/src/annotation-geometry';
import {
  annotationPointToClientPoint,
  clientPointToAnnotationPoint,
  createAnnotationRectangle,
  getAnnotationImageRect,
  type AnnotationCoordinateContext,
  type AnnotationPoint,
} from '../../apps/web/target-ui/annotation-coordinates';

const scale = ANNOTATION_COORDINATE_SCALE;

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

function point(x: number, y: number): AnnotationPoint {
  return {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x,
    y,
  };
}

describe('annotation coordinate transforms', () => {
  it('fits landscape and portrait sources with contain letterboxing', () => {
    expect(getAnnotationImageRect(context())).toEqual({
      x: 0,
      y: 50,
      width: 400,
      height: 200,
      right: 400,
      bottom: 250,
    });

    expect(
      getAnnotationImageRect(
        context({
          viewport: { x: 10, y: 20, width: 400, height: 300 },
          source: { width: 2, height: 4 },
        }),
      ),
    ).toEqual({
      x: 135,
      y: 20,
      width: 150,
      height: 300,
      right: 285,
      bottom: 320,
    });
  });

  it('rejects letterbox padding rather than clamping it to the image edge', () => {
    expect(clientPointToAnnotationPoint({ x: 200, y: 49.999 }, context())).toBe(
      null,
    );
    expect(
      clientPointToAnnotationPoint({ x: 200, y: 250.001 }, context()),
    ).toBe(null);

    const portrait = context({
      viewport: { x: 10, y: 20, width: 400, height: 300 },
      source: { width: 2, height: 4 },
    });
    expect(
      clientPointToAnnotationPoint({ x: 134.999, y: 170 }, portrait),
    ).toBeNull();
    expect(
      clientPointToAnnotationPoint({ x: 285.001, y: 170 }, portrait),
    ).toBeNull();
  });

  it('maps through zoom and center-relative pan while rejecting clipped viewport space', () => {
    const transformed = context({
      viewport: { x: 100, y: 200, width: 400, height: 300 },
      zoom: 2,
      pan: { x: 30, y: -20 },
    });

    expect(getAnnotationImageRect(transformed)).toEqual({
      x: -70,
      y: 130,
      width: 800,
      height: 400,
      right: 730,
      bottom: 530,
    });
    expect(
      clientPointToAnnotationPoint({ x: 500, y: 400 }, transformed),
    ).toEqual(point(712_500, 675_000));
    expect(
      clientPointToAnnotationPoint({ x: 50, y: 300 }, transformed),
    ).toBeNull();
  });

  it('accepts inclusive image edges and supports negative client coordinates', () => {
    expect(clientPointToAnnotationPoint({ x: 0, y: 50 }, context())).toEqual(
      point(0, 0),
    );
    expect(clientPointToAnnotationPoint({ x: 400, y: 250 }, context())).toEqual(
      point(scale, scale),
    );
    expect(
      clientPointToAnnotationPoint({ x: 400.00001, y: 250 }, context()),
    ).toBeNull();

    const negativeViewport = context({
      viewport: { x: -200, y: -100, width: 400, height: 300 },
      source: { width: 4, height: 3 },
    });
    expect(
      clientPointToAnnotationPoint({ x: -100, y: -25 }, negativeViewport),
    ).toEqual(point(250_000, 250_000));
    expect(
      clientPointToAnnotationPoint({ x: -201, y: -25 }, negativeViewport),
    ).toBeNull();
  });

  it('normalizes reverse drags and rejects zero-area or invalid rectangles', () => {
    const rectangle = createAnnotationRectangle(
      point(850_000, 700_000),
      point(100_000, 150_000),
    );

    expect(rectangle).toEqual({
      type: 'rectangle',
      coordinateSpace: 'normalized_1e6',
      x: 100_000,
      y: 150_000,
      width: 750_000,
      height: 550_000,
    });
    expect(annotationGeometrySchema.safeParse(rectangle).success).toBe(true);
    expect(createAnnotationRectangle(point(10, 10), point(10, 20))).toBeNull();
    expect(createAnnotationRectangle(point(10, 10), point(20, 10))).toBeNull();
    expect(createAnnotationRectangle(point(-1, 10), point(20, 30))).toBeNull();
    expect(
      createAnnotationRectangle(point(0, 0), point(scale + 1, scale)),
    ).toBeNull();
  });

  it('keeps geometry stable as the viewport is resized, zoomed, and panned', () => {
    const geometryPoint = point(333_333, 666_667);
    const initial = context({
      viewport: { x: 10, y: 20, width: 320, height: 240 },
      source: { width: 4, height: 3 },
    });
    const resizedAndTransformed = context({
      viewport: { x: 20, y: 10, width: 500, height: 600 },
      source: { width: 400, height: 800 },
      zoom: 1.2,
      pan: { x: -12, y: 0 },
    });

    const firstClientPoint = annotationPointToClientPoint(
      geometryPoint,
      initial,
    );
    const secondClientPoint = annotationPointToClientPoint(
      geometryPoint,
      resizedAndTransformed,
    );
    expect(firstClientPoint).not.toBeNull();
    expect(secondClientPoint).not.toBeNull();
    expect(firstClientPoint).not.toEqual(secondClientPoint);

    for (const [clientPoint, view] of [
      [firstClientPoint, initial],
      [secondClientPoint, resizedAndTransformed],
    ] as const) {
      expect(clientPoint).not.toBeNull();
      const roundTrip = clientPointToAnnotationPoint(clientPoint!, view);
      expect(roundTrip).not.toBeNull();
      expect(Math.abs(roundTrip!.x - geometryPoint.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(roundTrip!.y - geometryPoint.y)).toBeLessThanOrEqual(1);
    }
  });

  it('rejects invalid dimensions, transforms, stale bounds, and overflow', () => {
    const invalidContexts: AnnotationCoordinateContext[] = [
      context({ viewport: { x: 0, y: 0, width: 0, height: 300 } }),
      context({ viewport: { x: 0, y: 0, width: 400, height: -1 } }),
      context({ source: { width: 0, height: 2 } }),
      context({ source: { width: Number.NaN, height: 2 } }),
      context({ zoom: 0.99 }),
      context({ zoom: Number.POSITIVE_INFINITY }),
      context({ pan: { x: 0, y: Number.NaN } }),
      context({
        viewport: {
          x: Number.MAX_VALUE,
          y: 0,
          width: Number.MAX_VALUE,
          height: 300,
        },
      }),
      context({ zoom: Number.MAX_VALUE }),
      context({ pan: { x: Number.MAX_VALUE, y: 0 } }),
    ];

    for (const invalid of invalidContexts) {
      expect(getAnnotationImageRect(invalid)).toBeNull();
      expect(
        clientPointToAnnotationPoint({ x: 10, y: 10 }, invalid),
      ).toBeNull();
      expect(annotationPointToClientPoint(point(0, 0), invalid)).toBeNull();
    }

    expect(
      getAnnotationImageRect(null as unknown as AnnotationCoordinateContext),
    ).toBeNull();
    expect(
      clientPointToAnnotationPoint({ x: Number.NaN, y: 10 }, context()),
    ).toBeNull();
    expect(
      annotationPointToClientPoint(
        point(Number.POSITIVE_INFINITY, 0),
        context(),
      ),
    ).toBeNull();
  });
});
