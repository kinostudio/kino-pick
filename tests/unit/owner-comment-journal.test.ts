import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimOwnerCommentIntent,
  readOwnerCommentJournal,
  saveOwnerCommentIntent,
  updateOwnerCommentIntent,
  demoteOwnerCommentIntent,
  finishOwnerCommentIntent,
  discardOwnerCommentIntent,
  type OwnerCommentJournalMetadata,
} from '../../apps/web/target-ui/owner-comment-journal';
import type { OwnerCommentCommand } from '../../packages/contracts/src/owner-comments';
import type { OwnerCommentProcessingCommand } from '../../packages/contracts/src/comment-processing';

function fixture() {
  const storage = new Map<string, string>();
  const getItem = vi.fn((key: string) => storage.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => {
    storage.set(key, value);
  });
  const removeItem = vi.fn((key: string) => {
    storage.delete(key);
  });
  vi.stubGlobal('window', { sessionStorage: { getItem, setItem, removeItem } });
  const actorId = randomUUID(),
    albumId = randomUUID();
  const body = '私人回覆文字不應存入恢復紀錄';
  const command: OwnerCommentCommand = {
    requestId: randomUUID(),
    operation: 'reply',
    inviteId: randomUUID(),
    photoId: randomUUID(),
    versionId: randomUUID(),
    parentCommentId: randomUUID(),
    expectedParentRevision: 1,
    body,
  };
  const metadata: OwnerCommentJournalMetadata = {
    requestId: command.requestId,
    actorId,
    albumId,
    operation: 'reply',
    inviteId: command.inviteId,
    photoId: command.photoId,
    versionId: command.versionId,
    parentCommentId: command.parentCommentId,
    expectedParentRevision: 1,
    bodySha256: createHash('sha256').update(body).digest('hex'),
  };
  const key = 'kino-pic:owner-comments:v1:' + actorId + ':' + albumId;
  return {
    storage,
    getItem,
    setItem,
    removeItem,
    actorId,
    albumId,
    body,
    command,
    metadata,
    key,
  };
}

function processingFixture(
  actorId: string = randomUUID(),
  albumId: string = randomUUID(),
  requestId: string = randomUUID(),
) {
  const command: OwnerCommentProcessingCommand = {
    requestId,
    operation: 'set_processing_state',
    inviteId: randomUUID(),
    photoId: randomUUID(),
    versionId: randomUUID(),
    commentId: randomUUID(),
    expectedCommentRevision: 3,
    expectedProcessingRevision: 1,
    state: 'in_progress',
  };
  const metadata: OwnerCommentJournalMetadata = {
    requestId,
    actorId,
    albumId,
    inviteId: command.inviteId,
    photoId: command.photoId,
    versionId: command.versionId,
    operation: 'set_processing_state',
    commentId: command.commentId,
    expectedCommentRevision: command.expectedCommentRevision,
    expectedProcessingRevision: command.expectedProcessingRevision,
    state: command.state,
  };
  const key = 'kino-pic:owner-comments:v1:' + actorId + ':' + albumId;
  return { actorId, albumId, command, metadata, key };
}
afterEach(() => vi.unstubAllGlobals());

