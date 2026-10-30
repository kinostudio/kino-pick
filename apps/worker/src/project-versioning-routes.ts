import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  setProjectVersioningSchema,
  projectVersioningCapabilitiesSchema,
} from '../../../packages/contracts/src/project-versioning';
import {
  configuration,
  projectVersioningCapability,
  resolvedUploadCapability,
  type WorkerEnv,
} from './config';
import { D1ProjectVersioningRepository } from './project-versioning';
import { WorkspaceFailure } from './workspaces';
type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const projectVersioningRoutes = new Hono<Environment>();
const repository = (c: RouteContext) =>
  new D1ProjectVersioningRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    projectVersioningCapability(c.env),
    resolvedUploadCapability(c.env),
  );
const fail = (c: RouteContext, error: unknown) => {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'PROJECT_VERSIONING_UNAVAILABLE' } }, 503);
};
const query = (c: RouteContext) => {
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
};
projectVersioningRoutes.get('/api/v1/versioning/capabilities', (c) => {
  try {
    query(c);
    return c.json(
      projectVersioningCapabilitiesSchema.parse({
        enabled: projectVersioningCapability(c.env),
      }),
    );
  } catch (error) {
    return fail(c, error);
  }
});
projectVersioningRoutes.get(
  '/api/v1/projects/:projectId/versioning',
  async (c) => {
    try {
      query(c);
      return c.json(
        await repository(c).read(z.uuid().parse(c.req.param('projectId'))),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
projectVersioningRoutes.put(
  '/api/v1/projects/:projectId/versioning',
  async (c) => {
    try {
      query(c);
      if (c.req.header('Origin') !== configuration(c.env).origin)
        throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('PROJECT_VERSIONING_OWNER_CHANGED', 403);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      }
      const input = setProjectVersioningSchema.parse(body);
      if (
        !resolvedUploadCapability(c.env) &&
        (input.mode === 'auto_filename' || input.mode === 'assisted')
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      return c.json(
        await repository(c).set(
          z.uuid().parse(c.req.param('projectId')),
          input,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
