import { z } from 'zod';
import {
  annotationProcessingSnapshotSchema,
  ownerAnnotationProcessingCommandSchema,
  type OwnerAnnotationProcessingCommand,
} from '../../../packages/contracts/src/annotation-processing.ts';

const metadataBaseSchema = z
  .object({
    version: z.literal(1),
    ownerId: z.uuid(),
    albumId: z.uuid(),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    command: ownerAnnotationProcessingCommandSchema,
    expectedProcessing: annotationProcessingSnapshotSchema,
  })
  .strict();

export const annotationProcessingJournalMetadataSchema =
  metadataBaseSchema.superRefine((metadata, ctx) => {
    const { command, expectedProcessing } = metadata;
    if (command.expectedOwnerId !== metadata.ownerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['ownerId'],
        message: 'Journal Owner scope must match the command',
      });
    }
    if (
      command.inviteId !== metadata.inviteId ||
      command.photoId !== metadata.photoId ||
      command.versionId !== metadata.versionId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'Journal command scope must match its target',
      });
    }
    if (command.expectedProcessingRevision !== expectedProcessing.revision) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedProcessing', 'revision'],
        message: 'Processing snapshot must match the command compare-and-set',
      });
    }
    if (
      expectedProcessing.annotationRevision !== null &&
      expectedProcessing.annotationRevision > command.expectedAnnotationRevision
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedProcessing', 'annotationRevision'],
        message: 'Processing snapshot cannot acknowledge a future annotation',
      });
    }
  });

export type AnnotationProcessingJournalMetadata = z.infer<
  typeof annotationProcessingJournalMetadataSchema
>;
export type AnnotationProcessingJournalStatus =
  'ready' | 'uncertain' | 'conflict';
export type AnnotationProcessingJournalSnapshot =
  | { kind: 'none' }
  | {
      kind: 'pending';
      metadata: AnnotationProcessingJournalMetadata;
      command: OwnerAnnotationProcessingCommand;
      status: AnnotationProcessingJournalStatus;
      sending: boolean;
    }
  | {
      kind: 'blocked';
      reason: 'storage' | 'corrupt';
      metadata?: AnnotationProcessingJournalMetadata;
      command?: OwnerAnnotationProcessingCommand;
    };

export type AnnotationProcessingJournalClaim = {
  readonly key: string;
  readonly token: number;
  readonly metadata: AnnotationProcessingJournalMetadata;
  readonly command: OwnerAnnotationProcessingCommand;
};

const storedJournalSchema = z
  .object({
    version: z.literal(1),
    metadata: annotationProcessingJournalMetadataSchema,
    status: z.enum(['ready', 'uncertain', 'conflict']),
  })
  .strict();
type StoredJournal = z.infer<typeof storedJournalSchema>;

type Listener = () => void;
type StorageRead = { ok: true; raw: string | null } | { ok: false };
type SaveResult =
  | { ok: true; metadata: AnnotationProcessingJournalMetadata }
  | {
      ok: false;
      reason: 'existing' | 'storage' | 'invalid';
      snapshot: AnnotationProcessingJournalSnapshot;
    };

const snapshots = new Map<string, AnnotationProcessingJournalSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const claimTokens = new Map<string, number>();
const emptySnapshot: AnnotationProcessingJournalSnapshot = { kind: 'none' };
let nextClaimToken = 0;

function scopeKey(ownerId: string, albumId: string) {
  return JSON.stringify([ownerId, albumId]);
}

