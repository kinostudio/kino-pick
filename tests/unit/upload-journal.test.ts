import { describe, expect, it } from 'vitest';
import {
  decodeUploadJournal,
  encodeUploadJournal,
  uploadJournalKey,
  type UploadJournalItem,
  type UploadJournalScope,
} from '../../apps/web/target-ui/upload-journal';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope: UploadJournalScope = {
  actorId: uuid(1),
  workspaceId: uuid(2),
  projectId: uuid(3),
  albumId: uuid(4),
};
const now = 1800000000000;
const item = (n = 10): UploadJournalItem => ({
  id: uuid(n),
  initBody: {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    albumId: scope.albumId,
    originalFilename: 'portrait.png',
    expectedBytes: 100,
    contentType: 'image/png',
    sha256: 'a'.repeat(64),
    requestId: uuid(n + 100),
  },
  uploadSessionId: uuid(n + 200),
  authorizeBody: { requestId: uuid(n + 300) },
  completeBody: { requestId: uuid(n + 400) },
  cancelBody: null,
  width: 24,
  height: 48,
});
describe('bounded untrusted upload recovery journal', () => {
  it('round-trips exact operation IDs and metadata without bearer capabilities or binary payloads', () => {
    const value = item();
    const encoded = encodeUploadJournal(scope, [value], now);
    expect(decodeUploadJournal(encoded, scope, now)).toEqual([value]);
    expect(decodeUploadJournal(null, scope, now)).toEqual([]);
    expect(encoded).not.toMatch(
      /https:|blob:|authorization|previewUrl|cookie|token|base64/i,
    );
  });
  it('isolates actor and all resource scopes', () => {
    const encoded = encodeUploadJournal(scope, [item()], now);
    for (const key of [
      'actorId',
      'workspaceId',
      'projectId',
      'albumId',
    ] as const) {
      const other = { ...scope, [key]: uuid(999) };
      expect(uploadJournalKey(other)).not.toEqual(uploadJournalKey(scope));
      expect(() => decodeUploadJournal(encoded, other, now)).toThrow();
    }
    expect(() =>
      encodeUploadJournal(
        scope,
        [{ ...item(), initBody: { ...item().initBody, albumId: uuid(999) } }],
        now,
      ),
    ).toThrow();
  });
  it('rejects duplicate item or operation IDs before they can alias server requests', () => {
    expect(() => encodeUploadJournal(scope, [item(), item()], now)).toThrow();
    expect(() =>
      encodeUploadJournal(
        scope,
        [{ ...item(), completeBody: item().authorizeBody }],
        now,
      ),
    ).toThrow();
    expect(() =>
      encodeUploadJournal(
        scope,
        [item(), { ...item(11), completeBody: item().authorizeBody }],
        now,
      ),
    ).toThrow();
  });
  it('enforces 20 entries, 64KiB reads and seven-day expiry without deleting any data', () => {
    expect(
      decodeUploadJournal(
        encodeUploadJournal(
          scope,
          Array.from({ length: 20 }, (_, n) => item(n + 10)),
          now,
        ),
        scope,
        now,
      ),
    ).toHaveLength(20);
    expect(() =>
      encodeUploadJournal(
        scope,
        Array.from({ length: 21 }, (_, n) => item(n + 10)),
        now,
      ),
    ).toThrow();
    expect(() => decodeUploadJournal(' '.repeat(65537), scope, now)).toThrow();
    expect(() => decodeUploadJournal('中'.repeat(22000), scope, now)).toThrow();
    const encoded = encodeUploadJournal(scope, [item()], now);
    expect(() =>
      decodeUploadJournal(encoded, scope, now + 7 * 86400000 + 1),
    ).toThrow();
    expect(() => decodeUploadJournal(encoded, scope, now - 60001)).toThrow();
    expect(() => decodeUploadJournal('{', scope, now)).toThrow();
  });
  it('rejects injected secrets, oversized files and invalid pixel dimensions', () => {
    const extra = {
      ...item(),
      authorization: { url: 'https://secret.invalid' },
    };
    expect(() => encodeUploadJournal(scope, [extra], now)).toThrow();
    expect(() =>
      encodeUploadJournal(
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
      encodeUploadJournal(
        scope,
        [{ ...item(), width: 10000, height: 10000 }],
        now,
      ),
    ).toThrow();
  });
});
