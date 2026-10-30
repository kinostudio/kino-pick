import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const albumId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const inviteId = '33333333-3333-4333-8333-333333333333';
const photoId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const annotationId = '66666666-6666-4666-8666-666666666666';
const commentId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const storage = new MemoryStorage();
let journal: typeof import('../../apps/web/target-ui/owner-annotation-journal.ts');

async function loadJournal() {
  vi.resetModules();
  journal =
    await import('../../apps/web/target-ui/owner-annotation-journal.ts');
}

function key() {
  return 'kino-pic:owner-annotations:v1:' + ownerId + ':' + albumId;
}

function createMetadata(requestId = '77777777-7777-4777-8777-777777777777') {
  const command = {
    requestId,
    expectedOwnerId: ownerId,
    inviteId,
    photoId,
    versionId,
    operation: 'create' as const,
    geometry: {
      type: 'point' as const,
      coordinateSpace: 'normalized_1e6' as const,
      x: 125_000,
      y: 875_000,
    },
    style: { color: 'amber' as const },
    commentId: null,
  };
  return journal.ownerAnnotationJournalMetadata({
    ownerId,
    albumId,
    inviteId,
    photoId,
    versionId,
    command,
    expectedCurrent: null,
  });
}

function createFreehandMetadata(
  requestId = '77777777-7777-4777-8777-777777777778',
) {
  const command = {
    requestId,
    expectedOwnerId: ownerId,
    inviteId,
    photoId,
    versionId,
    operation: 'create' as const,
    geometry: {
      type: 'freehand' as const,
      coordinateSpace: 'normalized_1e6' as const,
      version: 1 as const,
      points: [
        { x: 125_000, y: 875_000 },
        { x: 375_000, y: 625_000 },
      ],
    },
    style: { color: 'red' as const },
    commentId: null,
  };
  return journal.ownerAnnotationJournalMetadata({
    ownerId,
    albumId,
    inviteId,
    photoId,
    versionId,
    command,
    expectedCurrent: null,
  });
}

