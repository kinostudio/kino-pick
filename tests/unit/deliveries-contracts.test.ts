import { describe, expect, it } from 'vitest';
import {
  createDeliverySchema as createDeliveryFromBarrel,
  MAX_DELIVERY_ITEMS,
  MAX_DELIVERY_REQUEST_BYTES,
} from '../../packages/contracts/src';
import {
  createDeliverySchema,
  deliveryVerifiedAssetSchema,
  guestDeliveryDownloadRequestSchema,
  guestDeliveryReadSchema,
  ownerDeliveriesPageSchema,
  ownerDeliveryResultSchema,
  ownerDeliveryManifestSchema,
} from '../../packages/contracts/src/deliveries';

const id = (sequence: number) =>
  '00000000-0000-4000-8000-' + String(sequence).padStart(12, '0');

const ownerId = id(1);
const projectId = id(2);
const albumId = id(3);
const inviteId = id(4);
const secondInviteId = id(5);
const photoId = id(6);
const secondPhotoId = id(7);
const versionId = id(8);
const secondVersionId = id(9);
const assetId = id(10);
const secondAssetId = id(11);
const approvalRequestId = id(12);
const deliveryId = id(13);
const requestId = id(14);
const occurredAt = '2026-10-29T10:00:00.000Z';

const sourceItem = {
  photoId,
  versionId,
  fileAssetId: assetId,
  approvalRequestId,
};

const secondSourceItem = {
  photoId: secondPhotoId,
  versionId: secondVersionId,
  fileAssetId: secondAssetId,
  approvalRequestId: null,
};

const createBody = {
  requestId,
  expectedOwnerId: ownerId,
  projectId,
  albumId,
  inviteIds: [inviteId, secondInviteId],
  items: [sourceItem, secondSourceItem],
  expiresAt: '2026-11-29T10:00:00.000Z',
  confirm: true,
};

const verifiedAsset = {
  id: assetId,
  assetKind: 'delivery' as const,
  filename: 'Portrait.final.jpg',
  byteSize: 2048,
  mime: 'image/jpeg' as const,
  checksumSha256: 'a'.repeat(64),
  verification: {
    state: 'verified' as const,
    verifiedAt: occurredAt,
  },
};

const guestDeliveryItem = {
  photoId,
  versionId,
  versionNo: 2,
  asset: verifiedAsset,
};

const ownerDelivery = {
  id: deliveryId,
  workspaceId: id(15),
  projectId,
  albumId,
  status: 'published' as const,
  createdBy: ownerId,
  createdAt: occurredAt,
  publishedAt: occurredAt,
  expiresAt: '2026-11-29T10:00:00.000Z',
  inviteIds: [inviteId, secondInviteId],
  items: [
    {
      ...guestDeliveryItem,
      approval: {
        requestId: approvalRequestId,
        photoId,
        versionId,
        confirmedAt: occurredAt,
      },
    },
  ],
};

const guestRead = {
  access: {
    deliveryId,
    inviteId,
    expiresAt: '2026-11-01T10:00:00.000Z',
    permissions: {
      can_view_delivery: true,
      can_download_delivery: false,
    },
  },
  delivery: {
    id: deliveryId,
    projectId,
    albumId,
    status: 'published' as const,
    publishedAt: occurredAt,
    expiresAt: '2026-11-29T10:00:00.000Z',
    items: [guestDeliveryItem],
  },
};

