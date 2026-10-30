import { z } from 'zod';
import { annotationStyleSchema } from './annotation-style.ts';
import { annotationGeometrySchema } from './annotation-geometry.ts';
export { annotationStyleSchema };
export type { AnnotationStyle } from './annotation-style.ts';

const requestId = z.uuid().transform((value) => value.toLowerCase());
const expectedRevision = z.number().int().positive().safe();
export const guestAnnotationCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      requestId,
      expectedGuestId: z.uuid(),
      operation: z.literal('create'),
      photoId: z.uuid(),
      versionId: z.uuid(),
      geometry: annotationGeometrySchema,
      style: annotationStyleSchema,
      commentId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      requestId,
      expectedGuestId: z.uuid(),
      operation: z.literal('update'),
      annotationId: z.uuid(),
      expectedRevision,
      geometry: annotationGeometrySchema,
      style: annotationStyleSchema,
      commentId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      requestId,
      expectedGuestId: z.uuid(),
      operation: z.literal('delete'),
      annotationId: z.uuid(),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      requestId,
      expectedGuestId: z.uuid(),
      operation: z.literal('resolve'),
      annotationId: z.uuid(),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      requestId,
      expectedGuestId: z.uuid(),
      operation: z.literal('reopen'),
      annotationId: z.uuid(),
      expectedRevision,
    })
    .strict(),
]);

export const guestAnnotationItemSchema = z
  .object({
    annotationId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    revision: expectedRevision,
    geometry: annotationGeometrySchema.nullable(),
    style: annotationStyleSchema.nullable(),
    commentId: z.uuid().nullable(),
    state: z.enum(['open', 'resolved', 'deleted']),
    authorLabel: z.string().min(1).max(160),
    isMine: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.state === 'deleted') {
      if (item.geometry !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['geometry'],
          message: 'Deleted annotations must not expose geometry',
        });
      if (item.style !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['style'],
          message: 'Deleted annotations must not expose style',
        });
      if (item.commentId !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['commentId'],
          message: 'Deleted annotations must not retain a comment link',
        });
      return;
    }

    if (item.geometry === null || item.style === null)
      ctx.addIssue({
        code: 'custom',
        path: ['geometry'],
        message: 'Live annotations require geometry and style',
      });
  });

export const guestAnnotationsPageSchema = z
  .object({
    guestId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    items: z.array(guestAnnotationItemSchema).max(24),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (
      page.items.some(
        (item) =>
          item.photoId !== page.photoId || item.versionId !== page.versionId,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Annotation scope mismatch',
      });

    if (
      new Set(page.items.map((item) => item.annotationId)).size !==
      page.items.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Duplicate annotation item',
      });
  });

export const guestAnnotationResultSchema = z
  .object({
    requestId,
    operation: z.enum(['create', 'update', 'delete', 'resolve', 'reopen']),
    item: guestAnnotationItemSchema,
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.item.updatedAt !== result.occurredAt)
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'updatedAt'],
        message: 'Result timestamp must match the item update timestamp',
      });

    if (result.operation === 'create') {
      if (result.item.revision !== 1)
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'revision'],
          message: 'A new annotation starts at revision 1',
        });
      if (result.item.state !== 'open')
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'state'],
          message: 'A new annotation must be open',
        });
      return;
    }

    if (result.item.revision < 2)
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'revision'],
        message: 'An annotation update must advance its revision',
      });

    const expectedState =
      result.operation === 'delete'
        ? 'deleted'
        : result.operation === 'resolve'
          ? 'resolved'
          : 'open';
    if (result.item.state !== expectedState)
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'state'],
        message: `A ${result.operation} result must be ${expectedState}`,
      });
  });

export const guestAnnotationReadQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    annotationId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (query) => query.cursor === undefined || query.annotationId === undefined,
    'A targeted current read cannot paginate',
  );

export const guestAnnotationsCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type GuestAnnotationCommand = z.infer<
  typeof guestAnnotationCommandSchema
>;
export type GuestAnnotationItem = z.infer<typeof guestAnnotationItemSchema>;
export type GuestAnnotationsPage = z.infer<typeof guestAnnotationsPageSchema>;
export type GuestAnnotationResult = z.infer<typeof guestAnnotationResultSchema>;
export type GuestAnnotationReadQuery = z.infer<
  typeof guestAnnotationReadQuerySchema
>;
export type GuestAnnotationsCapabilities = z.infer<
  typeof guestAnnotationsCapabilitiesSchema
>;
