import { z } from 'zod';

const safeCountSchema = z.number().int().nonnegative().safe();

export const matchingFilenameIndexStatusSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    profile: z.literal('default-v1'),
    indexedSessions: safeCountSchema,
    missingSessions: safeCountSchema,
    invalidSessions: safeCountSchema,
    unlinkedVersions: safeCountSchema,
    unreadyPhotos: safeCountSchema,
    state: z.enum(['building', 'blocked', 'ready']),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.invalidSessions > value.indexedSessions)
      context.addIssue({
        code: 'custom',
        path: ['invalidSessions'],
        message: 'invalidSessions cannot exceed indexedSessions',
      });

    const hasBlockers =
      value.invalidSessions > 0 ||
      value.unlinkedVersions > 0 ||
      value.unreadyPhotos > 0;
    const expectedState =
      value.missingSessions > 0
        ? 'building'
        : hasBlockers
          ? 'blocked'
          : 'ready';
    if (value.state !== expectedState)
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'state does not match matching filename index counters',
      });
  });

export type MatchingFilenameIndexStatus = z.infer<
  typeof matchingFilenameIndexStatusSchema
>;

export const matchingFilenameIndexCapabilitiesSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export type MatchingFilenameIndexCapabilities = z.infer<
  typeof matchingFilenameIndexCapabilitiesSchema
>;
