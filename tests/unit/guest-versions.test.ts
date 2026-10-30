import {
  configuration,
  guestVersionComparisonCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { describe, expect, it } from 'vitest';
import {
  guestPhotoVersionSchema,
  guestPhotoVersionsPageSchema,
  guestVersionComparisonCapabilitiesSchema,
} from '../../packages/contracts/src/guest-versions';

const makeId = (sequence: number) =>
  '00000000-0000-4000-8000-' + String(sequence).padStart(12, '0');
const albumId = makeId(1);
const photoId = makeId(2);
const currentVersionId = makeId(3);
const createdAt = '2026-10-26T12:30:00.000Z';

function makeVersion(
  versionId: string,
  versionNo: number,
  isCurrent = false,
  routePhotoId = photoId,
) {
  return {
    versionId,
    versionNo,
    width: 2400,
    height: 1600,
    createdAt,
    createdByLabel: '攝影師' as const,
    labels: [] as string[],
    isCurrent,
    thumbnailUrl: `/api/guest/photos/${routePhotoId}/versions/${versionId}/assets/thumbnail`,
    previewUrl: `/api/guest/photos/${routePhotoId}/versions/${versionId}/assets/preview`,
  };
}

function makePage() {
  const currentVersion = makeVersion(currentVersionId, 3, true);
  const versions = [
    currentVersion,
    makeVersion(makeId(4), 2),
    makeVersion(makeId(5), 1),
  ];
  return {
    albumId,
    photoId,
    head: { versionId: currentVersionId, revision: 2 },
    currentVersion,
    versions,
    nextCursor: null as string | null,
  };
}

describe('Guest photo version contracts', () => {
  it('keeps capability and page metadata strict and accepts an empty ready list', () => {
    expect(
      guestVersionComparisonCapabilitiesSchema.parse({ enabled: true }),
    ).toEqual({ enabled: true });
    expect(
      guestVersionComparisonCapabilitiesSchema.safeParse({
        enabled: true,
        photoId,
      }).success,
    ).toBe(false);

    const page = makePage();
    expect(guestPhotoVersionsPageSchema.parse(page).versions).toHaveLength(3);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: { versionId: makeId(6), revision: 0 },
        currentVersion: null,
        versions: [],
      }).success,
    ).toBe(true);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        workspaceId: makeId(7),
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        nextCursor: 'c'.repeat(513),
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: {
          versionId: currentVersionId,
          revision: Number.MAX_SAFE_INTEGER + 1,
        },
      }).success,
    ).toBe(false);
  });

  it('accepts bounded pages and rejects more than 24 versions', () => {
    const pinnedCurrentVersion = makeVersion(makeId(100), 24, true);
    const versions = [
      pinnedCurrentVersion,
      ...Array.from({ length: 23 }, (_, index) =>
        makeVersion(makeId(index + 101), 23 - index),
      ),
    ];
    const page = {
      ...makePage(),
      head: { versionId: makeId(100), revision: 0 },
      currentVersion: pinnedCurrentVersion,
      versions,
      nextCursor: 'c'.repeat(512),
    };
    expect(guestPhotoVersionsPageSchema.parse(page).versions).toHaveLength(24);
    const pinnedTooManyCurrentVersion = makeVersion(makeId(200), 25, true);
    const tooManyVersions = [
      pinnedTooManyCurrentVersion,
      ...Array.from({ length: 24 }, (_, index) =>
        makeVersion(makeId(index + 201), 24 - index),
      ),
    ];
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: { versionId: makeId(200), revision: 0 },
        currentVersion: pinnedTooManyCurrentVersion,
        versions: tooManyVersions,
      }).success,
    ).toBe(false);
  });

  it('requires exact Guest thumbnail and preview routes with a matching version ID', () => {
    const version = makeVersion(makeId(20), 1);
    expect(guestPhotoVersionSchema.parse(version).versionId).toBe(
      version.versionId,
    );

    const invalidThumbnailUrls = [
      `https://example.test${version.thumbnailUrl}`,
      `//example.test${version.thumbnailUrl}`,
      `http:/example.test${version.thumbnailUrl}`,
      `${version.thumbnailUrl}?download=1`,
      `${version.thumbnailUrl}#preview`,
      `/api/guest/photos/../versions/${version.versionId}/assets/thumbnail`,
      `/api/guest/photos/%2e%2e/versions/${version.versionId}/assets/thumbnail`,
      `/api/guest/photos/${photoId}/versions/%2f/assets/thumbnail`,
      `/api/guest/photos/${photoId}/versions/${version.versionId}/assets/%74humbnail`,
      `/api/guest/photos/${photoId}/versions/${version.versionId}/assets/preview`,
      `/api/guest/photos/${photoId}/versions/${makeId(21)}/assets/thumbnail`,
    ];

    for (const thumbnailUrl of invalidThumbnailUrls) {
      expect(
        guestPhotoVersionSchema.safeParse({ ...version, thumbnailUrl }).success,
      ).toBe(false);
    }
    expect(
      guestPhotoVersionSchema.safeParse({
        ...version,
        previewUrl: `${version.previewUrl}?token=secret`,
      }).success,
    ).toBe(false);
  });

  it('binds both asset routes to the page photo ID', () => {
    const page = makePage();
    const foreignPhotoVersion = makeVersion(makeId(30), 1, false, makeId(31));

    expect(guestPhotoVersionSchema.safeParse(foreignPhotoVersion).success).toBe(
      true,
    );
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: { versionId: makeId(32), revision: 0 },
        currentVersion: null,
        versions: [foreignPhotoVersion],
      }).success,
    ).toBe(false);
  });

  it('requires isCurrent to agree with the head without requiring the head on every page', () => {
    const page = makePage();
    expect(guestPhotoVersionsPageSchema.safeParse(page).success).toBe(true);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        versions: page.versions.map((version) => ({
          ...version,
          isCurrent: false,
        })),
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        versions: page.versions.map((version, index) => ({
          ...version,
          isCurrent: index === 1,
        })),
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: { versionId: makeId(40), revision: 4 },
        currentVersion: null,
        versions: page.versions.map((version) => ({
          ...version,
          isCurrent: false,
        })),
      }).success,
    ).toBe(true);
  });

  it('pins currentVersion to the page head and photo', () => {
    const page = makePage();
    expect(guestPhotoVersionsPageSchema.safeParse(page).success).toBe(true);

    const pinnedVersionId = makeId(80);
    const pinnedVersion = makeVersion(pinnedVersionId, 7, true);
    const pageWithoutReadyHistory = {
      ...page,
      head: { versionId: pinnedVersionId, revision: 3 },
      currentVersion: pinnedVersion,
      versions: [],
    };
    expect(
      guestPhotoVersionsPageSchema.safeParse(pageWithoutReadyHistory).success,
    ).toBe(true);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...pageWithoutReadyHistory,
        currentVersion: makeVersion(makeId(81), 7, true),
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...pageWithoutReadyHistory,
        currentVersion: { ...pinnedVersion, isCurrent: false },
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...pageWithoutReadyHistory,
        currentVersion: makeVersion(pinnedVersionId, 7, true, makeId(82)),
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate version IDs, duplicate numbers, and non-descending order', () => {
    const page = makePage();
    const firstId = makeId(50);
    const secondId = makeId(51);

    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: { versionId: makeId(52), revision: 0 },
        currentVersion: null,
        versions: [makeVersion(firstId, 2), makeVersion(firstId, 1)],
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: { versionId: makeId(52), revision: 0 },
        currentVersion: null,
        versions: [makeVersion(firstId, 3), makeVersion(secondId, 3)],
      }).success,
    ).toBe(false);
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...page,
        head: { versionId: makeId(52), revision: 0 },
        currentVersion: null,
        versions: [makeVersion(firstId, 1), makeVersion(secondId, 2)],
      }).success,
    ).toBe(false);
  });

  it('enforces UTC timestamps and paired bounded dimensions', () => {
    const version = makeVersion(makeId(60), 1);
    expect(
      guestPhotoVersionSchema.safeParse({
        ...version,
        width: null,
        height: null,
      }).success,
    ).toBe(true);

    for (const overrides of [
      { width: null },
      { height: null },
      { width: 32_769 },
      { height: 32_769 },
      { width: 10_000, height: 9_000 },
      { versionNo: 0 },
      { versionNo: Number.MAX_SAFE_INTEGER + 1 },
      { createdAt: '2026-10-26T12:30:00.000+08:00' },
      { createdAt: 'not-a-time' },
    ]) {
      expect(
        guestPhotoVersionSchema.safeParse({ ...version, ...overrides }).success,
      ).toBe(false);
    }
  });

  it('rejects internal keys, hashes, and actor metadata', () => {
    const version = makeVersion(makeId(70), 1);
    for (const extra of [
      { storageKey: 'private/object' },
      { sha256: '0'.repeat(64) },
      { checksum: '0'.repeat(64) },
      { actorId: makeId(71) },
      { uploadedBy: makeId(71) },
    ]) {
      expect(
        guestPhotoVersionSchema.safeParse({ ...version, ...extra }).success,
      ).toBe(false);
    }
    expect(
      guestPhotoVersionsPageSchema.safeParse({
        ...makePage(),
        objectKey: 'private/object',
      }).success,
    ).toBe(false);
  });
});

