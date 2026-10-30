import { z } from 'zod';
import { versionUploadInitSchema } from '../../../packages/contracts/src/version-uploads';

export const versionUploadJournalScopeSchema = z
  .object({
    actorId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
  })
  .strict();

export type VersionUploadJournalScope = z.infer<
  typeof versionUploadJournalScopeSchema
>;

const versionUploadJournalInitSchema = versionUploadInitSchema.extend({
  expectedBytes: z.number().int().positive().max(67108864).safe(),
});
const operationBodySchema = z
  .object({ requestId: z.uuid() })
  .strict()
  .nullable();

export const versionUploadJournalItemSchema = z
  .object({
    id: z.uuid(),
    initBody: versionUploadJournalInitSchema,
    uploadSessionId: z.uuid().nullable(),
    authorizeBody: operationBodySchema,
    completeBody: operationBodySchema,
    cancelBody: operationBodySchema,
    width: z.number().int().positive().max(32768),
    height: z.number().int().positive().max(32768),
  })
  .strict();

export type VersionUploadJournalItem = z.infer<
  typeof versionUploadJournalItemSchema
>;

const envelopeSchema = z
  .object({
    version: z.literal(1),
    scope: versionUploadJournalScopeSchema,
    savedAt: z.number().int().nonnegative().safe(),
    items: z.array(versionUploadJournalItemSchema).max(20),
  })
  .strict();

const maximumBytes = 65536;
const maximumAgeMs = 7 * 86400000;

function validate(
  scope: VersionUploadJournalScope,
  items: VersionUploadJournalItem[],
) {
  const itemIds = new Set<string>();
  const operationIds = new Set<string>();
  const sessionIds = new Set<string>();

  for (const item of items) {
    if (itemIds.has(item.id) || item.width * item.height > 80000000) {
      throw new Error('VERSION_UPLOAD_JOURNAL_INVALID');
    }

    if (item.uploadSessionId) {
      if (sessionIds.has(item.uploadSessionId))
        throw new Error('VERSION_UPLOAD_JOURNAL_DUPLICATE_SESSION');
      sessionIds.add(item.uploadSessionId);
    }

    for (const requestId of [
      item.initBody.requestId,
      item.authorizeBody?.requestId,
      item.completeBody?.requestId,
      item.cancelBody?.requestId,
    ]) {
      if (!requestId) continue;
      if (operationIds.has(requestId))
        throw new Error('VERSION_UPLOAD_JOURNAL_DUPLICATE_REQUEST');
      operationIds.add(requestId);
    }

    itemIds.add(item.id);
  }

  // The full resource scope is held by the envelope. The strict init body must
  // stay route-scoped and must never acquire a caller-controlled photo/tenant ID.
  versionUploadJournalScopeSchema.parse(scope);
}

export function versionUploadJournalKey(scope: VersionUploadJournalScope) {
  const parsed = versionUploadJournalScopeSchema.parse(scope);
  return [
    'kino-pic',
    'version-upload-journal',
    'v1',
    parsed.actorId,
    parsed.workspaceId,
    parsed.projectId,
    parsed.albumId,
    parsed.photoId,
  ].join(':');
}

export function encodeVersionUploadJournal(
  scope: VersionUploadJournalScope,
  items: VersionUploadJournalItem[],
  now = Date.now(),
) {
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error('VERSION_UPLOAD_JOURNAL_TIME_INVALID');
  const value = envelopeSchema.parse({
    version: 1,
    scope,
    savedAt: now,
    items,
  });
  validate(value.scope, value.items);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > maximumBytes)
    throw new Error('VERSION_UPLOAD_JOURNAL_TOO_LARGE');
  return text;
}

export function decodeVersionUploadJournal(
  text: string | null,
  scope: VersionUploadJournalScope,
  now = Date.now(),
): VersionUploadJournalItem[] {
  if (text === null) return [];
  if (
    text.length > maximumBytes ||
    new TextEncoder().encode(text).byteLength > maximumBytes
  )
    throw new Error('VERSION_UPLOAD_JOURNAL_TOO_LARGE');

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error('VERSION_UPLOAD_JOURNAL_INVALID');
  }

  const value = envelopeSchema.parse(decoded);
  if (versionUploadJournalKey(value.scope) !== versionUploadJournalKey(scope))
    throw new Error('VERSION_UPLOAD_JOURNAL_SCOPE_INVALID');
  if (value.savedAt > now + 60000 || now - value.savedAt > maximumAgeMs)
    throw new Error('VERSION_UPLOAD_JOURNAL_EXPIRED');
  validate(value.scope, value.items);
  return value.items;
}
