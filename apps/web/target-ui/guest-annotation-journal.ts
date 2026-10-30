import { z } from 'zod';
import {
  annotationGeometrySchema,
  type AnnotationGeometry,
} from '../../../packages/contracts/src/annotation-geometry.ts';
import {
  annotationStyleSchema,
  guestAnnotationCommandSchema,
  type AnnotationStyle,
  type GuestAnnotationCommand,
} from '../../../packages/contracts/src/guest-annotations.ts';

const expectedCurrentSchema = z
  .object({
    revision: z.number().int().positive().safe(),
    state: z.enum(['open', 'resolved']),
    geometry: annotationGeometrySchema,
    style: annotationStyleSchema,
    commentId: z.uuid().nullable(),
  })
  .strict();

export const guestAnnotationJournalMetadataSchema = z
  .object({
    version: z.literal(1),
    albumId: z.uuid(),
    expectedGuestId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    command: guestAnnotationCommandSchema,
    expectedCurrent: expectedCurrentSchema.nullable(),
  })
  .strict()
  .superRefine((metadata, ctx) => {
    const { command, expectedCurrent } = metadata;
    if (command.expectedGuestId !== metadata.expectedGuestId) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedGuestId'],
        message: 'Journal Guest scope must match its command',
      });
    }

    if (command.operation === 'create') {
      if (
        command.photoId !== metadata.photoId ||
        command.versionId !== metadata.versionId ||
        expectedCurrent !== null
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['command'],
          message: 'Create journal scope must match its target',
        });
      }
      return;
    }

    if (
      expectedCurrent === null ||
      expectedCurrent.revision !== command.expectedRevision
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedCurrent'],
        message: 'Existing annotation commands require their exact base row',
      });
      return;
    }

    const expectedState =
      command.operation === 'resolve'
        ? 'open'
        : command.operation === 'reopen'
          ? 'resolved'
          : 'open';
    if (
      command.operation !== 'delete' &&
      expectedCurrent.state !== expectedState
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedCurrent', 'state'],
        message: 'Command lifecycle must match its base row',
      });
    }

    if (
      command.operation === 'update' &&
      (command.commentId !== expectedCurrent.commentId ||
        (command.commentId === null) !== (expectedCurrent.commentId === null))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['command', 'commentId'],
        message: 'Updates must preserve the existing linked comment',
      });
    }
  });

export type GuestAnnotationJournalMetadata = z.infer<
  typeof guestAnnotationJournalMetadataSchema
>;

export type GuestAnnotationJournalStatus = 'ready' | 'uncertain' | 'conflict';

export type GuestAnnotationJournalSnapshot =
  | { kind: 'none' }
  | {
      kind: 'pending';
      metadata: GuestAnnotationJournalMetadata;
      command: GuestAnnotationCommand;
      status: GuestAnnotationJournalStatus;
      sending: boolean;
    }
  | {
      kind: 'blocked';
      reason: 'storage' | 'corrupt';
      metadata?: GuestAnnotationJournalMetadata;
      command?: GuestAnnotationCommand;
    };

export type GuestAnnotationJournalClaim = {
  readonly key: string;
  readonly token: number;
  readonly metadata: GuestAnnotationJournalMetadata;
  readonly command: GuestAnnotationCommand;
};

type Listener = () => void;
type StorageRead = { ok: true; raw: string | null } | { ok: false };
type MetadataSave =
  | { ok: true; metadata: GuestAnnotationJournalMetadata }
  | {
      ok: false;
      reason: 'existing' | 'storage' | 'invalid';
      snapshot: GuestAnnotationJournalSnapshot;
    };

const snapshots = new Map<string, GuestAnnotationJournalSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const claimTokens = new Map<string, number>();
const emptySnapshot: GuestAnnotationJournalSnapshot = { kind: 'none' };
let nextClaimToken = 0;

function scopeKey(guestId: string, albumId: string) {
  return JSON.stringify([guestId, albumId]);
}

function storageKey(guestId: string, albumId: string) {
  return 'kino-pic:guest-annotations:v1:' + guestId + ':' + albumId;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  }
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
  left: GuestAnnotationJournalMetadata,
  right: GuestAnnotationJournalMetadata,
) {
  return stableJson(left) === stableJson(right);
}

function snapshotMetadata(
  snapshot: GuestAnnotationJournalSnapshot | undefined,
) {
  return snapshot?.kind === 'pending' || snapshot?.kind === 'blocked'
    ? snapshot.metadata
    : undefined;
}

function snapshotCommand(snapshot: GuestAnnotationJournalSnapshot | undefined) {
  return snapshot?.kind === 'pending' || snapshot?.kind === 'blocked'
    ? snapshot.command
    : undefined;
}

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

function publish(key: string, snapshot: GuestAnnotationJournalSnapshot) {
  snapshots.set(key, snapshot);
  notify(key);
}

