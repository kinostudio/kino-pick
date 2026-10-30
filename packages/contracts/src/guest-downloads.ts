import { z } from 'zod';

export const guestDownloadKindSchema = z.enum(['preview', 'original']);

export const guestDownloadsQuerySchema = z
  .object({ cursor: z.uuid().optional() })
  .strict();

export const guestDownloadAccessSchema = z
  .object({
    guestId: z.uuid(),
    inviteId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    expiresAt: z.iso.datetime(),
    permissions: z
      .object({
        can_view: z.boolean(),
        can_download_preview: z.boolean(),
        can_download_original: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const guestDownloadFileSchema = z
  .object({
    filename: z.string().min(1).max(512),
    byteSize: z.number().int().positive().safe().max(5_363_466_240),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  })
  .strict();

export const guestDownloadPhotoSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    versionNo: z.number().int().positive().safe(),
    filename: z.string().min(1).max(255),
    preview: guestDownloadFileSchema.nullable(),
    original: guestDownloadFileSchema.nullable(),
  })
  .strict()
  .superRefine((photo, context) => {
    if (photo.preview === null && photo.original === null)
      context.addIssue({
        code: 'custom',
        message: 'At least one downloadable asset is required',
      });
    if (photo.preview !== null && photo.preview.mime !== 'image/jpeg')
      context.addIssue({
        code: 'custom',
        path: ['preview', 'mime'],
        message: 'Previews must use JPEG',
      });
  });

export const guestDownloadsPageSchema = z
  .object({
    access: guestDownloadAccessSchema,
    photos: z.array(guestDownloadPhotoSchema).max(24),
    nextCursor: z.uuid().nullable(),
  })
  .strict();

export const guestMediaDownloadAuditSchema = z
  .object({
    assetKind: guestDownloadKindSchema,
    assetId: z.uuid(),
    filename: z.string().min(1).max(255),
    byteSize: z.number().int().positive().safe().max(5_363_466_240),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  })
  .strict();

export function guestDownloadFilename(
  sourceFilename: string,
  kind: z.infer<typeof guestDownloadKindSchema>,
) {
  const source = z.string().min(1).max(255).parse(sourceFilename);
  if (kind === 'original') return source;
  const stem = source.replace(/\.(?:jpe?g|png|webp)$/i, '');
  return [...stem].slice(0, 100).join('') + '.preview.jpg';
}

export type GuestDownloadKind = z.infer<typeof guestDownloadKindSchema>;
export type GuestDownloadsQuery = z.infer<typeof guestDownloadsQuerySchema>;
export type GuestDownloadAccess = z.infer<typeof guestDownloadAccessSchema>;
export type GuestDownloadFile = z.infer<typeof guestDownloadFileSchema>;
export type GuestDownloadPhoto = z.infer<typeof guestDownloadPhotoSchema>;
export type GuestDownloadsPage = z.infer<typeof guestDownloadsPageSchema>;
export type GuestMediaDownloadAudit = z.infer<
  typeof guestMediaDownloadAuditSchema
>;
