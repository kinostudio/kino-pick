import { z } from 'zod';

export const resolvedBatchUploadCapabilitiesSchema = z
  .object({
    enabled: z.boolean(),
    maxFiles: z.literal(1000),
    pageSize: z.literal(24),
  })
  .strict();

export type ResolvedBatchUploadsCapabilities = z.infer<
  typeof resolvedBatchUploadCapabilitiesSchema
>;
