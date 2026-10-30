import { z } from 'zod';

export const guestFeedbackPhotoIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(24)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate photo IDs');
export const guestFeedbackCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export const guestRatingRequestSchema = z
  .object({
    requestId: z.uuid(),
    versionId: z.uuid(),
    stars: z.number().int().min(1).max(5).nullable(),
  })
  .strict();
export const guestFavoriteRequestSchema = z
  .object({ requestId: z.uuid(), versionId: z.uuid(), favored: z.boolean() })
  .strict();
export const guestRatingStateSchema = z
  .object({
    photoId: z.uuid(),
    stars: z.number().int().min(1).max(5).nullable(),
    versionId: z.uuid().nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const guestFavoriteStateSchema = z
  .object({
    photoId: z.uuid(),
    favored: z.boolean(),
    versionId: z.uuid().nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const guestRatingResultSchema = guestRatingStateSchema
  .extend({
    eventId: z.string().min(1).max(128).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export const guestFavoriteResultSchema = guestFavoriteStateSchema
  .extend({
    eventId: z.string().min(1).max(128).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export const guestRatingPageSchema = z
  .object({ items: z.array(guestRatingStateSchema).max(24) })
  .strict();
export const guestFavoritePageSchema = z
  .object({ items: z.array(guestFavoriteStateSchema).max(24) })
  .strict();
export type GuestRatingState = z.infer<typeof guestRatingStateSchema>;
export type GuestFavoriteState = z.infer<typeof guestFavoriteStateSchema>;
