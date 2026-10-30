import { describe, expect, it } from 'vitest';
import {
  versionUploadCapabilitiesSchema,
  versionUploadCompletionSchema,
  versionUploadInitResultSchema,
  versionUploadInitSchema,
  versionUploadTargetSchema,
  versionUploadRecoverySchema,
} from '../../packages/contracts/src/version-uploads';

const id = (number: number) =>
  '00000000-0000-4000-8000-' + String(number).padStart(12, '0');

const request = {
  requestId: id(1),
  originalFilename: ' retouch.png ',
  expectedBytes: 1024,
  contentType: 'image/png',
  sha256: 'a'.repeat(64),
  expectedRevision: 3,
  expectedCurrentVersionId: id(2),
  changeType: 'new_retouch',
  changeNote: '  cafe\u0301\n\tupdated  ',
  labels: ['  cafe\u0301 ', ' Final '],
  confirm: true,
} as const;

const session = {
  id: id(10),
  workspaceId: id(11),
  projectId: id(12),
  albumId: id(13),
  originalFilename: 'retouch.png',
  expectedBytes: 1024,
  reservedBytes: 1024,
  status: 'reserved',
  expiresAt: '2026-10-26T12:30:00.000Z',
  createdAt: '2026-10-26T12:00:00.000Z',
} as const;

