import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  ownerAnnotationProcessingCommandSchema,
  ownerAnnotationProcessingCapabilitiesSchema,
} from '../../../packages/contracts/src/annotation-processing';
import {
  configuration,
  ownerAnnotationProcessingCapability,
  type WorkerEnv,
} from './config';
import { D1OwnerAnnotationProcessingRepository } from './annotation-processing';
import { WorkspaceFailure } from './workspaces';
type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const annotationProcessingRoutes = new Hono<Environment>();
function fail(c: Context<Environment>, error: unknown) {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'ANNOTATION_PROCESSING_UNAVAILABLE' } }, 503);
}
function noQuery(c: Context<Environment>) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
annotationProcessingRoutes.get(
  '/api/v1/annotation-processing/capabilities',
  (c) => {
    try {
      noQuery(c);
      return c.json(
        ownerAnnotationProcessingCapabilitiesSchema.parse({
          enabled: ownerAnnotationProcessingCapability(c.env),
        }),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
const commandPath = '/api/v1/albums/:albumId/annotation-processing/commands';
annotationProcessingRoutes.use(
  commandPath,
  bodyLimit({
    maxSize: 8192,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
annotationProcessingRoutes.post(commandPath, async (c) => {
  try {
    if (c.req.header('Origin') !== configuration(c.env).origin)
      throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
    if (!ownerAnnotationProcessingCapability(c.env))
      throw new WorkspaceFailure('ANNOTATION_PROCESSING_DISABLED', 503);
    noQuery(c);
    if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
      throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
    if (
      c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    }
    return c.json(
      await new D1OwnerAnnotationProcessingRepository(c.env.DB).command(
        c.get('ownerId'),
        c.get('sessionId'),
        z.uuid().parse(c.req.param('albumId')),
        ownerAnnotationProcessingCommandSchema.parse(input),
      ),
    );
  } catch (error) {
    return fail(c, error);
  }
});
