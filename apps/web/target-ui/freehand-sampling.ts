import {
  FREEHAND_STROKE_MAX_POINTS,
  freehandStrokeGeometrySchema,
  type FreehandStrokeGeometry,
  type FreehandStrokePoint,
} from '../../../packages/contracts/src/freehand-stroke.ts';
import {
  clientPointToAnnotationPoint,
  type AnnotationClientPoint,
  type AnnotationCoordinateContext,
} from './annotation-coordinates.ts';

/**
 * Caps raw pointer samples before normalization/simplification to bound work.
 * Callers should cancel a stroke when this limit is exceeded.
 */
export const FREEHAND_STROKE_MAX_INPUT_POINTS = 16_384 as const;

function simplifyLargestTriangleThreeBuckets(
  points: readonly FreehandStrokePoint[],
  threshold: number,
): FreehandStrokePoint[] {
  if (points.length <= threshold) return [...points];

  const every = (points.length - 2) / (threshold - 2);
  const sampled: FreehandStrokePoint[] = [points[0]!];
  let selectedIndex = 0;

  for (let bucketIndex = 0; bucketIndex < threshold - 2; bucketIndex += 1) {
    const averageStart = Math.floor((bucketIndex + 1) * every) + 1;
    const averageEnd = Math.min(
      Math.floor((bucketIndex + 2) * every) + 1,
      points.length,
    );

    let averageX = 0;
    let averageY = 0;
    const averageCount = averageEnd - averageStart;
    for (let index = averageStart; index < averageEnd; index += 1) {
      averageX += points[index]!.x;
      averageY += points[index]!.y;
    }
    averageX /= averageCount;
    averageY /= averageCount;

    const candidateStart = Math.floor(bucketIndex * every) + 1;
    const candidateEnd = Math.min(
      Math.floor((bucketIndex + 1) * every) + 1,
      points.length - 1,
    );
    const previous = points[selectedIndex]!;
    let bestIndex = candidateStart;
    let largestArea = -1;

    for (
      let candidateIndex = candidateStart;
      candidateIndex < candidateEnd;
      candidateIndex += 1
    ) {
      const candidate = points[candidateIndex]!;
      const area = Math.abs(
        (previous.x - averageX) * (candidate.y - previous.y) -
          (previous.x - candidate.x) * (averageY - previous.y),
      );
      // Strict comparison makes equal-area ties choose the earliest point.
      if (area > largestArea) {
        largestArea = area;
        bestIndex = candidateIndex;
      }
    }

    sampled.push(points[bestIndex]!);
    selectedIndex = bestIndex;
  }

  sampled.push(points[points.length - 1]!);
  return sampled;
}

/**
 * Converts client-space samples to oriented normalized image coordinates,
 * removes adjacent duplicates, and deterministically reduces long paths.
 * Any invalid or out-of-image sample cancels the entire path; points are never
 * clamped into the image. Returns geometry only, without style or image bytes.
 */
export function sampleFreehandStroke(
  clientPoints: readonly AnnotationClientPoint[],
  context: AnnotationCoordinateContext,
): FreehandStrokeGeometry | null {
  if (
    !Array.isArray(clientPoints) ||
    clientPoints.length < 1 ||
    clientPoints.length > FREEHAND_STROKE_MAX_INPUT_POINTS
  ) {
    return null;
  }

  const normalizedPoints: FreehandStrokePoint[] = [];
  for (const clientPoint of clientPoints) {
    const normalized = clientPointToAnnotationPoint(
      clientPoint as AnnotationClientPoint,
      context,
    );
    if (!normalized) return null;

    const previous = normalizedPoints[normalizedPoints.length - 1];
    if (
      !previous ||
      previous.x !== normalized.x ||
      previous.y !== normalized.y
    ) {
      normalizedPoints.push({ x: normalized.x, y: normalized.y });
    }
  }

  if (normalizedPoints.length < 2) return null;

  const points =
    normalizedPoints.length <= FREEHAND_STROKE_MAX_POINTS
      ? normalizedPoints
      : simplifyLargestTriangleThreeBuckets(
          normalizedPoints,
          FREEHAND_STROKE_MAX_POINTS,
        );
  const distinctPoints: FreehandStrokePoint[] = [];
  for (const point of points) {
    const previous = distinctPoints[distinctPoints.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      distinctPoints.push(point);
    }
  }
  if (distinctPoints.length < 2) return null;

  const geometry: FreehandStrokeGeometry = {
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points: distinctPoints,
  };

  const parsed = freehandStrokeGeometrySchema.safeParse(geometry);
  return parsed.success ? parsed.data : null;
}
