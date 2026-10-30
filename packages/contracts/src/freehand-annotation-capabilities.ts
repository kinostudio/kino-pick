import { z } from 'zod';

/**
 * Reports whether this Worker can accept freehand annotation writes.
 * This global capability is not authorization to read or write any annotation.
 */
export const freehandAnnotationWriteCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type FreehandAnnotationWriteCapabilities = z.infer<
  typeof freehandAnnotationWriteCapabilitiesSchema
>;
