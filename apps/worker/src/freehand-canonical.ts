import {
  FREEHAND_STROKE_MAX_JSON_BYTES,
  freehandStrokeGeometrySchema,
  type FreehandStrokeGeometry,
} from '../../../packages/contracts/src/freehand-stroke-geometry.ts';
import {
  annotationGeometrySchema,
  type AnnotationGeometry,
} from '../../../packages/contracts/src/annotation-geometry';

/**
 * Serialize a validated freehand geometry in its stable field and point order.
 */
export function canonicalFreehandStrokeGeometryJson(input: unknown): string {
  const parsed = freehandStrokeGeometrySchema.safeParse(input);
  if (!parsed.success) throw new TypeError('INVALID_FREEHAND_GEOMETRY');

  const canonical: FreehandStrokeGeometry = {
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points: parsed.data.points.map(({ x, y }) => ({ x, y })),
  };
  const json = JSON.stringify(canonical);

  if (
    new TextEncoder().encode(json).byteLength > FREEHAND_STROKE_MAX_JSON_BYTES
  )
    throw new TypeError('FREEHAND_GEOMETRY_TOO_LARGE');

  return json;
}

/**
 * Return the versioned canonical shape used by both Guest and Owner commands.
 * Existing point/rectangle field order is kept unchanged for replay stability.
 */
export function canonicalAnnotationGeometry(
  input: unknown,
): AnnotationGeometry {
  const parsed = annotationGeometrySchema.safeParse(input);
  if (!parsed.success) throw new TypeError('INVALID_ANNOTATION_GEOMETRY');

  const geometry = parsed.data;
  if (geometry.type === 'freehand') {
    return JSON.parse(
      canonicalFreehandStrokeGeometryJson(geometry),
    ) as FreehandStrokeGeometry;
  }
  if (geometry.type === 'point') {
    return {
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: geometry.x,
      y: geometry.y,
    };
  }
  return {
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  };
}

export function canonicalAnnotationGeometryJson(input: unknown): string {
  return JSON.stringify(canonicalAnnotationGeometry(input));
}
