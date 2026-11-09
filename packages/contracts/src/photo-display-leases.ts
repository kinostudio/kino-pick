import { z } from 'zod';

export const photoDisplayLeaseRequestSchema = z
  .object({
    documentId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    expectedActorId: z.uuid(),
  })
  .strict();

export const photoDisplayLeaseResultSchema = z
  .object({
    documentId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    issuedAt: z.iso.datetime(),
    protectedUntilAt: z.iso.datetime(),
    displayForMs: z.number().int().min(1_000).max(600_000),
  })
  .strict()
  .superRefine((lease, ctx) => {
    const issuedAtMs = Date.parse(lease.issuedAt);
    const protectedUntilMs = Date.parse(lease.protectedUntilAt);
    if (
      !Number.isFinite(issuedAtMs) ||
      !Number.isFinite(protectedUntilMs) ||
      protectedUntilMs - issuedAtMs < lease.displayForMs + 60_000
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Protection must outlast display by at least 60 seconds',
      });
    }
  });

export type PhotoDisplayLeaseRequest = z.infer<
  typeof photoDisplayLeaseRequestSchema
>;
export type PhotoDisplayLeaseResult = z.infer<
  typeof photoDisplayLeaseResultSchema
>;
