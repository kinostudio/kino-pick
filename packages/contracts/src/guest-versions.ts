import { z } from 'zod';

const positiveSafeInteger = z.number().int().positive().safe();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const dimension = positiveSafeInteger.max(32_768).nullable();

const guestPhotoAssetRoutePattern =
  /^\/api\/guest\/photos\/([^/]+)\/versions\/([^/]+)\/assets\/(thumbnail|preview)$/;

type GuestPhotoAssetRoute = {
  photoId: string;
  versionId: string;
  kind: 'thumbnail' | 'preview';
};

function parseGuestPhotoAssetRoute(value: string): GuestPhotoAssetRoute | null {
  const match = guestPhotoAssetRoutePattern.exec(value);
  if (!match || match[0] !== value) return null;
  const photoId = match[1];
  const versionId = match[2];
  if (typeof photoId !== 'string' || typeof versionId !== 'string') return null;
  if (!z.uuid().safeParse(photoId).success) return null;
  if (!z.uuid().safeParse(versionId).success) return null;

  return {
    photoId,
    versionId,
    kind: match[3] as GuestPhotoAssetRoute['kind'],
  };
}

const guestPhotoAssetRouteSchema = z.string().superRefine((value, ctx) => {
  if (!parseGuestPhotoAssetRoute(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Expected a same-origin Guest photo asset route',
    });
  }
});

const guestThumbnailRouteSchema = guestPhotoAssetRouteSchema.refine(
  (value) => parseGuestPhotoAssetRoute(value)?.kind === 'thumbnail',
  'Expected the Guest thumbnail asset route',
);

const guestPreviewRouteSchema = guestPhotoAssetRouteSchema.refine(
  (value) => parseGuestPhotoAssetRoute(value)?.kind === 'preview',
  'Expected the Guest preview asset route',
);

export const guestVersionComparisonCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const guestPhotoVersionSchema = z
  .object({
    versionId: z.uuid(),
    versionNo: positiveSafeInteger,
    width: dimension,
    height: dimension,
    createdAt: z.iso.datetime(),
    createdByLabel: z.literal('攝影師'),
    labels: z
      .array(
        z
          .string()
          .refine(
            (value) =>
              value === value.normalize('NFC').trim() &&
              Array.from(value).length >= 1 &&
              Array.from(value).length <= 40 &&
              !/[\p{Cc}\p{Cf}]/u.test(value),
          ),
      )
      .max(16)
      .refine((values) => new Set(values).size === values.length),
    isCurrent: z.boolean(),
    thumbnailUrl: guestThumbnailRouteSchema,
    previewUrl: guestPreviewRouteSchema,
  })
  .strict()
  .superRefine((version, ctx) => {
    if ((version.width === null) !== (version.height === null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Image dimensions must both be present or both be null',
        path: ['height'],
      });
    }

    if (
      version.width !== null &&
      version.height !== null &&
      version.width * version.height > 80_000_000
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Image dimensions exceed the supported pixel limit',
        path: ['width'],
      });
    }

    for (const [field, url] of [
      ['thumbnailUrl', version.thumbnailUrl],
      ['previewUrl', version.previewUrl],
    ] as const) {
      const route = parseGuestPhotoAssetRoute(url);
      if (route === null || route.versionId !== version.versionId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Asset route must match its version',
          path: [field],
        });
      }
    }
  });

const guestPhotoVersionHeadSchema = z
  .object({
    versionId: z.uuid(),
    revision: nonnegativeSafeInteger,
  })
  .strict();

export const guestPhotoVersionsPageSchema = z
  .object({
    albumId: z.uuid(),
    photoId: z.uuid(),
    head: guestPhotoVersionHeadSchema,
    currentVersion: guestPhotoVersionSchema.nullable(),
    versions: z.array(guestPhotoVersionSchema).max(24),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.currentVersion !== null) {
      if (page.currentVersion.versionId !== page.head.versionId) {
        ctx.addIssue({
          code: 'custom',
          message: 'currentVersion must match the page head',
          path: ['currentVersion', 'versionId'],
        });
      }
      if (!page.currentVersion.isCurrent) {
        ctx.addIssue({
          code: 'custom',
          message: 'currentVersion must be marked current',
          path: ['currentVersion', 'isCurrent'],
        });
      }

      for (const [field, url] of [
        ['thumbnailUrl', page.currentVersion.thumbnailUrl],
        ['previewUrl', page.currentVersion.previewUrl],
      ] as const) {
        const route = parseGuestPhotoAssetRoute(url);
        if (
          route === null ||
          route.photoId !== page.photoId ||
          route.versionId !== page.currentVersion.versionId
        ) {
          ctx.addIssue({
            code: 'custom',
            message: 'Current asset route must match its photo and version',
            path: ['currentVersion', field],
          });
        }
      }
    }

    const versionIds = new Set<string>();
    const versionNos = new Set<number>();

    page.versions.forEach((version, index) => {
      if (versionIds.has(version.versionId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Version IDs must be unique within a page',
          path: ['versions', index, 'versionId'],
        });
      }
      versionIds.add(version.versionId);

      if (versionNos.has(version.versionNo)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Version numbers must be unique within a page',
          path: ['versions', index, 'versionNo'],
        });
      }
      versionNos.add(version.versionNo);

      if (
        index > 0 &&
        page.versions[index - 1]!.versionNo <= version.versionNo
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Versions must be ordered by descending version number',
          path: ['versions', index, 'versionNo'],
        });
      }

      if (version.isCurrent !== (version.versionId === page.head.versionId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'isCurrent must match the page head',
          path: ['versions', index, 'isCurrent'],
        });
      }

      for (const [field, url] of [
        ['thumbnailUrl', version.thumbnailUrl],
        ['previewUrl', version.previewUrl],
      ] as const) {
        const route = parseGuestPhotoAssetRoute(url);
        if (
          route === null ||
          route.photoId !== page.photoId ||
          route.versionId !== version.versionId
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

export type GuestPhotoVersion = z.infer<typeof guestPhotoVersionSchema>;
export type GuestPhotoVersionsPage = z.infer<
  typeof guestPhotoVersionsPageSchema
>;
