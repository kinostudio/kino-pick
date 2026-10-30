import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  ownerAnnotationReadQuerySchema,
  ownerAnnotationsCapabilitiesSchema,
} from '../../../packages/contracts/src/owner-annotations';
import { ownerAnnotationsCapability, type WorkerEnv } from './config';
import { D1OwnerAnnotationsRepository } from './owner-annotations';
import { WorkspaceFailure } from './workspaces';
import {
  FREEHAND_ANNOTATION_READ_CAPABILITIES_HEADER,
  AnnotationClientUpgradeRequiredError,
} from './freehand-read-compat';
type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const ownerAnnotationRoutes = new Hono<Environment>();
function fail(c: Context<Environment>, error: unknown) {
  if (error instanceof AnnotationClientUpgradeRequiredError)
    return c.json({ error: { code: error.code } }, 426);
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'OWNER_ANNOTATIONS_UNAVAILABLE' } }, 503);
}
ownerAnnotationRoutes.get('/api/v1/annotations/capabilities', (c) => {
  try {
    if (new URL(c.req.url).searchParams.size)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    return c.json(
      ownerAnnotationsCapabilitiesSchema.parse({
        enabled: ownerAnnotationsCapability(c.env),
      }),
    );
  } catch (error) {
    return fail(c, error);
  }
});
ownerAnnotationRoutes.get(
  '/api/v1/albums/:albumId/photos/:photoId/versions/:versionId/annotations',
  async (c) => {
    try {
      if (!ownerAnnotationsCapability(c.env))
        throw new WorkspaceFailure('OWNER_ANNOTATIONS_DISABLED', 503);
      const params = new URL(c.req.url).searchParams;
      if (
        [...new Set(params.keys())].some(
          (key) => params.getAll(key).length !== 1,
        )
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      const query = ownerAnnotationReadQuerySchema.parse(
        Object.fromEntries(params),
      );
      return c.json(
        await new D1OwnerAnnotationsRepository(c.env.DB).read(
          c.get('ownerId'),
          c.get('sessionId'),
          z.uuid().parse(c.req.param('albumId')),
          z.uuid().parse(c.req.param('photoId')),
          z.uuid().parse(c.req.param('versionId')),
          query,
          c.req.header(FREEHAND_ANNOTATION_READ_CAPABILITIES_HEADER),
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
