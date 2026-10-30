import { z } from 'zod';
export const galleryPhotoSchema = z
  .object({
    id: z.uuid(),
    versionId: z.uuid(),
    filename: z.string().min(1).max(255),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    createdAt: z.iso.datetime(),
    processing: z.enum([
      'queued',
      'running',
      'retryable',
      'needs_review',
      'abandoned',
      'succeeded',
      'unsupported',
      'unavailable',
    ]),
    thumbnailUrl: z
      .string()
      .regex(
        /^\/api\/(?:v1\/photos|guest\/photos)\/[a-f0-9-]+\/versions\/[a-f0-9-]+\/assets\/thumbnail$/,
      )
      .nullable(),
    previewUrl: z
      .string()
      .regex(
        /^\/api\/(?:v1\/photos|guest\/photos)\/[a-f0-9-]+\/versions\/[a-f0-9-]+\/assets\/preview$/,
      )
      .nullable(),
  })
  .strict();
export const galleryPageSchema = z
  .object({
    photos: z.array(galleryPhotoSchema).max(24),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type GalleryPhoto = z.infer<typeof galleryPhotoSchema>;
