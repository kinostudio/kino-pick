import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ownerId = '11111111-1111-4111-8111-111111111111';
const albumId = '22222222-2222-4222-8222-222222222222';
const inviteId = '33333333-3333-4333-8333-333333333333';
const photoId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const annotationId = '66666666-6666-4666-8666-666666666666';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    if (this.failReads) throw new Error('storage unavailable');
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    if (this.failWrites) throw new Error('storage unavailable');
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('storage unavailable');
    this.values.set(key, String(value));
  }
}

const storage = new MemoryStorage();
let journal: typeof import('../../apps/web/target-ui/annotation-processing-journal.ts');

async function loadJournal() {
  vi.resetModules();
  journal =
    await import('../../apps/web/target-ui/annotation-processing-journal.ts');
}

function key() {
  return 'kino-pic:annotation-processing:v1:' + ownerId + ':' + albumId;
}

function metadata(
  requestId = '77777777-7777-4777-8777-777777777777',
  state: 'in_progress' | 'resolved' = 'in_progress',
) {
  const expectedProcessing = {
    state: 'open' as const,
    revision: 0 as const,
    annotationRevision: null,
    contentRevision: null,
    updatedAt: null,
    stale: false as const,
  };
  const command = {
    requestId,
    expectedOwnerId: ownerId,
    operation: 'set_processing_state' as const,
    inviteId,
    photoId,
    versionId,
    annotationId,
    expectedAnnotationRevision: 4,
    expectedProcessingRevision: 0,
    state,
  };
  return journal.annotationProcessingJournalMetadata({
    version: 1,
    ownerId,
    albumId,
    inviteId,
    photoId,
    versionId,
    command,
    expectedProcessing,
  });
}

