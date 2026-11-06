import { z } from 'zod';

const ownerHistoryActorTypeSchema = z.enum(['user', 'guest', 'system']);
const ownerHistoryActorOrder = ['system', 'user', 'guest'] as const;
const ownerHistoryActorTypesSchema = z
  .array(ownerHistoryActorTypeSchema)
  .max(ownerHistoryActorOrder.length)
  .superRefine((values, ctx) => {
    if (new Set(values).size !== values.length)
      ctx.addIssue({ code: 'custom', message: 'Actor types must be unique' });
  })
  .transform((values) =>
    ownerHistoryActorOrder.filter((value) => values.includes(value)),
  );
const ownerHistoryActionPattern = /^[a-z][a-z0-9_.-]{0,127}$/;
const ownerHistoryActionSchema = z
  .string()
  .regex(ownerHistoryActionPattern)
  .refine((value) => ownerHistoryActionPattern.exec(value)?.[0] === value);
const ownerHistoryUtcDateTimeSchema = z.iso.datetime().refine(
  (value) => {
    const fraction = /\.(\d+)Z$/.exec(value)?.[1];
    return fraction === undefined || fraction.length <= 3;
  },
  { message: 'UTC timestamps support at most millisecond precision' },
);

const ownerHistoryFilterShape = {
  projectId: z.uuid().optional(),
  albumId: z.uuid().optional(),
  photoId: z.uuid().optional(),
  versionId: z.uuid().optional(),
  inviteId: z.uuid().optional(),
  actorType: ownerHistoryActorTypeSchema.optional(),
  actorTypes: ownerHistoryActorTypesSchema.optional(),
  actorId: z.uuid().optional(),
  action: ownerHistoryActionSchema.optional(),
  from: ownerHistoryUtcDateTimeSchema.optional(),
  to: ownerHistoryUtcDateTimeSchema.optional(),
};

type DateRangeFields = {
  from?: string | undefined;
  to?: string | undefined;
};

const isStrictlyBefore = (from: string, to: string): boolean => {
  const splitTimestamp = (value: string) => {
    const fractionStart = value.indexOf('.');
    const secondText =
      fractionStart < 0 ? value.slice(0, -1) : value.slice(0, fractionStart);
    const fraction =
      fractionStart < 0 ? '' : value.slice(fractionStart + 1, -1);
    return { second: Date.parse(secondText + 'Z'), fraction };
  };

  const fromParts = splitTimestamp(from);
  const toParts = splitTimestamp(to);

  if (fromParts.second !== toParts.second)
    return fromParts.second < toParts.second;

  const fractionLength = Math.max(
    fromParts.fraction.length,
    toParts.fraction.length,
  );
  return (
    fromParts.fraction.padEnd(fractionLength, '0') <
    toParts.fraction.padEnd(fractionLength, '0')
  );
};

const hasValidDateRange = ({ from, to }: DateRangeFields): boolean =>
  from === undefined || to === undefined || isStrictlyBefore(from, to);

const dateRangeIssue = {
  path: ['to'],
  message: 'The end time must be later than the start time',
};

const ownerHistoryFiltersObjectSchema = z
  .object(ownerHistoryFilterShape)
  .strict()
  .superRefine(({ actorType, actorTypes }, ctx) => {
    if (
      actorType !== undefined &&
      actorTypes !== undefined &&
      (actorTypes.length !== 1 || actorTypes[0] !== actorType)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['actorTypes'],
        message: 'actorType conflicts with actorTypes',
      });
  });

export const ownerHistoryFiltersSchema = ownerHistoryFiltersObjectSchema.refine(
  hasValidDateRange,
  dateRangeIssue,
);

export const ownerHistoryQuerySchema = z
  .object({
    ...ownerHistoryFilterShape,
    cursor: z.string().min(1).max(8192).optional(),
  })
  .strict()
  .superRefine(({ actorType, actorTypes }, ctx) => {
    if (
      actorType !== undefined &&
      actorTypes !== undefined &&
      (actorTypes.length !== 1 || actorTypes[0] !== actorType)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['actorTypes'],
        message: 'actorType conflicts with actorTypes',
      });
  })
  .refine(hasValidDateRange, dateRangeIssue);

export const ownerHistoryCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

type OwnerHistoryJsonValue =
  | null
  | boolean
  | number
  | string
  | OwnerHistoryJsonValue[]
  | { [key: string]: OwnerHistoryJsonValue };

