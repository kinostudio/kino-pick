import { z } from 'zod';
import { annotationGeometrySchema } from './annotation-geometry.ts';
import { annotationStyleSchema } from './guest-annotations.ts';

const requestId = z
  .uuid()
  .refine((value) => value === value.toLowerCase(), 'Expected lowercase UUID');
const expectedRevision = z.number().int().positive().safe();

const commandScope = {
  requestId,
  expectedOwnerId: z.uuid(),
  inviteId: z.uuid(),
  photoId: z.uuid(),
  versionId: z.uuid(),
};

export const ownerAnnotationCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...commandScope,
      operation: z.literal('create'),
      geometry: annotationGeometrySchema,
      style: annotationStyleSchema,
      commentId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      ...commandScope,
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
      ...commandScope,
      operation: z.literal('delete'),
      annotationId: z.uuid(),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      ...commandScope,
      operation: z.literal('resolve'),
      annotationId: z.uuid(),
      expectedRevision,
    })
    .strict(),
  z
    .object({
      ...commandScope,
      operation: z.literal('reopen'),
      annotationId: z.uuid(),
      expectedRevision,
    })
    .strict(),
]);

export const ownerAuthoredAnnotationItemSchema = z
  .object({
    annotationId: z.uuid(),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    revision: expectedRevision,
    geometry: annotationGeometrySchema.nullable(),
    style: annotationStyleSchema.nullable(),
    commentId: z.uuid().nullable(),
    state: z.enum(['open', 'resolved', 'deleted']),
    authorType: z.literal('owner'),
    authorLabel: z.string().min(1).max(160),
    canEdit: z.literal(true),
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

export const ownerAuthoredAnnotationPageSchema = z
  .object({
    ownerId: z.uuid(),
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    items: z.array(ownerAuthoredAnnotationItemSchema).max(24),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (
      page.items.some(
        (item) =>
          item.inviteId !== page.inviteId ||
          item.photoId !== page.photoId ||
          item.versionId !== page.versionId,
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

export const ownerAnnotationResultSchema = z
  .object({
    ownerId: z.uuid(),
    requestId,
    operation: z.enum(['create', 'update', 'delete', 'resolve', 'reopen']),
    item: ownerAuthoredAnnotationItemSchema,
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

export const ownerAnnotationAuthoringCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type OwnerAnnotationCommand = z.infer<
  typeof ownerAnnotationCommandSchema
>;
export type OwnerAuthoredAnnotationItem = z.infer<
  typeof ownerAuthoredAnnotationItemSchema
>;
export type OwnerAuthoredAnnotationPage = z.infer<
  typeof ownerAuthoredAnnotationPageSchema
>;
export type OwnerAnnotationResult = z.infer<typeof ownerAnnotationResultSchema>;
export type OwnerAnnotationAuthoringCapabilities = z.infer<
  typeof ownerAnnotationAuthoringCapabilitiesSchema
>;