function blockedSnapshot(
  reason: 'storage' | 'corrupt',
  existing?: GuestAnnotationJournalSnapshot,
): GuestAnnotationJournalSnapshot {
  const metadata = snapshotMetadata(existing);
  const command = snapshotCommand(existing);
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
  guestId: string,
  albumId: string,
): GuestAnnotationJournalMetadata | null {
  if (raw.length > 16_384) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  const parsed = guestAnnotationJournalMetadataSchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.expectedGuestId !== guestId ||
    parsed.data.albumId !== albumId
  ) {
    return null;
  }

  // Request IDs are canonicalized by the shared contract. Reject noncanonical
  // serialized variants so storage comparison always covers the full command.
  if (stableJson(decoded) !== stableJson(parsed.data)) return null;
  return parsed.data;
}

function pendingSnapshot(
  metadata: GuestAnnotationJournalMetadata,
  sending = false,
  status: GuestAnnotationJournalStatus = 'ready',
): GuestAnnotationJournalSnapshot {
  return {
    kind: 'pending',
    metadata,
    command: metadata.command,
    status,
    sending,
  };
}

export function subscribeGuestAnnotationJournal(
  guestId: string,
  albumId: string,
  listener: Listener,
) {
  if (!guestId || !albumId) return () => undefined;
  const key = scopeKey(guestId, albumId);
  const scopeListeners = listeners.get(key) ?? new Set<Listener>();
  scopeListeners.add(listener);
  listeners.set(key, scopeListeners);
  return () => {
    const active = listeners.get(key);
    active?.delete(listener);
    if (active?.size === 0) listeners.delete(key);
  };
}

export function getGuestAnnotationJournalSnapshot(
  guestId: string,
  albumId: string,
): GuestAnnotationJournalSnapshot {
  if (!guestId || !albumId) return emptySnapshot;
  return snapshots.get(scopeKey(guestId, albumId)) ?? emptySnapshot;
}

/**
 * Hydrates a bodyless command from this Guest/album's session-scoped journal.
 * Existing in-memory intents are compared with storage before they are returned.
 */
export function readGuestAnnotationJournal(
  guestId: string,
  albumId: string,
): GuestAnnotationJournalSnapshot {
  const key = scopeKey(guestId, albumId);
  const keyName = storageKey(guestId, albumId);
  const cached = snapshots.get(key);
  const stored = readStorage(keyName);

  if (!stored.ok) {
    const blocked = blockedSnapshot('storage', cached);
    publish(key, blocked);
    return blocked;
  }

  if (stored.raw === null) {
    if (cached?.kind === 'pending' || snapshotMetadata(cached) !== undefined) {
      const blocked = blockedSnapshot('corrupt', cached);
      publish(key, blocked);
      return blocked;
    }
    publish(key, emptySnapshot);
    return emptySnapshot;
  }

  const metadata = parseStored(stored.raw, guestId, albumId);
  if (!metadata) {
    const blocked = blockedSnapshot('corrupt', cached);
    publish(key, blocked);
    return blocked;
  }

  const cachedMetadata = snapshotMetadata(cached);
  if (cachedMetadata && !sameMetadata(cachedMetadata, metadata)) {
    // A newer or replaced raw intent is never overwritten or cleared by a late
    // response for the previous command.
    const blocked = blockedSnapshot('corrupt', cached);
    publish(key, blocked);
    return blocked;
  }

  if (cached?.kind === 'pending' && sameMetadata(cached.metadata, metadata)) {
    return cached;
  }

  const hydrated = pendingSnapshot(metadata);
  publish(key, hydrated);
  return hydrated;
}

/** Rechecks raw storage and requires the complete intent to remain current. */
export function isCurrentGuestAnnotationIntent(metadataInput: unknown) {
  const parsed = guestAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const current = readGuestAnnotationJournal(
    metadata.expectedGuestId,
    metadata.albumId,
  );
  return current.kind === 'pending' && sameMetadata(current.metadata, metadata);
}

