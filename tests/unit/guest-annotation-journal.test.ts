import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const albumId = '11111111-1111-4111-8111-111111111111';
const guestId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const annotationId = '55555555-5555-4555-8555-555555555555';
const commentId = '66666666-6666-4666-8666-666666666666';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const storage = new MemoryStorage();

let journal: typeof import('../../apps/web/target-ui/guest-annotation-journal.ts');

async function loadJournal() {
  vi.resetModules();
  journal =
    await import('../../apps/web/target-ui/guest-annotation-journal.ts');
}

function scopeStorageKey() {
  return 'kino-pic:guest-annotations:v1:' + guestId + ':' + albumId;
}

function createMetadata(requestId = '77777777-7777-4777-8777-777777777777') {
  const command = {
    requestId,
    expectedGuestId: guestId,
    operation: 'create' as const,
    photoId,
    versionId,
    geometry: {
      type: 'point' as const,
      coordinateSpace: 'normalized_1e6' as const,
      x: 125_000,
      y: 875_000,
    },
    style: { color: 'amber' as const },
    commentId,
  };

  return journal.guestAnnotationJournalMetadata({
    albumId,
    expectedGuestId: guestId,
    photoId,
    versionId,
    command,
    expectedCurrent: null,
  });
}

function resolveMetadata(requestId = '88888888-8888-4888-8888-888888888888') {
  const command = {
    requestId,
    expectedGuestId: guestId,
    operation: 'resolve' as const,
    annotationId,
    expectedRevision: 7,
  };

  return journal.guestAnnotationJournalMetadata({
    albumId,
    expectedGuestId: guestId,
    photoId,
    versionId,
    command,
    expectedCurrent: {
      revision: 7,
      state: 'open',
      geometry: {
        type: 'rectangle',
        coordinateSpace: 'normalized_1e6',
        x: 100_000,
        y: 200_000,
        width: 300_000,
        height: 400_000,
      },
      style: { color: 'blue' },
      commentId: null,
    },
  });
}

