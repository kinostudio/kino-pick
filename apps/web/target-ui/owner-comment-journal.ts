import { z } from 'zod';
import {
  ownerCommentCommandSchema,
  type OwnerCommentCommand,
} from '../../../packages/contracts/src/owner-comments';
import {
  ownerCommentProcessingCommandSchema,
  type OwnerCommentProcessingCommand,
} from '../../../packages/contracts/src/comment-processing';

export type OwnerCommentIntentCommand =
  OwnerCommentCommand | OwnerCommentProcessingCommand;

const target = {
  requestId: z.uuid(),
  actorId: z.uuid(),
  albumId: z.uuid(),
  inviteId: z.uuid(),
  photoId: z.uuid(),
  versionId: z.uuid(),
};

export const ownerCommentJournalMetadataSchema = z.discriminatedUnion(
  'operation',
  [
    z
      .object({
        ...target,
        operation: z.literal('reply'),
        parentCommentId: z.uuid(),
        expectedParentRevision: z.number().int().positive().safe(),
        bodySha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    z
      .object({
        ...target,
        operation: z.literal('edit_reply'),
        replyId: z.uuid(),
        expectedRevision: z.number().int().positive().safe(),
        bodySha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    z
      .object({
        ...target,
        operation: z.literal('delete_reply'),
        replyId: z.uuid(),
        expectedRevision: z.number().int().positive().safe(),
      })
      .strict(),
    z
      .object({
        ...target,
        operation: z.literal('set_processing_state'),
        commentId: z.uuid(),
        expectedCommentRevision: z.number().int().positive().safe(),
        expectedProcessingRevision: z.number().int().nonnegative().safe(),
        state: z.enum(['open', 'in_progress', 'resolved']),
      })
      .strict(),
  ],
);

export type OwnerCommentJournalMetadata = z.infer<
  typeof ownerCommentJournalMetadataSchema
>;

export type OwnerCommentJournalSnapshot =
  | { kind: 'none' }
  | {
      kind: 'pending';
      metadata: OwnerCommentJournalMetadata;
      command: OwnerCommentIntentCommand | null;
      sending: boolean;
    }
  | { kind: 'confirmed'; metadata: OwnerCommentJournalMetadata }
  | { kind: 'blocked'; reason: 'storage' | 'corrupt' };

type Listener = () => void;
const snapshots = new Map<string, OwnerCommentJournalSnapshot>();
const listeners = new Map<string, Set<Listener>>();

function scopeKey(actorId: string, albumId: string) {
  return actorId + ':' + albumId;
}

function storageKey(actorId: string, albumId: string) {
  return 'kino-pic:owner-comments:v1:' + actorId + ':' + albumId;
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function commandFromMetadata(
  metadata: OwnerCommentJournalMetadata,
): OwnerCommentIntentCommand | null {
  switch (metadata.operation) {
    case 'delete_reply':
      return ownerCommentCommandSchema.parse({
        requestId: metadata.requestId,
        operation: metadata.operation,
        replyId: metadata.replyId,
        expectedRevision: metadata.expectedRevision,
      });
    case 'set_processing_state':
      return ownerCommentProcessingCommandSchema.parse({
        requestId: metadata.requestId,
        operation: metadata.operation,
        inviteId: metadata.inviteId,
        photoId: metadata.photoId,
        versionId: metadata.versionId,
        commentId: metadata.commentId,
        expectedCommentRevision: metadata.expectedCommentRevision,
        expectedProcessingRevision: metadata.expectedProcessingRevision,
        state: metadata.state,
      });
    default:
      return null;
  }
}

function parseStored(
  raw: string,
  actorId: string,
  albumId: string,
): OwnerCommentJournalMetadata | null {
  if (raw.length > 4096) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = ownerCommentJournalMetadataSchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.actorId !== actorId ||
    parsed.data.albumId !== albumId
  )
    return null;
  return parsed.data;
}

function sameMetadata(
  left: OwnerCommentJournalMetadata,
  right: OwnerCommentJournalMetadata,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commandMatchesMetadata(
  metadata: OwnerCommentJournalMetadata,
  command: OwnerCommentIntentCommand,
) {
  if (
    command.requestId !== metadata.requestId ||
    command.operation !== metadata.operation
  )
    return false;
  switch (metadata.operation) {
    case 'reply':
      return (
        command.operation === 'reply' &&
        command.inviteId === metadata.inviteId &&
        command.photoId === metadata.photoId &&
        command.versionId === metadata.versionId &&
        command.parentCommentId === metadata.parentCommentId &&
        command.expectedParentRevision === metadata.expectedParentRevision
      );
    case 'edit_reply':
      return (
        command.operation === 'edit_reply' &&
        command.replyId === metadata.replyId &&
        command.expectedRevision === metadata.expectedRevision
      );
    case 'delete_reply':
      return (
        command.operation === 'delete_reply' &&
        command.replyId === metadata.replyId &&
        command.expectedRevision === metadata.expectedRevision
      );
    case 'set_processing_state':
      return (
        command.operation === 'set_processing_state' &&
        command.inviteId === metadata.inviteId &&
        command.photoId === metadata.photoId &&
        command.versionId === metadata.versionId &&
        command.commentId === metadata.commentId &&
        command.expectedCommentRevision === metadata.expectedCommentRevision &&
        command.expectedProcessingRevision ===
          metadata.expectedProcessingRevision &&
        command.state === metadata.state
      );
  }
}

export function readOwnerCommentJournal(
  actorId: string,
  albumId: string,
): OwnerCommentJournalSnapshot {
  const key = scopeKey(actorId, albumId);
  const known = snapshots.get(key);
  if (known) return known;

  if (typeof window === 'undefined') return { kind: 'none' };

  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(storageKey(actorId, albumId));
  } catch {
    const blocked: OwnerCommentJournalSnapshot = {
      kind: 'blocked',
      reason: 'storage',
    };
    snapshots.set(key, blocked);
    notify(key);
    return blocked;
  }

  if (raw === null) {
    const empty: OwnerCommentJournalSnapshot = { kind: 'none' };
    snapshots.set(key, empty);
    return empty;
  }

  const metadata = parseStored(raw, actorId, albumId);
  if (!metadata) {
    const blocked: OwnerCommentJournalSnapshot = {
      kind: 'blocked',
      reason: 'corrupt',
    };
    snapshots.set(key, blocked);
    notify(key);
    return blocked;
  }

  const pending: OwnerCommentJournalSnapshot = {
    kind: 'pending',
    metadata,
    command: commandFromMetadata(metadata),
    sending: false,
  };
  snapshots.set(key, pending);
  return pending;
}

export function subscribeOwnerCommentJournal(
  actorId: string,
  albumId: string,
  listener: Listener,
) {
  const key = scopeKey(actorId, albumId);
  const set = listeners.get(key) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

export function saveOwnerCommentIntent(
  metadataInput: OwnerCommentJournalMetadata,
  command: OwnerCommentIntentCommand,
): { ok: true } | { ok: false; reason: 'existing' | 'storage' | 'invalid' } {
  const parsed = ownerCommentJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success || !commandMatchesMetadata(parsed.data, command))
    return { ok: false, reason: 'invalid' };

  const metadata = parsed.data;
  const key = scopeKey(metadata.actorId, metadata.albumId);
  const current = readOwnerCommentJournal(metadata.actorId, metadata.albumId);
  if (current.kind !== 'none' && current.kind !== 'confirmed')
    return { ok: false, reason: 'existing' };

  if (typeof window === 'undefined') return { ok: false, reason: 'storage' };
  try {
    const keyName = storageKey(metadata.actorId, metadata.albumId);
    const raw = window.sessionStorage.getItem(keyName);
    if (raw !== null) {
      const stored = parseStored(raw, metadata.actorId, metadata.albumId);
      if (
        current.kind !== 'confirmed' ||
        !stored ||
        !sameMetadata(stored, current.metadata)
      ) {
        snapshots.set(
          key,
          stored
            ? {
                kind: 'pending',
                metadata: stored,
                command: commandFromMetadata(stored),
                sending: false,
              }
            : { kind: 'blocked', reason: 'corrupt' },
        );
        notify(key);
        return { ok: false, reason: 'existing' };
      }
    }
    window.sessionStorage.setItem(keyName, JSON.stringify(metadata));
  } catch {
    return { ok: false, reason: 'storage' };
  }

  snapshots.set(key, {
    kind: 'pending',
    metadata,
    command,
    sending: false,
  });
  notify(key);
  return { ok: true };
}

export function updateOwnerCommentIntent(
  actorId: string,
  albumId: string,
  expected: OwnerCommentJournalMetadata | string,
  update: {
    command?: OwnerCommentIntentCommand | null;
    sending?: boolean;
  },
) {
  const key = scopeKey(actorId, albumId);
  const current = readOwnerCommentJournal(actorId, albumId);
  const expectedMetadata =
    typeof expected === 'string'
      ? null
      : ownerCommentJournalMetadataSchema.safeParse(expected);
  if (
    current.kind !== 'pending' ||
    (typeof expected === 'string'
      ? current.metadata.requestId !== expected
      : !expectedMetadata?.success ||
        !sameMetadata(current.metadata, expectedMetadata.data))
  )
    return false;

  snapshots.set(key, {
    ...current,
    ...(update.command === undefined ? {} : { command: update.command }),
    ...(update.sending === undefined ? {} : { sending: update.sending }),
  });
  notify(key);
  return true;
}

export function claimOwnerCommentIntent(
  actorId: string,
  albumId: string,
  requestId: string,
  command: OwnerCommentIntentCommand,
): boolean {
  const key = scopeKey(actorId, albumId);
  const current = readOwnerCommentJournal(actorId, albumId);
  if (
    current.kind !== 'pending' ||
    current.metadata.requestId !== requestId ||
    current.sending ||
    !commandMatchesMetadata(current.metadata, command)
  )
    return false;

  snapshots.set(key, { ...current, command, sending: true });
  notify(key);
  return true;
}

export function demoteOwnerCommentIntent(actorId: string, albumId: string) {
  const key = scopeKey(actorId, albumId);
  const current = readOwnerCommentJournal(actorId, albumId);
  if (
    current.kind !== 'pending' ||
    current.metadata.operation === 'delete_reply' ||
    current.metadata.operation === 'set_processing_state' ||
    current.command === null
  )
    return;

  snapshots.set(key, { ...current, command: null });
  notify(key);
}

export function finishOwnerCommentIntent(
  actorId: string,
  albumId: string,
  expected: OwnerCommentJournalMetadata | string,
): 'cleared' | 'stale' | 'cleanup-failed' {
  const key = scopeKey(actorId, albumId);
  const current = readOwnerCommentJournal(actorId, albumId);
  const expectedMetadata =
    current.kind !== 'pending'
      ? null
      : typeof expected === 'string'
        ? current.metadata.requestId === expected
          ? current.metadata
          : null
        : (() => {
            const parsed =
              ownerCommentJournalMetadataSchema.safeParse(expected);
            return parsed.success ? parsed.data : null;
          })();
  if (
    current.kind !== 'pending' ||
    !expectedMetadata ||
    !sameMetadata(current.metadata, expectedMetadata)
  )
    return 'stale';

  if (typeof window === 'undefined') {
    snapshots.set(key, {
      kind: 'confirmed',
      metadata: current.metadata,
    });
    notify(key);
    return 'cleanup-failed';
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey(actorId, albumId));
    if (raw !== null) {
      const stored = parseStored(raw, actorId, albumId);
      if (!stored || !sameMetadata(stored, expectedMetadata)) {
        snapshots.set(key, {
          kind: 'confirmed',
          metadata: expectedMetadata,
        });
        notify(key);
        return 'cleanup-failed';
      }
      window.sessionStorage.removeItem(storageKey(actorId, albumId));
    }
  } catch {
    snapshots.set(key, {
      kind: 'confirmed',
      metadata: expectedMetadata,
    });
    notify(key);
    return 'cleanup-failed';
  }

  snapshots.set(key, { kind: 'none' });
  notify(key);
  return 'cleared';
}

export function discardOwnerCommentIntent(
  actorId: string,
  albumId: string,
  expected: OwnerCommentJournalMetadata | string | null,
): boolean {
  const key = scopeKey(actorId, albumId);
  const current = readOwnerCommentJournal(actorId, albumId);
  const expectedMetadata =
    current.kind !== 'pending' || expected === null
      ? null
      : typeof expected === 'string'
        ? current.metadata.requestId === expected
          ? current.metadata
          : null
        : (() => {
            const parsed =
              ownerCommentJournalMetadataSchema.safeParse(expected);
            return parsed.success ? parsed.data : null;
          })();
  if (
    expected === null
      ? current.kind !== 'blocked'
      : current.kind !== 'pending' ||
        !expectedMetadata ||
        !sameMetadata(current.metadata, expectedMetadata)
  )
    return false;

  if (typeof window === 'undefined') return false;
  try {
    const storage = storageKey(actorId, albumId);
    if (expected !== null) {
      const raw = window.sessionStorage.getItem(storage);
      if (raw !== null) {
        const stored = parseStored(raw, actorId, albumId);
        if (
          !stored ||
          !expectedMetadata ||
          !sameMetadata(stored, expectedMetadata)
        )
          return false;
      }
    }
    window.sessionStorage.removeItem(storage);
  } catch {
    return false;
  }

  snapshots.set(key, { kind: 'none' });
  notify(key);
  return true;
}
