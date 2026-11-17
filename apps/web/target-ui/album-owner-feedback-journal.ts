import { z } from 'zod';
import {
  albumOwnerFeedbackCommandSchema,
  type AlbumOwnerFeedbackCommand,
} from '../../../packages/contracts/src/album-owner-feedback.ts';

const journalMetadataSchema = z
  .object({
    version: z.literal(1),
    actorId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    kind: z.enum(['comment', 'annotation']),
    status: z.enum(['ready', 'uncertain', 'conflict']),
    command: albumOwnerFeedbackCommandSchema,
  })
  .strict()
  .superRefine((metadata, ctx) => {
    if (
      metadata.command.photoId !== metadata.photoId ||
      metadata.command.versionId !== metadata.versionId ||
      !metadata.command.operation.endsWith('_' + metadata.kind)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'Journal command must match its photo and feedback kind',
      });
  });

export type AlbumOwnerFeedbackJournalMetadata = z.infer<
  typeof journalMetadataSchema
>;

export type AlbumOwnerFeedbackJournalSnapshot =
  | { kind: 'none' }
  | {
      kind: 'pending';
      metadata: AlbumOwnerFeedbackJournalMetadata;
      command: AlbumOwnerFeedbackCommand;
      status: AlbumOwnerFeedbackJournalMetadata['status'];
    }
  | { kind: 'blocked'; reason: 'storage' | 'corrupt' };

export type AlbumOwnerFeedbackJournalScope = Pick<
  AlbumOwnerFeedbackJournalMetadata,
  'actorId' | 'albumId' | 'photoId' | 'versionId' | 'kind'
>;

const none: AlbumOwnerFeedbackJournalSnapshot = { kind: 'none' };

function storageKey(scope: AlbumOwnerFeedbackJournalScope) {
  return 'kino-pic:owner-album-feedback:v1:' + JSON.stringify(scope);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  if (typeof value === 'object' && value !== null)
    return (
      '{' +
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

function sameMetadata(
  left: AlbumOwnerFeedbackJournalMetadata,
  right: AlbumOwnerFeedbackJournalMetadata,
) {
  return stableJson(left) === stableJson(right);
}

export function sameAlbumOwnerFeedbackJournalMetadata(
  left: AlbumOwnerFeedbackJournalMetadata,
  right: AlbumOwnerFeedbackJournalMetadata,
) {
  return sameMetadata(left, right);
}

export function readAlbumOwnerFeedbackJournal(
  scope: AlbumOwnerFeedbackJournalScope,
): AlbumOwnerFeedbackJournalSnapshot {
  if (typeof window === 'undefined')
    return { kind: 'blocked', reason: 'storage' };

  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(storageKey(scope));
  } catch {
    return { kind: 'blocked', reason: 'storage' };
  }
  if (raw === null) return none;
  if (raw.length > 32_768) return { kind: 'blocked', reason: 'corrupt' };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return { kind: 'blocked', reason: 'corrupt' };
  }
  const parsed = journalMetadataSchema.safeParse(decoded);
  if (
    !parsed.success ||
    Object.entries(scope).some(
      ([key, value]) =>
        parsed.data[key as keyof AlbumOwnerFeedbackJournalScope] !== value,
    )
  )
    return { kind: 'blocked', reason: 'corrupt' };

  return {
    kind: 'pending',
    metadata: parsed.data,
    command: parsed.data.command,
    status: parsed.data.status,
  };
}

export function saveAlbumOwnerFeedbackIntent(
  metadata: AlbumOwnerFeedbackJournalMetadata,
): boolean {
  const parsed = journalMetadataSchema.safeParse(metadata);
  if (!parsed.success || typeof window === 'undefined') return false;

  const scope: AlbumOwnerFeedbackJournalScope = {
    actorId: metadata.actorId,
    albumId: metadata.albumId,
    photoId: metadata.photoId,
    versionId: metadata.versionId,
    kind: metadata.kind,
  };
  const existing = readAlbumOwnerFeedbackJournal(scope);
  if (existing.kind !== 'none')
    return (
      existing.kind === 'pending' && sameMetadata(existing.metadata, metadata)
    );

  try {
    window.sessionStorage.setItem(
      storageKey(scope),
      JSON.stringify(parsed.data),
    );
    return true;
  } catch {
    return false;
  }
}

export function updateAlbumOwnerFeedbackJournalStatus(
  metadata: AlbumOwnerFeedbackJournalMetadata,
  status: AlbumOwnerFeedbackJournalMetadata['status'],
): boolean {
  const parsed = journalMetadataSchema.safeParse({ ...metadata, status });
  if (!parsed.success || typeof window === 'undefined') return false;

  const scope: AlbumOwnerFeedbackJournalScope = {
    actorId: metadata.actorId,
    albumId: metadata.albumId,
    photoId: metadata.photoId,
    versionId: metadata.versionId,
    kind: metadata.kind,
  };
  const existing = readAlbumOwnerFeedbackJournal(scope);
  if (existing.kind !== 'pending' || !sameMetadata(existing.metadata, metadata))
    return false;

  try {
    window.sessionStorage.setItem(
      storageKey(scope),
      JSON.stringify(parsed.data),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearAlbumOwnerFeedbackIntent(
  metadata: AlbumOwnerFeedbackJournalMetadata,
): boolean {
  if (typeof window === 'undefined') return false;

  const scope: AlbumOwnerFeedbackJournalScope = {
    actorId: metadata.actorId,
    albumId: metadata.albumId,
    photoId: metadata.photoId,
    versionId: metadata.versionId,
    kind: metadata.kind,
  };
  const existing = readAlbumOwnerFeedbackJournal(scope);
  if (existing.kind !== 'pending' || !sameMetadata(existing.metadata, metadata))
    return false;

  try {
    window.sessionStorage.removeItem(storageKey(scope));
    return true;
  } catch {
    return false;
  }
}
