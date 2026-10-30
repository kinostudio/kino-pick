import { z } from 'zod';

const count = z.number().int().min(1).max(100000);
const epoch = z.number().int().nonnegative();
const bounds = { minimum: count, maximum: count.nullable() };
const coherent = (value: { minimum: number; maximum: number | null }) =>
  value.maximum === null || value.minimum <= value.maximum;
const boundsError = { message: 'Minimum exceeds maximum' };

export const effectiveSelectionPolicySchema = z
  .object({
    ...bounds,
    mode: z.literal('private'),
    source: z.enum(['system', 'project', 'album']),
    projectRevision: epoch,
    albumRevision: epoch,
  })
  .strict()
  .refine(coherent, boundsError)
  .refine(
    (value) =>
      value.source === 'album'
        ? value.albumRevision > 0
        : value.source === 'project'
          ? value.projectRevision > 0
          : value.projectRevision === 0,
    { message: 'Source must have a matching persisted epoch' },
  );

export const guestEffectiveSelectionPolicySchema =
  effectiveSelectionPolicySchema
    .safeExtend({ revision: epoch })
    .refine((value) => value.revision === value.albumRevision, {
      message: 'Legacy revision must equal album epoch',
    });

export const projectSelectionConfigurationSchema = z
  .object({
    projectId: z.uuid(),
    ...bounds,
    revision: epoch,
  })
  .strict()
  .refine(coherent, boundsError);
export const ownerProjectSelectionConfigurationReadSchema =
  projectSelectionConfigurationSchema.safeExtend({
    maxOpenSelectedCount: epoch,
  });
export const albumSelectionConfigurationSchema = z
  .object({
    albumId: z.uuid(),
    projectId: z.uuid(),
    configuration: z.enum(['inherit', 'override']),
    policy: effectiveSelectionPolicySchema,
  })
  .strict()
  .refine(
    (value) =>
      (value.configuration === 'override') ===
      (value.policy.source === 'album'),
    {
      message: 'Configuration and effective source disagree',
    },
  );
export const ownerAlbumSelectionConfigurationReadSchema =
  albumSelectionConfigurationSchema.safeExtend({ maxOpenSelectedCount: epoch });
export const setProjectSelectionConfigurationSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: epoch,
    ...bounds,
    confirm: z.literal(true),
  })
  .strict()
  .refine(coherent, boundsError);
const albumMutation = {
  requestId: z.uuid(),
  expectedAlbumRevision: epoch,
  expectedProjectRevision: epoch,
  confirm: z.literal(true),
};
export const setAlbumSelectionConfigurationSchema = z.discriminatedUnion(
  'configuration',
  [
    z
      .object({ ...albumMutation, configuration: z.literal('inherit') })
      .strict(),
    z
      .object({
        ...albumMutation,
        configuration: z.literal('override'),
        ...bounds,
      })
      .strict()
      .refine(coherent, boundsError),
  ],
);
const result = {
  eventId: z.string().min(1).max(128).nullable(),
  occurredAt: z.iso.datetime(),
};
export const setProjectSelectionConfigurationResultSchema = z
  .object({
    configuration: projectSelectionConfigurationSchema,
    ...result,
  })
  .strict();
export const setAlbumSelectionConfigurationResultSchema = z
  .object({
    configuration: albumSelectionConfigurationSchema,
    ...result,
  })
  .strict();
export type EffectiveSelectionPolicy = z.infer<
  typeof effectiveSelectionPolicySchema
>;
export type OwnerProjectSelectionConfigurationRead = z.infer<
  typeof ownerProjectSelectionConfigurationReadSchema
>;
export type OwnerAlbumSelectionConfigurationRead = z.infer<
  typeof ownerAlbumSelectionConfigurationReadSchema
>;
export type SetProjectSelectionConfigurationRequest = z.infer<
  typeof setProjectSelectionConfigurationSchema
>;
export type SetAlbumSelectionConfigurationRequest = z.infer<
  typeof setAlbumSelectionConfigurationSchema
>;
