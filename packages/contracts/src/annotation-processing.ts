import { z } from 'zod';

const requestId = z
  .uuid()
  .refine((value) => value === value.toLowerCase(), 'Expected lowercase UUID');
const positiveRevision = z.number().int().positive().safe();
const nonnegativeRevision = z.number().int().nonnegative().safe();

const initialProcessingSnapshotSchema = z
  .object({
    state: z.literal('open'),
    revision: z.literal(0),
    annotationRevision: z.null(),
    contentRevision: z.null(),
    updatedAt: z.null(),
    stale: z.literal(false),
  })
  .strict();

const recordedProcessingSnapshotSchema = z
  .object({
    state: z.enum(['open', 'in_progress', 'resolved']),
    revision: positiveRevision,
    annotationRevision: positiveRevision,
    contentRevision: positiveRevision,
    updatedAt: z.iso.datetime(),
    stale: z.boolean(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.contentRevision > snapshot.annotationRevision)
      ctx.addIssue({
        code: 'custom',
        path: ['contentRevision'],
        message: 'Content revision cannot exceed its annotation revision',
      });
  });

/** A processing state and its content watermark, independent of Guest annotation state. */
export const annotationProcessingSnapshotSchema = z.union([
  initialProcessingSnapshotSchema,
  recordedProcessingSnapshotSchema,
]);

export const ownerAnnotationProcessingCommandSchema = z
  .object({
    requestId,
    expectedOwnerId: z.uuid(),
    operation: z.literal('set_processing_state'),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    annotationId: z.uuid(),
    expectedAnnotationRevision: positiveRevision,
    expectedProcessingRevision: nonnegativeRevision,
    state: z.enum(['open', 'in_progress', 'resolved']),
  })
  .strict();

export const ownerAnnotationProcessingResultSchema = z
  .object({
    ownerId: z.uuid(),
    requestId,
    operation: z.literal('set_processing_state'),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    annotationId: z.uuid(),
    processing: annotationProcessingSnapshotSchema,
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.processing.revision < 1)
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'revision'],
        message: 'A processing command must produce a positive revision',
      });
    if (result.processing.stale)
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'stale'],
        message: 'A processing command receipt cannot be stale',
      });
    if (result.processing.updatedAt !== result.occurredAt)
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'updatedAt'],
        message: 'Receipt time must match the processing update time',
      });
  });

export const ownerAnnotationProcessingCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type AnnotationProcessingState = 'open' | 'in_progress' | 'resolved';
export type AnnotationProcessingSnapshot = z.infer<
  typeof annotationProcessingSnapshotSchema
>;
export type OwnerAnnotationProcessingCommand = z.infer<
  typeof ownerAnnotationProcessingCommandSchema
>;
export type OwnerAnnotationProcessingResult = z.infer<
  typeof ownerAnnotationProcessingResultSchema
>;
export type OwnerAnnotationProcessingCapabilities = z.infer<
  typeof ownerAnnotationProcessingCapabilitiesSchema
>;
