import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  D1AlbumReadProtections,
  protectAlbumRead,
} from '../../apps/worker/src/album-read-protections';
import { approvedDeliveryRoutes } from '../../apps/worker/src/approved-delivery-routes';
import { D1ApprovedDeliveries } from '../../apps/worker/src/approved-deliveries';
import { D1DeliveryZips } from '../../apps/worker/src/delivery-zips';
import { deliveryZipRoutes } from '../../apps/worker/src/delivery-zip-routes';
import { guestDownloadRoutes } from '../../apps/worker/src/guest-download-routes';
import {
  D1GuestDownloadsRepository,
  type GuestMediaDownloadContext,
} from '../../apps/worker/src/guest-downloads';
import { R2StorageAdapter } from '../../apps/worker/src/r2-storage';
import type { WorkerEnv } from '../../apps/worker/src/config';
import type { DeliveryFile } from '../../apps/worker/src/approved-deliveries';
import type { ZipItem } from '../../packages/contracts/src/delivery-zips';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';

const scope = {
  workspace_id: randomUUID(),
  project_id: randomUUID(),
  album_id: randomUUID(),
};
const guestId = randomUUID();
const sessionId = randomUUID();
const inviteId = randomUUID();
const photoId = randomUUID();
const versionId = randomUUID();
const deliveryId = randomUUID();
const assetId = randomUUID();
const zipId = randomUUID();
const requestId = randomUUID();
const imageHash = '00'.repeat(32);
const zipHash =
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
const cookie = `kino_guest=${'a'.repeat(64)}`;

function hashBytes(hash: string) {
  return Uint8Array.from(
    hash.match(/.{2}/gu)!.map((part) => Number.parseInt(part, 16)),
  ).buffer;
}

function bodyStream(bytes?: number[], onCancel?: () => void) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      }
    },
    cancel() {
      onCancel?.();
    },
  });
}

function imageObject(bytes?: number[], onCancel?: () => void) {
  return {
    size: 3,
    checksums: { sha256: hashBytes(imageHash) },
    httpMetadata: { contentType: 'image/jpeg' },
    body: bodyStream(bytes, onCancel),
  } as unknown as R2ObjectBody;
}

function baseEnv(enabled: boolean, order: string[] = []): WorkerEnv {
  const archiveBytes = new Uint8Array([0x61]);
  const bucket = {
    head: vi.fn(async () => {
      order.push('head');
      return {
        etag: 'zip-etag',
        size: archiveBytes.byteLength,
        checksums: { sha256: hashBytes(zipHash) },
        httpMetadata: { contentType: 'image/jpeg' },
      };
    }),
    get: vi.fn(async () => {
      order.push('get');
      return {
        etag: 'zip-etag',
        body: bodyStream([...archiveBytes]),
      };
    }),
  };
  return {
    APP_ENV: 'local',
    APP_URL: 'http://127.0.0.1:8787',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    ALBUM_READ_PROTECTION_ENABLED: enabled ? 'true' : 'false',
    CLIENT_ACTIVITY_ENABLED: 'false',
    GUEST_DOWNLOADS_ENABLED: 'true',
    PHOTO_VERSIONS_ENABLED: 'true',
    VERSION_APPROVALS_ENABLED: 'true',
    APPROVED_DELIVERIES_ENABLED: 'true',
    DELIVERY_ZIP_ENABLED: 'true',
    PRIMARY_STORAGE: bucket,
    DB: {},
  } as unknown as WorkerEnv;
}

function downloadContext(): GuestMediaDownloadContext {
  return {
    requestId,
    guestId,
    guestSessionId: sessionId,
    inviteId,
    workspaceId: scope.workspace_id,
    projectId: scope.project_id,
    albumId: scope.album_id,
    photoId,
    versionId,
    assetKind: 'original',
    assetId,
    filename: 'photo.jpg',
    byteSize: 3,
    mime: 'image/jpeg',
    checksumSha256: imageHash,
    objectKey: `${scope.workspace_id}/${scope.project_id}/${scope.album_id}/photo.jpg`,
    storageNodeId: 'primary',
  };
}

function approvedFile(): DeliveryFile {
  return {
    ...scope,
    delivery_id: deliveryId,
    photo_id: photoId,
    version_id: versionId,
    asset_id: assetId,
    guest_id: guestId,
    guest_session_id: sessionId,
    invite_id: inviteId,
    storage_node_id: 'primary',
    object_key: `${scope.workspace_id}/${scope.project_id}/${scope.album_id}/delivery.jpg`,
    filename: 'photo.jpg',
    byte_size: 3,
    mime: 'image/jpeg',
    checksum_sha256: imageHash,
    requestId,
    afterJson: '{}',
  };
}