describe('fixed-version delivery contracts', () => {
  it('exports the strict Owner command through the shared barrel', () => {
    expect(MAX_DELIVERY_ITEMS).toBe(64);
    expect(createDeliveryFromBarrel.parse(createBody)).toEqual(createBody);
  });

  it('requires explicit recipients and bounds the fixed photo/version/asset manifest to the API body limit', () => {
    expect(createDeliverySchema.parse(createBody)).toEqual(createBody);
    expect(
      createDeliverySchema.parse({
        ...createBody,
        items: [{ photoId, versionId, fileAssetId: assetId }],
      }).items[0]?.approvalRequestId,
    ).toBe(null);

    const maximumItems = Array.from(
      { length: MAX_DELIVERY_ITEMS },
      (_, index) => ({
        photoId: id(100 + index),
        versionId: id(2_000 + index),
        fileAssetId: id(4_000 + index),
        approvalRequestId: id(6_000 + index),
      }),
    );
    const maximumBody = {
      ...createBody,
      inviteIds: Array.from({ length: 24 }, (_, index) => id(8_000 + index)),
      items: maximumItems,
    };
    expect(JSON.stringify(maximumBody).length).toBeLessThanOrEqual(
      MAX_DELIVERY_REQUEST_BYTES,
    );
    expect(createDeliverySchema.safeParse(maximumBody).success).toBe(true);
    expect(
      createDeliverySchema.safeParse({
        ...maximumBody,
        items: [...maximumItems, { ...maximumItems[0], photoId: id(7_000) }],
      }).success,
    ).toBe(false);

    const caseVariant = inviteId.toUpperCase();
    expect(
      createDeliverySchema.safeParse({
        ...createBody,
        inviteIds: [caseVariant, secondInviteId],
      }).success,
    ).toBe(true);

    const invalidBodies = [
      { inviteIds: [] },
      { inviteIds: undefined },
      { inviteIds: [inviteId, caseVariant] },
      { inviteIds: Array.from({ length: 25 }, (_, index) => id(100 + index)) },
      { inviteIds: ['not-a-uuid'] },
      { items: [] },
      { items: [{ ...sourceItem, fileAssetId: 'not-a-uuid' }] },
      { items: [sourceItem, { ...secondSourceItem, photoId }] },
      { items: [sourceItem, { ...secondSourceItem, fileAssetId: assetId }] },
      { confirm: false },
      { signedUrl: 'https://download.example/token' },
      { objectKey: 'private/object/key' },
      { storageNodeId: id(99) },
      { items: [{ ...sourceItem, objectKey: 'private/key' }] },
    ];
    for (const invalid of invalidBodies) {
      expect(
        createDeliverySchema.safeParse({ ...createBody, ...invalid }).success,
      ).toBe(false);
    }
  });

  it('requires eligible verified asset metadata and rejects storage credentials', () => {
    expect(deliveryVerifiedAssetSchema.parse(verifiedAsset)).toEqual(
      verifiedAsset,
    );
    expect(
      deliveryVerifiedAssetSchema.safeParse({
        ...verifiedAsset,
        assetKind: 'original',
      }).success,
    ).toBe(true);
    expect(
      deliveryVerifiedAssetSchema.parse({
        ...verifiedAsset,
        checksumSha256: 'A'.repeat(64),
      }).checksumSha256,
    ).toBe('a'.repeat(64));

    const invalidAssets = [
      { ...verifiedAsset, assetKind: 'preview' },
      { ...verifiedAsset, assetKind: 'thumbnail' },
      {
        ...verifiedAsset,
        verification: { state: 'pending', verifiedAt: occurredAt },
      },
      { ...verifiedAsset, byteSize: 0 },
      { ...verifiedAsset, byteSize: 5_363_466_241 },
      { ...verifiedAsset, filename: '../Portrait.jpg' },
      { ...verifiedAsset, filename: 'folder\\Portrait.jpg' },
      { ...verifiedAsset, filename: 'Portrait\n.jpg' },
      { ...verifiedAsset, checksumSha256: 'not-a-sha256' },
      { ...verifiedAsset, objectKey: 'private/object/key' },
      { ...verifiedAsset, bucket: 'private-bucket' },
      { ...verifiedAsset, signedUrl: 'https://download.example/token' },
      { ...verifiedAsset, downloadToken: 'bearer-secret' },
    ];
    for (const invalid of invalidAssets) {
      expect(deliveryVerifiedAssetSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it('validates the Owner result and keeps any optional approval witness bound to the fixed photo/version', () => {
    expect(
      ownerDeliveryResultSchema.safeParse({
        requestId,
        delivery: ownerDelivery,
        eventId: 'evt_delivery_created_1',
        occurredAt,
      }).success,
    ).toBe(true);
    expect(
      ownerDeliveryResultSchema.safeParse({
        requestId,
        delivery: ownerDelivery,
        eventId: '',
        occurredAt,
      }).success,
    ).toBe(false);
    expect(ownerDeliveryManifestSchema.safeParse(ownerDelivery).success).toBe(
      true,
    );
    expect(
      ownerDeliveryManifestSchema.safeParse({
        ...ownerDelivery,
        items: [
          {
            ...ownerDelivery.items[0]!,
            approval: {
              ...ownerDelivery.items[0]!.approval,
              versionId: secondVersionId,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ownerDeliveryManifestSchema.safeParse({
        ...ownerDelivery,
        items: [
          {
            ...ownerDelivery.items[0]!,
            isCurrent: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ownerDeliveryManifestSchema.safeParse({
        ...ownerDelivery,
        status: 'expired',
        expiresAt: null,
      }).success,
    ).toBe(false);
    expect(
      ownerDeliveryManifestSchema.safeParse({
        ...ownerDelivery,
        items: [
          {
            ...ownerDelivery.items[0]!,
            asset: { ...verifiedAsset, objectKey: 'private/key' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ownerDeliveryManifestSchema.safeParse({
        ...ownerDelivery,
        items: [ownerDelivery.items[0]!, ownerDelivery.items[0]!],
      }).success,
    ).toBe(false);
    expect(
      ownerDeliveryManifestSchema.safeParse({
        ...ownerDelivery,
        items: [{ ...ownerDelivery.items[0]!, approval: null }],
      }).success,
    ).toBe(true);
  });

  it('returns a recipient-scoped Guest manifest with download rights independent of approval', () => {
    expect(guestDeliveryReadSchema.parse(guestRead)).toEqual(guestRead);
    expect(
      guestDeliveryReadSchema.safeParse({
        ...guestRead,
        access: {
          ...guestRead.access,
          permissions: {
            can_view_delivery: true,
            can_download_delivery: true,
          },
        },
      }).success,
    ).toBe(true);

    expect(
      guestDeliveryReadSchema.safeParse({
        ...guestRead,
        access: {
          ...guestRead.access,
          permissions: {
            can_view_delivery: false,
            can_download_delivery: true,
          },
        },
      }).success,
    ).toBe(true);

    const invalidReads = [
      {
        ...guestRead,
        access: {
          ...guestRead.access,
          permissions: {
            can_view_delivery: false,
            can_download_delivery: false,
          },
        },
      },
      {
        ...guestRead,
        access: { ...guestRead.access, deliveryId: id(99) },
      },
      {
        ...guestRead,
        access: {
          ...guestRead.access,
          permissions: {
            can_view_delivery: true,
            can_download_delivery: false,
            can_approve: true,
          },
        },
      },
      {
        ...guestRead,
        delivery: { ...guestRead.delivery, inviteIds: [inviteId] },
      },
      {
        ...guestRead,
        delivery: {
          ...guestRead.delivery,
          items: [
            {
              ...guestDeliveryItem,
              approval: {
                requestId: approvalRequestId,
                photoId,
                versionId,
                confirmedAt: occurredAt,
              },
            },
          ],
        },
      },
      {
        ...guestRead,
        delivery: {
          ...guestRead.delivery,
          items: [
            {
              ...guestDeliveryItem,
              asset: { ...verifiedAsset, signedUrl: 'https://example/token' },
            },
          ],
        },
      },
    ];
    for (const invalid of invalidReads) {
      expect(guestDeliveryReadSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('bounds Owner list pages and keeps Guest download requests credential-free', () => {
    const summary = {
      id: deliveryId,
      projectId,
      albumId,
      status: 'published' as const,
      createdAt: occurredAt,
      publishedAt: occurredAt,
      expiresAt: null,
      inviteIds: [inviteId],
      itemCount: 2,
    };
    expect(
      ownerDeliveriesPageSchema.safeParse({
        deliveries: Array.from({ length: 24 }, (_, index) => ({
          ...summary,
          id: id(100 + index),
        })),
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      ownerDeliveriesPageSchema.safeParse({
        deliveries: Array.from({ length: 25 }, (_, index) => ({
          ...summary,
          id: id(100 + index),
        })),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      ownerDeliveriesPageSchema.safeParse({
        deliveries: [{ ...summary, status: 'expired' }],
        nextCursor: null,
      }).success,
    ).toBe(false);

    expect(
      guestDeliveryDownloadRequestSchema.parse({
        requestId,
        fileAssetId: assetId,
        confirm: true,
      }),
    ).toEqual({ requestId, fileAssetId: assetId, confirm: true });
    expect(
      guestDeliveryDownloadRequestSchema.safeParse({
        requestId,
        fileAssetId: assetId,
        confirm: true,
        signedUrl: 'https://download.example/token',
      }).success,
    ).toBe(false);
  });
});
