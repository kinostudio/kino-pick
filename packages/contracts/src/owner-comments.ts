import { z } from 'zod';
import { commentProcessingSnapshotSchema } from './comment-processing.ts';
import { guestCommentBodySchema } from './guest-comments.ts';

const expectedRevision = z.number().int().positive().safe();
// UUID spelling must not create a second logical idempotency key.
const requestId = z.uuid().transform((value) => value.toLowerCase());

export const ownerCommentCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      requestId,
      operation: z.literal('reply'),
      inviteId: z.uuid(),
      photoId: z.uuid(),
      versionId: z.uuid(),
      parentCommentId: z.uuid(),
      expectedParentRevision: expectedRevision,
      body: guestCommentBodySchema,
    })
    .strict(),
  z
    .object({
      requestId,
      operation: z.literal('edit_reply'),
      replyId: z.uuid(),
      expectedRevision,
      body: guestCommentBodySchema,
    })
    .strict(),
  z
    .object({
      requestId,
      operation: z.literal('delete_reply'),
      replyId: z.uuid(),
      expectedRevision,
    })
    .strict(),
]);

export const ownerCommentReadQuerySchema = z
  .object({
    inviteId: z.uuid(),
    cursor: z.string().min(1).max(1024).optional(),
    commentId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (query) => query.cursor === undefined || query.commentId === undefined,
    'A targeted current read cannot paginate',
  );

export const ownerCommentThreadItemSchema = z
  .object({
    commentId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    revision: expectedRevision,
    body: guestCommentBodySchema.nullable(),
    state: z.enum(['open', 'resolved', 'deleted']),
    authorType: z.enum(['guest', 'owner']),
    parentCommentId: z.uuid().nullable(),
    processing: commentProcessingSnapshotSchema.nullable().default(null),
    authorLabel: z.string().min(1).max(160),
    canEdit: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if ((item.state === 'deleted') !== (item.body === null))
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'Deleted comments require tombstone body',
      });

    if (item.authorType === 'guest') {
      if (item.parentCommentId !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['parentCommentId'],
          message: 'Guest comments cannot be replies',
        });
      if (item.canEdit)
        ctx.addIssue({
          code: 'custom',
          path: ['canEdit'],
          message: 'Guest comments cannot be edited by the Owner',
        });
    }

    if (item.authorType === 'owner') {
      if (item.processing !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['processing'],
          message: 'Owner replies cannot carry processing state',
        });
      if (item.parentCommentId === null)
        ctx.addIssue({
          code: 'custom',
          path: ['parentCommentId'],
          message: 'Owner comments must be replies',
        });
      if (item.state === 'resolved')
        ctx.addIssue({
          code: 'custom',
          path: ['state'],
          message: 'Owner replies cannot resolve a thread',
        });
    }

    if (item.parentCommentId === item.commentId)
      ctx.addIssue({
        code: 'custom',
        path: ['parentCommentId'],
        message: 'A comment cannot be its own parent',
      });
  });

export const ownerCommentThreadPageSchema = z
  .object({
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    items: z.array(ownerCommentThreadItemSchema).max(24),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (
      page.items.some(
        (item) =>
          item.photoId !== page.photoId || item.versionId !== page.versionId,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Comment scope mismatch',
      });

    if (
      new Set(page.items.map((item) => item.commentId)).size !==
      page.items.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Duplicate comment item',
      });
  });

export const ownerCommentResultSchema = z
  .object({
    requestId,
    operation: z.enum(['reply', 'edit_reply', 'delete_reply']),
    item: ownerCommentThreadItemSchema,
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.item.authorType !== 'owner')
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'authorType'],
        message: 'Owner commands must return an Owner reply',
      });

    if (result.operation === 'reply') {
      if (result.item.revision !== 1)
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'revision'],
          message: 'A new reply starts at revision 1',
        });
      if (result.item.state !== 'open')
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'state'],
          message: 'A new reply must be open',
        });
    }

    if (result.operation === 'edit_reply') {
      if (result.item.revision < 2)
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'revision'],
          message: 'An edited reply must be at revision 2 or later',
        });
      if (result.item.state !== 'open')
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'state'],
          message: 'An edited reply must remain open',
        });
    }

    if (result.operation === 'delete_reply') {
      if (result.item.revision < 2)
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'revision'],
          message: 'A deleted reply must be at revision 2 or later',
        });
      if (result.item.state !== 'deleted')
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'state'],
          message: 'A deleted reply must be a tombstone',
        });
    }
  });

export const ownerCommentsCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type OwnerCommentCommand = z.infer<typeof ownerCommentCommandSchema>;
export type OwnerCommentReadQuery = z.infer<typeof ownerCommentReadQuerySchema>;
export type OwnerCommentThreadItem = z.infer<
  typeof ownerCommentThreadItemSchema
>;
export type OwnerCommentThreadPage = z.infer<
  typeof ownerCommentThreadPageSchema
>;
export type OwnerCommentResult = z.infer<typeof ownerCommentResultSchema>;
export type OwnerCommentsCapabilities = z.infer<
  typeof ownerCommentsCapabilitiesSchema
>;