function storageKey(ownerId: string, albumId: string) {
  return 'kino-pic:annotation-processing:v1:' + ownerId + ':' + albumId;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return (
      '{' +
      entries
        .map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function sameMetadata(
  left: AnnotationProcessingJournalMetadata,
  right: AnnotationProcessingJournalMetadata,
) {
  return stableJson(left) === stableJson(right);
}

function metadataOf(snapshot: AnnotationProcessingJournalSnapshot | undefined) {
  return snapshot?.kind === 'pending' || snapshot?.kind === 'blocked'
    ? snapshot.metadata
    : undefined;
}

function commandOf(snapshot: AnnotationProcessingJournalSnapshot | undefined) {
  return snapshot?.kind === 'pending' || snapshot?.kind === 'blocked'
    ? snapshot.command
    : undefined;
}

function notify(key: string) {
  for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

function publish(key: string, snapshot: AnnotationProcessingJournalSnapshot) {
  snapshots.set(key, snapshot);
  notify(key);
}

function blockedSnapshot(
  reason: 'storage' | 'corrupt',
  existing?: AnnotationProcessingJournalSnapshot,
): AnnotationProcessingJournalSnapshot {
  const metadata = metadataOf(existing);
  const command = commandOf(existing);
  return {
    kind: 'blocked',
    reason,
    ...(metadata === undefined ? {} : { metadata }),
    ...(command === undefined ? {} : { command }),
  };
}

function readStorage(key: string): StorageRead {
  if (typeof window === 'undefined') return { ok: false };
  try {
    return { ok: true, raw: window.sessionStorage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

function parseStored(
  raw: string,
  ownerId: string,
  albumId: string,
): StoredJournal | null {
  if (raw.length > 16_384) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = storedJournalSchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.metadata.ownerId !== ownerId ||
    parsed.data.metadata.albumId !== albumId ||
    stableJson(decoded) !== stableJson(parsed.data)
  )
    return null;
  return parsed.data;
}

function pendingSnapshot(
  metadata: AnnotationProcessingJournalMetadata,
  sending = false,
  status: AnnotationProcessingJournalStatus = 'ready',
): AnnotationProcessingJournalSnapshot {
  return {
    kind: 'pending',
    metadata,
    command: metadata.command,
    status,
    sending,
  };
}

export function annotationProcessingJournalMetadata(
  input: unknown,
): AnnotationProcessingJournalMetadata {
  return annotationProcessingJournalMetadataSchema.parse(input);
}

export function subscribeAnnotationProcessingJournal(
  ownerId: string,
  albumId: string,
  listener: Listener,
) {
  if (!ownerId || !albumId) return () => undefined;
  const key = scopeKey(ownerId, albumId);
  const scopeListeners = listeners.get(key) ?? new Set<Listener>();
  scopeListeners.add(listener);
  listeners.set(key, scopeListeners);
  return () => {
    const active = listeners.get(key);
    active?.delete(listener);
    if (active?.size === 0) listeners.delete(key);
  };
}

export function getAnnotationProcessingJournalSnapshot(
  ownerId: string,
  albumId: string,
): AnnotationProcessingJournalSnapshot {
  if (!ownerId || !albumId) return emptySnapshot;
  return snapshots.get(scopeKey(ownerId, albumId)) ?? emptySnapshot;
}

/** Hydrates from session storage and treats every malformed or changed raw value as blocked. */
export function readAnnotationProcessingJournal(
  ownerId: string,
  albumId: string,
): AnnotationProcessingJournalSnapshot {
  if (!ownerId || !albumId) return emptySnapshot;
  const key = scopeKey(ownerId, albumId);
  const cached = snapshots.get(key);
  const stored = readStorage(storageKey(ownerId, albumId));
  if (!stored.ok) {
    const blocked = blockedSnapshot('storage', cached);
    publish(key, blocked);
    return blocked;
  }
  if (stored.raw === null) {
    if (metadataOf(cached) !== undefined) {
      const blocked = blockedSnapshot('corrupt', cached);
      publish(key, blocked);
      return blocked;
    }
    publish(key, emptySnapshot);
    return emptySnapshot;
  }

  const storedJournal = parseStored(stored.raw, ownerId, albumId);
  if (!storedJournal) {
    const blocked = blockedSnapshot('corrupt', cached);
    publish(key, blocked);
    return blocked;
  }
  const { metadata } = storedJournal;
  const cachedMetadata = metadataOf(cached);
  if (cachedMetadata && !sameMetadata(cachedMetadata, metadata)) {
    const blocked = blockedSnapshot('corrupt', cached);
    publish(key, blocked);
    return blocked;
  }
  if (
    cached?.kind === 'pending' &&
    sameMetadata(cached.metadata, metadata) &&
    cached.status === storedJournal.status
  )
    return cached;
  const hydrated = pendingSnapshot(metadata, false, storedJournal.status);
  publish(key, hydrated);
  return hydrated;
}

function storedMatches(metadata: AnnotationProcessingJournalMetadata) {
  const stored = readStorage(storageKey(metadata.ownerId, metadata.albumId));
  if (!stored.ok || stored.raw === null) return false;
  const parsed = parseStored(stored.raw, metadata.ownerId, metadata.albumId);
  return parsed !== null && sameMetadata(parsed.metadata, metadata);
}

/** Checks the full metadata CAS without publishing or changing any UI state on mismatch. */
export function isCurrentAnnotationProcessingIntent(input: unknown) {
  const parsed = annotationProcessingJournalMetadataSchema.safeParse(input);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const snapshot = snapshots.get(scopeKey(metadata.ownerId, metadata.albumId));
  return (
    snapshot?.kind === 'pending' &&
    sameMetadata(snapshot.metadata, metadata) &&
    storedMatches(metadata)
  );
}

export function saveAnnotationProcessingIntent(input: unknown): SaveResult {
  const parsed = annotationProcessingJournalMetadataSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, reason: 'invalid', snapshot: emptySnapshot };
  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const keyName = storageKey(metadata.ownerId, metadata.albumId);
  const current = readAnnotationProcessingJournal(
    metadata.ownerId,
    metadata.albumId,
  );
  if (current.kind !== 'none')
    return { ok: false, reason: 'existing', snapshot: current };
  const stored = readStorage(keyName);
  if (!stored.ok) {
    const blocked = blockedSnapshot('storage', current);
    publish(key, blocked);
    return { ok: false, reason: 'storage', snapshot: blocked };
  }
  if (stored.raw !== null) {
    const refreshed = readAnnotationProcessingJournal(
      metadata.ownerId,
      metadata.albumId,
    );
    return { ok: false, reason: 'existing', snapshot: refreshed };
  }
  try {
    const storedValue: StoredJournal = {
      version: 1,
      metadata,
      status: 'ready',
    };
    window.sessionStorage.setItem(keyName, JSON.stringify(storedValue));
    const confirmed = window.sessionStorage.getItem(keyName);
    const roundTrip =
      confirmed === null
        ? null
        : parseStored(confirmed, metadata.ownerId, metadata.albumId);
    if (
      !roundTrip ||
      !sameMetadata(roundTrip.metadata, metadata) ||
      roundTrip.status !== 'ready'
    ) {
      const blocked = blockedSnapshot('corrupt', current);
      publish(key, blocked);
      return { ok: false, reason: 'storage', snapshot: blocked };
    }
  } catch {
    const blocked = blockedSnapshot('storage', current);
    publish(key, blocked);
    return { ok: false, reason: 'storage', snapshot: blocked };
  }
  publish(key, pendingSnapshot(metadata));
  return { ok: true, metadata };
}

export function claimAnnotationProcessingIntent(input: unknown) {
  const parsed = annotationProcessingJournalMetadataSchema.safeParse(input);
  if (!parsed.success) return null;
  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const snapshot = readAnnotationProcessingJournal(
    metadata.ownerId,
    metadata.albumId,
  );
  if (
    snapshot.kind !== 'pending' ||
    snapshot.sending ||
    !sameMetadata(snapshot.metadata, metadata) ||
    !storedMatches(metadata)
  )
    return null;
  nextClaimToken += 1;
  const token = nextClaimToken;
  claimTokens.set(key, token);
  publish(key, { ...snapshot, sending: true });
  return { key, token, metadata, command: snapshot.command };
}

export function releaseAnnotationProcessingClaim(
  claim: AnnotationProcessingJournalClaim,
) {
  if (claimTokens.get(claim.key) !== claim.token) return false;
  const current = snapshots.get(claim.key);
  if (
    current?.kind !== 'pending' ||
    !current.sending ||
    !sameMetadata(current.metadata, claim.metadata) ||
    !storedMatches(claim.metadata)
  )
    return false;
  claimTokens.delete(claim.key);
  publish(claim.key, { ...current, sending: false });
  return true;
}

function markIntent(input: unknown, status: AnnotationProcessingJournalStatus) {
  const parsed = annotationProcessingJournalMetadataSchema.safeParse(input);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const current = snapshots.get(key);
  if (
    current?.kind !== 'pending' ||
    !sameMetadata(current.metadata, metadata) ||
    !storedMatches(metadata)
  )
    return false;
  const stored = readStorage(storageKey(metadata.ownerId, metadata.albumId));
  if (!stored.ok || stored.raw === null) return false;
  const currentStored = parseStored(
    stored.raw,
    metadata.ownerId,
    metadata.albumId,
  );
  if (!currentStored || !sameMetadata(currentStored.metadata, metadata))
    return false;
  const updated: StoredJournal = { ...currentStored, status };
  try {
    const keyName = storageKey(metadata.ownerId, metadata.albumId);
    const before = window.sessionStorage.getItem(keyName);
    const beforeJournal =
      before === null
        ? null
        : parseStored(before, metadata.ownerId, metadata.albumId);
    if (
      beforeJournal === null ||
      !sameMetadata(beforeJournal.metadata, metadata)
    )
      return false;
    window.sessionStorage.setItem(keyName, JSON.stringify(updated));
    const after = window.sessionStorage.getItem(keyName);
    const afterJournal =
      after === null
        ? null
        : parseStored(after, metadata.ownerId, metadata.albumId);
    if (
      afterJournal === null ||
      !sameMetadata(afterJournal.metadata, metadata) ||
      afterJournal.status !== status
    )
      return false;
  } catch {
    return false;
  }
  publish(key, { ...current, status });
  return true;
}

export function markAnnotationProcessingUncertain(input: unknown) {
  return markIntent(input, 'uncertain');
}

export function markAnnotationProcessingConflict(input: unknown) {
  return markIntent(input, 'conflict');
}

function removeIntent(
  input: unknown,
  claim?: AnnotationProcessingJournalClaim,
) {
  const parsed = annotationProcessingJournalMetadataSchema.safeParse(input);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const keyName = storageKey(metadata.ownerId, metadata.albumId);
  const current = snapshots.get(key);
  const claimMatches =
    claim === undefined
      ? !current || current.kind !== 'pending' || !current.sending
      : claim.key === key &&
        claimTokens.get(key) === claim.token &&
        current?.kind === 'pending' &&
        current.sending &&
        sameMetadata(claim.metadata, metadata);
  if (
    current?.kind !== 'pending' ||
    !sameMetadata(current.metadata, metadata) ||
    !claimMatches ||
    !storedMatches(metadata)
  )
    return false;
  try {
    const before = window.sessionStorage.getItem(keyName);
    const beforeJournal =
      before === null
        ? null
        : parseStored(before, metadata.ownerId, metadata.albumId);
    if (
      beforeJournal === null ||
      !sameMetadata(beforeJournal.metadata, metadata)
    )
      return false;
    window.sessionStorage.removeItem(keyName);
    if (window.sessionStorage.getItem(keyName) !== null) return false;
  } catch {
    return false;
  }
  if (claim !== undefined) claimTokens.delete(key);
  publish(key, emptySnapshot);
  return true;
}

/** Clears only the claimed full intent after a receipt and targeted current read. */
export function completeAnnotationProcessingIntent(
  claim: AnnotationProcessingJournalClaim,
) {
  return removeIntent(claim.metadata, claim);
}

/** Explicit user abandonment clears only an exact, non-sending intent. */
export function abandonAnnotationProcessingIntent(input: unknown) {
  return removeIntent(input);
}
