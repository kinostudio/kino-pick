import { matchingProfileContextSchema } from './matching-rules';
import { z } from 'zod';
import { uploadSessionSchema } from './uploads';

const maxUploadBytes = 5_363_466_240;
const maxImageSide = 32_768;
const maxImagePixels = 80_000_000;
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const positiveProjectRevision = z.number().int().min(1).max(2_147_483_647);

export const resolvedUploadModeSchema = z.enum([
  'off',
  'manual',
  'auto_filename',
  'assisted',
]);

const originalFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/\u0000-\u001f\u007f]/u.test(value));

export const resolvedUploadFileSchema = z
  .object({
    originalFilename: originalFilenameSchema,
    expectedBytes: z.number().int().positive().max(maxUploadBytes).safe(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    dimensions: z
      .object({
        width: z.number().int().positive().max(maxImageSide),
        height: z.number().int().positive().max(maxImageSide),
      })
      .strict()
      .superRefine((dimensions, ctx) => {
        if (dimensions.width * dimensions.height > maxImagePixels) {
          ctx.addIssue({
            code: 'custom',
            message: 'Image dimensions exceed the pixel limit',
          });
        }
      }),
  })
  .strict();

export const resolvedUploadPreviewRequestSchema = z
  .object({ file: resolvedUploadFileSchema })
  .strict();

export const resolvedUploadDecisionSchema = z
  .object({
    outcome: z.enum([
      'new_photo',
      'new_version',
      'duplicate',
      'requires_review',
    ]),
    reason: z.string().min(1).max(100),
    photoId: z.uuid().nullable(),
    versionId: z.uuid().nullable(),
  })
  .strict();

export const resolvedUploadCandidateSchema = z
  .object({
    photoId: z.uuid(),
    filename: z.string().min(1).max(255),
    currentVersionId: z.uuid().nullable(),
    revision: nonnegativeSafeInteger.nullable(),
  })
  .strict();

export const resolvedUploadPreviewResponseSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    mode: resolvedUploadModeSchema,
    projectRevision: positiveProjectRevision,
    changeSequence: nonnegativeSafeInteger,
    decision: resolvedUploadDecisionSchema,
    candidatesTruncated: z.boolean(),
    candidates: z.array(resolvedUploadCandidateSchema).max(1000),
    catalogCursor: z.string().min(1).max(4096).optional(),
    matchingProfile: matchingProfileContextSchema.optional(),
  })
  .strict();

export const resolvedUploadChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new_photo') }).strict(),
  z
    .object({
      kind: z.literal('new_version'),
      photoId: z.uuid(),
      parentVersionId: z.uuid(),
      expectedRevision: nonnegativeSafeInteger,
    })
    .strict(),
]);

export const resolvedUploadReserveSchema = z
  .object({
    requestId: z.uuid(),
    file: resolvedUploadFileSchema,
    expectedChangeSequence: nonnegativeSafeInteger,
    expectedProjectRevision: positiveProjectRevision,
    expectedMode: z.enum(['auto_filename', 'assisted']),
    matchingProfile: matchingProfileContextSchema.optional(),
    choice: resolvedUploadChoiceSchema,
    confirm: z.literal(true),
  })
  .strict();

export const resolvedUploadTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new_photo') }).strict(),
  z
    .object({
      kind: z.literal('new_version'),
      photoId: z.uuid(),
      parentVersionId: z.uuid(),
      expectedRevision: nonnegativeSafeInteger,
      capturedVersioningMode: resolvedUploadModeSchema,
      changeType: z.literal('new_retouch'),
    })
    .strict(),
]);

export const resolvedUploadReservationSchema = z
  .object({
    uploadSession: uploadSessionSchema,
    target: resolvedUploadTargetSchema,
  })
  .strict();

export type ResolvedUploadMode = z.infer<typeof resolvedUploadModeSchema>;
export type ResolvedUploadFile = z.infer<typeof resolvedUploadFileSchema>;
export type ResolvedUploadPreviewRequest = z.infer<
  typeof resolvedUploadPreviewRequestSchema
>;
export type ResolvedUploadCandidate = z.infer<
  typeof resolvedUploadCandidateSchema
>;
export type ResolvedUploadDecision = z.infer<
  typeof resolvedUploadDecisionSchema
>;
export type ResolvedUploadPreviewResponse = z.infer<
  typeof resolvedUploadPreviewResponseSchema
>;
export type ResolvedUploadReserve = z.infer<typeof resolvedUploadReserveSchema>;
export type ResolvedUploadChoice = z.infer<typeof resolvedUploadChoiceSchema>;
export type ResolvedUploadTarget = z.infer<typeof resolvedUploadTargetSchema>;
export type ResolvedUploadReservation = z.infer<
  typeof resolvedUploadReservationSchema
>;
