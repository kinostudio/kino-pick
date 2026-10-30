import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { freehandAnnotationWriteCapabilitiesSchema } from '../../../packages/contracts/src/freehand-annotation-capabilities';
import {
  ownerAnnotationCommandSchema,
  ownerAnnotationAuthoringCapabilitiesSchema,
} from '../../../packages/contracts/src/owner-annotation-authoring';
import { ownerAnnotationReadQuerySchema } from '../../../packages/contracts/src/owner-annotations';
import {
  configuration,
  freehandAnnotationsCapability,
  ownerAnnotationAuthoringCapability,
  ownerAnnotationsCapability,
  type WorkerEnv,
} from './config';
import { D1OwnerAnnotationAuthoringRepository } from './owner-annotation-authoring';
import { D1OwnerAuthoredAnnotationReader } from './owner-annotation-author-read';
import { WorkspaceFailure } from './workspaces';
import { freehandAnnotationSchemaCapability } from './freehand-annotation-schema';
import {
  FREEHAND_ANNOTATION_READ_CAPABILITIES_HEADER,
  AnnotationClientUpgradeRequiredError,
} from './freehand-read-compat';
type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const ownerAnnotationAuthoringRoutes = new Hono<Environment>();
function fail(c: Context<Environment>, error: unknown) {
  if (error instanceof AnnotationClientUpgradeRequiredError)
    return c.json({ error: { code: error.code } }, 426);
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json(
    { error: { code: 'OWNER_ANNOTATION_AUTHORING_UNAVAILABLE' } },
    503,
  );
}
function noQuery(c: Context<Environment>) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
ownerAnnotationAuthoringRoutes.get(
  '/api/v1/annotations/authoring/capabilities',
  (c) => {
    try {
      noQuery(c);
      return c.json(
        ownerAnnotationAuthoringCapabilitiesSchema.parse({
          enabled: ownerAnnotationAuthoringCapability(c.env),
        }),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
ownerAnnotationAuthoringRoutes.get(
  '/api/v1/annotations/authoring/freehand-capabilities',
  async (c) => {
    try {
      noQuery(c);
      return c.json(
        freehandAnnotationWriteCapabilitiesSchema.parse({
          enabled:
            freehandAnnotationsCapability(c.env) &&
            (await freehandAnnotationSchemaCapability(c.env.DB)),
        }),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
ownerAnnotationAuthoringRoutes.get(
  '/api/v1/albums/:albumId/photos/:photoId/versions/:versionId/annotations/owner',
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
        await new D1OwnerAuthoredAnnotationReader(c.env.DB).read(
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
const commandPath = '/api/v1/albums/:albumId/annotations/owner/commands';
ownerAnnotationAuthoringRoutes.use(
  commandPath,
  bodyLimit({
    maxSize: 16384,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
ownerAnnotationAuthoringRoutes.post(commandPath, async (c) => {
  try {
    if (c.req.header('Origin') !== configuration(c.env).origin)
      throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
    if (!ownerAnnotationAuthoringCapability(c.env))
      throw new WorkspaceFailure('OWNER_ANNOTATION_AUTHORING_DISABLED', 503);
    noQuery(c);
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
      await new D1OwnerAnnotationAuthoringRepository(
        c.env.DB,
        freehandAnnotationsCapability(c.env),
      ).command(
        c.get('ownerId'),
        c.get('sessionId'),
        z.uuid().parse(c.req.param('albumId')),
        ownerAnnotationCommandSchema.parse(input),
      ),
    );
  } catch (error) {
    return fail(c, error);
  }
});
