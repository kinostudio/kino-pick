import { z } from 'zod';
import { uploadInitSchema } from '../../../packages/contracts/src/uploads';

export const uploadJournalScopeSchema = z
  .object({
    actorId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
  })
  .strict();
export type UploadJournalScope = z.infer<typeof uploadJournalScopeSchema>;
const operation = z.object({ requestId: z.uuid() }).strict().nullable();
export const uploadJournalItemSchema = z
  .object({
    id: z.uuid(),
    initBody: uploadInitSchema.extend({
      expectedBytes: z.number().int().positive().max(67108864),
    }),
    uploadSessionId: z.uuid().nullable(),
    authorizeBody: operation,
    completeBody: operation,
    cancelBody: operation,
    width: z.number().int().positive().max(32768),
    height: z.number().int().positive().max(32768),
  })
  .strict();
export type UploadJournalItem = z.infer<typeof uploadJournalItemSchema>;
const envelope = z
  .object({
    version: z.literal(1),
    scope: uploadJournalScopeSchema,
    savedAt: z.number().int().nonnegative(),
    items: z.array(uploadJournalItemSchema).max(20),
  })
  .strict();
const maximumBytes = 65536;
export function uploadJournalKey(scope: UploadJournalScope) {
  const s = uploadJournalScopeSchema.parse(scope);
  return `kino-pic:upload-journal:v1:${s.actorId}:${s.workspaceId}:${s.projectId}:${s.albumId}`;
}
function validate(scope: UploadJournalScope, items: UploadJournalItem[]) {
  const ids = new Set<string>();
  const requests = new Set<string>();
  for (const item of items) {
    if (
      item.initBody.workspaceId !== scope.workspaceId ||
      item.initBody.projectId !== scope.projectId ||
      item.initBody.albumId !== scope.albumId ||
      ids.has(item.id) ||
      item.width * item.height > 80000000
    )
      throw new Error('UPLOAD_JOURNAL_SCOPE_INVALID');
    ids.add(item.id);
    for (const id of [
      item.initBody.requestId,
      item.authorizeBody?.requestId,
      item.completeBody?.requestId,
      item.cancelBody?.requestId,
    ]) {
      if (id && requests.has(id))
        throw new Error('UPLOAD_JOURNAL_DUPLICATE_REQUEST');
      if (id) requests.add(id);
    }
  }
}
export function encodeUploadJournal(
  scope: UploadJournalScope,
  items: UploadJournalItem[],
  now = Date.now(),
) {
  const value = envelope.parse({ version: 1, scope, savedAt: now, items });
  validate(value.scope, value.items);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > maximumBytes)
    throw new Error('UPLOAD_JOURNAL_TOO_LARGE');
  return text;
}
export function decodeUploadJournal(
  text: string | null,
  scope: UploadJournalScope,
  now = Date.now(),
): UploadJournalItem[] {
  if (text === null) return [];
  if (
    text.length > maximumBytes ||
    new TextEncoder().encode(text).byteLength > maximumBytes
  )
    throw new Error('UPLOAD_JOURNAL_TOO_LARGE');
  const value = envelope.parse(JSON.parse(text));
  if (uploadJournalKey(value.scope) !== uploadJournalKey(scope))
    throw new Error('UPLOAD_JOURNAL_SCOPE_INVALID');
  if (value.savedAt > now + 60000 || now - value.savedAt > 7 * 86400000)
    throw new Error('UPLOAD_JOURNAL_EXPIRED');
  validate(value.scope, value.items);
  return value.items;
}
