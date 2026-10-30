import { z } from 'zod';
import { guestEffectiveSelectionPolicySchema } from './project-selection-policy';

export const guestSelectionRequestSchema = z
  .object({
    requestId: z.uuid(),
    selected: z.boolean(),
    versionId: z.uuid(),
  })
  .strict();

export const guestSelectionResultSchema = z
  .object({
    photoId: z.uuid(),
    selected: z.boolean(),
    selectedVersionId: z.uuid().nullable(),
    selectedAt: z.iso.datetime().nullable(),
    selectedCount: z.number().int().nonnegative(),
    roundNo: z.number().int().positive().optional(),
    selectionRevision: z.number().int().nonnegative().optional(),
    roundStatus: z.enum(['open', 'submitted']).optional(),
    eventId: z.string().min(1).max(128).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export type GuestSelectionRequest = z.infer<typeof guestSelectionRequestSchema>;
export type GuestSelectionResult = z.infer<typeof guestSelectionResultSchema>;

export const guestSelectionItemSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    selectedAt: z.iso.datetime(),
  })
  .strict();

export const guestSelectionPageSchema = z
  .object({
    items: z.array(guestSelectionItemSchema).max(24),
    selectionPolicy: guestEffectiveSelectionPolicySchema,
    canSubmit: z.boolean(),
    selectedCount: z.number().int().nonnegative(),
    roundNo: z.number().int().positive(),
    selectionRevision: z.number().int().nonnegative(),
    roundStatus: z.enum(['open', 'submitted']),
    submittedAt: z.iso.datetime().nullable(),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();

export const guestSelectionSubmissionRequestSchema = z
  .object({
    requestId: z.uuid(),
    expectedRoundNo: z.number().int().positive().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.expectedRoundNo === undefined) !==
      (value.expectedRevision === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Round and selection revision must be supplied together',
      });
  });

export const guestSelectionSubmissionResultSchema = z
  .object({
    submissionId: z.uuid(),
    roundNo: z.number().int().positive(),
    selectionRevision: z.number().int().positive(),
    selectedCount: z.number().int().positive(),
    submittedAt: z.iso.datetime(),
    eventId: z.string().min(1).max(128),
  })
  .strict();

export type GuestSelectionItem = z.infer<typeof guestSelectionItemSchema>;
export type GuestSelectionPage = z.infer<typeof guestSelectionPageSchema>;
export type GuestSelectionSubmissionRequest = z.infer<
  typeof guestSelectionSubmissionRequestSchema
>;
export type GuestSelectionSubmissionResult = z.infer<
  typeof guestSelectionSubmissionResultSchema
>;
