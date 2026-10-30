import { z } from 'zod';

export const projectVersioningModeSchema = z.enum([
  'off',
  'manual',
  'auto_filename',
  'assisted',
]);
export const configurableProjectVersioningModeSchema =
  projectVersioningModeSchema;
const revision = z.number().int().min(1).max(2147483647);
const availableModes = z
  .array(projectVersioningModeSchema)
  .min(1)
  .refine((modes) => new Set(modes).size === modes.length);
export const projectVersioningCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export const projectVersioningReadSchema = z
  .object({
    projectId: z.uuid(),
    workspaceId: z.uuid(),
    mode: projectVersioningModeSchema,
    revision,
    availableModes,
  })
  .strict();
export const setProjectVersioningSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: revision,
    mode: configurableProjectVersioningModeSchema,
    confirm: z.literal(true),
  })
  .strict();
export const setProjectVersioningResultSchema = z
  .object({
    projectId: z.uuid(),
    workspaceId: z.uuid(),
    mode: configurableProjectVersioningModeSchema,
    revision,
    changed: z.boolean(),
    eventId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.changed !== (value.eventId !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Changed state requires exactly one audit event',
      });
    }
  });
export type ProjectVersioningRead = z.infer<typeof projectVersioningReadSchema>;
export type SetProjectVersioning = z.infer<typeof setProjectVersioningSchema>;
export type SetProjectVersioningResult = z.infer<
  typeof setProjectVersioningResultSchema
>;
