import { z } from 'zod';

// Revision zero is the only unrecorded projection. Recorded projections carry
// both source watermarks, so callers can distinguish a pending projection
// from one that needs recomputation without changing Guest-authored content.
const positiveSafeRevision = z.number().int().positive().safe();
const nonnegativeSafeRevision = z.number().int().nonnegative().safe();
const requestId = z.uuid().transform((value) => value.toLowerCase());

const initialCommentProcessingSnapshotSchema = z
  .object({
    state: z.literal('open'),
    revision: z.literal(0),
    commentRevision: z.null(),
    contentRevision: z.null(),
    updatedAt: z.null(),
    stale: z.literal(false),
  })
  .strict();

const recordedCommentProcessingSnapshotSchema = z
  .object({
    state: z.enum(['open', 'in_progress', 'resolved']),
    revision: positiveSafeRevision,
    commentRevision: positiveSafeRevision,
    contentRevision: positiveSafeRevision,
    updatedAt: z.iso.datetime(),
    stale: z.boolean(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.contentRevision > snapshot.commentRevision)
      ctx.addIssue({
        code: 'custom',
        path: ['contentRevision'],
        message: 'Content revision cannot exceed comment revision',
      });
  });

export const commentProcessingSnapshotSchema = z.union([
  initialCommentProcessingSnapshotSchema,
  recordedCommentProcessingSnapshotSchema,
]);

export const ownerCommentProcessingCommandSchema = z
  .object({
    requestId,
    operation: z.literal('set_processing_state'),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    commentId: z.uuid(),
    expectedCommentRevision: positiveSafeRevision,
    expectedProcessingRevision: nonnegativeSafeRevision,
    state: z.enum(['open', 'in_progress', 'resolved']),
  })
  .strict();

export const ownerCommentProcessingResultSchema = z
  .object({
    requestId,
    operation: z.literal('set_processing_state'),
    commentId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    processing: commentProcessingSnapshotSchema,
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.processing.revision < 1)
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'revision'],
        message: 'A recorded command result requires a positive revision',
      });

    if (result.processing.stale)
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'stale'],
        message: 'A command result cannot be stale',
      });

    if (result.processing.updatedAt !== result.occurredAt)
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'updatedAt'],
        message: 'Processing update time must match the receipt time',
      });
  });

export const ownerCommentProcessingCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type CommentProcessingSnapshot = z.infer<
  typeof commentProcessingSnapshotSchema
>;
export type OwnerCommentProcessingCommand = z.infer<
  typeof ownerCommentProcessingCommandSchema
>;
export type OwnerCommentProcessingResult = z.infer<
  typeof ownerCommentProcessingResultSchema
>;
export type OwnerCommentProcessingCapabilities = z.infer<
  typeof ownerCommentProcessingCapabilitiesSchema
>;
