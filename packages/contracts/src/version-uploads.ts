import { z } from 'zod';
import {
  uploadCompleteSchema,
  uploadSessionSchema,
  uploadRecoverySchema,
} from './uploads';

const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const positiveSafeInteger = z.number().int().positive().safe();
const maxUploadBytes = 5_363_466_240;

export const versionUploadChangeTypeSchema = z.enum([
  'new_retouch',
  'replace_current',
]);

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function hasDisallowedControl(value: string, allowNoteWhitespace: boolean) {
  for (const character of value) {
    if (!/[\p{Cc}\p{Cf}]/u.test(character)) continue;
    if (
      allowNoteWhitespace &&
      (character === '\t' || character === '\n' || character === '\r')
    )
      continue;
    return true;
  }
  return false;
}

const originalFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/\u0000-\u001f\u007f]/u.test(value));

const changeNoteSchema = z.string().superRefine((value, ctx) => {
  if (hasDisallowedControl(value, true)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Change note contains a disallowed control character',
    });
  }
});

const canonicalChangeNoteSchema = changeNoteSchema
  .transform((value) => value.normalize('NFC').trim())
  .superRefine((value, ctx) => {
    if (codePointLength(value) > 2000) {
      ctx.addIssue({
        code: 'custom',
        message: 'Change note must contain at most 2000 Unicode code points',
      });
    }
  });

const versionUploadLabelSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (hasDisallowedControl(value, false)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Label contains a disallowed control character',
      });
    }
  })
  .transform((value) => value.normalize('NFC').trim())
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length < 1 || length > 40) {
      ctx.addIssue({
        code: 'custom',
        message: 'Label must contain 1 to 40 Unicode code points',
      });
    }
  });

const versionUploadLabelsSchema = z
  .array(versionUploadLabelSchema)
  .max(16)
  .superRefine((labels, ctx) => {
    const seen = new Set<string>();
    labels.forEach((label, index) => {
      if (seen.has(label)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Labels must be unique after canonicalization',
          path: [index],
        });
      }
      seen.add(label);
    });
  });

export const versionUploadCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const versionUploadInitSchema = z
  .object({
    requestId: z.uuid(),
    originalFilename: originalFilenameSchema,
    expectedBytes: z.number().int().positive().max(maxUploadBytes).safe(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    expectedRevision: nonnegativeSafeInteger,
    expectedCurrentVersionId: z.uuid(),
    changeType: versionUploadChangeTypeSchema,
    changeNote: canonicalChangeNoteSchema,
    labels: versionUploadLabelsSchema,
    confirm: z.literal(true),
  })
  .strict();

export const versionUploadTargetSchema = z
  .object({
    photoId: z.uuid(),
    parentVersionId: z.uuid(),
    expectedRevision: nonnegativeSafeInteger,
    changeType: versionUploadChangeTypeSchema,
    changeNote: canonicalChangeNoteSchema,
    labels: versionUploadLabelsSchema,
  })
  .strict();

export const versionUploadInitResultSchema = z
  .object({
    uploadSession: uploadSessionSchema,
    target: versionUploadTargetSchema,
  })
  .strict();

export const versionUploadRecoverySchema = uploadRecoverySchema
  .extend({ target: versionUploadTargetSchema })
  .strict();

export const versionUploadCompletionSchema = z
  .object({
    uploadSessionId: z.uuid(),
    status: z.literal('completed'),
    photoId: z.uuid(),
    versionId: z.uuid(),
    assetId: z.uuid(),
    actualBytes: z.number().int().positive().max(maxUploadBytes).safe(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    width: positiveSafeInteger,
    height: positiveSafeInteger,
    completedAt: z.iso.datetime({ offset: true }),
    versionNo: positiveSafeInteger,
    parentVersionId: z.uuid(),
    changeType: versionUploadChangeTypeSchema,
    changeNote: canonicalChangeNoteSchema,
    labels: versionUploadLabelsSchema,
  })
  .strict();

export type VersionUploadCapabilities = z.infer<
  typeof versionUploadCapabilitiesSchema
>;
export type VersionUploadChangeType = z.infer<
  typeof versionUploadChangeTypeSchema
>;
export type VersionUploadInit = z.infer<typeof versionUploadInitSchema>;
export type VersionUploadTarget = z.infer<typeof versionUploadTargetSchema>;
export type VersionUploadInitResult = z.infer<
  typeof versionUploadInitResultSchema
>;
export type VersionUploadComplete = z.infer<typeof uploadCompleteSchema>;
export type VersionUploadCompletion = z.infer<
  typeof versionUploadCompletionSchema
>;

export type VersionUploadRecovery = z.infer<typeof versionUploadRecoverySchema>;
