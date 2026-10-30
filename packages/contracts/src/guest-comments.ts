import { z } from 'zod';
import { commentProcessingSnapshotSchema } from './comment-processing.ts';

export const guestCommentBodySchema = z
  .string()
  .max(8000)
  .transform((value) => value.replace(/\r\n?/g, '\n').normalize('NFC').trim())
  .refine(
    (value) => [...value].length >= 1 && [...value].length <= 2000,
    'Comment must contain 1–2000 characters',
  )
  .refine(
    (value) =>
      !/[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(
        value,
      ),
    'Unsupported control character',
  );
export const guestCommentTargetSchema = z
  .object({ photoId: z.uuid(), versionId: z.uuid() })
  .strict();
export const guestCommentTargetsSchema = z
  .array(guestCommentTargetSchema)
  .min(1)
  .max(24)
  .refine(
    (items) => new Set(items.map((item) => item.photoId)).size === items.length,
    'One version per photo per command',
  );
const common = { requestId: z.uuid(), expectedGuestId: z.uuid() };
const existing = {
  ...common,
  commentId: z.uuid(),
  expectedRevision: z.number().int().positive().safe(),
};
export const guestCommentCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...common,
      operation: z.literal('create'),
      targets: guestCommentTargetsSchema,
      body: guestCommentBodySchema,
    })
    .strict(),
  z
    .object({
      ...existing,
      operation: z.literal('edit'),
      body: guestCommentBodySchema,
    })
    .strict(),
  z.object({ ...existing, operation: z.literal('delete') }).strict(),
  z.object({ ...existing, operation: z.literal('resolve') }).strict(),
  z.object({ ...existing, operation: z.literal('reopen') }).strict(),
]);
export const guestCommentItemSchema = z
  .object({
    commentId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    revision: z.number().int().positive().safe(),
    body: guestCommentBodySchema.nullable(),
    state: z.enum(['open', 'resolved', 'deleted']),
    authorLabel: z.string().min(1).max(160),
    isMine: z.boolean(),
    authorType: z.enum(['guest', 'owner']).default('guest'),
    parentCommentId: z.uuid().nullable().default(null),
    processing: commentProcessingSnapshotSchema.nullable().default(null),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (item) => (item.state === 'deleted') === (item.body === null),
    'Deleted comments require tombstone body',
  )
  .refine(
    (item) =>
      item.authorType === 'guest'
        ? item.parentCommentId === null
        : item.parentCommentId !== null &&
          item.parentCommentId !== item.commentId &&
          !item.isMine &&
          item.state !== 'resolved' &&
          item.processing === null,
    'Invalid comment author provenance',
  );
export const guestCommentsPageSchema = z
  .object({
    guestId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    items: z.array(guestCommentItemSchema).max(24),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (
      page.items.some(
        (item) =>
          item.photoId !== page.photoId || item.versionId !== page.versionId,
      ) ||
      new Set(page.items.map((item) => item.commentId)).size !==
        page.items.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Comment scope mismatch or duplicate',
      });
  });
export const guestCommentResultSchema = z
  .object({
    guestId: z.uuid(),
    requestId: z.uuid(),
    operation: z.enum(['create', 'edit', 'delete', 'resolve', 'reopen']),
    items: z.array(guestCommentItemSchema).min(1).max(24),
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (result) =>
      new Set(result.items.map((item) => item.commentId)).size ===
      result.items.length,
    'Duplicate comment result',
  )
  .refine(
    (result) =>
      result.items.every((item) => item.authorType === 'guest' && item.isMine),
    "Guest commands can only return the current author's Guest comments",
  );
export const guestCommentReadQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    commentId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (query) => query.cursor === undefined || query.commentId === undefined,
    'A targeted current read cannot paginate',
  );
export const guestCommentsCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export type GuestCommentCommand = z.infer<typeof guestCommentCommandSchema>;
export type GuestCommentItem = z.infer<typeof guestCommentItemSchema>;
export type GuestCommentsPage = z.infer<typeof guestCommentsPageSchema>;
export type GuestCommentResult = z.infer<typeof guestCommentResultSchema>;