const MAX_JSON_DEPTH = 5;
const MAX_JSON_OBJECT_KEYS = 40;
const MAX_JSON_ARRAY_LENGTH = 128;
const MAX_JSON_STRING_LENGTH = 8192;

const ownerHistoryJsonObjectSchema = (
  childValueSchema: z.ZodType<OwnerHistoryJsonValue>,
) =>
  z
    .record(z.string().max(MAX_JSON_STRING_LENGTH), childValueSchema)
    .refine((value) => Object.keys(value).length <= MAX_JSON_OBJECT_KEYS, {
      message: 'JSON objects may contain at most 40 keys',
    });

const ownerHistoryJsonValueSchemaAtDepth = (
  depth: number,
): z.ZodType<OwnerHistoryJsonValue> => {
  const scalarSchema = z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(MAX_JSON_STRING_LENGTH),
  ]);

  if (depth > MAX_JSON_DEPTH) return scalarSchema;

  return z.union([
    scalarSchema,
    z
      .array(ownerHistoryJsonValueSchemaAtDepth(depth + 1))
      .max(MAX_JSON_ARRAY_LENGTH),
    ownerHistoryJsonObjectSchema(ownerHistoryJsonValueSchemaAtDepth(depth + 1)),
  ]);
};

// before/after themselves count as depth 1; nested JSON values may reach depth 5.
const ownerHistoryJsonRecordSchema = ownerHistoryJsonObjectSchema(
  ownerHistoryJsonValueSchemaAtDepth(2),
);

const ownerHistoryActorSchema = z
  .object({
    type: ownerHistoryActorTypeSchema,
    id: z.uuid().nullable(),
    label: z.string().min(1).max(200).nullable(),
  })
  .strict();

const ownerHistoryDetailsSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('available'),
      before: ownerHistoryJsonRecordSchema.nullable(),
      after: ownerHistoryJsonRecordSchema.nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal('omitted'),
      before: z.null(),
      after: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal('invalid'),
      before: z.null(),
      after: z.null(),
    })
    .strict(),
]);

export const ownerHistoryEventSchema = z
  .object({
    eventId: z.string().min(1).max(512),
    occurredAt: ownerHistoryUtcDateTimeSchema,
    actor: ownerHistoryActorSchema,
    workspaceId: z.uuid(),
    projectId: z.uuid().nullable(),
    albumId: z.uuid().nullable(),
    photoId: z.uuid().nullable(),
    versionId: z.uuid().nullable(),
    inviteId: z.uuid().nullable(),
    relatedInviteIds: z.array(z.uuid()).max(24),
    sessionId: z.string().min(1).max(512).nullable(),
    guestSessionId: z.uuid().nullable(),
    requestId: z.string().min(1).max(256).nullable(),
    action: ownerHistoryActionSchema,
    details: ownerHistoryDetailsSchema,
  })
  .strict()
  .superRefine((event, ctx) => {
    if (new Set(event.relatedInviteIds).size !== event.relatedInviteIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['relatedInviteIds'],
        message: 'Related invite IDs must be unique',
      });

    if (
      event.inviteId !== null &&
      !event.relatedInviteIds.includes(event.inviteId)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['relatedInviteIds'],
        message: 'The primary invite ID must be included among related invites',
      });
  });
export const ownerHistoryPageSchema = z
  .object({
    ownerId: z.uuid(),
    workspaceId: z.uuid(),
    snapshotToken: z.string().min(1).max(8192),
    items: z.array(ownerHistoryEventSchema).max(24),
    nextCursor: z.string().min(1).max(8192).nullable(),
  })
  .strict();

export const ownerHistoryExportRequestSchema = z
  .object({
    expectedOwnerId: z.uuid(),
    snapshotToken: z.string().min(1).max(8192),
    format: z.enum(['csv', 'json']),
  })
  .strict();

export type OwnerHistoryFilters = z.infer<typeof ownerHistoryFiltersSchema>;
export type OwnerHistoryQuery = z.infer<typeof ownerHistoryQuerySchema>;
export type OwnerHistoryEvent = z.infer<typeof ownerHistoryEventSchema>;
export type OwnerHistoryPage = z.infer<typeof ownerHistoryPageSchema>;
export type OwnerHistoryExportRequest = z.infer<
  typeof ownerHistoryExportRequestSchema
>;
