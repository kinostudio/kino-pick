import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlbumOwnerFeedbackCommand } from '../../packages/contracts/src/album-owner-feedback';
import {
  clearAlbumOwnerFeedbackIntent,
  readAlbumOwnerFeedbackJournal,
  saveAlbumOwnerFeedbackIntent,
  updateAlbumOwnerFeedbackJournalStatus,
  type AlbumOwnerFeedbackJournalMetadata,
} from '../../apps/web/target-ui/album-owner-feedback-journal';

const scope = {
  actorId: '11111111-1111-4111-8111-111111111111',
  albumId: '22222222-2222-4222-8222-222222222222',
  photoId: '33333333-3333-4333-8333-333333333333',
  versionId: '44444444-4444-4444-8444-444444444444',
  kind: 'comment' as const,
};

function installSessionStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Owner album feedback journal', () => {
  it('keeps one exact command under its actor and photo-version scope', () => {
    installSessionStorage();
    const command: Extract<
      AlbumOwnerFeedbackCommand,
      { operation: 'create_comment' }
    > = {
      requestId: '55555555-5555-4555-8555-555555555555',
      operation: 'create_comment',
      photoId: scope.photoId,
      versionId: scope.versionId,
      body: '留意右側光線。',
    };
    const metadata: AlbumOwnerFeedbackJournalMetadata = {
      version: 1,
      ...scope,
      status: 'ready',
      command,
    };

    expect(saveAlbumOwnerFeedbackIntent(metadata)).toBe(true);
    expect(
      saveAlbumOwnerFeedbackIntent({
        ...metadata,
        command: { ...command, body: '不同內容' },
      }),
    ).toBe(false);
    expect(readAlbumOwnerFeedbackJournal(scope)).toMatchObject({
      kind: 'pending',
      command: metadata.command,
      status: 'ready',
    });
    expect(
      readAlbumOwnerFeedbackJournal({
        ...scope,
        photoId: '66666666-6666-4666-8666-666666666666',
      }),
    ).toEqual({ kind: 'none' });

    expect(updateAlbumOwnerFeedbackJournalStatus(metadata, 'uncertain')).toBe(
      true,
    );
    const uncertain = { ...metadata, status: 'uncertain' as const };
    expect(readAlbumOwnerFeedbackJournal(scope)).toMatchObject({
      kind: 'pending',
      command: metadata.command,
      status: 'uncertain',
    });
    expect(clearAlbumOwnerFeedbackIntent(uncertain)).toBe(true);
    expect(readAlbumOwnerFeedbackJournal(scope)).toEqual({ kind: 'none' });
  });
});