describe('Owner reply recovery journal', () => {
  it('does not overwrite corruption introduced after an empty journal was cached', () => {
    const f = fixture();
    expect(readOwnerCommentJournal(f.actorId, f.albumId).kind).toBe('none');
    f.storage.set(f.key, 'broken-after-cache');
    expect(saveOwnerCommentIntent(f.metadata, f.command).ok).toBe(false);
    expect(f.storage.get(f.key)).toBe('broken-after-cache');
    expect(readOwnerCommentJournal(f.actorId, f.albumId)).toEqual({
      kind: 'blocked',
      reason: 'corrupt',
    });
  });
  it('a confirmed A cannot overwrite an unknown B found during cleanup', () => {
    const f = fixture();
    expect(saveOwnerCommentIntent(f.metadata, f.command).ok).toBe(true);
    const bMeta = { ...f.metadata, requestId: randomUUID() };
    const rawB = JSON.stringify(bMeta);
    f.storage.set(f.key, rawB);
    expect(
      finishOwnerCommentIntent(f.actorId, f.albumId, f.command.requestId),
    ).toBe('cleanup-failed');
    const c = { ...f.command, requestId: randomUUID() };
    expect(
      saveOwnerCommentIntent({ ...f.metadata, requestId: c.requestId }, c).ok,
    ).toBe(false);
    expect(f.storage.get(f.key)).toBe(rawB);
    const state = readOwnerCommentJournal(f.actorId, f.albumId);
    expect(state.kind === 'pending' && state.metadata.requestId).toBe(
      bMeta.requestId,
    );
  });

  it('claims one send attempt atomically and rejects a stale or concurrent claim', () => {
    const f = fixture();
    expect(saveOwnerCommentIntent(f.metadata, f.command)).toEqual({ ok: true });
    expect(
      claimOwnerCommentIntent(
        f.actorId,
        f.albumId,
        f.command.requestId,
        f.command,
      ),
    ).toBe(true);
    expect(
      claimOwnerCommentIntent(
        f.actorId,
        f.albumId,
        f.command.requestId,
        f.command,
      ),
    ).toBe(false);
    expect(
      claimOwnerCommentIntent(f.actorId, f.albumId, randomUUID(), f.command),
    ).toBe(false);
    expect(
      updateOwnerCommentIntent(f.actorId, f.albumId, f.command.requestId, {
        sending: false,
      }),
    ).toBe(true);
    expect(
      claimOwnerCommentIntent(
        f.actorId,
        f.albumId,
        f.command.requestId,
        f.command,
      ),
    ).toBe(true);
  });

  it('persists only metadata and demotes plaintext without losing the captured request', () => {
    const f = fixture();
    expect(saveOwnerCommentIntent(f.metadata, f.command)).toEqual({ ok: true });
    const raw = f.storage.get(f.key)!;
    expect(raw).not.toContain(f.body);
    const fields = Object.keys(JSON.parse(raw));
    for (const field of ['body', 'token', 'sessionId', 'secret'])
      expect(fields).not.toContain(field);
    demoteOwnerCommentIntent(f.actorId, f.albumId);
    const state = readOwnerCommentJournal(f.actorId, f.albumId);
    expect(state.kind).toBe('pending');
    if (state.kind !== 'pending') throw new Error('Missing captured intent');
    expect(state.command).toBeNull();
    expect(state.metadata).toEqual(f.metadata);
    expect(f.storage.get(f.key)).toBe(raw);
  });
  it('an older completion, denial or discard cannot erase a newer request', () => {
    const f = fixture();
    expect(saveOwnerCommentIntent(f.metadata, f.command)).toEqual({ ok: true });
    expect(
      saveOwnerCommentIntent(
        { ...f.metadata, requestId: randomUUID() },
        f.command,
      ).ok,
    ).toBe(false);
    expect(
      finishOwnerCommentIntent(f.actorId, f.albumId, f.command.requestId),
    ).toBe('cleared');
    const b = { ...f.command, requestId: randomUUID() };
    const bMeta = { ...f.metadata, requestId: b.requestId };
    expect(saveOwnerCommentIntent(bMeta, b)).toEqual({ ok: true });
    const raw = f.storage.get(f.key);
    expect(
      finishOwnerCommentIntent(f.actorId, f.albumId, f.command.requestId),
    ).toBe('stale');
    expect(
      updateOwnerCommentIntent(f.actorId, f.albumId, f.command.requestId, {
        command: null,
        sending: false,
      }),
    ).toBe(false);
    expect(
      discardOwnerCommentIntent(f.actorId, f.albumId, f.command.requestId),
    ).toBe(false);
    expect(f.storage.get(f.key)).toBe(raw);
    const state = readOwnerCommentJournal(f.actorId, f.albumId);
    expect(state.kind === 'pending' && state.metadata.requestId).toBe(
      b.requestId,
    );
  });
  it('corrupt or unknown plaintext-bearing storage blocks replacement until explicit discard', () => {
    const f = fixture();
    f.storage.set(f.key, JSON.stringify({ ...f.metadata, body: f.body }));
    expect(readOwnerCommentJournal(f.actorId, f.albumId)).toEqual({
      kind: 'blocked',
      reason: 'corrupt',
    });
    expect(saveOwnerCommentIntent(f.metadata, f.command)).toEqual({
      ok: false,
      reason: 'existing',
    });
    expect(f.storage.has(f.key)).toBe(true);
    expect(discardOwnerCommentIntent(f.actorId, f.albumId, null)).toBe(true);
    expect(saveOwnerCommentIntent(f.metadata, f.command)).toEqual({ ok: true });
  });
  it('unavailable storage and quota errors never record a ready-to-send new intent', () => {
    const unreadable = fixture();
    unreadable.getItem.mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(
      readOwnerCommentJournal(unreadable.actorId, unreadable.albumId),
    ).toEqual({ kind: 'blocked', reason: 'storage' });
    expect(
      saveOwnerCommentIntent(unreadable.metadata, unreadable.command).ok,
    ).toBe(false);
    const quota = fixture();
    quota.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(saveOwnerCommentIntent(quota.metadata, quota.command)).toEqual({
      ok: false,
      reason: 'storage',
    });
    expect(readOwnerCommentJournal(quota.actorId, quota.albumId).kind).toBe(
      'none',
    );
    expect(quota.storage.size).toBe(0);
  });

  it('recovers a bodyless processing command from metadata without storing private fields', async () => {
    const base = fixture();
    const f = processingFixture(base.actorId, base.albumId);
    expect(saveOwnerCommentIntent(f.metadata, f.command)).toEqual({ ok: true });
    const raw = base.storage.get(f.key)!;
    expect(raw).not.toContain(base.body);
    for (const field of ['body', 'bodySha256', 'token', 'sessionId', 'secret'])
      expect(Object.keys(JSON.parse(raw))).not.toContain(field);

    vi.resetModules();
    const reloadedJournal =
      await import('../../apps/web/target-ui/owner-comment-journal');
    expect(
      reloadedJournal.readOwnerCommentJournal(f.actorId, f.albumId),
    ).toEqual({
      kind: 'pending',
      metadata: f.metadata,
      command: f.command,
      sending: false,
    });
  });

  it('full metadata CAS prevents a late reply A from claiming, updating or discarding status B', () => {
    const reply = fixture();
    expect(saveOwnerCommentIntent(reply.metadata, reply.command).ok).toBe(true);
    expect(
      finishOwnerCommentIntent(reply.actorId, reply.albumId, reply.metadata),
    ).toBe('cleared');

    const status = processingFixture(
      reply.actorId,
      reply.albumId,
      reply.command.requestId,
    );
    expect(saveOwnerCommentIntent(status.metadata, status.command).ok).toBe(
      true,
    );
    const rawStatus = reply.storage.get(reply.key);
    expect(
      claimOwnerCommentIntent(
        reply.actorId,
        reply.albumId,
        reply.command.requestId,
        reply.command,
      ),
    ).toBe(false);
    expect(
      updateOwnerCommentIntent(reply.actorId, reply.albumId, reply.metadata, {
        command: null,
        sending: false,
      }),
    ).toBe(false);
    expect(
      finishOwnerCommentIntent(reply.actorId, reply.albumId, reply.metadata),
    ).toBe('stale');
    expect(
      discardOwnerCommentIntent(reply.actorId, reply.albumId, reply.metadata),
    ).toBe(false);
    expect(reply.storage.get(reply.key)).toBe(rawStatus);
    const current = readOwnerCommentJournal(reply.actorId, reply.albumId);
    expect(current.kind).toBe('pending');
    if (current.kind !== 'pending') throw new Error('Status intent was lost');
    expect(current.metadata).toEqual(status.metadata);
    expect(current.command).toEqual(status.command);
  });
});
