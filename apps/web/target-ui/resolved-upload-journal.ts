import { z } from 'zod';
import {
  resolvedUploadReserveSchema,
  resolvedUploadReservationSchema,
  type ResolvedUploadReserve,
} from '../../../packages/contracts/src/resolved-uploads';

export const resolvedUploadJournalScopeSchema = z
  .object({
    actorId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
  })
  .strict();

export type ResolvedUploadJournalScope = z.infer<
  typeof resolvedUploadJournalScopeSchema
>;

const maxBrowserUploadBytes = 64 * 1024 * 1024;
const fileFingerprintSchema = z
  .object({
    originalFilename: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          value.trim().length > 0 && !/[\\/\u0000-\u001f\u007f]/u.test(value),
      ),
    expectedBytes: z
      .number()
      .int()
      .positive()
      .max(maxBrowserUploadBytes)
      .safe(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    dimensions: z
      .object({
        width: z.number().int().positive().max(32768),
        height: z.number().int().positive().max(32768),
      })
      .strict()
      .superRefine((dimensions, ctx) => {
        if (dimensions.width * dimensions.height > 80_000_000) {
          ctx.addIssue({
            code: 'custom',
            message: 'Image dimensions exceed the pixel limit',
          });
        }
      }),
  })
  .strict();

export type ResolvedUploadFileFingerprint = z.infer<
  typeof fileFingerprintSchema
>;

const operationSchema = z.object({ requestId: z.uuid() }).strict();

export const resolvedUploadJournalItemSchema = z
  .object({
    id: z.uuid(),
    reservationBody: resolvedUploadReserveSchema,
    reservation: resolvedUploadReservationSchema.nullable(),
    authorizeBody: operationSchema,
    completeBody: operationSchema,
    fingerprint: fileFingerprintSchema,
    needsReview: z.boolean(),
  })
  .strict();

export type ResolvedUploadJournalItem = z.infer<
  typeof resolvedUploadJournalItemSchema
>;

const envelopeSchema = z
  .object({
    version: z.literal(1),
    scope: resolvedUploadJournalScopeSchema,
    savedAt: z.number().int().nonnegative().safe(),
    items: z.array(resolvedUploadJournalItemSchema).max(1),
  })
  .strict();

const maximumBytes = 65_536;
const maximumAgeMs = 7 * 86_400_000;

function sameFingerprint(
  file: ResolvedUploadReserve['file'],
  fingerprint: ResolvedUploadFileFingerprint,
) {
  return (
    file.originalFilename === fingerprint.originalFilename.trim() &&
    file.expectedBytes === fingerprint.expectedBytes &&
    file.contentType === fingerprint.contentType &&
    file.sha256 === fingerprint.sha256 &&
    file.dimensions.width === fingerprint.dimensions.width &&
    file.dimensions.height === fingerprint.dimensions.height
  );
}

function validate(
  scope: ResolvedUploadJournalScope,
  items: ResolvedUploadJournalItem[],
) {
  const itemIds = new Set<string>();
  const operationIds = new Set<string>();
  const sessionIds = new Set<string>();

  for (const item of items) {
    if (
      itemIds.has(item.id) ||
      !sameFingerprint(item.reservationBody.file, item.fingerprint)
    )
      throw new Error('RESOLVED_UPLOAD_JOURNAL_INVALID');

    for (const requestId of [
      item.reservationBody.requestId,
      item.authorizeBody.requestId,
      item.completeBody.requestId,
    ]) {
      if (operationIds.has(requestId))
        throw new Error('RESOLVED_UPLOAD_JOURNAL_DUPLICATE_REQUEST');
      operationIds.add(requestId);
    }

    if (item.reservation) {
      const { uploadSession, target } = item.reservation;
      if (
        sessionIds.has(uploadSession.id) ||
        uploadSession.workspaceId !== scope.workspaceId ||
        uploadSession.projectId !== scope.projectId ||
        uploadSession.albumId !== scope.albumId ||
        uploadSession.originalFilename !==
          item.reservationBody.file.originalFilename ||
        uploadSession.expectedBytes !==
          item.reservationBody.file.expectedBytes ||
        uploadSession.reservedBytes !== item.reservationBody.file.expectedBytes
      )
        throw new Error('RESOLVED_UPLOAD_JOURNAL_SCOPE_INVALID');
      sessionIds.add(uploadSession.id);

      const choice = item.reservationBody.choice;
      if (choice.kind !== target.kind)
        throw new Error('RESOLVED_UPLOAD_JOURNAL_TARGET_INVALID');
      if (choice.kind === 'new_version') {
        if (
          target.kind !== 'new_version' ||
          target.photoId !== choice.photoId ||
          target.parentVersionId !== choice.parentVersionId ||
          target.expectedRevision !== choice.expectedRevision ||
          target.capturedVersioningMode !== item.reservationBody.expectedMode ||
          target.changeType !== 'new_retouch'
        )
          throw new Error('RESOLVED_UPLOAD_JOURNAL_TARGET_INVALID');
      }
    }

    itemIds.add(item.id);
  }
}

export function resolvedUploadJournalKey(scope: ResolvedUploadJournalScope) {
  const parsed = resolvedUploadJournalScopeSchema.parse(scope);
  return [
    'kino-pic',
    'resolved-upload-journal',
    'v1',
    parsed.actorId,
    parsed.workspaceId,
    parsed.projectId,
    parsed.albumId,
  ].join(':');
}

export function encodeResolvedUploadJournal(
  scope: ResolvedUploadJournalScope,
  items: ResolvedUploadJournalItem[],
  now = Date.now(),
) {
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error('RESOLVED_UPLOAD_JOURNAL_TIME_INVALID');
  const value = envelopeSchema.parse({
    version: 1,
    scope,
    savedAt: now,
    items,
  });
  validate(value.scope, value.items);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > maximumBytes)
    throw new Error('RESOLVED_UPLOAD_JOURNAL_TOO_LARGE');
  return text;
}

export function decodeResolvedUploadJournal(
  text: string | null,
  scope: ResolvedUploadJournalScope,
  now = Date.now(),
): ResolvedUploadJournalItem[] {
  if (text === null) return [];
  if (
    text.length > maximumBytes ||
    new TextEncoder().encode(text).byteLength > maximumBytes
  )
    throw new Error('RESOLVED_UPLOAD_JOURNAL_TOO_LARGE');

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error('RESOLVED_UPLOAD_JOURNAL_INVALID');
  }

  const value = envelopeSchema.parse(decoded);
  if (resolvedUploadJournalKey(value.scope) !== resolvedUploadJournalKey(scope))
    throw new Error('RESOLVED_UPLOAD_JOURNAL_SCOPE_INVALID');
  if (value.savedAt > now + 60_000 || now - value.savedAt > maximumAgeMs)
    throw new Error('RESOLVED_UPLOAD_JOURNAL_EXPIRED');
  validate(value.scope, value.items);
  return value.items;
}
