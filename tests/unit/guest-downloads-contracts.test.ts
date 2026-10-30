import { describe, expect, it } from 'vitest';
import {
  guestDownloadAccessSchema,
  guestDownloadFileSchema,
  guestDownloadFilename,
  guestDownloadPhotoSchema,
  guestDownloadsPageSchema,
  guestDownloadsQuerySchema,
  guestMediaDownloadAuditSchema,
} from '../../packages/contracts/src/guest-downloads';
import { guestHistoryEventSchema } from '../../packages/contracts/src/guest-history';
import {
  configuration,
  guestDownloadsCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { projectOwnerHistoryDetails } from '../../apps/worker/src/owner-history-projection';

const id = () => crypto.randomUUID();

function env(mode: 'local' | 'staging' | 'production'): WorkerEnv {
  return {
    APP_ENV: mode,
    APP_URL:
      mode === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  } as WorkerEnv;
}

function access() {
  return {
    guestId: id(),
    inviteId: id(),
    workspaceId: id(),
    projectId: id(),
    albumId: id(),
    expiresAt: '2026-10-30T00:00:00.000Z',
    permissions: {
      can_view: false,
      can_download_preview: true,
      can_download_original: false,
    },
  };
}

function previewFile() {
  return {
    filename: 'Portrait.preview.jpg',
    byteSize: 1024,
    mime: 'image/jpeg',
  };
}

function mediaEvent(action: 'download.requested' | 'download.generated') {
  return {
    eventId: id(),
    occurredAt: '2026-10-29T12:00:00.000Z',
    albumId: id(),
    photoId: id(),
    versionId: id(),
    photoStatus: 'available' as const,
    action,
    detail: {
      assetKind: 'preview' as const,
      assetId: id(),
      filename: 'Portrait.preview.jpg',
      byteSize: 1024,
      mime: 'image/jpeg' as const,
    },
  };
}

describe('Guest media download contracts', () => {
  it('strictly validates the cursor query and access permission record', () => {
    expect(guestDownloadsQuerySchema.parse({})).toEqual({});
    expect(guestDownloadsQuerySchema.safeParse({ cursor: id() }).success).toBe(
      true,
    );
    expect(
      guestDownloadsQuerySchema.safeParse({ cursor: 'cursor', extra: true })
        .success,
    ).toBe(false);
    expect(guestDownloadAccessSchema.safeParse(access()).success).toBe(true);
    expect(
      guestDownloadAccessSchema.safeParse({
        ...access(),
        permissions: {
          can_view: true,
          can_download_preview: false,
          extra: true,
        },
      }).success,
    ).toBe(false);
  });

  it('bounds file metadata and requires at least one valid asset per photo', () => {
    expect(
      guestDownloadFileSchema.safeParse({
        ...previewFile(),
        byteSize: 5_363_466_240,
      }).success,
    ).toBe(true);
    expect(
      guestDownloadFileSchema.safeParse({
        ...previewFile(),
        byteSize: 5_363_466_241,
      }).success,
    ).toBe(false);
    expect(
      guestDownloadFileSchema.safeParse({
        ...previewFile(),
        objectKey: 'private-key',
      }).success,
    ).toBe(false);

    const photo = {
      photoId: id(),
      versionId: id(),
      versionNo: 1,
      filename: 'Portrait.JPG',
      preview: previewFile(),
      original: null,
    };
    expect(guestDownloadPhotoSchema.safeParse(photo).success).toBe(true);
    expect(
      guestDownloadPhotoSchema.safeParse({
        ...photo,
        preview: { ...previewFile(), mime: 'image/png' },
      }).success,
    ).toBe(false);
    expect(
      guestDownloadPhotoSchema.safeParse({
        ...photo,
        preview: null,
        original: null,
      }).success,
    ).toBe(false);
  });

  it('limits the page to 24 photos and keeps audit details strict', () => {
    const photo = {
      photoId: id(),
      versionId: id(),
      versionNo: 1,
      filename: 'Portrait.JPG',
      preview: previewFile(),
      original: null,
    };
    expect(
      guestDownloadsPageSchema.safeParse({
        access: access(),
        photos: Array.from({ length: 24 }, () => ({ ...photo, photoId: id() })),
        nextCursor: id(),
      }).success,
    ).toBe(true);
    expect(
      guestDownloadsPageSchema.safeParse({
        access: access(),
        photos: Array.from({ length: 25 }, () => ({ ...photo, photoId: id() })),
        nextCursor: null,
      }).success,
    ).toBe(false);

    const audit = {
      assetKind: 'original' as const,
      assetId: id(),
      filename: 'Portrait.JPG',
      byteSize: 2048,
      mime: 'image/jpeg' as const,
    };
    expect(guestMediaDownloadAuditSchema.safeParse(audit).success).toBe(true);
    expect(
      guestMediaDownloadAuditSchema.safeParse({ ...audit, objectKey: 'secret' })
        .success,
    ).toBe(false);
    expect(
      guestHistoryEventSchema.safeParse(mediaEvent('download.generated'))
        .success,
    ).toBe(true);
    expect(
      guestHistoryEventSchema.safeParse({
        ...mediaEvent('download.requested'),
        detail: {
          ...mediaEvent('download.requested').detail,
          objectKey: 'secret',
        },
      }).success,
    ).toBe(false);
  });

  it('derives preview names by Unicode code point and preserves original names', () => {
    expect(guestDownloadFilename('Portrait.JpEg', 'preview')).toBe(
      'Portrait.preview.jpg',
    );
    expect(guestDownloadFilename('Portrait.PNG', 'preview')).toBe(
      'Portrait.preview.jpg',
    );
    expect(guestDownloadFilename('archive.tif', 'preview')).toBe(
      'archive.tif.preview.jpg',
    );
    const unicodeName = '🌄'.repeat(101) + '.png';
    expect(guestDownloadFilename(unicodeName, 'preview')).toBe(
      '🌄'.repeat(100) + '.preview.jpg',
    );
    expect(guestDownloadFilename('  原檔名.JPG  ', 'original')).toBe(
      '  原檔名.JPG  ',
    );
  });

  it('projects media audit details before legacy export details', () => {
    const media = {
      assetKind: 'preview',
      assetId: id(),
      filename: 'Portrait.preview.jpg',
      byteSize: 1024,
      mime: 'image/jpeg',
    };
    expect(
      projectOwnerHistoryDetails(
        'download.generated',
        null,
        JSON.stringify(media),
      ),
    ).toEqual({ status: 'available', before: null, after: media });
    const legacy = {
      submissionId: id(),
      format: 'csv',
      selectedCount: 3,
    };
    expect(
      projectOwnerHistoryDetails(
        'download.generated',
        null,
        JSON.stringify(legacy),
      ),
    ).toEqual({
      status: 'available',
      before: null,
      after: legacy,
    });
    expect(
      projectOwnerHistoryDetails(
        'download.generated',
        null,
        JSON.stringify({ ...media, objectKey: 'private-key' }),
      ).status,
    ).toBe('invalid');
  });

  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).GUEST_DOWNLOADS_ENABLED).toBe('false');
      expect(guestDownloadsCapability(env(mode))).toBe(false);
    },
  );

  it('keeps the capability local-only and independent from view rights', () => {
    expect(
      guestDownloadsCapability({
        ...env('local'),
        GUEST_DOWNLOADS_ENABLED: 'true',
        GUEST_EXCHANGE_ENABLED: 'false',
        GUEST_VERSION_COMPARISON_ENABLED: 'false',
      }),
    ).toBe(true);

    for (const mode of ['staging', 'production'] as const) {
      expect(() =>
        configuration({ ...env(mode), GUEST_DOWNLOADS_ENABLED: 'true' }),
      ).toThrow('GUEST_DOWNLOADS_LOCAL_ONLY');
    }
    expect(() =>
      configuration({ ...env('local'), GUEST_DOWNLOADS_ENABLED: 'TRUE' }),
    ).toThrow();
  });
});
