import { describe, expect, it } from 'vitest';
import { ANNOTATION_COORDINATE_SCALE } from '../../packages/contracts/src/annotation-coordinate-scale';
import {
  FREEHAND_STROKE_MAX_POINTS,
  freehandStrokeGeometrySchema,
  type FreehandStrokeGeometry,
} from '../../packages/contracts/src/freehand-stroke-geometry';
import {
  getAnnotationImageRect,
  type AnnotationCoordinateContext,
} from '../../apps/web/target-ui/annotation-coordinates';
import { getFreehandStrokeRenderModel } from '../../apps/web/target-ui/freehand-render';

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

function geometry(
  points: FreehandStrokeGeometry['points'] = [
    { x: 100_000, y: 200_000 },
    { x: 800_000, y: 700_000 },
  ],
): FreehandStrokeGeometry {
  return {
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points,
  };
}

describe('freehand stroke render model', () => {
  it('keeps ordered normalized x/y points and maps the image through landscape letterboxing', () => {
    const input = geometry([
      { x: 123_456, y: 654_321 },
      { x: 999_999, y: 1 },
    ]);

    const model = getFreehandStrokeRenderModel(input, context());

    expect(model).toEqual({
      viewport: { x: 0, y: 0, width: 400, height: 300 },
      imageRect: {
        x: 0,
        y: 50,
        width: 400,
        height: 200,
        right: 400,
        bottom: 250,
      },
      coordinateBounds: {
        minX: 0,
        minY: 0,
        maxX: ANNOTATION_COORDINATE_SCALE,
        maxY: ANNOTATION_COORDINATE_SCALE,
      },
      points: [
        { x: 123_456, y: 654_321 },
        { x: 999_999, y: 1 },
      ],
    });
    expect(model?.points[0]).toEqual({ x: 123_456, y: 654_321 });
    expect(freehandStrokeGeometrySchema.safeParse(input).success).toBe(true);
  });

  it('uses the shared portrait contain bounds and keeps inclusive image-edge points', () => {
    const view = context({
      viewport: { x: 10, y: 20, width: 400, height: 300 },
      source: { width: 2, height: 4 },
    });
    const input = geometry([
      { x: 0, y: 0 },
      { x: ANNOTATION_COORDINATE_SCALE, y: ANNOTATION_COORDINATE_SCALE },
    ]);

    const model = getFreehandStrokeRenderModel(input, view);

    expect(model?.imageRect).toEqual({
      x: 135,
      y: 20,
      width: 150,
      height: 300,
      right: 285,
      bottom: 320,
    });
    expect(model?.points).toEqual(input.points);
  });

  it('reuses image bounds for resize, zoom, and pan while preserving logical points', () => {
    const input = geometry();
    const initial = context();
    const resizedAndTransformed = context({
      viewport: { x: 100, y: 200, width: 800, height: 600 },
      zoom: 2,
      pan: { x: 30, y: -20 },
    });

    const initialModel = getFreehandStrokeRenderModel(input, initial);
    const transformedModel = getFreehandStrokeRenderModel(
      input,
      resizedAndTransformed,
    );

    expect(initialModel?.imageRect).toEqual(getAnnotationImageRect(initial));
    expect(transformedModel?.imageRect).toEqual(
      getAnnotationImageRect(resizedAndTransformed),
    );
    expect(transformedModel?.imageRect).toEqual({
      x: -270,
      y: 80,
      width: 1600,
      height: 800,
      right: 1330,
      bottom: 880,
    });
    expect(transformedModel?.points).toEqual(initialModel?.points);
  });

  it('retains bounds that extend past the viewport for the host viewport clip', () => {
    const view = context({
      viewport: { x: 100, y: 200, width: 400, height: 300 },
      zoom: 2,
      pan: { x: 30, y: -20 },
    });

    const model = getFreehandStrokeRenderModel(
      geometry([
        { x: 0, y: 0 },
        { x: ANNOTATION_COORDINATE_SCALE, y: ANNOTATION_COORDINATE_SCALE },
      ]),
      view,
    );

    expect(model?.viewport).toEqual(view.viewport);
    expect(model?.imageRect).toEqual({
      x: -70,
      y: 130,
      width: 800,
      height: 400,
      right: 730,
      bottom: 530,
    });
    expect(model?.imageRect.x).toBeLessThan(model!.viewport.x);
    expect(model?.imageRect.right).toBeGreaterThan(
      model!.viewport.x + model!.viewport.width,
    );
    expect(model?.points).toEqual([
      { x: 0, y: 0 },
      { x: ANNOTATION_COORDINATE_SCALE, y: ANNOTATION_COORDINATE_SCALE },
    ]);
  });

  it('fails closed for invalid geometry, injected fields, and invalid coordinate contexts', () => {
    const valid = geometry();
    const invalidGeometry: unknown[] = [
      null,
      'M0 0 L1 1',
      { ...valid, version: 2 },
      { ...valid, coordinateSpace: 'normalized_1e3' },
      { ...valid, svg: '<path d="M0 0" />' },
      {
        ...valid,
        points: [
          { x: 1, y: 2, path: 'M0 0' },
          { x: 3, y: 4 },
        ],
      },
      {
        ...valid,
        points: [
          { x: -1, y: 0 },
          { x: 3, y: 4 },
        ],
      },
      {
        ...valid,
        points: [
          { x: 0, y: 0 },
          { x: 1_000_001, y: 4 },
        ],
      },
      {
        ...valid,
        points: [
          { x: 1, y: 2 },
          { x: 1, y: 2 },
        ],
      },
      { ...valid, points: [{ x: 1, y: 2 }] },
      {
        ...valid,
        points: Array.from(
          { length: FREEHAND_STROKE_MAX_POINTS + 1 },
          (_, i) => ({
            x: i,
            y: i + 1,
          }),
        ),
      },
    ];

    for (const value of invalidGeometry) {
      expect(getFreehandStrokeRenderModel(value, context())).toBeNull();
    }

    expect(
      getFreehandStrokeRenderModel(
        valid,
        context({ viewport: { x: 0, y: 0, width: 0, height: 300 } }),
      ),
    ).toBeNull();
    expect(
      getFreehandStrokeRenderModel(valid, context({ zoom: 0.99 })),
    ).toBeNull();
    expect(
      getFreehandStrokeRenderModel(
        valid,
        null as unknown as AnnotationCoordinateContext,
      ),
    ).toBeNull();
  });
});
