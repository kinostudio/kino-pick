import { z } from 'zod';
import { guestPermissionsSchema, guestPermissionNames } from './guest-access';

export const revokeInviteSchema = z
  .object({ requestId: z.uuid(), confirmRevoke: z.literal(true) })
  .strict();
export const revokedInviteSchema = z
  .object({
    inviteId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    revokedAt: z.iso.datetime(),
  })
  .strict();
export const inviteSummarySchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    accessMode: z.enum(['link_only', 'generated_password', 'custom_password']),
    permissions: guestPermissionsSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    sealed: z.boolean(),
    maxUses: z.number().int().positive().nullable(),
    issuedSessions: z.number().int().nonnegative(),
    albums: z.array(
      z.object({ id: z.uuid(), name: z.string().min(1).max(160) }).strict(),
    ),
  })
  .strict();
export const invitePageSchema = z
  .object({
    invites: z.array(inviteSummarySchema).max(24),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type InviteSummary = z.infer<typeof inviteSummarySchema>;

export const createInviteSchema = z
  .object({
    requestId: z.uuid(),
    albumIds: z.array(z.uuid()).min(1).max(24),
    accessMode: z.enum(['link_only', 'generated_password', 'custom_password']),
    password: z.string().max(256).optional(),
    permissions: guestPermissionsSchema,
    expiresAt: z.iso.datetime(),
    maxUses: z.number().int().min(1).max(10000).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.albumIds).size !== value.albumIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['albumIds'],
        message: 'Duplicate albums',
      });
    if (
      (value.accessMode === 'custom_password') !==
      (value.password !== undefined)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password only for custom mode',
      });
  });
export const createdInviteSchema = z
  .object({
    inviteId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const inviteCreationResponseSchema = z.discriminatedUnion(
  'secretAvailable',
  [
    z
      .object({
        invite: createdInviteSchema,
        secretAvailable: z.literal(false),
      })
      .strict(),
    z
      .object({
        invite: createdInviteSchema,
        secretAvailable: z.literal(true),
        token: z
          .string()
          .length(64)
          .regex(/^[a-f0-9]+$/),
        generatedPassword: z
          .string()
          .length(64)
          .regex(/^[a-f0-9]+$/)
          .nullable(),
      })
      .strict(),
  ],
);

export const inviteCapabilitiesSchema = z
  .object({
    validationScope: z
      .object({
        projectId: z.uuid(),
        albumId: z.uuid(),
        permissionNames: z
          .array(z.enum(guestPermissionNames))
          .max(12)
          .refine((values) => new Set(values).size === values.length)
          .optional(),
      })
      .strict()
      .optional(),
    issuanceEnabled: z.boolean(),
    exchangeEnabled: z.boolean(),
    selectionEnabled: z.boolean(),
    feedbackEnabled: z.boolean(),
    tagsEnabled: z.boolean(),
    historyEnabled: z.boolean(),
    downloadsEnabled: z.boolean().default(false),
    commentsEnabled: z.boolean().default(false),
    annotationsEnabled: z.boolean().default(false),
    versionComparisonEnabled: z.boolean().default(false),
    maxAlbums: z.literal(24),
    maxUses: z.literal(10000),
    maxExpiryDays: z.literal(365),
  })
  .strict();
