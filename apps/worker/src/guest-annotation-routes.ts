import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { freehandAnnotationWriteCapabilitiesSchema } from '../../../packages/contracts/src/freehand-annotation-capabilities';
import {
  guestAnnotationsCapabilitiesSchema,
  guestAnnotationCommandSchema,
  guestAnnotationReadQuerySchema,
} from '../../../packages/contracts/src/guest-annotations';
import {
  configuration,
  freehandAnnotationsCapability,
  guestAnnotationsCapability,
  type WorkerEnv,
} from './config';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { D1GuestAnnotationsRepository } from './guest-annotations';
import { D1GuestAnnotationReader } from './guest-annotation-read';
import { D1GuestSharedAnnotationReader } from './guest-annotation-shared-read';
import { WorkspaceFailure } from './workspaces';
import { freehandAnnotationSchemaCapability } from './freehand-annotation-schema';
import {
  FREEHAND_ANNOTATION_READ_CAPABILITIES_HEADER,
  AnnotationClientUpgradeRequiredError,
} from './freehand-read-compat';
type Environment = { Bindings: WorkerEnv };
type RouteContext = Context<Environment>;
export const guestAnnotationRoutes = new Hono<Environment>();
function fail(c: RouteContext, error: unknown) {
  if (error instanceof AnnotationClientUpgradeRequiredError)
    return c.json({ error: { code: error.code } }, 426);
  if (error instanceof GuestAccessDenied)
    return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'GUEST_ANNOTATIONS_UNAVAILABLE' } }, 503);
}
function enabled(c: RouteContext) {
  if (!guestAnnotationsCapability(c.env))
    throw new WorkspaceFailure('GUEST_ANNOTATIONS_UNAVAILABLE', 503);
}
function noQuery(c: RouteContext) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
function secret(c: RouteContext) {
  return readGuestSessionSecret(
    c.req.header('Cookie'),
    configuration(c.env).origin.startsWith('https:'),
  );
}
guestAnnotationRoutes.get('/api/guest/annotations/capabilities', (c) => {
  try {
    noQuery(c);
    return c.json(
      guestAnnotationsCapabilitiesSchema.parse({
        enabled: guestAnnotationsCapability(c.env),
      }),
    );
  } catch (error) {
    return fail(c, error);
  }
});
guestAnnotationRoutes.get(
  '/api/guest/annotations/freehand-capabilities',
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
// Explicitly own-author reads are safe under either pending peer-visibility choice.
guestAnnotationRoutes.get(
  '/api/guest/albums/:albumId/photos/:photoId/versions/:versionId/annotations/own',
  async (c) => {
    try {
      enabled(c);
      const params = new URL(c.req.url).searchParams;
      if (
        [...new Set(params.keys())].some(
          (key) => params.getAll(key).length !== 1,
        )
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      const query = guestAnnotationReadQuerySchema.parse(
        Object.fromEntries(params),
      );
      return c.json(
        await new D1GuestAnnotationReader(c.env.DB).readOwn(
          secret(c),
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
// Sharing is confined to the viewer's sealed invitation. Own command recovery
// continues to use the separate author-only endpoint above.
guestAnnotationRoutes.get(
  '/api/guest/albums/:albumId/photos/:photoId/versions/:versionId/annotations/shared',
  async (c) => {
    try {
      enabled(c);
      const params = new URL(c.req.url).searchParams;
      if (
        [...new Set(params.keys())].some(
          (key) => params.getAll(key).length !== 1,
        )
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      const query = guestAnnotationReadQuerySchema.parse(
        Object.fromEntries(params),
      );
      return c.json(
        await new D1GuestSharedAnnotationReader(c.env.DB).readShared(
          secret(c),
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
const commandPath = '/api/guest/albums/:albumId/annotations/commands';
guestAnnotationRoutes.use(
  commandPath,
  bodyLimit({
    maxSize: 16384,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
guestAnnotationRoutes.post(commandPath, async (c) => {
  try {
    if (c.req.header('Origin') !== configuration(c.env).origin)
      throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
    enabled(c);
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
      await new D1GuestAnnotationsRepository(
        c.env.DB,
        freehandAnnotationsCapability(c.env),
      ).command(
        secret(c),
        z.uuid().parse(c.req.param('albumId')),
        guestAnnotationCommandSchema.parse(input),
      ),
    );
  } catch (error) {
    return fail(c, error);
  }
});
