import {
  annotationGeometrySchema,
  type AnnotationGeometry,
} from '../../../packages/contracts/src/annotation-geometry.ts';
import { canonicalFreehandStrokeGeometryJson } from './freehand-canonical.ts';

function invalidGeometry(): never {
  throw new TypeError('INVALID_ANNOTATION_GEOMETRY');
}

type PointOrRectangleAnnotationGeometry = Extract<
  AnnotationGeometry,
  { type: 'point' | 'rectangle' }
>;

function canonicalPointOrRectangle(
  geometry: PointOrRectangleAnnotationGeometry,
): PointOrRectangleAnnotationGeometry {
  if (geometry.type === 'point')
    return {
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: geometry.x,
      y: geometry.y,
    };
  return {
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  };
}

/**
 * Strictly validate and serialize one v1 annotation geometry.
 *
 * This helper is intentionally isolated from the Guest/Owner command paths
 * until their serializers and database guards are explicitly upgraded.
 */
export function canonicalAnnotationGeometryV1Json(input: unknown): string {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return invalidGeometry();

  if (Reflect.get(input, 'type') === 'freehand')
    return canonicalFreehandStrokeGeometryJson(input);

  const parsed = annotationGeometrySchema.safeParse(input);
  if (!parsed.success) return invalidGeometry();

  if (parsed.data.type === 'freehand')
    return canonicalFreehandStrokeGeometryJson(parsed.data);

  return JSON.stringify(canonicalPointOrRectangle(parsed.data));
}
