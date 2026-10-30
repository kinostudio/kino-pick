import { ANNOTATION_COORDINATE_SCALE } from '../../../packages/contracts/src/annotation-geometry.ts';
import type { AnnotationGeometry } from '../../../packages/contracts/src/annotation-geometry.ts';

export type AnnotationPoint = Extract<AnnotationGeometry, { type: 'point' }>;
export type AnnotationRectangle = Extract<
  AnnotationGeometry,
  { type: 'rectangle' }
>;

export type AnnotationClientPoint = {
  x: number;
  y: number;
};

export type AnnotationViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OrientedPreviewSize = {
  width: number;
  height: number;
};

export type AnnotationPan = {
  x: number;
  y: number;
};

/**
 * Geometry stays in the oriented source image's normalized coordinate space.
 * viewport and pan use CSS pixels; pan is relative to the viewport center.
 */
export type AnnotationCoordinateContext = {
  viewport: AnnotationViewport;
  source: OrientedPreviewSize;
  zoom: number;
  pan: AnnotationPan;
};

export type AnnotationImageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(value: unknown): value is AnnotationClientPoint {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isPositiveSize(value: unknown): value is OrientedPreviewSize {
  return (
    isRecord(value) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0
  );
}

function isValidViewport(value: unknown): value is AnnotationViewport {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    value.width <= 0 ||
    !isFiniteNumber(value.height) ||
    value.height <= 0
  ) {
    return false;
  }

  const right = value.x + value.width;
  const bottom = value.y + value.height;
  return (
    Number.isFinite(right) &&
    right > value.x &&
    Number.isFinite(bottom) &&
    bottom > value.y
  );
}

function isAnnotationPoint(value: unknown): value is AnnotationPoint {
  return (
    isRecord(value) &&
    value.type === 'point' &&
    value.coordinateSpace === 'normalized_1e6' &&
    Number.isSafeInteger(value.x) &&
    typeof value.x === 'number' &&
    value.x >= 0 &&
    value.x <= ANNOTATION_COORDINATE_SCALE &&
    Number.isSafeInteger(value.y) &&
    typeof value.y === 'number' &&
    value.y >= 0 &&
    value.y <= ANNOTATION_COORDINATE_SCALE
  );
}

/**
 * Computes the CSS-pixel rectangle for an object-fit: contain image,
 * centered in the viewport, then scaled around its center and translated by pan.
 * Invalid, stale, zero-sized, or overflowing inputs return null.
 */
export function getAnnotationImageRect(
  context: AnnotationCoordinateContext,
): AnnotationImageRect | null {
  if (!isRecord(context)) return null;

  const { viewport, source, zoom, pan } = context;
  if (
    !isValidViewport(viewport) ||
    !isPositiveSize(source) ||
    !isFiniteNumber(zoom) ||
    zoom < 1 ||
    !isFinitePoint(pan)
  ) {
    return null;
  }

  const fitScale = Math.min(
    viewport.width / source.width,
    viewport.height / source.height,
  );
  if (!Number.isFinite(fitScale) || fitScale <= 0) return null;

  const width = source.width * fitScale * zoom;
  const height = source.height * fitScale * zoom;
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null;
  }

  const centerX = viewport.x + viewport.width / 2 + pan.x;
  const centerY = viewport.y + viewport.height / 2 + pan.y;
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  const right = x + width;
  const bottom = y + height;

  if (
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(right) ||
    right <= x ||
    !Number.isFinite(bottom) ||
    bottom <= y
  ) {
    return null;
  }

  return { x, y, width, height, right, bottom };
}

function containsInclusive(
  point: AnnotationClientPoint,
  bounds: Pick<AnnotationImageRect, 'x' | 'y' | 'right' | 'bottom'>,
): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.right &&
    point.y >= bounds.y &&
    point.y <= bounds.bottom
  );
}

function quantizeCoordinate(
  position: number,
  start: number,
  end: number,
): number | null {
  if (position === start) return 0;
  if (position === end) return ANNOTATION_COORDINATE_SCALE;

  const fraction = (position - start) / (end - start);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;

  const coordinate = Math.round(fraction * ANNOTATION_COORDINATE_SCALE);
  return Number.isSafeInteger(coordinate) ? coordinate : null;
}

/**
 * Maps a client-space pointer to integer millionths of the oriented source image.
 * Both the viewport and image rectangle use inclusive edges. Letterbox padding,
 * clipped image portions, and invalid inputs are rejected instead of clamped.
 */
export function clientPointToAnnotationPoint(
  clientPoint: AnnotationClientPoint,
  context: AnnotationCoordinateContext,
): AnnotationPoint | null {
  if (
    !isFinitePoint(clientPoint) ||
    !isRecord(context) ||
    !isValidViewport(context.viewport)
  ) {
    return null;
  }

  const imageRect = getAnnotationImageRect(context);
  if (
    !imageRect ||
    !containsInclusive(clientPoint, {
      x: context.viewport.x,
      y: context.viewport.y,
      right: context.viewport.x + context.viewport.width,
      bottom: context.viewport.y + context.viewport.height,
    }) ||
    !containsInclusive(clientPoint, imageRect)
  ) {
    return null;
  }

  const x = quantizeCoordinate(clientPoint.x, imageRect.x, imageRect.right);
  const y = quantizeCoordinate(clientPoint.y, imageRect.y, imageRect.bottom);
  if (x === null || y === null) return null;

  return {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x,
    y,
  };
}

/**
 * Maps a normalized annotation point back to the current image's CSS-pixel
 * position. Reusing the same geometry with a new context handles resize, zoom,
 * and pan without changing its logical image coordinates.
 */
export function annotationPointToClientPoint(
  point: AnnotationPoint,
  context: AnnotationCoordinateContext,
): AnnotationClientPoint | null {
  if (!isAnnotationPoint(point)) return null;

  const imageRect = getAnnotationImageRect(context);
  if (!imageRect) return null;

  const x =
    point.x === 0
      ? imageRect.x
      : point.x === ANNOTATION_COORDINATE_SCALE
        ? imageRect.right
        : imageRect.x +
          (point.x / ANNOTATION_COORDINATE_SCALE) * imageRect.width;
  const y =
    point.y === 0
      ? imageRect.y
      : point.y === ANNOTATION_COORDINATE_SCALE
        ? imageRect.bottom
        : imageRect.y +
          (point.y / ANNOTATION_COORDINATE_SCALE) * imageRect.height;

  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Builds a positive-area normalized rectangle from either drag direction. */
export function createAnnotationRectangle(
  start: AnnotationPoint,
  end: AnnotationPoint,
): AnnotationRectangle | null {
  if (!isAnnotationPoint(start) || !isAnnotationPoint(end)) return null;

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) return null;

  return {
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x,
    y,
    width,
    height,
  };
}
