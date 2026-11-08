import { z } from 'zod';

const revision = z.number().int().min(0).max(2147483647);
const inactiveDays = z.number().int().min(1).max(36500);

export const albumRetentionPolicyCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const albumRetentionPolicySchema = z
  .object({
    albumId: z.uuid(),
    revision,
    cleanupAllowed: z.boolean(),
    inactiveDays,
    automaticDeletionEnabled: z.literal(false),
    dryRun: z.literal(true),
  })
  .strict();

export const updateAlbumRetentionPolicySchema = z
  .object({
    requestId: z.uuid(),
    expectedOwnerId: z.uuid(),
    expectedRevision: revision,
    cleanupAllowed: z.boolean(),
    inactiveDays,
  })
  .strict();

export type AlbumRetentionPolicy = z.infer<typeof albumRetentionPolicySchema>;
export type UpdateAlbumRetentionPolicy = z.infer<
  typeof updateAlbumRetentionPolicySchema
>;
