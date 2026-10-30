import { z } from 'zod';

const boundedCount = z.number().int().min(1).max(100000);
export const selectionBoundsSchema = z
  .object({
    minimum: boundedCount,
    maximum: boundedCount.nullable(),
    revision: z.number().int().nonnegative(),
    mode: z.literal('private'),
  })
  .strict()
  .refine((p) => p.maximum === null || p.minimum <= p.maximum, {
    message: 'Minimum exceeds maximum',
  });
export const albumSelectionPolicySchema = selectionBoundsSchema.safeExtend({
  albumId: z.uuid(),
});
export const ownerSelectionPolicyReadSchema = z
  .object({
    policy: albumSelectionPolicySchema,
    maxOpenSelectedCount: z.number().int().nonnegative(),
  })
  .strict();
export const setSelectionPolicySchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    minimum: boundedCount,
    maximum: boundedCount.nullable(),
    confirm: z.literal(true),
  })
  .strict()
  .refine((p) => p.maximum === null || p.minimum <= p.maximum, {
    message: 'Minimum exceeds maximum',
  });
export const setSelectionPolicyResultSchema = z
  .object({
    policy: albumSelectionPolicySchema,
    eventId: z.string().min(1).max(128).nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type AlbumSelectionPolicy = z.infer<typeof albumSelectionPolicySchema>;
export type OwnerSelectionPolicyRead = z.infer<
  typeof ownerSelectionPolicyReadSchema
>;
export type SetSelectionPolicyRequest = z.infer<
  typeof setSelectionPolicySchema
>;
