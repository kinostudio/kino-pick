import { z } from 'zod';

const controlCharacters = /[\p{Cc}\p{Cf}]/u;
const maxLabelCodePoints = 40;

export const guestTagLabelSchema = z
  .string()
  .transform((label) => label.normalize('NFC').trim())
  .superRefine((label, ctx) => {
    if (label.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Tag label cannot be empty' });
    }
    if (controlCharacters.test(label)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Tag label cannot contain control characters',
      });
    }
    if ([...label].length > maxLabelCodePoints) {
      ctx.addIssue({
        code: 'custom',
        message: 'Tag label cannot exceed 40 Unicode code points',
      });
    }
  });

export const guestTagPhotoIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(24)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate photo IDs');

export const guestTagCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const guestTagRequestSchema = z
  .object({
    requestId: z.uuid(),
    expectedGuestId: z.uuid(),
    versionId: z.uuid(),
    label: guestTagLabelSchema,
    present: z.boolean(),
  })
  .strict();

export const guestTagItemSchema = z
  .object({
    tagId: z.uuid(),
    label: guestTagLabelSchema,
    versionId: z.uuid(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const guestTagStateSchema = z
  .object({
    photoId: z.uuid(),
    tags: z.array(guestTagItemSchema).max(20),
  })
  .strict();

export const guestTagPageSchema = z
  .object({
    guestId: z.uuid(),
    items: z.array(guestTagStateSchema).max(24),
  })
  .strict();

export const guestTagResultSchema = z
  .object({
    guestId: z.uuid(),
    photoId: z.uuid(),
    tagId: z.uuid().nullable(),
    label: guestTagLabelSchema,
    present: z.boolean(),
    versionId: z.uuid(),
    changed: z.boolean(),
    eventId: z.string().max(128).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export type GuestTagRequest = z.infer<typeof guestTagRequestSchema>;
export type GuestTagItem = z.infer<typeof guestTagItemSchema>;
export type GuestTagState = z.infer<typeof guestTagStateSchema>;
export type GuestTagResult = z.infer<typeof guestTagResultSchema>;
export type GuestTagPage = z.infer<typeof guestTagPageSchema>;
