import { z } from 'zod';

const positiveSafeInteger = z.number().int().positive().safe();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();

export const photoVersionProcessingSchema = z.enum([
  'queued',
  'running',
  'retryable',
  'needs_review',
  'abandoned',
  'succeeded',
  'unsupported',
  'unavailable',
]);

export const photoVersionsCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const photoVersionHeadSchema = z
  .object({
    versionId: z.uuid(),
    revision: nonnegativeSafeInteger,
  })
  .strict();

const ownerPhotoAssetRoutePattern =
  /^\/api\/v1\/photos\/([^/]+)\/versions\/([^/]+)\/assets\/(thumbnail|preview)$/;

function parseOwnerPhotoAssetRoute(value: string) {
  const match = ownerPhotoAssetRoutePattern.exec(value);
  if (!match) return null;
  if (!z.uuid().safeParse(match[1]).success) return null;
  if (!z.uuid().safeParse(match[2]).success) return null;

  return {
    photoId: match[1],
    versionId: match[2],
    kind: match[3] as 'thumbnail' | 'preview',
  };
}

const ownerPhotoAssetRouteSchema = z.string().superRefine((value, ctx) => {
  if (!parseOwnerPhotoAssetRoute(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Expected an Owner photo asset route',
    });
  }
});

const ownerThumbnailRouteSchema = ownerPhotoAssetRouteSchema.refine(
  (value) => parseOwnerPhotoAssetRoute(value)?.kind === 'thumbnail',
  'Expected the Owner thumbnail asset route',
);

const ownerPreviewRouteSchema = ownerPhotoAssetRouteSchema.refine(
  (value) => parseOwnerPhotoAssetRoute(value)?.kind === 'preview',
  'Expected the Owner preview asset route',
);

export const photoVersionItemSchema = z
  .object({
    id: z.uuid(),
    versionNo: positiveSafeInteger,
    createdAt: z.iso.datetime(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    processing: photoVersionProcessingSchema,
    thumbnailUrl: ownerThumbnailRouteSchema.nullable(),
    previewUrl: ownerPreviewRouteSchema.nullable(),
  })
  .strict();

export const ownerPhotoVersionsPageSchema = z
  .object({
    photoId: z.uuid(),
    current: photoVersionHeadSchema,
    currentVersion: photoVersionItemSchema,
    versions: z.array(photoVersionItemSchema).max(24),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.currentVersion.id !== page.current.versionId) {
      ctx.addIssue({
        code: 'custom',
        message: 'currentVersion must match the current head',
        path: ['currentVersion', 'id'],
      });
    }

    for (const [field, url] of [
      ['thumbnailUrl', page.currentVersion.thumbnailUrl],
      ['previewUrl', page.currentVersion.previewUrl],
    ] as const) {
      if (url === null) continue;

      const route = parseOwnerPhotoAssetRoute(url);
      if (
        route === null ||
        route.photoId !== page.photoId ||
        route.versionId !== page.currentVersion.id
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Current asset route must match its photo and version',
          path: ['currentVersion', field],
        });
      }
    }

    page.versions.forEach((version, index) => {
      for (const [field, url] of [
        ['thumbnailUrl', version.thumbnailUrl],
        ['previewUrl', version.previewUrl],
      ] as const) {
        if (url === null) continue;

        const route = parseOwnerPhotoAssetRoute(url);
        if (
          route === null ||
          route.photoId !== page.photoId ||
          route.versionId !== version.id
        ) {
          ctx.addIssue({
            code: 'custom',
            message: 'Asset route must match its photo and version',
            path: ['versions', index, field],
          });
        }
      }
    });
  });

export const setCurrentPhotoVersionSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: nonnegativeSafeInteger,
    expectedCurrentVersionId: z.uuid(),
    versionId: z.uuid(),
    confirm: z.literal(true),
  })
  .strict();

export const setCurrentPhotoVersionResultSchema = z
  .object({
    photoId: z.uuid(),
    current: photoVersionHeadSchema,
    changed: z.boolean(),
    eventId: z.string().min(1).max(128).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .refine((result) => result.changed === (result.eventId !== null), {
    message: 'eventId must be present exactly when the current version changed',
    path: ['eventId'],
  });

export type PhotoVersionsCapabilities = z.infer<
  typeof photoVersionsCapabilitiesSchema
>;
export type PhotoVersionHead = z.infer<typeof photoVersionHeadSchema>;
export type PhotoVersionItem = z.infer<typeof photoVersionItemSchema>;
export type OwnerPhotoVersionsPage = z.infer<
  typeof ownerPhotoVersionsPageSchema
>;
export type SetCurrentPhotoVersion = z.infer<
  typeof setCurrentPhotoVersionSchema
>;
export type SetCurrentPhotoVersionResult = z.infer<
  typeof setCurrentPhotoVersionResultSchema
>;
