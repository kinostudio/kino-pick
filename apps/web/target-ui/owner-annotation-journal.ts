import { z } from 'zod';
import {
  annotationGeometrySchema,
  type AnnotationGeometry,
} from '../../../packages/contracts/src/annotation-geometry.ts';
import {
  type OwnerAnnotationCommand,
  ownerAnnotationCommandSchema,
} from '../../../packages/contracts/src/owner-annotation-authoring.ts';
import { annotationStyleSchema } from '../../../packages/contracts/src/guest-annotations.ts';

const expectedCurrentSchema = z
  .object({
    revision: z.number().int().positive().safe(),
    state: z.enum(['open', 'resolved']),
    geometry: annotationGeometrySchema,
    style: annotationStyleSchema,
    commentId: z.uuid().nullable(),
  })
  .strict();

export const ownerAnnotationJournalMetadataSchema = z
  .object({
    version: z.literal(1),
    ownerId: z.uuid(),
    albumId: z.uuid(),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    command: ownerAnnotationCommandSchema,
    expectedCurrent: expectedCurrentSchema.nullable(),
  })
  .strict()
  .superRefine((metadata, ctx) => {
    const { command, expectedCurrent } = metadata;
    if (command.expectedOwnerId !== metadata.ownerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['ownerId'],
        message: 'Journal Owner scope must match its command',
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

    if (command.operation === 'create') {
      if (expectedCurrent !== null || command.commentId !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['expectedCurrent'],
          message: 'Creates require no base row and no linked comment',
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

    const requiredState =
      command.operation === 'resolve'
        ? 'open'
        : command.operation === 'reopen'
          ? 'resolved'
          : 'open';
    if (
      command.operation !== 'delete' &&
      expectedCurrent.state !== requiredState
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedCurrent', 'state'],
        message: 'Command lifecycle must match its base row',
      });
    }

    if (
      command.operation === 'update' &&
      command.commentId !== expectedCurrent.commentId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['command', 'commentId'],
        message: 'Updates must preserve the existing linked comment',
      });
    }
  });

export type OwnerAnnotationJournalMetadata = z.infer<
  typeof ownerAnnotationJournalMetadataSchema
>;

export type OwnerAnnotationJournalStatus = 'ready' | 'uncertain' | 'conflict';

export type OwnerAnnotationJournalSnapshot =
  | { kind: 'none' }
  | {
      kind: 'pending';
      metadata: OwnerAnnotationJournalMetadata;
      command: OwnerAnnotationCommand;
      status: OwnerAnnotationJournalStatus;
      sending: boolean;
    }
  | {
      kind: 'blocked';
      reason: 'storage' | 'corrupt';
      metadata?: OwnerAnnotationJournalMetadata;
      command?: OwnerAnnotationCommand;
    };

export type OwnerAnnotationJournalClaim = {
  readonly key: string;
  readonly token: number;
  readonly metadata: OwnerAnnotationJournalMetadata;
  readonly command: OwnerAnnotationCommand;
};

type Listener = () => void;
type StorageRead = { ok: true; raw: string | null } | { ok: false };
type MetadataSave =
  | { ok: true; metadata: OwnerAnnotationJournalMetadata }
  | {
      ok: false;
      reason: 'existing' | 'storage' | 'invalid';
      snapshot: OwnerAnnotationJournalSnapshot;
    };

const snapshots = new Map<string, OwnerAnnotationJournalSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const claimTokens = new Map<string, number>();
const emptySnapshot: OwnerAnnotationJournalSnapshot = { kind: 'none' };
let nextClaimToken = 0;

function scopeKey(ownerId: string, albumId: string) {
  return JSON.stringify([ownerId, albumId]);
}

function storageKey(ownerId: string, albumId: string) {
  return 'kino-pic:owner-annotations:v1:' + ownerId + ':' + albumId;
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
  left: OwnerAnnotationJournalMetadata,
  right: OwnerAnnotationJournalMetadata,
) {
  return stableJson(left) === stableJson(right);
}

function metadataOf(snapshot: OwnerAnnotationJournalSnapshot | undefined) {
  return snapshot?.kind === 'pending' || snapshot?.kind === 'blocked'
    ? snapshot.metadata
    : undefined;
}

