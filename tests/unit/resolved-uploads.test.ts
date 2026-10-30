import {
  configuration,
  resolvedUploadCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { describe, expect, it } from 'vitest';
import {
  resolvedUploadFileSchema,
  resolvedUploadPreviewRequestSchema,
  resolvedUploadPreviewResponseSchema,
  resolvedUploadReservationSchema,
  resolvedUploadReserveSchema,
} from '../../packages/contracts/src/resolved-uploads';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const albumId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const photoId = '55555555-5555-4555-8555-555555555555';
const versionId = '66666666-6666-4666-8666-666666666666';
const file = {
  originalFilename: ' portrait.jpg ',
  expectedBytes: 123,
  contentType: 'image/jpeg',
  sha256: 'a'.repeat(64),
  dimensions: { width: 800, height: 600 },
};
const decision = {
  outcome: 'new_photo',
  reason: 'No matching logical photo',
  photoId: null,
  versionId: null,
};
const candidate = {
  photoId,
  filename: 'portrait.jpg',
  currentVersionId: versionId,
  revision: 0,
};

describe('resolved upload file', () => {
  it('trims a valid filename and accepts exact size and pixel limits', () => {
    expect(resolvedUploadFileSchema.parse(file).originalFilename).toBe(
      'portrait.jpg',
    );
    expect(
      resolvedUploadFileSchema.safeParse({
        ...file,
        expectedBytes: 5_363_466_240,
        dimensions: { width: 10_000, height: 8_000 },
      }).success,
    ).toBe(true);
  });

  it('rejects filenames, byte bounds, MIME/hash, and unsafe dimensions', () => {
    for (const originalFilename of [
      '',
      '   ',
      'a/b.jpg',
      'a\\b.jpg',
      'a\u0001.jpg',
      'x'.repeat(256),
    ]) {
      expect(
        resolvedUploadFileSchema.safeParse({ ...file, originalFilename })
          .success,
      ).toBe(false);
    }
    for (const expectedBytes of [
      0,
      -1,
      1.5,
      5_363_466_241,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        resolvedUploadFileSchema.safeParse({ ...file, expectedBytes }).success,
      ).toBe(false);
    }
    for (const dimensions of [
      { width: 0, height: 10 },
      { width: 10, height: 0 },
      { width: 32_769, height: 1 },
      { width: 10_000, height: 8_001 },
      { width: 1.5, height: 10 },
      { width: 800, height: 600, rawWidth: 1600 },
    ]) {
      expect(
        resolvedUploadFileSchema.safeParse({ ...file, dimensions }).success,
      ).toBe(false);
    }
    expect(
      resolvedUploadFileSchema.safeParse({ ...file, contentType: 'image/gif' })
        .success,
    ).toBe(false);
    expect(
      resolvedUploadFileSchema.safeParse({
        ...file,
        sha256: 'A'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      resolvedUploadFileSchema.safeParse({ ...file, sessionId: requestId })
        .success,
    ).toBe(false);
    expect(
      resolvedUploadPreviewRequestSchema.safeParse({ file, workspaceId })
        .success,
    ).toBe(false);
  });
});

describe('resolved upload preview', () => {
  const response = {
    workspaceId,
    projectId,
    albumId,
    mode: 'auto_filename',
    projectRevision: 1,
    changeSequence: 0,
    decision,
    candidatesTruncated: false,
    candidates: [candidate],
  };

  it('accepts bounded candidates and rejects forged or invalid values', () => {
    expect(
      resolvedUploadPreviewResponseSchema.safeParse(response).success,
    ).toBe(true);
    expect(
      resolvedUploadPreviewResponseSchema.safeParse({
        ...response,
        candidates: Array.from({ length: 1000 }, () => candidate),
      }).success,
    ).toBe(true);
    for (const input of [
      { ...response, tenantId: workspaceId },
      { ...response, projectRevision: 0 },
      { ...response, projectRevision: 2_147_483_648 },
      { ...response, changeSequence: Number.MAX_SAFE_INTEGER + 1 },
      {
        ...response,
        candidates: Array.from({ length: 1001 }, () => candidate),
      },
      { ...response, candidates: [{ ...candidate, objectKey: 'forged' }] },
      { ...response, decision: { ...decision, outcome: 'skip' } },
      { ...response, decision: { ...decision, reason: '' } },
      { ...response, decision: { ...decision, reason: 'r'.repeat(101) } },
      { ...response, decision: { ...decision, photoId: 'bad' } },
      { ...response, decision: { ...decision, sessionId: requestId } },
    ]) {
      expect(resolvedUploadPreviewResponseSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });
});

describe('resolved upload reservation', () => {
  const reserve = {
    requestId,
    file,
    expectedChangeSequence: 0,
    expectedProjectRevision: 1,
    expectedMode: 'auto_filename',
    choice: { kind: 'new_photo' },
    confirm: true,
  };
  const uploadSession = {
    id: requestId,
    workspaceId,
    projectId,
    albumId,
    originalFilename: 'portrait.jpg',
    expectedBytes: 123,
    reservedBytes: 123,
    status: 'reserved',
    expiresAt: '2026-10-28T00:00:00Z',
    createdAt: '2026-10-27T00:00:00Z',
  };

  it('requires confirmation and an explicit non-skip choice', () => {
    expect(resolvedUploadReserveSchema.safeParse(reserve).success).toBe(true);
    expect(
      resolvedUploadReserveSchema.safeParse({
        ...reserve,
        choice: {
          kind: 'new_version',
          photoId,
          parentVersionId: versionId,
          expectedRevision: 0,
        },
      }).success,
    ).toBe(true);
    for (const input of [
      { ...reserve, confirm: false },
      { ...reserve, confirm: undefined },
      { ...reserve, choice: { kind: 'skip' } },
      { ...reserve, choice: { kind: 'new_photo', photoId } },
      { ...reserve, expectedMode: 'manual' },
      { ...reserve, expectedChangeSequence: -1 },
      { ...reserve, expectedProjectRevision: 0 },
      { ...reserve, ownerId: workspaceId },
    ]) {
      expect(resolvedUploadReserveSchema.safeParse(input).success).toBe(false);
    }
  });

  it('captures new-photo or immutable new-retouch targets with all four modes', () => {
    expect(
      resolvedUploadReservationSchema.safeParse({
        uploadSession,
        target: { kind: 'new_photo' },
      }).success,
    ).toBe(true);
    for (const capturedVersioningMode of [
      'off',
      'manual',
      'auto_filename',
      'assisted',
    ]) {
      expect(
        resolvedUploadReservationSchema.safeParse({
          uploadSession,
          target: {
            kind: 'new_version',
            photoId,
            parentVersionId: versionId,
            expectedRevision: 0,
            capturedVersioningMode,
            changeType: 'new_retouch',
          },
        }).success,
      ).toBe(true);
    }
    for (const target of [
      { kind: 'skip' },
      { kind: 'new_photo', photoId },
      {
        kind: 'new_version',
        photoId,
        parentVersionId: versionId,
        expectedRevision: 0,
        capturedVersioningMode: 'off',
        changeType: 'replace_current',
      },
    ]) {
      expect(
        resolvedUploadReservationSchema.safeParse({ uploadSession, target })
          .success,
      ).toBe(false);
    }
    expect(
      resolvedUploadReservationSchema.safeParse({
        uploadSession: { ...uploadSession, assetId: requestId },
        target: { kind: 'new_photo' },
      }).success,
    ).toBe(false);
  });
});

describe('Resolved upload capability gates', () => {
  const environment = (appEnv: 'local' | 'staging' | 'production') =>
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
      expect(resolvedUploadCapability(environment(appEnv))).toBe(false);
      expect(
        configuration(environment(appEnv)).PHOTO_VERSION_MATCHING_ENABLED,
      ).toBe('false');
    },
  );
  it.each(Array.from({ length: 32 }, (_, i) => i))(
    'requires all five supporting gates: %i',
    (mask) => {
      expect(
        resolvedUploadCapability({
          ...environment('local'),
          DIRECT_UPLOAD_ENABLED: mask & 1 ? 'true' : 'false',
          PHOTO_VERSIONS_ENABLED: mask & 2 ? 'true' : 'false',
          PHOTO_VERSION_UPLOADS_ENABLED: mask & 4 ? 'true' : 'false',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: mask & 8 ? 'true' : 'false',
          PHOTO_VERSION_MATCHING_ENABLED: mask & 16 ? 'true' : 'false',
        } as WorkerEnv),
      ).toBe(mask === 31);
    },
  );
  it.each(['staging', 'production'] as const)(
    'rejects matching enablement in %s',
    (appEnv) => {
      expect(() =>
        configuration({
          ...environment(appEnv),
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
        } as WorkerEnv),
      ).toThrow('PHOTO_VERSION_MATCHING_LOCAL_ONLY');
    },
  );
});
