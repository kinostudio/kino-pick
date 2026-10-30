import { z } from 'zod';
import { photoVersionHeadSchema } from './photo-versions';

const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const positiveSafeInteger = z.number().int().positive().safe();
const approvalStatusSchema = z.enum(['open', 'confirmed']);

export const versionApprovalInviteIdsSchema = z
  .array(z.uuid().transform((inviteId) => inviteId.toLowerCase()))
  .min(1)
  .max(24)
  .refine(
    (inviteIds) => new Set(inviteIds).size === inviteIds.length,
    'Invitation IDs must be unique',
  );

export const createVersionApprovalRequestSchema = z
  .object({
    requestId: z.uuid(),
    expectedOwnerId: z.uuid(),
    expectedHead: photoVersionHeadSchema,
    inviteIds: versionApprovalInviteIdsSchema,
    confirm: z.literal(true),
  })
  .strict();

export const versionApprovalRequestSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    versionNo: positiveSafeInteger,
    headRevision: nonnegativeSafeInteger,
    inviteIds: versionApprovalInviteIdsSchema,
    status: approvalStatusSchema,
    createdAt: z.iso.datetime(),
    confirmedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if ((request.status === 'confirmed') !== (request.confirmedAt !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Confirmation time must match the receipt-derived status',
        path: ['confirmedAt'],
      });
    }
  });

export const ownerVersionApprovalReadSchema = versionApprovalRequestSchema
  .extend({ isCurrent: z.boolean() })
  .strict();

export const ownerVersionApprovalListSchema = z
  .object({
    requests: z.array(ownerVersionApprovalReadSchema).max(24),
    nextCursor: z.uuid().nullable(),
  })
  .strict();

export const ownerVersionApprovalResultSchema = z
  .object({
    requestId: z.uuid(),
    request: versionApprovalRequestSchema,
    eventId: z.string().min(1).max(160),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export const guestVersionApprovalRequestSchema = z
  .object({
    id: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    versionNo: positiveSafeInteger,
    headRevision: nonnegativeSafeInteger,
    isCurrent: z.boolean(),
    status: approvalStatusSchema,
    createdAt: z.iso.datetime(),
    confirmedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if ((request.status === 'confirmed') !== (request.confirmedAt !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Confirmation time must match the receipt-derived status',
        path: ['confirmedAt'],
      });
    }
  });

export const guestVersionApprovalListSchema = z
  .object({
    requests: z.array(guestVersionApprovalRequestSchema).max(24),
    nextCursor: z.uuid().nullable(),
  })
  .strict();

export const guestVersionApprovalConfirmationSchema = z
  .object({
    requestId: z.uuid(),
    expectedGuestId: z.uuid(),
    confirm: z.literal(true),
  })
  .strict();

export const guestVersionApprovalConfirmationResultSchema = z
  .object({
    requestId: z.uuid(),
    approvalRequestId: z.uuid(),
    guestId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    versionNo: positiveSafeInteger,
    headRevision: nonnegativeSafeInteger,
    recorded: z.boolean(),
    eventId: z.string().min(1).max(160).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .refine((result) => result.recorded === (result.eventId !== null), {
    message: 'eventId must be present exactly when a receipt was recorded',
    path: ['eventId'],
  });

export const versionApprovalsCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type VersionApprovalInviteIds = z.infer<
  typeof versionApprovalInviteIdsSchema
>;
export type CreateVersionApprovalRequest = z.infer<
  typeof createVersionApprovalRequestSchema
>;
export type VersionApprovalRequest = z.infer<
  typeof versionApprovalRequestSchema
>;
export type OwnerVersionApprovalRead = z.infer<
  typeof ownerVersionApprovalReadSchema
>;
export type OwnerVersionApprovalList = z.infer<
  typeof ownerVersionApprovalListSchema
>;
export type OwnerVersionApprovalResult = z.infer<
  typeof ownerVersionApprovalResultSchema
>;
export type GuestVersionApprovalRequest = z.infer<
  typeof guestVersionApprovalRequestSchema
>;
export type GuestVersionApprovalList = z.infer<
  typeof guestVersionApprovalListSchema
>;
export type GuestVersionApprovalConfirmation = z.infer<
  typeof guestVersionApprovalConfirmationSchema
>;
export type GuestVersionApprovalConfirmationResult = z.infer<
  typeof guestVersionApprovalConfirmationResultSchema
>;
export type VersionApprovalsCapabilities = z.infer<
  typeof versionApprovalsCapabilitiesSchema
>;
