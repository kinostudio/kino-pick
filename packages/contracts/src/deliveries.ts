import { z } from 'zod';

export const MAX_DELIVERY_ITEMS = 64;
export const MAX_DELIVERY_INVITES = 24;
export const MAX_DELIVERY_REQUEST_BYTES = 16_384;
export const MAX_DELIVERIES_PER_PAGE = 24;

const positiveSafeInteger = z.number().int().positive().safe();
const deliveryStatusSchema = z.enum(['published', 'revoked', 'expired']);
const deliveryAssetKindSchema = z.enum(['original', 'delivery']);
const deliveryMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i)
  .transform((checksum) => checksum.toLowerCase());

export const deliveryInviteIdsSchema = z
  .array(z.uuid().transform((inviteId) => inviteId.toLowerCase()))
  .min(1)
  .max(MAX_DELIVERY_INVITES)
  .refine(
    (inviteIds) => new Set(inviteIds).size === inviteIds.length,
    'Invitation IDs must be unique',
  );

/**
 * Owner input pins immutable IDs. A nullable approvalRequestId is an optional
 * witness reference; null means no witness is attached. The service must
 * independently verify that every asset is private, verified, and belongs to
 * the exact photo/version.
 */
export const deliverySourceItemSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    fileAssetId: z.uuid(),
    approvalRequestId: z.uuid().nullable().default(null),
  })
  .strict();

export const deliverySourceItemsSchema = z
  .array(deliverySourceItemSchema)
  .min(1)
  .max(MAX_DELIVERY_ITEMS)
  .superRefine((items, context) => {
    const photos = new Set<string>();
    const assets = new Set<string>();

    items.forEach((item, index) => {
      const photoId = item.photoId.toLowerCase();
      const fileAssetId = item.fileAssetId.toLowerCase();

      if (photos.has(photoId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'photoId'],
          message: 'Each photo can appear only once in a delivery',
        });
      }
      if (assets.has(fileAssetId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'fileAssetId'],
          message: 'A file asset can appear only once in a delivery',
        });
      }
      photos.add(photoId);
      assets.add(fileAssetId);
    });
  });

export const createDeliverySchema = z
  .object({
    requestId: z.uuid(),
    expectedOwnerId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    inviteIds: deliveryInviteIdsSchema,
    items: deliverySourceItemsSchema,
    expiresAt: z.iso.datetime().nullable(),
    confirm: z.literal(true),
  })
  .strict();

export const deliveryVerifiedAssetSchema = z
  .object({
    id: z.uuid(),
    assetKind: deliveryAssetKindSchema,
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (filename) =>
          filename !== '.' &&
          filename !== '..' &&
          !filename.includes('/') &&
          !filename.includes('\\') &&
          !/[\u0000-\u001f\u007f]/.test(filename),
        'Filename must be a single safe file name',
      ),
    byteSize: positiveSafeInteger.max(5_363_466_240),
    mime: deliveryMimeSchema,
    checksumSha256: sha256Schema,
    verification: z
      .object({
        state: z.literal('verified'),
        verifiedAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();

export const deliveryApprovalEvidenceSchema = z
  .object({
    requestId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    confirmedAt: z.iso.datetime(),
  })
  .strict();

export const deliveryManifestItemSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    versionNo: positiveSafeInteger,
    asset: deliveryVerifiedAssetSchema,
  })
  .strict();

export const ownerDeliveryManifestItemSchema = deliveryManifestItemSchema
  .extend({ approval: deliveryApprovalEvidenceSchema.nullable() })
  .strict()
  .superRefine((item, context) => {
    if (
      item.approval !== null &&
      (item.approval.photoId.toLowerCase() !== item.photoId.toLowerCase() ||
        item.approval.versionId.toLowerCase() !== item.versionId.toLowerCase())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approval'],
        message: 'Approval evidence must match the fixed photo and version',
      });
    }
  });

const deliveryManifestItemsSchema = z
  .array(deliveryManifestItemSchema)
  .min(1)
  .max(MAX_DELIVERY_ITEMS)
  .superRefine((items, context) => {
    const photos = new Set<string>();
    const assets = new Set<string>();

    items.forEach((item, index) => {
      const photoId = item.photoId.toLowerCase();
      const assetId = item.asset.id.toLowerCase();

      if (photos.has(photoId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'photoId'],
          message: 'Each photo can appear only once in a delivery',
        });
      }
      if (assets.has(assetId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'asset', 'id'],
          message: 'A file asset can appear only once in a delivery',
        });
      }
      photos.add(photoId);
      assets.add(assetId);
    });
  });

