import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { configuration, type WorkerEnv } from './config';
import { D1WorkspaceManagementRepository } from './workspace-management';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;

export const workspaceManagementRoutes = new Hono<Environment>();
const routePath = '/api/v1/workspaces/:workspaceId';

function failure(c: RouteContext, error: unknown) {
  if (error instanceof WorkspaceFailure && error.status !== 503)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'WORKSPACE_MANAGEMENT_UNAVAILABLE' } }, 503);
}

function validateRequest(c: RouteContext) {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  if (
    c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId') ||
    c.req.header('X-Kino-Expected-Session') !== c.get('sessionId')
  )
    throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 403);
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}

async function readInput(c: RouteContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
}

workspaceManagementRoutes.use(
  routePath,
  bodyLimit({
    maxSize: 8192,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);

workspaceManagementRoutes.patch(routePath, async (c) => {
  try {
    validateRequest(c);
    const result = await new D1WorkspaceManagementRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).rename(c.req.param('workspaceId'), await readInput(c));
    return c.json(result);
  } catch (error) {
    return failure(c, error);
  }
});

workspaceManagementRoutes.delete(routePath, async (c) => {
  try {
    validateRequest(c);
    const result = await new D1WorkspaceManagementRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).delete(c.req.param('workspaceId'), await readInput(c));
    return c.json(result);
  } catch (error) {
    return failure(c, error);
  }
});
