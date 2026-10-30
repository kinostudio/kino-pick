import { ANNOTATION_COORDINATE_SCALE } from '../../../packages/contracts/src/annotation-coordinate-scale.ts';
import {
  FREEHAND_STROKE_MAX_POINTS,
  freehandStrokeGeometrySchema,
} from '../../../packages/contracts/src/freehand-stroke-geometry.ts';
import {
  getAnnotationImageRect,
  type AnnotationCoordinateContext,
  type AnnotationImageRect,
  type AnnotationViewport,
} from './annotation-coordinates.ts';

export type FreehandStrokeRenderPoint = Readonly<{
  x: number;
  y: number;
}>;

export type FreehandStrokeRenderModel = Readonly<{
  /** CSS-pixel bounds of the existing viewport; the caller owns clipping. */
  viewport: Readonly<AnnotationViewport>;
  /**
   * CSS-pixel image bounds from the shared contain/zoom/pan transform.
   * This rectangle may extend outside viewport.
   */
  imageRect: Readonly<AnnotationImageRect>;
  /** Numeric coordinate extent for the normalized_1e6 image-space points. */
  coordinateBounds: Readonly<{
    minX: 0;
    minY: 0;
    maxX: typeof ANNOTATION_COORDINATE_SCALE;
    maxY: typeof ANNOTATION_COORDINATE_SCALE;
  }>;
  /** Ordered image-space x/y pairs; no SVG markup or path string is produced. */
  points: readonly FreehandStrokeRenderPoint[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Creates a render-only model for a normalized freehand stroke.
 *
 * Image geometry remains in the same normalized_1e6 space used by sampling and
 * the existing annotation canvas. imageRect comes from the shared contain,
 * zoom, and center-relative pan transform, so letterboxing and viewport changes
 * use the same mapping as point/rectangle annotations. This helper does not
 * clip strokes: the eventual renderer must stay inside the existing viewport
 * clip because imageRect can extend beyond viewport.
 *
 * Malformed geometry, unsupported fields, invalid bounds, and invalid
 * coordinate contexts fail closed. The result contains numeric geometry only:
 * no image bytes, style, SVG string, or caller-provided markup.
 */
export function getFreehandStrokeRenderModel(
  geometry: unknown,
  context: AnnotationCoordinateContext,
): FreehandStrokeRenderModel | null {
  try {
    if (
      !isRecord(geometry) ||
      !Array.isArray(geometry.points) ||
      geometry.points.length < 2 ||
      geometry.points.length > FREEHAND_STROKE_MAX_POINTS
    ) {
      return null;
    }

    const parsed = freehandStrokeGeometrySchema.safeParse(geometry);
    if (!parsed.success) return null;

    const imageRect = getAnnotationImageRect(context);
    if (!imageRect) return null;

    const viewport = context.viewport;
    return {
      viewport: {
        x: viewport.x,
        y: viewport.y,
        width: viewport.width,
        height: viewport.height,
      },
      imageRect: {
        x: imageRect.x,
        y: imageRect.y,
        width: imageRect.width,
        height: imageRect.height,
        right: imageRect.right,
        bottom: imageRect.bottom,
      },
      coordinateBounds: {
        minX: 0,
        minY: 0,
        maxX: ANNOTATION_COORDINATE_SCALE,
        maxY: ANNOTATION_COORDINATE_SCALE,
      },
      points: parsed.data.points.map(({ x, y }) => ({ x, y })),
    };
  } catch {
    return null;
  }
}
