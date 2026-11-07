import { z } from 'zod';

export const captureMetadataSchema = z
  .object({
    cameraModel: z.string().min(1).max(128).nullable(),
    lensModel: z.string().min(1).max(128).nullable(),
    fNumber: z.number().positive().finite().nullable(),
    exposureSeconds: z.number().positive().finite().nullable(),
    iso: z.number().int().positive().safe().nullable(),
  })
  .strict();

export type CaptureMetadata = z.infer<typeof captureMetadataSchema>;