function zipItem(): ZipItem {
  return {
    deliveryId,
    photoId,
    versionId,
    versionNo: 1,
    assetId,
    filename: 'photo.jpg',
    byteSize: 1,
    mime: 'image/jpeg',
    sha256: zipHash,
    entryName: `001-v1-${photoId.slice(0, 8)}-photo.jpg`,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('attachment album read protection', () => {
  it('skips D1 completely when the existing flag is OFF', async () => {
    const acquire = vi.spyOn(D1AlbumReadProtections.prototype, 'acquire');
    await protectAlbumRead(baseEnv(false), scope);
    expect(acquire).not.toHaveBeenCalled();
  });

  it('fails before storage when the initial Guest download protection fails', async () => {
    vi.spyOn(D1AlbumReadProtections.prototype, 'acquire').mockRejectedValue(
      new WorkspaceFailure('ALBUM_READ_PROTECTION_UNAVAILABLE', 503),
    );
    vi.spyOn(D1GuestDownloadsRepository.prototype, 'request').mockResolvedValue(
      downloadContext(),
    );
    const open = vi.spyOn(R2StorageAdapter.prototype, 'open');

    const response = await guestDownloadRoutes.fetch(
      new Request(
        `http://127.0.0.1:8787/api/guest/photos/${photoId}/versions/${versionId}/downloads/original`,
        { headers: { Cookie: cookie } },
      ),
      baseEnv(true),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'ALBUM_READ_PROTECTION_UNAVAILABLE' },
    });
    expect(open).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'protects all attachment paths only when the flag is %s',
    async (enabled) => {
      const order: string[] = [];
      const acquire = vi
        .spyOn(D1AlbumReadProtections.prototype, 'acquire')
        .mockImplementation(async () => {
          order.push('protect');
          return { protectedUntilMs: 1_900_000_000_000, revision: 1 };
        });
      const download = vi
        .spyOn(D1GuestDownloadsRepository.prototype, 'request')
        .mockResolvedValue(downloadContext());
      const generatedDownload = vi
        .spyOn(D1GuestDownloadsRepository.prototype, 'generated')
        .mockImplementation(async () => {
          order.push('generated-download');
        });
      const requestedDelivery = vi
        .spyOn(D1ApprovedDeliveries.prototype, 'requested')
        .mockResolvedValue(approvedFile());
      const generatedDelivery = vi
        .spyOn(D1ApprovedDeliveries.prototype, 'generated')
        .mockImplementation(async () => {
          order.push('generated-delivery');
        });
      const item = zipItem();
      const ticket = {
        ticket_id: zipId,
        workspace_id: scope.workspace_id,
        project_id: scope.project_id,
        album_id: scope.album_id,
        guest_id: guestId,
        guest_session_id: sessionId,
        manifest: '{}',
        occurred_at_utc: new Date().toISOString(),
        contents: {
          deliveryIds: [deliveryId],
          items: [item],
          expiresAtMs: Date.now() + 60_000,
        },
      } as unknown as Awaited<ReturnType<D1DeliveryZips['ticket']>>;
      const ticketRead = vi
        .spyOn(D1DeliveryZips.prototype, 'ticket')
        .mockResolvedValue(ticket);
      const auditZip = vi
        .spyOn(D1DeliveryZips.prototype, 'audit')
        .mockResolvedValue();
      const zipSource = vi
        .spyOn(D1DeliveryZips.prototype, 'source')
        .mockResolvedValue({
          ...item,
          storage_node_id: 'primary',
          object_key: `${scope.workspace_id}/${scope.project_id}/${scope.album_id}/original.jpg`,
        });
      const objects = [imageObject([1, 2, 3]), imageObject([4, 5, 6])];
      let objectIndex = 0;
      const open = vi
        .spyOn(R2StorageAdapter.prototype, 'open')
        .mockImplementation(async () => {
          order.push('open');
          return objects[objectIndex++]!;
        });
      const env = baseEnv(enabled, order);

      const downloadResponse = await guestDownloadRoutes.fetch(
        new Request(
          `http://127.0.0.1:8787/api/guest/photos/${photoId}/versions/${versionId}/downloads/original`,
          { headers: { Cookie: cookie } },
        ),
        env,
      );
      expect(downloadResponse.status).toBe(200);
      await downloadResponse.arrayBuffer();

      const approvedResponse = await approvedDeliveryRoutes.fetch(
        new Request(
          `http://127.0.0.1:8787/api/guest/albums/${scope.album_id}/deliveries/${deliveryId}/assets/${assetId}/download?requestId=${requestId}`,
          { headers: { Cookie: cookie } },
        ),
        env,
      );
      expect(approvedResponse.status).toBe(200);
      await approvedResponse.arrayBuffer();

      const zipResponse = await deliveryZipRoutes.fetch(
        new Request(
          `http://127.0.0.1:8787/api/guest/albums/${scope.album_id}/delivery-zips/${zipId}/download?requestId=${requestId}`,
          { headers: { Cookie: cookie } },
        ),
        env,
      );
      expect(zipResponse.status).toBe(200);
      await zipResponse.arrayBuffer();

      if (enabled) {
        expect(acquire).toHaveBeenCalledTimes(7);
        expect(
          acquire.mock.calls.every(
            ([readScope]) =>
              JSON.stringify(readScope) === JSON.stringify(scope),
          ),
        ).toBe(true);
        expect(order.indexOf('protect')).toBeLessThan(order.indexOf('open'));
        expect(
          order.indexOf('protect', order.indexOf('generated-download')),
        ).toBeGreaterThan(order.indexOf('generated-download'));
        expect(
          order.indexOf('protect', order.indexOf('generated-delivery')),
        ).toBeGreaterThan(order.indexOf('generated-delivery'));
        expect(order[order.indexOf('head') - 1]).toBe('protect');
        expect(order.lastIndexOf('protect')).toBeLessThan(
          order.lastIndexOf('get'),
        );
      } else {
        expect(acquire).not.toHaveBeenCalled();
        expect(order).not.toContain('protect');
      }
      expect(download).toHaveBeenCalledOnce();
      expect(generatedDownload).toHaveBeenCalledOnce();
      expect(requestedDelivery).toHaveBeenCalledOnce();
      expect(generatedDelivery).toHaveBeenCalledOnce();
      expect(ticketRead).toHaveBeenCalledTimes(enabled ? 4 : 3);
      expect(auditZip).toHaveBeenCalledTimes(2);
      expect(zipSource).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledTimes(2);
    },
  );

  it('fails closed and cancels unread Guest download bytes on the final protection failure', async () => {
    const cancel = vi.fn();
    const acquire = vi
      .spyOn(D1AlbumReadProtections.prototype, 'acquire')
      .mockResolvedValueOnce({
        protectedUntilMs: Date.now() + 900_000,
        revision: 1,
      })
      .mockRejectedValueOnce(
        new WorkspaceFailure('ALBUM_READ_PROTECTION_UNAVAILABLE', 503),
      );
    vi.spyOn(D1GuestDownloadsRepository.prototype, 'request').mockResolvedValue(
      downloadContext(),
    );
    vi.spyOn(
      D1GuestDownloadsRepository.prototype,
      'generated',
    ).mockResolvedValue();
    vi.spyOn(R2StorageAdapter.prototype, 'open').mockResolvedValue(
      imageObject(undefined, cancel),
    );

    const response = await guestDownloadRoutes.fetch(
      new Request(
        `http://127.0.0.1:8787/api/guest/photos/${photoId}/versions/${versionId}/downloads/original`,
        { headers: { Cookie: cookie } },
      ),
      baseEnv(true),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'ALBUM_READ_PROTECTION_UNAVAILABLE' },
    });
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels unread approved-delivery bytes when the final protection fails', async () => {
    const cancel = vi.fn();
    const acquire = vi
      .spyOn(D1AlbumReadProtections.prototype, 'acquire')
      .mockResolvedValueOnce({
        protectedUntilMs: Date.now() + 900_000,
        revision: 1,
      })
      .mockRejectedValueOnce(
        new WorkspaceFailure('ALBUM_READ_PROTECTION_UNAVAILABLE', 503),
      );
    vi.spyOn(D1ApprovedDeliveries.prototype, 'requested').mockResolvedValue(
      approvedFile(),
    );
    vi.spyOn(D1ApprovedDeliveries.prototype, 'generated').mockResolvedValue();
    vi.spyOn(R2StorageAdapter.prototype, 'open').mockResolvedValue(
      imageObject(undefined, cancel),
    );

    const response = await approvedDeliveryRoutes.fetch(
      new Request(
        `http://127.0.0.1:8787/api/guest/albums/${scope.album_id}/deliveries/${deliveryId}/assets/${assetId}/download?requestId=${requestId}`,
        { headers: { Cookie: cookie } },
      ),
      baseEnv(true),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'ALBUM_READ_PROTECTION_UNAVAILABLE' },
    });
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