function commandOf(snapshot: OwnerAnnotationJournalSnapshot | undefined) {
  return snapshot?.kind === 'pending' || snapshot?.kind === 'blocked'
    ? snapshot.command
    : undefined;
}

function notify(key: string) {
  for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

function publish(key: string, snapshot: OwnerAnnotationJournalSnapshot) {
  snapshots.set(key, snapshot);
  notify(key);
}

function blockedSnapshot(
  reason: 'storage' | 'corrupt',
  existing?: OwnerAnnotationJournalSnapshot,
): OwnerAnnotationJournalSnapshot {
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
): OwnerAnnotationJournalMetadata | null {
  if (raw.length > 32_768) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = ownerAnnotationJournalMetadataSchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.ownerId !== ownerId ||
    parsed.data.albumId !== albumId
  ) {
    return null;
  }
  if (stableJson(decoded) !== stableJson(parsed.data)) return null;
  return parsed.data;
}

function pendingSnapshot(
  metadata: OwnerAnnotationJournalMetadata,
  sending = false,
  status: OwnerAnnotationJournalStatus = 'ready',
): OwnerAnnotationJournalSnapshot {
  return {
    kind: 'pending',
    metadata,
    command: metadata.command,
    status,
    sending,
  };
}

export function subscribeOwnerAnnotationJournal(
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

export function getOwnerAnnotationJournalSnapshot(
  ownerId: string,
  albumId: string,
): OwnerAnnotationJournalSnapshot {
  if (!ownerId || !albumId) return emptySnapshot;
  return snapshots.get(scopeKey(ownerId, albumId)) ?? emptySnapshot;
}

/** Revalidates raw storage on every read and restores the exact command. */
export function readOwnerAnnotationJournal(
  ownerId: string,
  albumId: string,
): OwnerAnnotationJournalSnapshot {
  if (!ownerId || !albumId) return emptySnapshot;
  const key = scopeKey(ownerId, albumId);
  const keyName = storageKey(ownerId, albumId);
  const cached = snapshots.get(key);
  const stored = readStorage(keyName);

  if (!stored.ok) {
    const blocked = blockedSnapshot('storage', cached);
    publish(key, blocked);
    return blocked;
  }
  if (stored.raw === null) {
    if (cached?.kind === 'pending' || metadataOf(cached) !== undefined) {
      const blocked = blockedSnapshot('corrupt', cached);
      publish(key, blocked);
      return blocked;
    }
    publish(key, emptySnapshot);
    return emptySnapshot;
  }

  const metadata = parseStored(stored.raw, ownerId, albumId);
  if (!metadata) {
    const blocked = blockedSnapshot('corrupt', cached);
    publish(key, blocked);
    return blocked;
  }

  const cachedMetadata = metadataOf(cached);
  if (cachedMetadata && !sameMetadata(cachedMetadata, metadata)) {
    const blocked = blockedSnapshot('corrupt', cached);
    publish(key, blocked);
    return blocked;
  }
  if (cached?.kind === 'pending' && sameMetadata(cached.metadata, metadata))
    return cached;

  const hydrated = pendingSnapshot(metadata);
  publish(key, hydrated);
  return hydrated;
}

export function isCurrentOwnerAnnotationIntent(metadataInput: unknown) {
  const parsed = ownerAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const current = readOwnerAnnotationJournal(
    metadata.ownerId,
    metadata.albumId,
  );
  return current.kind === 'pending' && sameMetadata(current.metadata, metadata);
}

export function saveOwnerAnnotationIntent(
  metadataInput: unknown,
): MetadataSave {
  const parsed = ownerAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success)
    return {
      ok: false,
      reason: 'invalid',
      snapshot: emptySnapshot,
    };

  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const keyName = storageKey(metadata.ownerId, metadata.albumId);
  const current = readOwnerAnnotationJournal(
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
    const refreshed = readOwnerAnnotationJournal(
      metadata.ownerId,
      metadata.albumId,
    );
    return { ok: false, reason: 'existing', snapshot: refreshed };
  }

  try {
    window.sessionStorage.setItem(keyName, JSON.stringify(metadata));
    const confirmed = window.sessionStorage.getItem(keyName);
    const roundTrip =
      confirmed === null
        ? null
        : parseStored(confirmed, metadata.ownerId, metadata.albumId);
    if (!roundTrip || !sameMetadata(roundTrip, metadata)) {
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

function currentStoredMetadata(metadata: OwnerAnnotationJournalMetadata) {
  const stored = readStorage(storageKey(metadata.ownerId, metadata.albumId));
  if (!stored.ok || stored.raw === null) return null;
  return parseStored(stored.raw, metadata.ownerId, metadata.albumId);
}

export function claimOwnerAnnotationIntent(metadataInput: unknown) {
  const parsed = ownerAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return null;
  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const snapshot = readOwnerAnnotationJournal(
    metadata.ownerId,
    metadata.albumId,
  );
  const stored = currentStoredMetadata(metadata);
  if (
    snapshot.kind !== 'pending' ||
    snapshot.sending ||
    !sameMetadata(snapshot.metadata, metadata) ||
    !stored ||
    !sameMetadata(stored, metadata)
  )
    return null;

  nextClaimToken += 1;
  const token = nextClaimToken;
  claimTokens.set(key, token);
  publish(key, { ...snapshot, sending: true });
  return { key, token, metadata, command: snapshot.command };
}

export function releaseOwnerAnnotationClaim(
  claim: OwnerAnnotationJournalClaim,
) {
  if (claimTokens.get(claim.key) !== claim.token) return false;
  claimTokens.delete(claim.key);
  const current = snapshots.get(claim.key);
  if (
    current?.kind !== 'pending' ||
    !sameMetadata(current.metadata, claim.metadata)
  )
    return false;

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
  status: OwnerAnnotationJournalStatus,
) {
  const parsed = ownerAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const current = snapshots.get(key);
  if (current?.kind !== 'pending' || !sameMetadata(current.metadata, metadata))
    return false;
  const stored = currentStoredMetadata(metadata);
  if (!stored || !sameMetadata(stored, metadata)) {
    publish(key, blockedSnapshot('corrupt', current));
    return false;
  }
  publish(key, { ...current, status });
  return true;
}

export function markOwnerAnnotationUncertain(metadata: unknown) {
  return markIntent(metadata, 'uncertain');
}

export function markOwnerAnnotationConflict(metadata: unknown) {
  return markIntent(metadata, 'conflict');
}

function removeIntent(metadataInput: unknown) {
  const parsed = ownerAnnotationJournalMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) return false;
  const metadata = parsed.data;
  const key = scopeKey(metadata.ownerId, metadata.albumId);
  const keyName = storageKey(metadata.ownerId, metadata.albumId);
  const current = readOwnerAnnotationJournal(
    metadata.ownerId,
    metadata.albumId,
  );
  if (current.kind !== 'pending' || !sameMetadata(current.metadata, metadata))
    return false;
  if (current.sending) return false;

  const stored = currentStoredMetadata(metadata);
  if (!stored || !sameMetadata(stored, metadata)) {
    publish(key, blockedSnapshot('corrupt', current));
    return false;
  }

  try {
    const before = window.sessionStorage.getItem(keyName);
    if (before === null) {
      publish(key, blockedSnapshot('corrupt', current));
      return false;
    }
    const beforeMetadata = parseStored(
      before,
      metadata.ownerId,
      metadata.albumId,
    );
    if (!beforeMetadata || !sameMetadata(beforeMetadata, metadata)) {
      publish(key, blockedSnapshot('corrupt', current));
      return false;
    }
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

/** Call after receipt validation and a successful current-owner targeted read. */
export function completeOwnerAnnotationIntent(metadata: unknown) {
  return removeIntent(metadata);
}

/** Explicit user abandonment clears only the exact full intent. */
export function abandonOwnerAnnotationIntent(metadata: unknown) {
  return removeIntent(metadata);
}

export function ownerAnnotationJournalMetadata(input: {
  ownerId: string;
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  command: OwnerAnnotationCommand;
  expectedCurrent: {
    revision: number;
    state: 'open' | 'resolved';
    geometry: AnnotationGeometry;
    style: z.infer<typeof annotationStyleSchema>;
    commentId: string | null;
  } | null;
}): OwnerAnnotationJournalMetadata {
  return ownerAnnotationJournalMetadataSchema.parse({
    version: 1,
    ...input,
  });
}
