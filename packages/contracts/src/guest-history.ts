import { z } from 'zod';
import { guestTagLabelSchema } from './guest-tags.ts';
import { guestMediaDownloadAuditSchema } from './guest-downloads.ts';

export const guestHistoryActionSchema = z.enum([
  'selection.added',
  'selection.removed',
  'selection.version_changed',
  'selection.submitted',
  'rating.set',
  'rating.cleared',
  'favorite.added',
  'favorite.removed',
  'tag.added',
  'tag.removed',
  'shared_selection.added',
  'shared_selection.removed',
  'shared_selection.version_changed',
  'shared_selection.submitted',
  'comment.create',
  'comment.edit',
  'comment.delete',
  'comment.resolve',
  'comment.reopen',
  'annotation.created',
  'annotation.updated',
  'annotation.deleted',
  'annotation.resolved',
  'annotation.reopened',
  'download.requested',
  'download.generated',
  'delivery.download_requested',
  'delivery.download_generated',
  'version_approval.confirmed',
]);

export const guestHistoryQuerySchema = z
  .object({
    albumId: z.uuid().optional(),
    photoId: z.uuid().optional(),
    cursor: z.string().max(2048).optional(),
  })
  .strict()
  .refine(
    (query) => query.photoId === undefined || query.albumId !== undefined,
    {
      message: 'Photo filtering requires an album ID',
      path: ['albumId'],
    },
  );

export const guestHistoryCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

const selectionProjectionSchema = z
  .object({
    selected: z.boolean(),
    versionId: z.uuid().nullable(),
  })
  .strict();

const submissionProjectionSchema = z
  .object({
    roundNo: z.number().int().positive(),
    status: z.enum(['open', 'submitted']),
    selectedCount: z.number().int().nonnegative().optional(),
  })
  .strict();

const ratingProjectionSchema = z
  .object({ stars: z.number().int().min(1).max(5).nullable() })
  .strict();

const favoriteProjectionSchema = z.object({ favored: z.boolean() }).strict();

const tagProjectionSchema = z
  .object({
    label: guestTagLabelSchema,
    present: z.boolean(),
  })
  .strict();

const eventMetadataSchema = z.object({
  eventId: z.string().min(1).max(128),
  occurredAt: z.iso.datetime(),
  albumId: z.uuid(),
  photoId: z.uuid().nullable(),
  versionId: z.uuid().nullable(),
  photoStatus: z.enum(['available', 'unavailable']).nullable(),
});

const selectionDeltaSchema = z
  .object({
    before: selectionProjectionSchema,
    after: selectionProjectionSchema,
  })
  .strict();

const submissionDeltaSchema = z
  .object({
    before: submissionProjectionSchema,
    after: submissionProjectionSchema,
  })
  .strict();

const ratingDeltaSchema = z
  .object({
    before: ratingProjectionSchema,
    after: ratingProjectionSchema,
  })
  .strict();

const favoriteDeltaSchema = z
  .object({
    before: favoriteProjectionSchema,
    after: favoriteProjectionSchema,
  })
  .strict();

const tagDeltaSchema = z
  .object({
    before: tagProjectionSchema,
    after: tagProjectionSchema,
  })
  .strict();

// Activity keeps revision/state only; deleted or edited comment bodies are not re-exposed.
const commentHistoryStateSchema = z
  .object({
    commentId: z.uuid(),
    revision: z.number().int().nonnegative().safe(),
    state: z.enum(['absent', 'open', 'resolved', 'deleted']),
  })
  .strict()
  .refine(
    (value) => (value.state === 'absent') === (value.revision === 0),
    'Invalid comment history revision',
  );
const commentDeltaSchema = z
  .object({
    before: commentHistoryStateSchema,
    after: commentHistoryStateSchema,
  })
  .strict()
  .refine(
    (delta) =>
      delta.before.commentId === delta.after.commentId &&
      delta.after.revision === delta.before.revision + 1 &&
      delta.after.state !== 'absent',
    'Non-adjacent comment history',
  );

const annotationHistoryStateSchema = z
  .object({
    annotationId: z.uuid(),
    revision: z.number().int().nonnegative().safe(),
    state: z.enum(['absent', 'open', 'resolved', 'deleted']),
  })
  .strict()
  .refine(
    (value) => (value.state === 'absent') === (value.revision === 0),
    'Invalid annotation history revision',
  );
const annotationDeltaSchema = z
  .object({
    before: annotationHistoryStateSchema,
    after: annotationHistoryStateSchema,
  })
  .strict()
  .refine(
    (delta) =>
      delta.before.annotationId === delta.after.annotationId &&
      delta.after.revision === delta.before.revision + 1 &&
      delta.after.state !== 'absent',
    'Non-adjacent annotation history',
  );

