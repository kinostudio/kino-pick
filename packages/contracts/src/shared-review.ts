import { z } from 'zod';

const count = z.number().int().min(1).max(100000);
const title = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (s) => !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(s),
    'Invalid title',
  );
const bounds = { minimum: count, maximum: count.nullable() };
const coherent = (p: { minimum: number; maximum: number | null }) =>
  p.maximum === null || p.minimum <= p.maximum;
export const sharedReviewCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export const createSharedReviewSchema = z
  .object({
    requestId: z.uuid(),
    title,
    inviteIds: z
      .array(z.uuid())
      .min(1)
      .max(24)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate invites'),
    ...bounds,
    confirmShared: z.literal(true),
  })
  .strict()
  .refine(coherent, 'Minimum exceeds maximum');
export const sharedReviewSummarySchema = z
  .object({
    id: z.uuid(),
    albumId: z.uuid(),
    title,
    inviteIds: z.array(z.uuid()).min(1).max(24),
    roundNo: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    status: z.enum(['open', 'submitted']),
    ...bounds,
    selectedCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine(coherent, 'Minimum exceeds maximum');
export const ownerSharedReviewListSchema = z
  .object({ reviews: z.array(sharedReviewSummarySchema).max(20) })
  .strict();
export const sharedReviewOwnerResultSchema = z
  .object({
    review: sharedReviewSummarySchema,
    eventId: z.string().min(1).max(160),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export const reopenSharedReviewSchema = z
  .object({
    requestId: z.uuid(),
    expectedRoundNo: z.number().int().positive(),
    ...bounds,
    confirmShared: z.literal(true),
  })
  .strict()
  .refine(coherent, 'Minimum exceeds maximum');
export const guestSharedReviewMetadataSchema = z
  .object({
    guestId: z.uuid(),
    id: z.uuid(),
    albumId: z.uuid(),
    title,
    roundNo: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    status: z.enum(['open', 'submitted']),
    ...bounds,
    canSelect: z.boolean(),
    canSubmit: z.boolean(),
    canView: z.boolean(),
    canSubmitNow: z.boolean(),
    selectedCount: z.number().int().nonnegative().nullable(),
    submittedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine(coherent, 'Minimum exceeds maximum')
  .refine(
    (r) => (r.canSelect ? r.selectedCount !== null : r.selectedCount === null),
    'Selection count requires select permission',
  )
  .refine(
    (r) => !r.canSubmitNow || (r.canSubmit && r.status === 'open'),
    'Submit eligibility requires submit permission and open round',
  );
export const guestSharedReviewListSchema = z
  .object({ reviews: z.array(guestSharedReviewMetadataSchema).max(20) })
  .strict();
export const sharedReviewSelectionItemSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    selectedAt: z.iso.datetime(),
  })
  .strict();
export const sharedReviewSelectionPageSchema = z
  .object({
    review: guestSharedReviewMetadataSchema,
    items: z.array(sharedReviewSelectionItemSchema).max(24),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();
export const setSharedReviewSelectionSchema = z
  .object({
    expectedGuestId: z.uuid(),
    requestId: z.uuid(),
    roundNo: z.number().int().positive(),
    versionId: z.uuid(),
    selected: z.boolean(),
  })
  .strict();
export const sharedReviewSelectionResultSchema = z
  .object({
    reviewId: z.uuid(),
    photoId: z.uuid(),
    roundNo: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    selected: z.boolean(),
    selectedVersionId: z.uuid().nullable(),
    selectedAt: z.iso.datetime().nullable(),
    selectedCount: z.number().int().nonnegative(),
    eventId: z.string().min(1).max(160).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export const submitSharedReviewSchema = z
  .object({
    expectedGuestId: z.uuid(),
    requestId: z.uuid(),
    roundNo: z.number().int().positive(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const sharedReviewSubmissionSchema = z
  .object({
    id: z.uuid(),
    reviewId: z.uuid(),
    roundNo: z.number().int().positive(),
    revision: z.number().int().positive(),
    selectedCount: z.number().int().positive(),
    submittedAt: z.iso.datetime(),
    submittedByGuestId: z.uuid(),
  })
  .strict();
export const sharedReviewSubmitResultSchema = z
  .object({
    submission: sharedReviewSubmissionSchema,
    eventId: z.string().min(1).max(160),
  })
  .strict();
export const sharedReviewSubmissionPageSchema = z
  .object({
    submissions: z.array(sharedReviewSubmissionSchema).max(24),
    nextBeforeRoundNo: z.number().int().positive().nullable(),
  })
  .strict();
export const sharedReviewSubmissionItemSchema =
  sharedReviewSelectionItemSchema.extend({
    filename: z.string().min(1).max(255),
    versionNo: z.number().int().positive(),
  });
export const sharedReviewSubmissionDetailSchema = z
  .object({
    submission: sharedReviewSubmissionSchema,
    items: z.array(sharedReviewSubmissionItemSchema).max(24),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();
export type SharedReviewSummary = z.infer<typeof sharedReviewSummarySchema>;
export type GuestSharedReviewMetadata = z.infer<
  typeof guestSharedReviewMetadataSchema
>;
export type SharedReviewSubmission = z.infer<
  typeof sharedReviewSubmissionSchema
>;
