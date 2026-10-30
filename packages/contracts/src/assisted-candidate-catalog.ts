import { z } from 'zod';
import { resolvedUploadCandidateSchema } from './resolved-uploads';

const positiveSafeInteger = z.number().int().positive().safe();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();

export const assistedCandidatePageSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    projectRevision: positiveSafeInteger,
    albumRevision: positiveSafeInteger,
    changeSequence: nonnegativeSafeInteger,
    items: z.array(resolvedUploadCandidateSchema).max(24),
    nextCursor: z.string().min(1).max(4096).nullable(),
  })
  .strict();

export type AssistedCandidatePage = z.infer<typeof assistedCandidatePageSchema>;
