import { z } from 'zod';

const originalFilename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value));

export const uploadInitSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    originalFilename,
    expectedBytes: z.number().int().positive().max(5_363_466_240).safe(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    requestId: z.uuid(),
  })
  .strict();

export const uploadCancelSchema = z.object({ requestId: z.uuid() }).strict();

export const uploadAuthorizeSchema = z.object({ requestId: z.uuid() }).strict();

export const uploadCompleteSchema = z.object({ requestId: z.uuid() }).strict();

export const uploadSessionSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    originalFilename,
    expectedBytes: z.number().int().positive().safe(),
    reservedBytes: z.number().int().positive().safe(),
    status: z.enum([
      'reserved',
      'cancelled',
      'expired',
      'completed',
      'needs_review',
    ]),
    expiresAt: z.iso.datetime({ offset: true }),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type UploadSession = z.infer<typeof uploadSessionSchema>;
export const uploadRecoverySchema = z
  .object({
    initRequestId: z.uuid(),
    uploadSession: uploadSessionSchema,
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']).nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    authorizationRequestId: z.uuid().nullable(),
    authorizationExpiresAt: z.iso.datetime().nullable(),
  })
  .strict();
