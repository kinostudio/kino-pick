import { z } from 'zod';

const lowerUuidSchema = z.uuid().transform((value) => value.toLowerCase());
const revisionSchema = z.number().int().safe().min(0);

export const photoPinSchema = z
  .object({
    photoId: z.uuid(),
    albumId: z.uuid(),
    isPinned: z.boolean(),
    revision: revisionSchema,
  })
  .strict();

export const setPhotoPinSchema = z
  .object({
    requestId: lowerUuidSchema,
    expectedRevision: revisionSchema,
    isPinned: z.boolean(),
  })
  .strict();

export const setPhotoPinResultSchema = z
  .object({
    photo: photoPinSchema,
    changed: z.boolean(),
    eventId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.changed !== (value.eventId !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Changed pin state requires exactly one audit event',
      });
    }
  });

export type PhotoPin = z.infer<typeof photoPinSchema>;
export type SetPhotoPin = z.infer<typeof setPhotoPinSchema>;
export type SetPhotoPinResult = z.infer<typeof setPhotoPinResultSchema>;
