import { describe, expect, it } from 'vitest';
import {
  decodeResolvedUploadJournal,
  encodeResolvedUploadJournal,
  resolvedUploadJournalKey,
  type ResolvedUploadJournalItem,
  type ResolvedUploadJournalScope,
} from '../../apps/web/target-ui/resolved-upload-journal';

const uuid = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope: ResolvedUploadJournalScope = {
  actorId: uuid(1),
  workspaceId: uuid(2),
  projectId: uuid(3),
  albumId: uuid(4),
};
const now = 1_800_000_000_000;

const item = (n = 10): ResolvedUploadJournalItem => ({
  id: uuid(n),
  reservationBody: {
    requestId: uuid(n + 100),
    file: {
      originalFilename: 'Portrait_EDIT.jpg',
      expectedBytes: 1024,
      contentType: 'image/jpeg',
      sha256: 'a'.repeat(64),
      dimensions: { width: 2400, height: 3600 },
    },
    expectedChangeSequence: 27,
    expectedProjectRevision: 9,
    expectedMode: 'assisted',
    choice: {
      kind: 'new_version',
      photoId: uuid(20),
      parentVersionId: uuid(21),
      expectedRevision: 4,
    },
    confirm: true,
  },
  reservation: {
    uploadSession: {
      id: uuid(n + 200),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      albumId: scope.albumId,
      originalFilename: 'Portrait_EDIT.jpg',
      expectedBytes: 1024,
      reservedBytes: 1024,
      status: 'reserved',
      expiresAt: '2027-01-01T00:15:00.000Z',
      createdAt: '2027-01-01T00:00:00.000Z',
    },
    target: {
      kind: 'new_version',
      photoId: uuid(20),
      parentVersionId: uuid(21),
      expectedRevision: 4,
      capturedVersioningMode: 'assisted',
      changeType: 'new_retouch',
    },
  },
  authorizeBody: { requestId: uuid(n + 300) },
  completeBody: { requestId: uuid(n + 400) },
  fingerprint: {
    originalFilename: 'Portrait_EDIT.jpg',
    expectedBytes: 1024,
    contentType: 'image/jpeg',
    sha256: 'a'.repeat(64),
    dimensions: { width: 2400, height: 3600 },
  },
  needsReview: false,
});

describe('durable resolved-upload journal', () => {
  it('round-trips the exact reservation intent, request IDs, fingerprint, and private target', () => {
    const value = item();
    const encoded = encodeResolvedUploadJournal(scope, [value], now);
    const decoded = decodeResolvedUploadJournal(encoded, scope, now);

    expect(decoded).toEqual([value]);
    expect(decoded[0]?.reservationBody).toEqual(value.reservationBody);
    expect(decoded[0]?.reservation?.target).toEqual(value.reservation?.target);
    expect(decoded[0]?.authorizeBody).toEqual(value.authorizeBody);
    expect(decoded[0]?.completeBody).toEqual(value.completeBody);
    expect(encoded).not.toMatch(
      /https:\/\/|signedUrl|uploadAuthorization|cookie|rawBytes|accessToken/i,
    );
  });

  it('keeps the accepted mode and target captured for replay after UI mode changes', () => {
    const accepted = item();
    accepted.reservationBody.expectedMode = 'auto_filename';
    if (accepted.reservation?.target.kind === 'new_version')
      accepted.reservation.target.capturedVersioningMode = 'auto_filename';

    const restored = decodeResolvedUploadJournal(
      encodeResolvedUploadJournal(scope, [accepted], now),
      scope,
      now,
    )[0];

    expect(restored?.reservationBody.expectedMode).toBe('auto_filename');
    expect(restored?.reservationBody.choice).toEqual(
      accepted.reservationBody.choice,
    );
    expect(restored?.reservation?.target).toEqual(accepted.reservation?.target);
  });

  it('binds storage and decoding to the complete actor and album scope', () => {
    const encoded = encodeResolvedUploadJournal(scope, [item()], now);
    for (const key of [
      'actorId',
      'workspaceId',
      'projectId',
      'albumId',
    ] as const) {
      const otherScope = { ...scope, [key]: uuid(999) };
      expect(resolvedUploadJournalKey(otherScope)).not.toBe(
        resolvedUploadJournalKey(scope),
      );
      expect(() =>
        decodeResolvedUploadJournal(encoded, otherScope, now),
      ).toThrow();
    }

    const changedScope = JSON.parse(encoded) as {
      scope: ResolvedUploadJournalScope;
    };
    changedScope.scope.projectId = uuid(998);
    expect(() =>
      decodeResolvedUploadJournal(JSON.stringify(changedScope), scope, now),
    ).toThrow();
  });

  it('rejects a target that differs from the exact assisted choice', () => {
    const wrongTarget = item();
    if (wrongTarget.reservation?.target.kind === 'new_version')
      wrongTarget.reservation.target.expectedRevision += 1;
    expect(() =>
      encodeResolvedUploadJournal(scope, [wrongTarget], now),
    ).toThrow();

    const wrongPhoto = item();
    wrongPhoto.reservationBody.choice = {
      kind: 'new_version',
      photoId: uuid(99),
      parentVersionId: uuid(21),
      expectedRevision: 4,
    };
    expect(() =>
      encodeResolvedUploadJournal(scope, [wrongPhoto], now),
    ).toThrow();
  });

  it('rejects scope, fingerprint, and duplicate request ID mismatches', () => {
    const wrongScope = item();
    if (wrongScope.reservation)
      wrongScope.reservation.uploadSession.workspaceId = uuid(77);
    expect(() =>
      encodeResolvedUploadJournal(scope, [wrongScope], now),
    ).toThrow();

    const wrongFingerprint = item();
    wrongFingerprint.fingerprint.dimensions.width += 1;
    expect(() =>
      encodeResolvedUploadJournal(scope, [wrongFingerprint], now),
    ).toThrow();

    const duplicateRequest = item();
    duplicateRequest.authorizeBody.requestId =
      duplicateRequest.reservationBody.requestId;
    expect(() =>
      encodeResolvedUploadJournal(scope, [duplicateRequest], now),
    ).toThrow();
  });

  it('rejects extra credential or byte fields and limits entries and age', () => {
    expect(() =>
      encodeResolvedUploadJournal(scope, [item(), item(11)], now),
    ).toThrow();

    expect(() =>
      encodeResolvedUploadJournal(
        scope,
        [
          {
            ...item(),
            signedUrl: 'https://storage.invalid/put?token=private',
          } as ResolvedUploadJournalItem,
        ],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeResolvedUploadJournal(
        scope,
        [
          {
            ...item(),
            rawBytes: [1, 2, 3],
          } as ResolvedUploadJournalItem,
        ],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeResolvedUploadJournal(
        scope,
        [
          {
            ...item(),
            fingerprint: {
              ...item().fingerprint,
              expectedBytes: 64 * 1024 * 1024 + 1,
            },
          },
        ],
        now,
      ),
    ).toThrow();

    const encoded = encodeResolvedUploadJournal(scope, [item()], now);
    expect(() =>
      decodeResolvedUploadJournal(encoded, scope, now + 7 * 86_400_000 + 1),
    ).toThrow();
    expect(() =>
      decodeResolvedUploadJournal(encoded, scope, now - 60_001),
    ).toThrow();
    expect(() =>
      decodeResolvedUploadJournal('中'.repeat(22_000), scope, now),
    ).toThrow();
    expect(() => decodeResolvedUploadJournal('{', scope, now)).toThrow();
  });
});
