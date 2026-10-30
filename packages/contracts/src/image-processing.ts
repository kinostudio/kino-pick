import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const dimension = z.number().int().positive().max(32768);
const sourceSchema = z
  .object({
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    bytes: z.number().int().positive().max(67108864),
    sha256: hash,
    width: dimension,
    height: dimension,
  })
  .strict()
  .refine((value) => value.width * value.height <= 80000000);

/** Local operator input, never accepted as proof of processing by the Worker. */
export const localImageProcessingMetadataSchema = z
  .object({
    scope: z
      .object({ workspaceId: z.uuid(), projectId: z.uuid(), albumId: z.uuid() })
      .strict(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    expected: sourceSchema,
  })
  .strict();

const artifactSchema = z
  .object({
    kind: z.enum(['thumbnail', 'preview']),
    filename: z.enum(['thumbnail.jpg', 'preview.jpg']),
    mime: z.literal('image/jpeg'),
    bytes: z.number().int().positive().max(8388608),
    width: dimension,
    height: dimension,
    sha256: hash,
  })
  .strict()
  .refine(
    (value) =>
      value.filename === `${value.kind}.jpg` &&
      Math.max(value.width, value.height) <=
        (value.kind === 'thumbnail' ? 320 : 2048),
  );

export const localImageProcessingManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.uuid(),
    processorVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
    ...localImageProcessingMetadataSchema.shape,
    artifacts: z.array(artifactSchema).length(2),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.artifacts.map((artifact) => artifact.kind)).size === 2 &&
      value.artifacts.reduce((total, artifact) => total + artifact.bytes, 0) <=
        16777216,
  );

export type LocalImageProcessingManifest = z.infer<
  typeof localImageProcessingManifestSchema
>;
