import { z } from 'zod';
import { annotationGeometrySchema } from './annotation-geometry.ts';
import { annotationProcessingSnapshotSchema } from './annotation-processing.ts';
import { annotationStyleSchema } from './guest-annotations.ts';

const revision = z.number().int().positive().safe();
const initialProcessingSnapshot = {
  state: 'open',
  revision: 0,
  annotationRevision: null,
  contentRevision: null,
  updatedAt: null,
  stale: false,
} as const;

export const ownerAnnotationReadQuerySchema = z
  .object({
    inviteId: z.uuid(),
    cursor: z.string().min(1).max(1024).optional(),
    annotationId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (query) => query.cursor === undefined || query.annotationId === undefined,
    'A targeted current read cannot paginate',
  );

export const ownerAnnotationItemSchema = z
  .object({
    annotationId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    authorGuestId: z.uuid(),
    revision,
    geometry: annotationGeometrySchema.nullable(),
    style: annotationStyleSchema.nullable(),
    commentId: z.uuid().nullable(),
    state: z.enum(['open', 'resolved', 'deleted']),
    authorLabel: z.string().min(1).max(160),
    canEdit: z.literal(false),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    processing: annotationProcessingSnapshotSchema.default(
      initialProcessingSnapshot,
    ),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (
      item.processing.annotationRevision !== null &&
      item.processing.annotationRevision > item.revision
    )
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'annotationRevision'],
        message:
          'Processing acknowledgement cannot exceed the annotation revision',
      });

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

export const ownerAnnotationsPageSchema = z
  .object({
    inviteId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    items: z.array(ownerAnnotationItemSchema).max(24),
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

export const ownerAnnotationsCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export type OwnerAnnotationReadQuery = z.infer<
  typeof ownerAnnotationReadQuerySchema
>;
export type OwnerAnnotationItem = z.infer<typeof ownerAnnotationItemSchema>;
export type OwnerAnnotationsPage = z.infer<typeof ownerAnnotationsPageSchema>;
export type OwnerAnnotationsCapabilities = z.infer<
  typeof ownerAnnotationsCapabilitiesSchema
>;
