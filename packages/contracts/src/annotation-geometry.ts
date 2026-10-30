import { z } from 'zod';
import { ANNOTATION_COORDINATE_SCALE } from './annotation-coordinate-scale.ts';
import { freehandStrokeGeometrySchema } from './freehand-stroke-geometry.ts';
export { ANNOTATION_COORDINATE_SCALE } from './annotation-coordinate-scale.ts';

const coordinate = z
  .number()
  .finite()
  .int()
  .safe()
  .min(0)
  .max(ANNOTATION_COORDINATE_SCALE);
const extent = z
  .number()
  .finite()
  .int()
  .safe()
  .min(1)
  .max(ANNOTATION_COORDINATE_SCALE);

export const annotationGeometrySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('point'),
      coordinateSpace: z.literal('normalized_1e6'),
      x: coordinate,
      y: coordinate,
    })
    .strict(),
  z
    .object({
      type: z.literal('rectangle'),
      coordinateSpace: z.literal('normalized_1e6'),
      x: coordinate,
      y: coordinate,
      width: extent,
      height: extent,
    })
    .strict()
    .superRefine((rectangle, ctx) => {
      if (rectangle.x + rectangle.width > ANNOTATION_COORDINATE_SCALE)
        ctx.addIssue({
          code: 'custom',
          path: ['width'],
          message: 'Rectangle extends beyond normalized image width',
        });
      if (rectangle.y + rectangle.height > ANNOTATION_COORDINATE_SCALE)
        ctx.addIssue({
          code: 'custom',
          path: ['height'],
          message: 'Rectangle extends beyond normalized image height',
        });
    }),
  freehandStrokeGeometrySchema,
]);

export type AnnotationGeometry = z.infer<typeof annotationGeometrySchema>;
