import { describe, expect, it } from 'vitest';
import {
  createAnnotationCanvasFreehandDraft,
  getAnnotationCanvasFreehandRenderModel,
  matchesCurrentFreehandScope,
  type AnnotationCanvasFreehandScope,
} from '../../apps/web/target-ui/annotation-canvas';
import {
  annotationPointToClientPoint,
  type AnnotationCoordinateContext,
  type AnnotationPoint,
} from '../../apps/web/target-ui/annotation-coordinates';
import { FREEHAND_STROKE_MAX_INPUT_POINTS } from '../../apps/web/target-ui/freehand-sampling';
import type { FreehandStroke } from '../../packages/contracts/src/freehand-stroke';

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

function annotationPoint(x: number, y: number): AnnotationPoint {
  return {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x,
    y,
  };
}

function clientPoints(
  points: readonly AnnotationPoint[],
  view: AnnotationCoordinateContext,
) {
  return points.map((point) => {
    const client = annotationPointToClientPoint(point, view);
    if (!client) throw new Error('Expected a client coordinate');
    return client;
  });
}

function scope(
  overrides: Partial<AnnotationCanvasFreehandScope> = {},
): AnnotationCanvasFreehandScope {
  return {
    scopeKey: 'owner/photo/version',
    previewUrl: 'https://example.test/private-preview',
    canDraw: true,
    mode: true,
    ready: true,
    viewKey: '1:0:0:400:300:4:2',
    ...overrides,
  };
}

describe('AnnotationCanvas optional freehand preparation', () => {
  it('keeps normalized strokes stable across zoom and pan and uses the color allowlist', () => {
    const normalized = [
      annotationPoint(250_000, 250_000),
      annotationPoint(750_000, 750_000),
    ];
    const firstView = context();
    const transformedView = context({
      viewport: { x: 100, y: 80, width: 800, height: 600 },
      zoom: 1.5,
      pan: { x: 24, y: -18 },
    });

    const first = createAnnotationCanvasFreehandDraft(
      clientPoints(normalized, firstView),
      firstView,
      'blue',
    );
    const transformed = createAnnotationCanvasFreehandDraft(
      clientPoints(normalized, transformedView),
      transformedView,
      'blue',
    );

    expect(first).toEqual({
      geometry: {
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 1,
        points: normalized.map(({ x, y }) => ({ x, y })),
      },
      style: { color: 'blue' },
    });
    expect(transformed).toEqual(first);
  });

  it('cancels out-of-image paths and raw samples above the finite cap', () => {
    const view = context();
    const outsidePath = [
      { x: 100, y: 100 },
      { x: 200, y: 49.99 },
    ];
    expect(
      createAnnotationCanvasFreehandDraft(outsidePath, view, 'red'),
    ).toBeNull();

    const tooManySamples = Array.from(
      { length: FREEHAND_STROKE_MAX_INPUT_POINTS + 1 },
      (_, index) => ({ x: 100 + index / 1000, y: 100 }),
    );
    expect(
      createAnnotationCanvasFreehandDraft(tooManySamples, view, 'amber'),
    ).toBeNull();
  });

  it('renders only validated numeric geometry and allowlisted CSS color', () => {
    const stroke: FreehandStroke = {
      geometry: {
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 1,
        points: [
          { x: 123_456, y: 654_321 },
          { x: 876_543, y: 123_456 },
        ],
      },
      style: { color: 'amber' },
    };
    const view = context({
      viewport: { x: 100, y: 200, width: 400, height: 300 },
      zoom: 2,
      pan: { x: 30, y: -20 },
    });

    const model = getAnnotationCanvasFreehandRenderModel(stroke, view);

    expect(model?.points).toEqual(stroke.geometry.points);
    expect(model?.stroke).toBe('#d97706');
    expect(JSON.stringify(model)).not.toContain('data:image');
    expect(
      getAnnotationCanvasFreehandRenderModel(
        { ...stroke, style: { color: 'purple' } },
        view,
      ),
    ).toBeNull();
  });

  it('rejects stale scope, preview, permission, mode, and view snapshots', () => {
    const started = scope();

    expect(matchesCurrentFreehandScope(started, scope())).toBe(true);
    expect(
      matchesCurrentFreehandScope(started, scope({ scopeKey: 'other' })),
    ).toBe(false);
    expect(
      matchesCurrentFreehandScope(
        started,
        scope({ previewUrl: 'https://example.test/next-preview' }),
      ),
    ).toBe(false);
    expect(
      matchesCurrentFreehandScope(started, scope({ canDraw: false })),
    ).toBe(false);
    expect(matchesCurrentFreehandScope(started, scope({ mode: false }))).toBe(
      false,
    );
    expect(
      matchesCurrentFreehandScope(started, scope({ viewKey: 'zoomed' })),
    ).toBe(false);
    expect(matchesCurrentFreehandScope(started, scope({ ready: false }))).toBe(
      false,
    );
  });
});