describe('Guest version display metadata privacy', () => {
  it('allows only the public role label and normalized unique version labels', () => {
    const version = makeVersion(currentVersionId, 3, true);
    expect(
      guestPhotoVersionSchema.safeParse({
        ...version,
        labels: ['精修', '膚色調整'],
      }).success,
    ).toBe(true);
    for (const invalid of [
      { createdByLabel: 'owner@example.test' },
      { actorId: makeId(10) },
      { labels: ['x', 'x'] },
      { labels: [' x '] },
      { labels: ['x\u202e'] },
      { labels: ['x'.repeat(41)] },
      { labels: Array.from({ length: 17 }, (_, i) => String(i)) },
    ]) {
      expect(
        guestPhotoVersionSchema.safeParse({ ...version, ...invalid }).success,
      ).toBe(false);
    }
  });
});

describe('Guest version comparison feature gates', () => {
  const env = (appEnv: 'local' | 'staging' | 'production') =>
    ({
      APP_ENV: appEnv,
      APP_URL:
        appEnv === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
      REGISTRATION_MODE: 'closed',
      STORAGE_AUTODELETE_ENABLED: 'false',
      STORAGE_RETENTION_DRY_RUN: 'true',
      MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    }) as WorkerEnv;
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (appEnv) => {
      expect(guestVersionComparisonCapability(env(appEnv))).toBe(false);
      expect(configuration(env(appEnv)).GUEST_VERSION_COMPARISON_ENABLED).toBe(
        'false',
      );
    },
  );
  it.each(Array.from({ length: 8 }, (_, i) => i))(
    'requires three supporting gates %i',
    (mask) => {
      expect(
        guestVersionComparisonCapability({
          ...env('local'),
          GUEST_EXCHANGE_ENABLED: mask & 1 ? 'true' : 'false',
          PHOTO_VERSIONS_ENABLED: mask & 2 ? 'true' : 'false',
          GUEST_VERSION_COMPARISON_ENABLED: mask & 4 ? 'true' : 'false',
          GUEST_SELECTION_ENABLED: 'false',
        } as WorkerEnv),
      ).toBe(mask === 7);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects enablement in %s',
    (appEnv) => {
      expect(() =>
        configuration({
          ...env(appEnv),
          GUEST_VERSION_COMPARISON_ENABLED: 'true',
        }),
      ).toThrow('GUEST_VERSION_COMPARISON_LOCAL_ONLY');
    },
  );
});