beforeEach(async () => {
  storage.clear();
  vi.stubGlobal('window', { sessionStorage: storage });
  await loadJournal();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Guest annotation recovery journal', () => {
  it('stores only bodyless command metadata and reconstructs the exact command after reload', async () => {
    const metadata = createMetadata();
    if (metadata.command.operation !== 'create') return;
    const saved = journal.saveGuestAnnotationIntent(metadata);
    expect(saved.ok).toBe(true);
    expect(journal.isCurrentGuestAnnotationIntent(metadata)).toBe(true);

    const raw = storage.getItem(scopeStorageKey());
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('previewUrl');
    expect(raw).not.toContain('image');
    expect(raw).not.toContain('cookie');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('comment text');

    await loadJournal();
    const restored = journal.readGuestAnnotationJournal(guestId, albumId);
    expect(restored.kind).toBe('pending');
    if (restored.kind !== 'pending') return;
    if (restored.command.operation !== 'create') return;
    expect(restored.metadata).toEqual(metadata);
    expect(restored.command).toEqual(metadata.command);
    expect(restored.command.requestId).toBe(metadata.command.requestId);
    expect(restored.command.geometry).toEqual(metadata.command.geometry);
  });

  it('serializes a scope claim so only one sender owns the pending command', () => {
    const metadata = createMetadata();
    expect(journal.saveGuestAnnotationIntent(metadata).ok).toBe(true);

    const first = journal.claimGuestAnnotationIntent(metadata);
    const second = journal.claimGuestAnnotationIntent(metadata);
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    if (!first) return;
    expect(journal.releaseGuestAnnotationClaim(first)).toBe(true);
    const retry = journal.claimGuestAnnotationIntent(metadata);
    expect(retry).not.toBeNull();
  });

  it('keeps a replacement raw intent untouched when an older full-metadata CAS replies late', () => {
    const original = createMetadata();
    const replacement = resolveMetadata();
    expect(journal.saveGuestAnnotationIntent(original).ok).toBe(true);
    storage.setItem(scopeStorageKey(), JSON.stringify(replacement));

    expect(journal.markGuestAnnotationUncertain(original)).toBe(false);
    expect(journal.markGuestAnnotationConflict(original)).toBe(false);
    expect(journal.isCurrentGuestAnnotationIntent(original)).toBe(false);
    expect(journal.completeGuestAnnotationIntent(original)).toBe(false);
    expect(journal.abandonGuestAnnotationIntent(original)).toBe(false);
    expect(journal.claimGuestAnnotationIntent(original)).toBeNull();
    expect(storage.getItem(scopeStorageKey())).toBe(
      JSON.stringify(replacement),
    );

    const snapshot = journal.readGuestAnnotationJournal(guestId, albumId);
    expect(snapshot.kind).toBe('blocked');
    if (snapshot.kind === 'blocked') {
      expect(snapshot.reason).toBe('corrupt');
      expect(snapshot.metadata).toEqual(original);
    }
  });

  it('does not clear, demote, or claim a later different operation from a late first reply', () => {
    const original = createMetadata();
    expect(journal.saveGuestAnnotationIntent(original).ok).toBe(true);
    const firstClaim = journal.claimGuestAnnotationIntent(original);
    expect(firstClaim).not.toBeNull();
    if (!firstClaim) return;

    expect(journal.releaseGuestAnnotationClaim(firstClaim)).toBe(true);
    expect(journal.completeGuestAnnotationIntent(original)).toBe(true);

    const replacement = resolveMetadata();
    expect(journal.saveGuestAnnotationIntent(replacement).ok).toBe(true);
    const replacementClaim = journal.claimGuestAnnotationIntent(replacement);
    expect(replacementClaim).not.toBeNull();
    if (!replacementClaim) return;

    expect(journal.markGuestAnnotationUncertain(original)).toBe(false);
    expect(journal.markGuestAnnotationConflict(original)).toBe(false);
    expect(journal.isCurrentGuestAnnotationIntent(original)).toBe(false);
    expect(journal.isCurrentGuestAnnotationIntent(replacement)).toBe(true);
    expect(journal.completeGuestAnnotationIntent(original)).toBe(false);
    expect(journal.releaseGuestAnnotationClaim(firstClaim)).toBe(false);
    expect(journal.claimGuestAnnotationIntent(original)).toBeNull();

    const snapshot = journal.getGuestAnnotationJournalSnapshot(
      guestId,
      albumId,
    );
    expect(snapshot.kind).toBe('pending');
    if (snapshot.kind === 'pending') {
      expect(snapshot.metadata).toEqual(replacement);
      expect(snapshot.command.operation).toBe('resolve');
      expect(snapshot.sending).toBe(true);
    }
    expect(storage.getItem(scopeStorageKey())).toBe(
      JSON.stringify(replacement),
    );
    expect(journal.claimGuestAnnotationIntent(replacement)).toBeNull();
  });

  it('blocks replacement when storage contains corrupt metadata', () => {
    storage.setItem(scopeStorageKey(), '{"version":1,"unexpected":true}');

    const result = journal.saveGuestAnnotationIntent(createMetadata());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('existing');
    expect(result.snapshot.kind).toBe('blocked');
    expect(storage.getItem(scopeStorageKey())).toBe(
      '{"version":1,"unexpected":true}',
    );
  });

  it('blocks replacement when session storage is unavailable', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): never {
        throw new Error('storage unavailable');
      },
    });

    const result = journal.saveGuestAnnotationIntent(createMetadata());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('existing');
    expect(result.snapshot).toMatchObject({
      kind: 'blocked',
      reason: 'storage',
    });
  });

  it('preserves linked comment identifiers in update intent metadata', () => {
    const update = {
      requestId: '99999999-9999-4999-8999-999999999999',
      expectedGuestId: guestId,
      operation: 'update' as const,
      annotationId,
      expectedRevision: 3,
      geometry: {
        type: 'point' as const,
        coordinateSpace: 'normalized_1e6' as const,
        x: 500_000,
        y: 500_000,
      },
      style: { color: 'red' as const },
      commentId,
    };
    const metadata = journal.guestAnnotationJournalMetadata({
      albumId,
      expectedGuestId: guestId,
      photoId,
      versionId,
      command: update,
      expectedCurrent: {
        revision: 3,
        state: 'open',
        geometry: {
          type: 'point',
          coordinateSpace: 'normalized_1e6',
          x: 100_000,
          y: 200_000,
        },
        style: { color: 'amber' },
        commentId,
      },
    });

    expect(journal.saveGuestAnnotationIntent(metadata).ok).toBe(true);
    const stored = JSON.parse(storage.getItem(scopeStorageKey()) ?? 'null');
    expect(stored.command.commentId).toBe(commentId);
    expect(stored.expectedCurrent.commentId).toBe(commentId);
  });
});
