import { z } from 'zod';

export const photographerLabelColorSchema = z.enum([
  'red',
  'yellow',
  'green',
  'blue',
  'purple',
]);
export type PhotographerLabelColor = z.infer<
  typeof photographerLabelColorSchema
>;

const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const lowerUuidSchema = z.uuid().transform((value) => value.toLowerCase());
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const photographerMetadataEvidenceSchema = z
  .object({
    storage: z.literal('embedded-xmp'),
    format: z.enum(['jpeg', 'png', 'webp']),
    namespaceUri: z.literal('http://ns.adobe.com/xap/1.0/'),
    property: z.enum(['xmp:Rating', 'xmp:Label']),
    serialization: z.enum(['attribute', 'element', 'multiple']),
  })
  .strict();

const photographerMetadataValueFieldSchema = <T extends z.ZodType>(
  valueSchema: T,
) =>
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('missing') }).strict(),
    z
      .object({
        status: z.literal('value'),
        value: valueSchema,
        evidence: photographerMetadataEvidenceSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('cleared'),
        evidence: photographerMetadataEvidenceSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('invalid'),
        reason: z.enum([
          'invalid_packet',
          'packet_too_large',
          'duplicate_property',
          'invalid_structure',
          'invalid_value',
        ]),
        evidence: photographerMetadataEvidenceSchema.nullable(),
      })
      .strict(),
    z
      .object({
        status: z.literal('rejected'),
        evidence: photographerMetadataEvidenceSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('unsupported'),
        reason: z.literal('non_integer_rating'),
        evidence: photographerMetadataEvidenceSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('unrecognized'),
        evidence: photographerMetadataEvidenceSchema,
      })
      .strict(),
  ]);

export const photographerRatingFieldSchema =
  photographerMetadataValueFieldSchema(z.number().int().min(1).max(5));
export const photographerLabelFieldSchema =
  photographerMetadataValueFieldSchema(photographerLabelColorSchema);

export const photographerMetadataResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unsupported_format') }).strict(),
  z
    .object({
      status: z.literal('supported'),
      format: z.enum(['jpeg', 'png', 'webp']),
      packetStatus: z.enum(['present', 'missing', 'invalid', 'too_large']),
      rating: photographerRatingFieldSchema,
      label: photographerLabelFieldSchema,
    })
    .strict(),
]);
export type PhotographerMetadataResult = z.infer<
  typeof photographerMetadataResultSchema
>;

export const photographerRecommendationPolicySchema = z
  .object({
    albumId: z.uuid(),
    revision: revisionSchema,
    visible: z.boolean(),
    minRating: z.number().int().min(1).max(5).nullable(),
    allowedLabels: z.array(photographerLabelColorSchema).max(5),
    matchMode: z.literal('any'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.allowedLabels).size !== value.allowedLabels.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedLabels'],
        message: 'Labels must be unique',
      });
    }
  });

export const setPhotographerRecommendationPolicySchema = z
  .object({
    requestId: lowerUuidSchema,
    expectedRevision: revisionSchema,
    visible: z.boolean(),
    minRating: z.number().int().min(1).max(5).nullable(),
    allowedLabels: z.array(photographerLabelColorSchema).max(5),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.allowedLabels).size !== value.allowedLabels.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedLabels'],
        message: 'Labels must be unique',
      });
    }
  });

export const photographerManualValuePatchSchema = <T extends z.ZodType>(
  valueSchema: T,
) =>
  z.discriminatedUnion('state', [
    z.object({ state: z.literal('inherit') }).strict(),
    z.object({ state: z.literal('clear') }).strict(),
    z.object({ state: z.literal('set'), value: valueSchema }).strict(),
  ]);

export const photographerManualDecisionSchema = z.enum([
  'inherit',
  'recommend',
  'exclude',
]);

export const setPhotographerPhotoMetadataSchema = z
  .object({
    requestId: lowerUuidSchema,
    expectedRevision: revisionSchema,
    expectedHeadRevision: revisionSchema,
    versionId: lowerUuidSchema,
    rating: photographerManualValuePatchSchema(z.number().int().min(1).max(5)),
    label: photographerManualValuePatchSchema(photographerLabelColorSchema),
    decision: photographerManualDecisionSchema,
  })
  .strict();

const importedRatingSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_imported') }).strict(),
  z.object({ state: z.literal('unsupported_format') }).strict(),
  z
    .object({
      state: z.literal('imported'),
      field: photographerRatingFieldSchema,
    })
    .strict(),
]);
const importedLabelSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_imported') }).strict(),
  z.object({ state: z.literal('unsupported_format') }).strict(),
  z
    .object({
      state: z.literal('imported'),
      field: photographerLabelFieldSchema,
    })
    .strict(),
]);

const manualRatingSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('inherit'), value: z.null() }).strict(),
  z.object({ state: z.literal('clear'), value: z.null() }).strict(),
  z
    .object({
      state: z.literal('set'),
      value: z.number().int().min(1).max(5),
    })
    .strict(),
]);
const manualLabelSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('inherit'), value: z.null() }).strict(),
  z.object({ state: z.literal('clear'), value: z.null() }).strict(),
  z
    .object({
      state: z.literal('set'),
      value: photographerLabelColorSchema,
    })
    .strict(),
]);

export const photographerPhotoRecommendationSchema = z
  .object({
    photoId: z.uuid(),
    versionId: z.uuid(),
    versionNo: z.number().int().positive(),
    revision: revisionSchema,
    headRevision: revisionSchema,
    isCurrentHead: z.boolean(),
    source: z
      .object({
        assetId: z.uuid(),
        sha256: sha256Schema,
        mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        importedAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
    rating: z
      .object({
        effective: z.number().int().min(1).max(5).nullable(),
        imported: importedRatingSchema,
        manual: manualRatingSchema,
      })
      .strict(),
    label: z
      .object({
        effective: photographerLabelColorSchema.nullable(),
        imported: importedLabelSchema,
        manual: manualLabelSchema,
      })
      .strict(),
    decision: z
      .object({
        manual: photographerManualDecisionSchema,
        recommended: z.boolean(),
        source: z.enum(['criteria', 'manual', 'none']),
      })
      .strict(),
  })
  .strict();

export const photographerRecommendationsPageSchema = z
  .object({
    policy: photographerRecommendationPolicySchema,
    photos: z.array(photographerPhotoRecommendationSchema).max(24),
    nextCursor: z.uuid().nullable(),
  })
  .strict();

export const photographerRecommendationPolicyResultSchema = z
  .object({
    policy: photographerRecommendationPolicySchema,
    changed: z.boolean(),
    eventId: z.string().min(1).nullable(),
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

export const setPhotographerPhotoMetadataResultSchema = z
  .object({
    photo: photographerPhotoRecommendationSchema,
    changed: z.boolean(),
    eventId: z.string().min(1).nullable(),
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

export const importPhotographerMetadataRequestSchema = z
  .object({
    requestId: lowerUuidSchema,
    expectedRevision: revisionSchema,
    workspaceId: lowerUuidSchema,
    projectId: lowerUuidSchema,
    albumId: lowerUuidSchema,
    photoId: lowerUuidSchema,
    versionId: lowerUuidSchema,
    assetId: lowerUuidSchema,
    sourceSha256: sha256Schema,
    sourceMime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    metadata: photographerMetadataResultSchema,
  })
  .strict();

export const importPhotographerMetadataResultSchema = z
  .object({
    photo: photographerPhotoRecommendationSchema,
    changed: z.boolean(),
    eventId: z.string().min(1).nullable(),
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

export const photographerRecommendationsQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(24).default(24),
  })
  .strict();

export type PhotographerRecommendationPolicy = z.infer<
  typeof photographerRecommendationPolicySchema
>;
export type SetPhotographerRecommendationPolicy = z.infer<
  typeof setPhotographerRecommendationPolicySchema
>;
export type PhotographerPhotoRecommendation = z.infer<
  typeof photographerPhotoRecommendationSchema
>;
export type PhotographerRecommendationsPage = z.infer<
  typeof photographerRecommendationsPageSchema
>;
export type SetPhotographerPhotoMetadata = z.infer<
  typeof setPhotographerPhotoMetadataSchema
>;
export type PhotographerRecommendationPolicyResult = z.infer<
  typeof photographerRecommendationPolicyResultSchema
>;
export type SetPhotographerPhotoMetadataResult = z.infer<
  typeof setPhotographerPhotoMetadataResultSchema
>;
export type ImportPhotographerMetadataRequest = z.infer<
  typeof importPhotographerMetadataRequestSchema
>;
export type ImportPhotographerMetadataResult = z.infer<
  typeof importPhotographerMetadataResultSchema
>;
