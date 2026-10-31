import { z } from 'zod';
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');
export const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'production']).default('local'),
    STORAGE_DRIVER: z.enum(['memory']).default('memory'),
    STORAGE_AUTODELETE_ENABLED: flag.default(false),
    STORAGE_RETENTION_DRY_RUN: flag.default(true),
    STORAGE_SOFT_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .safe()
      .default(8_000_000_000),
  })
  .superRefine((v, ctx) => {
    if (v.APP_ENV === 'production')
      ctx.addIssue({
        code: 'custom',
        message:
          'Production storage is not implemented; memory adapter is local/test only',
      });
    if (v.STORAGE_AUTODELETE_ENABLED || !v.STORAGE_RETENTION_DRY_RUN)
      ctx.addIssue({
        code: 'custom',
        message: 'Destructive retention is unavailable in Phase 0',
      });
  });
export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('kino-pic-web'),
  phase: z.literal('M1'),
  dependencies: z.literal('not_checked'),
});

export * from './identity';

export * from './projects';

export * from './uploads';
export * from './image-processing';
export * from './guest-access';
export * from './guest-actions';
export * from './owner-selection';
export * from './invites';

export * from './guest-feedback';
export * from './guest-tags';

export * from './guest-history';

export * from './guest-downloads';
export * from './human-views';

export * from './selection-policy';

export * from './shared-review';

export * from './project-selection-policy';

export * from './photo-versions';

export * from './version-uploads';

export * from './project-versioning';

export * from './guest-comments';
export * from './owner-comments';

export * from './comment-processing';

export * from './guest-annotations';

export * from './annotation-geometry';

export * from './freehand-stroke';

export * from './owner-annotations';

export * from './owner-annotation-authoring';
export * from './annotation-threads';

export * from './annotation-processing';

export * from './owner-history';

export * from './matching-filename-index';

export * from './assisted-candidate-catalog';

export * from './matching-rules';

export * from './resolved-batch-uploads';

export * from './version-approvals';
export * from './deliveries';
export * from './freehand-annotation-capabilities';

export * from './album-activation';