export const guestVersionApprovalHistoryDetailSchema = z
  .object({
    approvalRequestId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
  })
  .strict();

const eventVariant = <TAction extends z.ZodType, TDetail extends z.ZodType>(
  action: TAction,
  detail: TDetail,
) => eventMetadataSchema.extend({ action, detail }).strict();

export const guestHistoryEventSchema = z
  .discriminatedUnion('action', [
    eventVariant(
      z.enum([
        'selection.added',
        'selection.removed',
        'selection.version_changed',
      ]),
      selectionDeltaSchema,
    ),
    eventVariant(z.literal('selection.submitted'), submissionDeltaSchema),
    eventVariant(z.enum(['rating.set', 'rating.cleared']), ratingDeltaSchema),
    eventVariant(
      z.enum(['favorite.added', 'favorite.removed']),
      favoriteDeltaSchema,
    ),
    eventVariant(z.enum(['tag.added', 'tag.removed']), tagDeltaSchema),
    eventVariant(
      z.enum([
        'shared_selection.added',
        'shared_selection.removed',
        'shared_selection.version_changed',
      ]),
      selectionDeltaSchema,
    ),
    eventVariant(
      z.literal('shared_selection.submitted'),
      submissionDeltaSchema,
    ),
    eventVariant(
      z.enum([
        'comment.create',
        'comment.edit',
        'comment.delete',
        'comment.resolve',
        'comment.reopen',
      ]),
      commentDeltaSchema,
    ),
    eventVariant(
      z.enum([
        'annotation.created',
        'annotation.updated',
        'annotation.deleted',
        'annotation.resolved',
        'annotation.reopened',
      ]),
      annotationDeltaSchema,
    ),
    eventVariant(
      z.enum([
        'download.requested',
        'download.generated',
        'delivery.download_requested',
        'delivery.download_generated',
      ]),
      guestMediaDownloadAuditSchema,
    ),
    eventVariant(
      z.literal('version_approval.confirmed'),
      guestVersionApprovalHistoryDetailSchema,
    ),
  ])
  .superRefine((event, ctx) => {
    if (event.action === 'version_approval.confirmed') {
      if (
        event.photoId !== event.detail.photoId ||
        event.versionId !== event.detail.versionId
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid approval photo/version scope',
        });
      return;
    }
    if (event.action.startsWith('comment.')) {
      const parsed = commentDeltaSchema.safeParse(event.detail);
      if (!parsed.success) return;
      const delta = parsed.data;
      const before = delta.before.state,
        after = delta.after.state;
      const valid =
        event.action === 'comment.create'
          ? before === 'absent' && after === 'open'
          : event.action === 'comment.edit'
            ? (before === 'open' || before === 'resolved') && after === before
            : event.action === 'comment.delete'
              ? (before === 'open' || before === 'resolved') &&
                after === 'deleted'
              : event.action === 'comment.resolve'
                ? before === 'open' && after === 'resolved'
                : before === 'resolved' && after === 'open';
      if (!valid || event.photoId === null || event.versionId === null)
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid version-bound comment transition',
        });
      return;
    }

    if (!event.action.startsWith('annotation.')) return;
    const parsed = annotationDeltaSchema.safeParse(event.detail);
    if (!parsed.success) return;
    const before = parsed.data.before.state,
      after = parsed.data.after.state;
    const valid =
      event.action === 'annotation.created'
        ? before === 'absent' && after === 'open'
        : event.action === 'annotation.updated'
          ? before === 'open' && after === 'open'
          : event.action === 'annotation.deleted'
            ? (before === 'open' || before === 'resolved') &&
              after === 'deleted'
            : event.action === 'annotation.resolved'
              ? before === 'open' && after === 'resolved'
              : before === 'resolved' && after === 'open';
    if (!valid || event.photoId === null || event.versionId === null)
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid version-bound annotation transition',
      });
  });

export const guestHistoryPageSchema = z
  .object({
    guestId: z.uuid(),
    items: z.array(guestHistoryEventSchema).max(24),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();

export type GuestHistoryQuery = z.infer<typeof guestHistoryQuerySchema>;
export type GuestHistoryCapabilities = z.infer<
  typeof guestHistoryCapabilitiesSchema
>;
export type GuestHistoryPage = z.infer<typeof guestHistoryPageSchema>;
export type GuestHistoryEvent = z.infer<typeof guestHistoryEventSchema>;
export type GuestHistoryAction = z.infer<typeof guestHistoryActionSchema>;
