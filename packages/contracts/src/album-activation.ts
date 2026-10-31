import { z } from 'zod';

export const activateAlbumSchema = z
  .object({
    requestId: z.uuid().transform((value) => value.toLowerCase()),
    expectedRevision: z.number().int().min(1).max(2147483646),
    confirmActivate: z.literal(true),
  })
  .strict();

export type ActivateAlbumInput = z.infer<typeof activateAlbumSchema>;
