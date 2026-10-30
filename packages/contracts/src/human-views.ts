import { z } from 'zod';

export const humanViewRequestSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    expectedActorId: z.uuid(),
    visibleForMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();

export const humanViewResultSchema = z
  .object({
    recorded: z.boolean(),
    nextAllowedAt: z.iso.datetime(),
  })
  .strict();

export const humanViewCapabilitiesSchema = z
  .object({
    enabled: z.boolean(),
    minVisibleMs: z.literal(1_000),
    dedupeMs: z.literal(300_000),
  })
  .strict();

export type HumanViewRequest = z.infer<typeof humanViewRequestSchema>;
export type HumanViewResult = z.infer<typeof humanViewResultSchema>;
export type HumanViewCapabilities = z.infer<typeof humanViewCapabilitiesSchema>;
