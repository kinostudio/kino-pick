import { z } from 'zod';
import { annotationGeometrySchema } from './annotation-geometry.ts';
import { annotationStyleSchema } from './annotation-style.ts';
import { guestCommentBodySchema } from './guest-comments.ts';

const requestId = z.uuid().transform((value) => value.toLowerCase());
const uuid = z.uuid().transform((value) => value.toLowerCase());
const expectedRevision = z.number().int().positive().safe();
const scope = z.object({ kind: z.literal('album') }).strict();

const commandScope = {
  requestId,
  photoId: uuid,
  versionId: uuid,
};

export const albumOwnerFeedbackCommandSchema = z.discriminatedUnion(
  'operation',
  [
    z
      .object({
        ...commandScope,
        operation: z.literal('create_comment'),
        body: guestCommentBodySchema,
      })
      .strict(),
    z
      .object({
        ...commandScope,
        operation: z.literal('update_comment'),
        feedbackId: uuid,
        expectedRevision,
        body: guestCommentBodySchema,
      })
      .strict(),
    z
      .object({
        ...commandScope,
        operation: z.literal('delete_comment'),
        feedbackId: uuid,
        expectedRevision,
      })
      .strict(),
    z
      .object({
        ...commandScope,
        operation: z.literal('create_annotation'),
        geometry: annotationGeometrySchema,
        style: annotationStyleSchema,
      })
      .strict(),
    z
      .object({
        ...commandScope,
        operation: z.literal('update_annotation'),
        feedbackId: uuid,
        expectedRevision,
        geometry: annotationGeometrySchema,
        style: annotationStyleSchema,
      })
      .strict(),
    z
      .object({
        ...commandScope,
        operation: z.literal('delete_annotation'),
        feedbackId: uuid,
        expectedRevision,
      })
      .strict(),
  ],
);

const itemBase = {
  id: uuid,
  scope,
  albumId: uuid,
  photoId: uuid,
  versionId: uuid,
  revision: expectedRevision,
  state: z.enum(['open', 'deleted']),
  authorType: z.literal('owner'),
  authorLabel: z.string().min(1).max(160),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const albumOwnerFeedbackItemSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...itemBase,
      kind: z.literal('comment'),
      body: guestCommentBodySchema.nullable(),
    })
    .strict()
    .superRefine((item, ctx) => {
      if ((item.state === 'deleted') !== (item.body === null))
        ctx.addIssue({
          code: 'custom',
          path: ['body'],
          message: 'Deleted comments require tombstone body',
        });
    }),
  z
    .object({
      ...itemBase,
      kind: z.literal('annotation'),
      geometry: annotationGeometrySchema.nullable(),
      style: annotationStyleSchema.nullable(),
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
      } else if (item.geometry === null || item.style === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['geometry'],
          message: 'Live annotations require geometry and style',
        });
      }
    }),
]);

export const albumOwnerFeedbackPageSchema = z
  .object({
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    items: z.array(albumOwnerFeedbackItemSchema).max(24),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (
      page.items.some(
        (item) =>
          item.albumId !== page.albumId ||
          item.photoId !== page.photoId ||
          item.versionId !== page.versionId,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Owner feedback scope mismatch',
      });

    if (new Set(page.items.map((item) => item.id)).size !== page.items.length)
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Duplicate Owner feedback item',
      });
  });

export const albumOwnerFeedbackReadQuerySchema = z
  .object({ cursor: z.string().min(1).max(1024).optional() })
  .strict();

export const albumOwnerFeedbackResultSchema = z
  .object({
    requestId,
    operation: z.enum([
      'create_comment',
      'update_comment',
      'delete_comment',
      'create_annotation',
      'update_annotation',
      'delete_annotation',
    ]),
    item: albumOwnerFeedbackItemSchema,
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
    if (
      (result.operation.endsWith('_comment') &&
        result.item.kind !== 'comment') ||
      (result.operation.endsWith('_annotation') &&
        result.item.kind !== 'annotation')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'kind'],
        message: 'Command result kind mismatch',
      });
    if (result.operation.startsWith('create_')) {
      if (result.item.revision !== 1 || result.item.state !== 'open')
        ctx.addIssue({
          code: 'custom',
          path: ['item', 'revision'],
          message: 'A new feedback item starts open at revision 1',
        });
    } else if (result.item.revision < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'revision'],
        message: 'A feedback update must advance its revision',
      });
    }
    if (
      result.operation.startsWith('delete_') &&
      result.item.state !== 'deleted'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'state'],
        message: 'A delete result must be a tombstone',
      });
    if (!result.operation.startsWith('delete_') && result.item.state !== 'open')
      ctx.addIssue({
        code: 'custom',
        path: ['item', 'state'],
        message: 'A live command must return an open item',
      });
  });

export type AlbumOwnerFeedbackCommand = z.infer<
  typeof albumOwnerFeedbackCommandSchema
>;
export type AlbumOwnerFeedbackItem = z.infer<
  typeof albumOwnerFeedbackItemSchema
>;
export type AlbumOwnerFeedback = AlbumOwnerFeedbackItem;
export type AlbumOwnerFeedbackPage = z.infer<
  typeof albumOwnerFeedbackPageSchema
>;
export type AlbumOwnerFeedbackResult = z.infer<
  typeof albumOwnerFeedbackResultSchema
>;