function resolveMetadata(requestId = '88888888-8888-4888-8888-888888888888') {
  const command = {
    requestId,
    expectedOwnerId: ownerId,
    inviteId,
    photoId,
    versionId,
    operation: 'resolve' as const,
    annotationId,
    expectedRevision: 7,
  };
  return journal.ownerAnnotationJournalMetadata({
    ownerId,
    albumId,
    inviteId,
    photoId,
    versionId,
    command,
    expectedCurrent: {
      revision: 7,
      state: 'open',
      geometry: {
        type: 'rectangle' as const,
        coordinateSpace: 'normalized_1e6' as const,
        x: 100_000,
        y: 200_000,
        width: 300_000,
        height: 400_000,
      },
      style: { color: 'blue' as const },
      commentId,
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

describe('Owner annotation recovery journal', () => {
  it('stores only command metadata and restores the exact request after reload', async () => {
    const metadata = createMetadata();
    const saved = journal.saveOwnerAnnotationIntent(metadata);
    expect(saved.ok).toBe(true);
    expect(journal.isCurrentOwnerAnnotationIntent(metadata)).toBe(true);

    const raw = storage.getItem(key());
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('previewUrl');
    expect(raw).not.toContain('image');
    expect(raw).not.toContain('cookie');
    expect(raw).not.toContain('sessionId');
    expect(raw).not.toContain('comment text');

    await loadJournal();
    const restored = journal.readOwnerAnnotationJournal(ownerId, albumId);
    expect(restored.kind).toBe('pending');
    if (restored.kind !== 'pending') return;
    expect(restored.metadata).toEqual(metadata);
    expect(restored.command).toEqual(metadata.command);
    expect(restored.command.requestId).toBe(metadata.command.requestId);
    if (
      restored.command.operation !== 'create' ||
      metadata.command.operation !== 'create'
    )
      return;
    expect(restored.command.geometry).toEqual(metadata.command.geometry);
  });

  it('restores a freehand command unchanged for exact retry', async () => {
    const metadata = createFreehandMetadata();
    expect(journal.saveOwnerAnnotationIntent(metadata).ok).toBe(true);
    await loadJournal();
    const restored = journal.readOwnerAnnotationJournal(ownerId, albumId);
    expect(restored.kind).toBe('pending');
    if (restored.kind !== 'pending') return;
    expect(restored.metadata).toEqual(metadata);
    expect(restored.command).toEqual(metadata.command);
    expect(restored.command.requestId).toBe(metadata.command.requestId);
    if (
      restored.command.operation !== 'create' ||
      metadata.command.operation !== 'create'
    )
      return;
    expect(restored.command.geometry).toEqual(metadata.command.geometry);
    const claim = journal.claimOwnerAnnotationIntent(restored.metadata);
    expect(claim?.command).toEqual(metadata.command);
    const raw = storage.getItem(key());
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('previewUrl');
    expect(raw).not.toContain('image');
    expect(raw).not.toContain('sessionId');
  });

  it('claims one sender at a time and releases only that claim once', () => {
    const metadata = createMetadata();
    expect(journal.saveOwnerAnnotationIntent(metadata).ok).toBe(true);

    const first = journal.claimOwnerAnnotationIntent(metadata);
    expect(first).not.toBeNull();
    expect(journal.claimOwnerAnnotationIntent(metadata)).toBeNull();
    if (!first) return;

    expect(journal.releaseOwnerAnnotationClaim(first)).toBe(true);
    expect(journal.releaseOwnerAnnotationClaim(first)).toBe(false);
    expect(journal.claimOwnerAnnotationIntent(metadata)).not.toBeNull();
  });

  it('keeps a different newer operation raw when the prior operation replies late', () => {
    const original = createMetadata();
    const replacement = resolveMetadata();
    expect(journal.saveOwnerAnnotationIntent(original).ok).toBe(true);
    const claim = journal.claimOwnerAnnotationIntent(original);
    expect(claim).not.toBeNull();
    if (!claim) return;

    storage.setItem(key(), JSON.stringify(replacement));
    expect(journal.markOwnerAnnotationUncertain(original)).toBe(false);
    expect(journal.markOwnerAnnotationConflict(original)).toBe(false);
    expect(journal.isCurrentOwnerAnnotationIntent(original)).toBe(false);
    expect(journal.completeOwnerAnnotationIntent(original)).toBe(false);
    expect(journal.abandonOwnerAnnotationIntent(original)).toBe(false);
    expect(journal.claimOwnerAnnotationIntent(original)).toBeNull();
    expect(journal.releaseOwnerAnnotationClaim(claim)).toBe(false);
    expect(storage.getItem(key())).toBe(JSON.stringify(replacement));

    const snapshot = journal.readOwnerAnnotationJournal(ownerId, albumId);
    expect(snapshot.kind).toBe('blocked');
    if (snapshot.kind === 'blocked') {
      expect(snapshot.reason).toBe('corrupt');
      expect(snapshot.metadata).toEqual(original);
    }
  });

  it('preserves a linked comment ID exactly in an edit command and base snapshot', () => {
    const command = {
      requestId: '99999999-9999-4999-8999-999999999999',
      expectedOwnerId: ownerId,
      inviteId,
      photoId,
      versionId,
      operation: 'update' as const,
      annotationId,
      expectedRevision: 7,
      geometry: {
        type: 'point' as const,
        coordinateSpace: 'normalized_1e6' as const,
        x: 500_000,
        y: 500_000,
      },
      style: { color: 'red' as const },
      commentId,
    };
    const metadata = journal.ownerAnnotationJournalMetadata({
      ownerId,
      albumId,
      inviteId,
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
        commentId,
      },
    });
    expect(metadata.command.operation).toBe('update');
    expect(metadata.expectedCurrent?.commentId).toBe(commentId);
    const saved = journal.saveOwnerAnnotationIntent(metadata);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const restored = journal.readOwnerAnnotationJournal(ownerId, albumId);
    expect(restored.kind).toBe('pending');
    if (restored.kind === 'pending')
      expect(restored.metadata.expectedCurrent?.commentId).toBe(commentId);

    expect(
      journal.ownerAnnotationJournalMetadataSchema.safeParse({
        ...metadata,
        command: { ...command, commentId: commentId.toLowerCase() },
      }).success,
    ).toBe(false);
  });

  it('blocks replacement when stored intent metadata is corrupt', () => {
    storage.setItem(key(), '{"version":1,"unexpected":true}');
    const saved = journal.saveOwnerAnnotationIntent(createMetadata());
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.reason).toBe('existing');
    expect(saved.snapshot).toMatchObject({
      kind: 'blocked',
      reason: 'corrupt',
    });
    expect(storage.getItem(key())).toBe('{"version":1,"unexpected":true}');
  });

  it('blocks writes when session storage cannot be read', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): never {
        throw new Error('storage unavailable');
      },
    });
    const saved = journal.saveOwnerAnnotationIntent(createMetadata());
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.reason).toBe('existing');
    expect(saved.snapshot).toMatchObject({
      kind: 'blocked',
      reason: 'storage',
    });
  });
});
