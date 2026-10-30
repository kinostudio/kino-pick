import { z } from 'zod';

export const ownerSubmissionSummarySchema = z
  .object({
    id: z.uuid(),
    inviteId: z.uuid(),
    guestId: z.uuid(),
    roundNo: z.number().int().positive(),
    selectionRevision: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    submittedAt: z.iso.datetime(),
    roundStatus: z.enum(['open', 'submitted']),
    currentRoundNo: z.number().int().positive(),
    sealed: z.boolean(),
  })
  .strict();

export const ownerSubmissionListResponseSchema = z
  .object({
    submissions: z.array(ownerSubmissionSummarySchema),
  })
  .strict();

export const ownerSubmissionItemSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    selectedAt: z.iso.datetime(),
    originalFilename: z.string().min(1),
    versionNo: z.number().int().positive(),
    byteSize: z.number().int().nonnegative(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  })
  .strict();

export const ownerSubmissionDetailSchema = z
  .object({
    id: z.uuid(),
    inviteId: z.uuid(),
    guestId: z.uuid(),
    albumId: z.uuid(),
    roundNo: z.number().int().positive(),
    selectionRevision: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    submittedAt: z.iso.datetime(),
    roundStatus: z.enum(['open', 'submitted']),
    currentRoundNo: z.number().int().positive(),
    sealed: z.boolean(),
    items: z.array(ownerSubmissionItemSchema),
  })
  .strict();

export const ownerSubmissionDetailResponseSchema = z
  .object({
    submission: ownerSubmissionDetailSchema,
  })
  .strict();

export const ownerRoundReopenRequestSchema = z
  .object({
    requestId: z.uuid(),
    inviteId: z.uuid(),
    guestId: z.uuid(),
    expectedRoundNo: z.number().int().positive(),
  })
  .strict();

export const ownerRoundReopenResultSchema = z
  .object({
    albumId: z.uuid(),
    inviteId: z.uuid(),
    guestId: z.uuid(),
    roundNo: z.number().int().positive(),
    selectionRevision: z.union([z.literal(0), z.literal(1)]),
    status: z.literal('open'),
    reopenedAt: z.iso.datetime(),
    eventId: z.string().min(1),
  })
  .strict();

export const ownerRoundReopenResponseSchema = z
  .object({
    reopen: ownerRoundReopenResultSchema,
  })
  .strict();

export type OwnerSubmissionSummary = z.infer<
  typeof ownerSubmissionSummarySchema
>;
export type OwnerSubmissionListResponse = z.infer<
  typeof ownerSubmissionListResponseSchema
>;
export type OwnerSubmissionItem = z.infer<typeof ownerSubmissionItemSchema>;
export type OwnerSubmissionDetail = z.infer<typeof ownerSubmissionDetailSchema>;
export type OwnerSubmissionDetailResponse = z.infer<
  typeof ownerSubmissionDetailResponseSchema
>;
export type OwnerRoundReopenRequest = z.infer<
  typeof ownerRoundReopenRequestSchema
>;
export type OwnerRoundReopenResult = z.infer<
  typeof ownerRoundReopenResultSchema
>;
export type OwnerRoundReopenResponse = z.infer<
  typeof ownerRoundReopenResponseSchema
>;
