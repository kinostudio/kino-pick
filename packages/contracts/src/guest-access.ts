import { z } from 'zod';

// Stable persisted bit positions. Never reorder; append new permissions instead.
export const guestPermissionNames = [
  'can_view',
  'can_download_preview',
  'can_download_original',
  'can_select',
  'can_rate',
  'can_favorite',
  'can_tag',
  'can_annotate',
  'can_comment',
  'can_submit',
  'can_view_own_history',
  'can_compare_versions',
] as const;
export const guestPermissionSchema = z.enum(guestPermissionNames);
export type GuestPermission = z.infer<typeof guestPermissionSchema>;
export const guestPermissionMaskSchema = z.number().int().min(0).max(4095);
export const guestPermissionsSchema = z
  .object({
    can_view: z.boolean(),
    can_download_preview: z.boolean(),
    can_download_original: z.boolean(),
    can_select: z.boolean(),
    can_rate: z.boolean(),
    can_favorite: z.boolean(),
    can_tag: z.boolean(),
    can_annotate: z.boolean(),
    can_comment: z.boolean(),
    can_submit: z.boolean(),
    can_view_own_history: z.boolean(),
    can_compare_versions: z.boolean(),
  })
  .strict();
export function guestPermissionBit(permission: GuestPermission): number {
  return (
    2 ** guestPermissionNames.indexOf(guestPermissionSchema.parse(permission))
  );
}
export function decodeGuestPermissions(input: unknown) {
  const mask = guestPermissionMaskSchema.parse(input);
  return guestPermissionsSchema.parse(
    Object.fromEntries(
      guestPermissionNames.map((name) => [
        name,
        (mask & guestPermissionBit(name)) !== 0,
      ]),
    ),
  );
}
export const guestAlbumAccessSchema = z
  .object({
    guestId: z.uuid(),
    inviteId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    permissions: guestPermissionsSchema,
    expiresAt: z.iso.datetime(),
    inviteExpiresAt: z.iso.datetime().optional(),
  })
  .strict();

const guestBearerSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);

export const guestExchangeRequestSchema = z
  .object({
    requestId: z.uuid(),
    token: guestBearerSchema,
    displayName: z
      .string()
      .trim()
      .min(1)
      .refine((value) => Array.from(value).length <= 80)
      .refine((value) => !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value)),
    password: z.string().max(256).optional(),
  })
  .strict();

export type GuestExchangeRequest = z.infer<typeof guestExchangeRequestSchema>;

export const guestExchangeCapabilitiesSchema = z
  .object({ exchangeEnabled: z.boolean() })
  .strict();

// Browser-safe exact password bounds shared by the UI and native verifier.
export const guestPasswordSchema = z
  .string()
  .min(12)
  .max(256)
  .refine((value) => {
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    }
    return new TextEncoder().encode(value).byteLength <= 1024;
  }, 'Password must be bounded well-formed UTF-8');

// Generated short codes are accepted for login only; custom password policy stays unchanged.
export const generatedGuestPasswordSchema = z.string().regex(/^[0-9]{5}$/);
export const guestLoginPasswordSchema = z.union([
  generatedGuestPasswordSchema,
  guestPasswordSchema,
]);
