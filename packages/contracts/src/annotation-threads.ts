import { z } from 'zod';
import {
  guestAnnotationItemSchema,
  guestAnnotationsPageSchema,
} from './guest-annotations.ts';
import { annotationProcessingSnapshotSchema } from './annotation-processing.ts';

export const guestSharedAnnotationItemSchema = guestAnnotationItemSchema
  .safeExtend({
    authorType: z.enum(['guest', 'owner']).default('guest'),
    processing: annotationProcessingSnapshotSchema.nullable().default(null),
  })
  .superRefine((item, ctx) => {
    if (item.authorType === 'owner' && item.isMine)
      ctx.addIssue({
        code: 'custom',
        path: ['isMine'],
        message: 'Owner-authored annotations cannot be Guest-owned',
      });
    if (item.authorType === 'owner' && item.processing !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['processing'],
        message:
          'Owner-authored annotations do not carry Guest processing state',
      });
    if (
      item.authorType === 'guest' &&
      item.processing?.annotationRevision !== null &&
      item.processing?.annotationRevision !== undefined &&
      item.processing.annotationRevision > item.revision
    )
      ctx.addIssue({
        code: 'custom',
        path: ['processing', 'annotationRevision'],
        message:
          'Processing acknowledgement cannot exceed the annotation revision',
      });
  });

export const guestSharedAnnotationsPageSchema =
  guestAnnotationsPageSchema.safeExtend({
    items: z.array(guestSharedAnnotationItemSchema).max(24),
  });

export type GuestSharedAnnotationItem = z.infer<
  typeof guestSharedAnnotationItemSchema
>;
export type GuestSharedAnnotationsPage = z.infer<
  typeof guestSharedAnnotationsPageSchema
>;
