import { z } from 'zod';

export const annotationStyleSchema = z
  .object({ color: z.enum(['amber', 'red', 'blue']) })
  .strict();

export type AnnotationStyle = z.infer<typeof annotationStyleSchema>;
