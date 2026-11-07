import { z } from 'zod';

export const MAX_ZIP_FILES = 24;
export const MAX_ZIP_BYTES = 64 * 1024 * 1024;
export const ZIP_TTL_MS = 15 * 60 * 1000;
export const zipDeliveryIdsSchema = z
  .array(z.uuid().transform((id) => id.toLowerCase()))
  .min(1)
  .max(MAX_ZIP_FILES)
  .refine((ids) => new Set(ids).size === ids.length);
export const createDeliveryZipSchema = z
  .object({
    requestId: z.uuid(),
    expectedGuestId: z.uuid(),
    deliveryIds: zipDeliveryIdsSchema,
  })
  .strict();
export const zipItemSchema = z
  .object({
    deliveryId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    versionNo: z.number().int().positive().safe(),
    assetId: z.uuid(),
    filename: z.string().min(1).max(255),
    byteSize: z.number().int().positive().safe(),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    entryName: z
      .string()
      .min(1)
      .max(240)
      .refine((name) => !/[\\/:\p{Cc}]/u.test(name)),
  })
  .strict();
export const zipManifestSchema = z
  .object({
    deliveryIds: zipDeliveryIdsSchema,
    items: z.array(zipItemSchema).min(1).max(MAX_ZIP_FILES),
    expiresAtMs: z.number().int().positive().safe(),
  })
  .strict();
export const deliveryZipSchema = z
  .object({
    id: z.uuid(),
    albumId: z.uuid(),
    expiresAt: z.iso.datetime(),
    fileCount: z.number().int().min(1).max(MAX_ZIP_FILES),
    totalBytes: z.number().int().positive().max(MAX_ZIP_BYTES),
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(240),
            versionNo: z.number().int().positive(),
            byteSize: z.number().int().positive().safe(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ZIP_FILES),
  })
  .strict();
export type ZipItem = z.infer<typeof zipItemSchema>;
