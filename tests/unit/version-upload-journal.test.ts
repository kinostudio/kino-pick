import { describe, expect, it } from 'vitest';
import {
  decodeVersionUploadJournal,
  encodeVersionUploadJournal,
  versionUploadJournalKey,
  type VersionUploadJournalItem,
  type VersionUploadJournalScope,
} from '../../apps/web/target-ui/version-upload-journal';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope: VersionUploadJournalScope = {
  actorId: uuid(1),
  workspaceId: uuid(2),
  projectId: uuid(3),
  albumId: uuid(4),
  photoId: uuid(5),
};
const now = 1800000000000;

const item = (n = 10): VersionUploadJournalItem => ({
  id: uuid(n),
  initBody: {
    requestId: uuid(n + 100),
    originalFilename: 'retouch.png',
    expectedBytes: 1024,
    contentType: 'image/png',
    sha256: 'a'.repeat(64),
    expectedRevision: 7,
    expectedCurrentVersionId: uuid(6),
    changeType: 'new_retouch',
    changeNote: 'Color correction',
    labels: ['portrait', 'approved'],
    confirm: true,
  },
  uploadSessionId: uuid(n + 200),
  authorizeBody: { requestId: uuid(n + 300) },
  completeBody: { requestId: uuid(n + 400) },
  cancelBody: null,
  width: 240,
  height: 480,
});

describe('bounded immutable version-upload journal', () => {
  it('round-trips the frozen head witness and canonical change metadata only', () => {
    const value = item();
    value.initBody.changeNote = '  Cafe\u0301  ';
    value.initBody.labels = ['  e\u0301  ', 'approved'];

    const encoded = encodeVersionUploadJournal(scope, [value], now);
    const decoded = decodeVersionUploadJournal(encoded, scope, now);

    expect(decoded[0]).toMatchObject({
      id: value.id,
      initBody: {
        expectedRevision: 7,
        expectedCurrentVersionId: uuid(6),
        changeType: 'new_retouch',
        changeNote: 'Café',
        labels: ['é', 'approved'],
      },
    });
    expect(decoded[0]?.initBody.requestId).toBe(value.initBody.requestId);
    expect(decoded[0]?.authorizeBody).toEqual(value.authorizeBody);
    expect(decoded[0]?.completeBody).toEqual(value.completeBody);
    expect(decoded[0]?.uploadSessionId).toBe(value.uploadSessionId);
    expect(encoded).not.toMatch(
      /https:|blob:|authorization|cookie|token|base64/i,
    );
  });

  it('binds the key and record to the full actor, tenant, album, and photo scope', () => {
    const encoded = encodeVersionUploadJournal(scope, [item()], now);
    for (const key of [
      'actorId',
      'workspaceId',
      'projectId',
      'albumId',
      'photoId',
    ] as const) {
      const otherScope = { ...scope, [key]: uuid(999) };
      expect(versionUploadJournalKey(otherScope)).not.toBe(
        versionUploadJournalKey(scope),
      );
      expect(() =>
        decodeVersionUploadJournal(encoded, otherScope, now),
      ).toThrow();
    }

    const payloadWithOtherPhoto = JSON.parse(encoded) as {
      scope: VersionUploadJournalScope;
    };
    payloadWithOtherPhoto.scope.photoId = uuid(998);
    expect(() =>
      decodeVersionUploadJournal(
        JSON.stringify(payloadWithOtherPhoto),
        scope,
        now,
      ),
    ).toThrow();
  });

  it('rejects duplicate item, operation, and session UUIDs', () => {
    expect(() =>
      encodeVersionUploadJournal(scope, [item(), item()], now),
    ).toThrow();
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [{ ...item(), completeBody: item().authorizeBody }],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [item(), { ...item(11), cancelBody: item().completeBody }],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [item(), { ...item(11), uploadSessionId: item().uploadSessionId }],
        now,
      ),
    ).toThrow();
  });

  it('enforces the item, byte, dimension, and seven-day bounds', () => {
    const twenty = Array.from({ length: 20 }, (_, n) => item(n + 10));
    expect(
      decodeVersionUploadJournal(
        encodeVersionUploadJournal(scope, twenty, now),
        scope,
        now,
      ),
    ).toHaveLength(20);
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        Array.from({ length: 21 }, (_, n) => item(n + 10)),
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [
          {
            ...item(),
            initBody: { ...item().initBody, expectedBytes: 67108865 },
          },
        ],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [{ ...item(), width: 10000, height: 10000 }],
        now,
      ),
    ).toThrow();
    expect(() =>
      decodeVersionUploadJournal('中'.repeat(22000), scope, now),
    ).toThrow();

    const encoded = encodeVersionUploadJournal(scope, [item()], now);
    expect(() =>
      decodeVersionUploadJournal(encoded, scope, now + 7 * 86400000 + 1),
    ).toThrow();
    expect(() =>
      decodeVersionUploadJournal(encoded, scope, now - 60001),
    ).toThrow();
    expect(() => decodeVersionUploadJournal('{', scope, now)).toThrow();
  });

  it('preserves authored URLs and hash-like filenames but rejects secret and byte fields', () => {
    const authored = item();
    authored.initBody.originalFilename = `${'f'.repeat(64)}.jpg`;
    authored.initBody.changeNote =
      'Reference image: https://example.invalid/ref';
    const roundTrip = decodeVersionUploadJournal(
      encodeVersionUploadJournal(scope, [authored], now),
      scope,
      now,
    );
    expect(roundTrip[0]?.initBody.originalFilename).toBe(
      authored.initBody.originalFilename,
    );
    expect(roundTrip[0]?.initBody.changeNote).toBe(
      authored.initBody.changeNote,
    );

    const unsafeItem = {
      ...item(),
      signedUrl: 'https://storage.invalid/signed?token=secret',
    };
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [unsafeItem as VersionUploadJournalItem],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [
          {
            ...item(),
            authorization: { url: 'https://storage.invalid', token: 'private' },
          } as VersionUploadJournalItem,
        ],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeVersionUploadJournal(
        scope,
        [
          {
            ...item(),
            rawBytes: [1, 2, 3],
          } as VersionUploadJournalItem,
        ],
        now,
      ),
    ).toThrow();
  });
});
