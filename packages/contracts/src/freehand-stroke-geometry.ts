import { z } from 'zod';
import { ANNOTATION_COORDINATE_SCALE } from './annotation-coordinate-scale.ts';

export const FREEHAND_STROKE_MAX_POINTS = 256 as const;
export const FREEHAND_STROKE_MAX_JSON_BYTES = 8_192 as const;

const coordinate = z
  .number()
  .finite()
  .int()
  .safe()
  .min(0)
  .max(ANNOTATION_COORDINATE_SCALE);

export const freehandStrokePointSchema = z
  .object({
    x: coordinate,
    y: coordinate,
  })
  .strict();

export const freehandStrokeGeometrySchema = z
  .object({
    type: z.literal('freehand'),
    coordinateSpace: z.literal('normalized_1e6'),
    version: z.literal(1),
    points: z
      .array(freehandStrokePointSchema)
      .min(2)
      .max(FREEHAND_STROKE_MAX_POINTS),
  })
  .strict()
  .superRefine((geometry, ctx) => {
    for (let index = 1; index < geometry.points.length; index += 1) {
      const previous = geometry.points[index - 1]!;
      const current = geometry.points[index]!;

      if (previous.x === current.x && previous.y === current.y)
        ctx.addIssue({
          code: 'custom',
          path: ['points', index],
          message: 'Consecutive freehand points must be distinct',
        });
    }

    const serializedBytes = new TextEncoder().encode(
      JSON.stringify(geometry),
    ).byteLength;
    if (serializedBytes > FREEHAND_STROKE_MAX_JSON_BYTES)
      ctx.addIssue({
        code: 'custom',
        path: ['points'],
        message: 'Freehand geometry exceeds the JSON byte limit',
      });
  });

export type FreehandStrokePoint = z.infer<typeof freehandStrokePointSchema>;
export type FreehandStrokeGeometry = z.infer<
  typeof freehandStrokeGeometrySchema
>;
