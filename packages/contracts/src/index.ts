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