describe('manual version-upload contracts', () => {
  it('keeps capabilities strict and disabled state explicit', () => {
    expect(versionUploadCapabilitiesSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(
      versionUploadCapabilitiesSchema.safeParse({ enabled: true, mode: 'auto' })
        .success,
    ).toBe(false);
  });

  it('canonicalizes explicit init metadata and never accepts caller target scope', () => {
    const parsed = versionUploadInitSchema.parse(request);
    expect(parsed).toEqual({
      ...request,
      originalFilename: 'retouch.png',
      changeNote: 'café\n\tupdated',
      labels: ['café', 'Final'],
    });

    for (const field of ['photoId', 'workspaceId', 'projectId', 'albumId']) {
      expect(
        versionUploadInitSchema.safeParse({ ...request, [field]: id(90) })
          .success,
      ).toBe(false);
    }
    for (const candidate of [
      { ...request, confirm: false },
      { ...request, expectedCurrentVersionId: 'invalid' },
      { ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...request, contentType: 'image/gif' },
      { ...request, extra: 'not allowed' },
    ]) {
      expect(versionUploadInitSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it('requires note and labels to be explicit while allowing intentional empties', () => {
    expect(
      versionUploadInitSchema.parse({ ...request, changeNote: '', labels: [] }),
    ).toMatchObject({ changeNote: '', labels: [] });
    const withoutNote = Object.fromEntries(
      Object.entries(request).filter(([key]) => key !== 'changeNote'),
    );
    const withoutLabels = Object.fromEntries(
      Object.entries(request).filter(([key]) => key !== 'labels'),
    );
    expect(versionUploadInitSchema.safeParse(withoutNote).success).toBe(false);
    expect(versionUploadInitSchema.safeParse(withoutLabels).success).toBe(
      false,
    );
  });

  it('counts label and note limits in Unicode code points and rejects controls', () => {
    const fortyCodePoints = '😀'.repeat(40);
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        labels: [fortyCodePoints],
      }).success,
    ).toBe(true);
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        labels: ['😀'.repeat(41)],
      }).success,
    ).toBe(false);
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        labels: ['valid\u200bhidden'],
      }).success,
    ).toBe(false);
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        labels: ['valid\ufeff'],
      }).success,
    ).toBe(false);
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        changeNote: 'line one\nline two\tend',
      }).success,
    ).toBe(true);
    for (const changeNote of [
      'bad\u0001control',
      'bad\u200bformat',
      '\ufeff',
      '😀'.repeat(2001),
    ]) {
      expect(
        versionUploadInitSchema.safeParse({ ...request, changeNote }).success,
      ).toBe(false);
    }
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        changeNote: '😀'.repeat(2000),
      }).success,
    ).toBe(true);
  });

  it('requires unique canonical labels while preserving case distinctions', () => {
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        labels: ['café', 'Final', 'CAFÉ'],
      }).success,
    ).toBe(true);
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        labels: ['café', ' cafe\u0301 '],
      }).success,
    ).toBe(false);
    expect(
      versionUploadInitSchema.safeParse({
        ...request,
        labels: Array.from({ length: 17 }, (_, index) => `tag-${index}`),
      }).success,
    ).toBe(false);
  });

  it('binds returned target metadata to the upload session and rejects private fields', () => {
    const target = {
      photoId: id(20),
      parentVersionId: id(2),
      expectedRevision: 3,
      changeType: 'new_retouch',
      changeNote: ' café ',
      labels: [' Final '],
    };
    const parsed = versionUploadInitResultSchema.parse({
      uploadSession: session,
      target,
    });
    expect(parsed.target.changeNote).toBe('café');
    expect(parsed.target.labels).toEqual(['Final']);
    expect(
      versionUploadTargetSchema.safeParse({
        ...target,
        workspaceId: id(11),
      }).success,
    ).toBe(false);
    expect(
      versionUploadInitResultSchema.safeParse({
        uploadSession: session,
        target: { ...target, signedUrl: 'https://storage.invalid/token' },
      }).success,
    ).toBe(false);
    expect(
      versionUploadInitResultSchema.safeParse({
        uploadSession: session,
        target,
        photoId: id(21),
      }).success,
    ).toBe(false);
  });

  it('validates immutable completion metadata and keeps completion strict', () => {
    const completion = {
      uploadSessionId: id(30),
      status: 'completed',
      photoId: id(20),
      versionId: id(31),
      assetId: id(32),
      actualBytes: 1024,
      contentType: 'image/png',
      sha256: 'b'.repeat(64),
      width: 2400,
      height: 1600,
      completedAt: '2026-10-26T12:30:00.000Z',
      versionNo: 4,
      parentVersionId: id(2),
      changeType: 'replace_current',
      changeNote: ' Retouch pass 2 ',
      labels: [' Final '],
    } as const;
    expect(versionUploadCompletionSchema.parse(completion)).toMatchObject({
      versionNo: 4,
      parentVersionId: id(2),
      changeNote: 'Retouch pass 2',
      labels: ['Final'],
    });
    for (const candidate of [
      { ...completion, versionNo: 0 },
      { ...completion, parentVersionId: 'not-a-uuid' },
      { ...completion, signedUrl: 'https://storage.invalid/token' },
      { ...completion, target: { photoId: id(20) } },
    ]) {
      expect(versionUploadCompletionSchema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });
});

describe('version upload recovery privacy', () => {
  it('recovers the immutable target with upload status but no storage credentials', () => {
    const recovered = {
      initRequestId: request.requestId,
      uploadSession: session,
      contentType: 'image/png',
      sha256: request.sha256,
      authorizationRequestId: null,
      authorizationExpiresAt: null,
      target: {
        photoId: id(20),
        parentVersionId: request.expectedCurrentVersionId,
        expectedRevision: request.expectedRevision,
        changeType: request.changeType,
        changeNote: 'Retouch',
        labels: ['Final'],
      },
    };
    expect(versionUploadRecoverySchema.parse(recovered).target.photoId).toBe(
      id(20),
    );
    for (const candidate of [
      { ...recovered, objectKey: 'private/original' },
      { ...recovered, signedUrl: 'https://private.invalid/token' },
      { ...recovered, target: { ...recovered.target, sessionId: id(99) } },
      { ...recovered, target: undefined },
      { ...recovered, authorizationRequestId: 'invalid' },
    ]) {
      expect(versionUploadRecoverySchema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });
});