const ownerDeliveryManifestItemsSchema = z
  .array(ownerDeliveryManifestItemSchema)
  .min(1)
  .max(MAX_DELIVERY_ITEMS)
  .superRefine((items, context) => {
    const photos = new Set<string>();
    const assets = new Set<string>();

    items.forEach((item, index) => {
      const photoId = item.photoId.toLowerCase();
      const assetId = item.asset.id.toLowerCase();

      if (photos.has(photoId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'photoId'],
          message: 'Each photo can appear only once in a delivery',
        });
      }
      if (assets.has(assetId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'asset', 'id'],
          message: 'A file asset can appear only once in a delivery',
        });
      }
      photos.add(photoId);
      assets.add(assetId);
    });
  });

export const ownerDeliveryManifestSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    status: deliveryStatusSchema,
    createdBy: z.uuid(),
    createdAt: z.iso.datetime(),
    publishedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    inviteIds: deliveryInviteIdsSchema,
    items: ownerDeliveryManifestItemsSchema,
  })
  .strict()
  .superRefine((delivery, context) => {
    if (delivery.status === 'expired' && delivery.expiresAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'An expired delivery must have an expiration time',
      });
    }
  });

export const ownerDeliverySummarySchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    status: deliveryStatusSchema,
    createdAt: z.iso.datetime(),
    publishedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    inviteIds: deliveryInviteIdsSchema,
    itemCount: positiveSafeInteger.max(MAX_DELIVERY_ITEMS),
  })
  .strict()
  .superRefine((delivery, context) => {
    if (delivery.status === 'expired' && delivery.expiresAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'An expired delivery must have an expiration time',
      });
    }
  });

export const ownerDeliveriesPageSchema = z
  .object({
    deliveries: z
      .array(ownerDeliverySummarySchema)
      .max(MAX_DELIVERIES_PER_PAGE),
    nextCursor: z.uuid().nullable(),
  })
  .strict();

export const ownerDeliveryResultSchema = z
  .object({
    requestId: z.uuid(),
    delivery: ownerDeliveryManifestSchema,
    eventId: z.string().min(1).max(160),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export const guestDeliveryAccessSchema = z
  .object({
    deliveryId: z.uuid(),
    inviteId: z.uuid(),
    expiresAt: z.iso.datetime(),
    permissions: z
      .object({
        can_view_delivery: z.boolean(),
        can_download_delivery: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const guestDeliveryManifestSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    status: z.literal('published'),
    publishedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    items: deliveryManifestItemsSchema,
  })
  .strict();

export const guestDeliveryReadSchema = z
  .object({
    access: guestDeliveryAccessSchema,
    delivery: guestDeliveryManifestSchema,
  })
  .strict()
  .superRefine((read, context) => {
    if (
      !read.access.permissions.can_view_delivery &&
      !read.access.permissions.can_download_delivery
    ) {
      context.addIssue({
        code: 'custom',
        path: ['access', 'permissions'],
        message: 'Delivery read requires view or download access',
      });
    }
    if (
      read.access.deliveryId.toLowerCase() !== read.delivery.id.toLowerCase()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['access', 'deliveryId'],
        message: 'Access must belong to the returned delivery',
      });
    }
  });

/** The server rechecks the active invite's independent download permission. */
export const guestDeliveryDownloadRequestSchema = z
  .object({
    requestId: z.uuid(),
    fileAssetId: z.uuid(),
    confirm: z.literal(true),
  })
  .strict();

export type DeliverySourceItem = z.infer<typeof deliverySourceItemSchema>;
export type CreateDelivery = z.infer<typeof createDeliverySchema>;
export type DeliveryVerifiedAsset = z.infer<typeof deliveryVerifiedAssetSchema>;
export type DeliveryApprovalEvidence = z.infer<
  typeof deliveryApprovalEvidenceSchema
>;
export type DeliveryManifestItem = z.infer<typeof deliveryManifestItemSchema>;
export type OwnerDeliveryManifestItem = z.infer<
  typeof ownerDeliveryManifestItemSchema
>;
export type OwnerDeliveryManifest = z.infer<typeof ownerDeliveryManifestSchema>;
export type OwnerDeliverySummary = z.infer<typeof ownerDeliverySummarySchema>;
export type OwnerDeliveriesPage = z.infer<typeof ownerDeliveriesPageSchema>;
export type OwnerDeliveryResult = z.infer<typeof ownerDeliveryResultSchema>;
export type GuestDeliveryAccess = z.infer<typeof guestDeliveryAccessSchema>;
export type GuestDeliveryManifest = z.infer<typeof guestDeliveryManifestSchema>;
export type GuestDeliveryRead = z.infer<typeof guestDeliveryReadSchema>;
export type GuestDeliveryDownloadRequest = z.infer<
  typeof guestDeliveryDownloadRequestSchema
>;