beforeEach(async () => {
  storage.clear();
  storage.failReads = false;
  storage.failWrites = false;
  vi.stubGlobal('window', { sessionStorage: storage });
  await loadJournal();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Owner annotation processing recovery journal', () => {
  it('stores only the exact command and processing CAS metadata and restores it after reload', async () => {
    const intent = metadata();
    expect(journal.saveAnnotationProcessingIntent(intent).ok).toBe(true);
    expect(journal.isCurrentAnnotationProcessingIntent(intent)).toBe(true);

    const raw = storage.getItem(key());
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('geometry');
    expect(raw).not.toContain('comment');
    expect(raw).not.toContain('sessionId');
    expect(raw).not.toContain('authorGuestId');
    expect(raw).not.toContain('cookie');
    expect(raw).not.toContain('image');

    await loadJournal();
    const restored = journal.readAnnotationProcessingJournal(ownerId, albumId);
    expect(restored.kind).toBe('pending');
    if (restored.kind !== 'pending') return;
    expect(restored.metadata).toEqual(intent);
    expect(restored.command).toEqual(intent.command);
    expect(restored.command.requestId).toBe(intent.command.requestId);
    expect(restored.command.expectedAnnotationRevision).toBe(4);
    expect(restored.command.expectedProcessingRevision).toBe(0);
  });

  it('allows one active claim and completes only through that exact claim', () => {
    const intent = metadata();
    expect(journal.saveAnnotationProcessingIntent(intent).ok).toBe(true);
    const claim = journal.claimAnnotationProcessingIntent(intent);
    expect(claim).not.toBeNull();
    expect(journal.claimAnnotationProcessingIntent(intent)).toBeNull();
    if (!claim) return;

    expect(journal.completeAnnotationProcessingIntent(claim)).toBe(true);
    expect(journal.completeAnnotationProcessingIntent(claim)).toBe(false);
    expect(storage.getItem(key())).toBeNull();
    expect(
      journal.getAnnotationProcessingJournalSnapshot(ownerId, albumId),
    ).toEqual({
      kind: 'none',
    });
  });

  it('releases a claim once and preserves the uncertain state for exact retry', () => {
    const intent = metadata();
    expect(journal.saveAnnotationProcessingIntent(intent).ok).toBe(true);
    const claim = journal.claimAnnotationProcessingIntent(intent);
    expect(claim).not.toBeNull();
    if (!claim) return;

    expect(journal.releaseAnnotationProcessingClaim(claim)).toBe(true);
    expect(journal.releaseAnnotationProcessingClaim(claim)).toBe(false);
    expect(journal.markAnnotationProcessingUncertain(intent)).toBe(true);
    const pending = journal.readAnnotationProcessingJournal(ownerId, albumId);
    expect(pending).toMatchObject({ kind: 'pending', status: 'uncertain' });
    if (pending.kind === 'pending')
      expect(pending.command.requestId).toBe(intent.command.requestId);
  });

  it('restores uncertain and conflict status together with the exact command after reload', async () => {
    const uncertain = metadata();
    expect(journal.saveAnnotationProcessingIntent(uncertain).ok).toBe(true);
    expect(journal.markAnnotationProcessingUncertain(uncertain)).toBe(true);
    await loadJournal();
    expect(
      journal.readAnnotationProcessingJournal(ownerId, albumId),
    ).toMatchObject({
      kind: 'pending',
      status: 'uncertain',
      command: { requestId: uncertain.command.requestId },
    });

    const conflict = metadata(
      '88888888-8888-4888-8888-888888888888',
      'resolved',
    );
    storage.clear();
    await loadJournal();
    expect(journal.saveAnnotationProcessingIntent(conflict).ok).toBe(true);
    expect(journal.markAnnotationProcessingConflict(conflict)).toBe(true);
    await loadJournal();
    expect(
      journal.readAnnotationProcessingJournal(ownerId, albumId),
    ).toMatchObject({
      kind: 'pending',
      status: 'conflict',
      command: { requestId: conflict.command.requestId },
    });
  });

  it('does not let a late reply for A clear, demote, or replace raw intent B', () => {
    const first = metadata();
    const replacement = metadata(
      '88888888-8888-4888-8888-888888888888',
      'resolved',
    );
    expect(journal.saveAnnotationProcessingIntent(first).ok).toBe(true);
    const claim = journal.claimAnnotationProcessingIntent(first);
    expect(claim).not.toBeNull();
    if (!claim) return;

    const rawReplacement = JSON.stringify({
      version: 1,
      metadata: replacement,
      status: 'ready',
    });
    storage.setItem(key(), rawReplacement);
    expect(journal.markAnnotationProcessingUncertain(first)).toBe(false);
    expect(journal.markAnnotationProcessingConflict(first)).toBe(false);
    expect(journal.completeAnnotationProcessingIntent(claim)).toBe(false);
    expect(journal.releaseAnnotationProcessingClaim(claim)).toBe(false);
    expect(journal.abandonAnnotationProcessingIntent(first)).toBe(false);
    expect(storage.getItem(key())).toBe(rawReplacement);

    const snapshot = journal.readAnnotationProcessingJournal(ownerId, albumId);
    expect(snapshot).toMatchObject({ kind: 'blocked', reason: 'corrupt' });
  });

  it('blocks replacement for corrupt or unavailable storage without clearing the raw value', () => {
    const invalidRaw = JSON.stringify({ version: 1, ownerId, albumId });
    storage.setItem(key(), invalidRaw);
    const saved = journal.saveAnnotationProcessingIntent(metadata());
    expect(saved.ok).toBe(false);
    expect(storage.getItem(key())).toBe(invalidRaw);
    expect(
      journal.readAnnotationProcessingJournal(ownerId, albumId),
    ).toMatchObject({
      kind: 'blocked',
      reason: 'corrupt',
    });

    storage.clear();
    storage.failReads = true;
    const unavailableSave = journal.saveAnnotationProcessingIntent(metadata());
    expect(unavailableSave.ok).toBe(false);
    expect(unavailableSave).toMatchObject({ ok: false, reason: 'existing' });
  });

  it('rejects metadata with scope, revision, or private-content injection', () => {
    const intent = metadata();
    expect(
      journal.annotationProcessingJournalMetadataSchema.safeParse({
        ...intent,
        command: { ...intent.command, expectedOwnerId: photoId },
      }).success,
    ).toBe(false);
    expect(
      journal.annotationProcessingJournalMetadataSchema.safeParse({
        ...intent,
        expectedProcessing: { ...intent.expectedProcessing, revision: 1 },
      }).success,
    ).toBe(false);
    expect(
      journal.annotationProcessingJournalMetadataSchema.safeParse({
        ...intent,
        geometry: { type: 'point' },
      }).success,
    ).toBe(false);
    expect(
      journal.annotationProcessingJournalMetadataSchema.safeParse({
        ...intent,
        command: { ...intent.command, sessionId: 'private' },
      }).success,
    ).toBe(false);
  });
});