export function saveGuestAnnotationIntent(
  metadataInput: unknown,
): MetadataSave {
  const parsed = guestAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      snapshot: { kind: 'none' },
    };
  }
  const metadata = parsed.data;
  const key = scopeKey(metadata.expectedGuestId, metadata.albumId);
  const keyName = storageKey(metadata.expectedGuestId, metadata.albumId);
  const current = readGuestAnnotationJournal(
    metadata.expectedGuestId,
    metadata.albumId,
  );
  if (current.kind !== 'none') {
    return { ok: false, reason: 'existing', snapshot: current };
  }

  const stored = readStorage(keyName);
  if (!stored.ok) {
    const blocked = blockedSnapshot('storage', current);
    publish(key, blocked);
    return { ok: false, reason: 'storage', snapshot: blocked };
  }
  if (stored.raw !== null) {
    const refreshed = readGuestAnnotationJournal(
      metadata.expectedGuestId,
      metadata.albumId,
    );
    return { ok: false, reason: 'existing', snapshot: refreshed };
  }

  try {
    window.sessionStorage.setItem(keyName, JSON.stringify(metadata));
    const confirmed = window.sessionStorage.getItem(keyName);
    if (
      confirmed === null ||
      !parseStored(confirmed, metadata.expectedGuestId, metadata.albumId) ||
      !sameMetadata(
        parseStored(confirmed, metadata.expectedGuestId, metadata.albumId)!,
        metadata,
      )
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

function currentStoredMetadata(
  metadata: GuestAnnotationJournalMetadata,
): GuestAnnotationJournalMetadata | null {
  const stored = readStorage(
    storageKey(metadata.expectedGuestId, metadata.albumId),
  );
  if (!stored.ok || stored.raw === null) return null;
  return parseStored(stored.raw, metadata.expectedGuestId, metadata.albumId);
}

export function claimGuestAnnotationIntent(
  metadataInput: unknown,
): GuestAnnotationJournalClaim | null {
  const parsed = guestAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return null;
  const metadata = parsed.data;
  const key = scopeKey(metadata.expectedGuestId, metadata.albumId);
  const snapshot = readGuestAnnotationJournal(
    metadata.expectedGuestId,
    metadata.albumId,
  );
  const stored = currentStoredMetadata(metadata);

  if (
    snapshot.kind !== 'pending' ||
    snapshot.sending ||
    !sameMetadata(snapshot.metadata, metadata) ||
    !stored ||
    !sameMetadata(stored, metadata)
  ) {
    return null;
  }

  nextClaimToken += 1;
  const token = nextClaimToken;
  claimTokens.set(key, token);
  publish(key, { ...snapshot, sending: true });
  return { key, token, metadata, command: metadata.command };
}

/** Releases only the exact claim that acquired this scope's send mutex. */
export function releaseGuestAnnotationClaim(
  claim: GuestAnnotationJournalClaim,
): boolean {
  if (claimTokens.get(claim.key) !== claim.token) return false;
  claimTokens.delete(claim.key);

  const current = snapshots.get(claim.key);
  if (
    current?.kind !== 'pending' ||
    !sameMetadata(current.metadata, claim.metadata)
  ) {
    return false;
  }

  const stored = currentStoredMetadata(claim.metadata);
  if (!stored || !sameMetadata(stored, claim.metadata)) {
    publish(claim.key, blockedSnapshot('corrupt', current));
    return false;
  }

  publish(claim.key, { ...current, sending: false });
  return true;
}

function markIntent(
  metadataInput: unknown,
  status: GuestAnnotationJournalStatus,
): boolean {
  const parsed = guestAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const key = scopeKey(metadata.expectedGuestId, metadata.albumId);
  const current = snapshots.get(key);
  if (
    current?.kind !== 'pending' ||
    !sameMetadata(current.metadata, metadata)
  ) {
    return false;
  }
  const stored = currentStoredMetadata(metadata);

  if (!stored || !sameMetadata(stored, metadata)) {
    publish(key, blockedSnapshot('corrupt', current));
    return false;
  }

  publish(key, { ...current, status });
  return true;
}

export function markGuestAnnotationUncertain(metadata: unknown) {
  return markIntent(metadata, 'uncertain');
}

export function markGuestAnnotationConflict(metadata: unknown) {
  return markIntent(metadata, 'conflict');
}

function removeIntent(metadataInput: unknown): boolean {
  const parsed = guestAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const key = scopeKey(metadata.expectedGuestId, metadata.albumId);
  const keyName = storageKey(metadata.expectedGuestId, metadata.albumId);
  const current = snapshots.get(key);
  if (
    current?.kind !== 'pending' ||
    !sameMetadata(current.metadata, metadata)
  ) {
    return false;
  }
  const stored = currentStoredMetadata(metadata);

  if (current.sending || !stored || !sameMetadata(stored, metadata)) {
    publish(key, blockedSnapshot('corrupt', current));
    return false;
  }

  try {
    window.sessionStorage.removeItem(keyName);
    if (window.sessionStorage.getItem(keyName) !== null) {
      publish(key, blockedSnapshot('storage', current));
      return false;
    }
  } catch {
    publish(key, blockedSnapshot('storage', current));
    return false;
  }

  claimTokens.delete(key);
  publish(key, { kind: 'none' });
  return true;
}

/** Called only after a validated receipt and successful targeted current read. */
export function completeGuestAnnotationIntent(metadata: unknown) {
  return removeIntent(metadata);
}

/** Explicit user abandonment; it never clears a different or unknown raw intent. */
export function abandonGuestAnnotationIntent(metadata: unknown) {
  return removeIntent(metadata);
}

// Kept as a tiny convenience for callers constructing immutable intent records.
export function guestAnnotationJournalMetadata(input: {
  albumId: string;
  expectedGuestId: string;
  photoId: string;
  versionId: string;
  command: GuestAnnotationCommand;
  expectedCurrent: {
    revision: number;
    state: 'open' | 'resolved';
    geometry: AnnotationGeometry;
    style: AnnotationStyle;
    commentId: string | null;
  } | null;
}): GuestAnnotationJournalMetadata {
  return guestAnnotationJournalMetadataSchema.parse({
    version: 1,
    ...input,
  });
}
