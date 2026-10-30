import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const albumId = '11111111-1111-4111-8111-111111111111';
const guestId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const requestId = '77777777-7777-4777-8777-777777777777';

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

let journal: typeof import('../../apps/web/target-ui/guest-annotation-journal.ts');

async function loadJournal() {
  vi.resetModules();
  journal =
    await import('../../apps/web/target-ui/guest-annotation-journal.ts');
}

beforeEach(async () => {
  storage.clear();
  vi.stubGlobal('window', { sessionStorage: storage });
  await loadJournal();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Guest freehand journal recovery', () => {
  it('keeps the exact immutable stroke command through reload without storing image bytes', async () => {
    const command = {
      requestId,
      expectedGuestId: guestId,
      operation: 'create' as const,
      photoId,
      versionId,
      geometry: {
        type: 'freehand' as const,
        coordinateSpace: 'normalized_1e6' as const,
        version: 1 as const,
        points: [
          { x: 100_000, y: 200_000 },
          { x: 400_000, y: 800_000 },
        ],
      },
      style: { color: 'blue' as const },
      commentId: null,
    };
    const metadata = journal.guestAnnotationJournalMetadata({
      albumId,
      expectedGuestId: guestId,
      photoId,
      versionId,
      command,
      expectedCurrent: null,
    });

    expect(journal.saveGuestAnnotationIntent(metadata).ok).toBe(true);
    const raw = storage.getItem(
      'kino-pic:guest-annotations:v1:' + guestId + ':' + albumId,
    );
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('data:image');
    expect(raw).not.toContain('previewUrl');
    expect(raw).not.toContain('cookie');

    await loadJournal();
    const restored = journal.readGuestAnnotationJournal(guestId, albumId);
    expect(restored.kind).toBe('pending');
    if (restored.kind !== 'pending') return;

    const retry = journal.claimGuestAnnotationIntent(restored.metadata);
    expect(retry).not.toBeNull();
    if (!retry) return;

    if (retry.command.operation !== 'create') return;

    expect(retry.command.requestId).toBe(requestId);
    expect(retry.command.geometry).toEqual(command.geometry);
    expect(JSON.stringify(retry.command)).toBe(JSON.stringify(command));
  });
});
