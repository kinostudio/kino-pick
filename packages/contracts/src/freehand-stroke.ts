import { z } from 'zod';
import { annotationStyleSchema } from './annotation-style.ts';
import { freehandStrokeGeometrySchema } from './freehand-stroke-geometry.ts';

export {
  FREEHAND_STROKE_MAX_JSON_BYTES,
  FREEHAND_STROKE_MAX_POINTS,
  freehandStrokeGeometrySchema,
  freehandStrokePointSchema,
} from './freehand-stroke-geometry.ts';
export type {
  FreehandStrokeGeometry,
  FreehandStrokePoint,
} from './freehand-stroke-geometry.ts';

export const freehandStrokeSchema = z
  .object({
    geometry: freehandStrokeGeometrySchema,
    style: annotationStyleSchema,
  })
  .strict();

export type FreehandStroke = z.infer<typeof freehandStrokeSchema>;
