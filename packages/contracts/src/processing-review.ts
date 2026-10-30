import { z } from 'zod';

export const processingReviewPreviewSchema = z
  .object({
    jobId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    status: z.literal('needs_review'),
    leaseEpoch: z.number().int().positive(),
    reason: z.enum(['PROCESSING_CONTENT_INVALID', 'PROCESSING_IO_UNCERTAIN']),
    heldBytes: z.literal(16777216),
    potentialReleaseBytes: z.union([z.literal(0), z.literal(16777216)]),
    originalRetained: z.literal(true),
    dryRun: z.literal(true),
    outputs: z
      .array(
        z
          .object({
            kind: z.enum(['thumbnail', 'preview']),
            state: z.enum(['missing', 'fenced', 'occupied', 'unknown']),
          })
          .strict(),
      )
      .length(2),
  })
  .strict();
export type ProcessingReviewPreview = z.infer<
  typeof processingReviewPreviewSchema
>;

export const abandonProcessingSchema = z
  .object({
    requestId: z.uuid(),
    expectedLeaseEpoch: z.number().int().positive(),
    confirmAbandon: z.literal(true),
  })
  .strict();
export const abandonedProcessingSchema = z
  .object({
    jobId: z.uuid(),
    status: z.literal('abandoned'),
    leaseEpoch: z.number().int().positive(),
    releasedBytes: z.literal(16777216),
    originalRetained: z.literal(true),
  })
  .strict();
