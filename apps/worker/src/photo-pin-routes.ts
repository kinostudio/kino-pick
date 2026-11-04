import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { configuration, type WorkerEnv } from './config';
import { D1PhotoPinsRepository } from './photo-pins';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;

export const photoPinRoutes = new Hono<Environment>();
const repository = (c: RouteContext) =>
  new D1PhotoPinsRepository(c.env.DB, c.get('ownerId'), c.get('sessionId'));
const fail = (c: RouteContext, error: unknown) => {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'PHOTO_PINS_UNAVAILABLE' } }, 503);
};
const checkWrite = (c: RouteContext) => {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  if (
    c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId') ||
    c.req.header('X-Kino-Expected-Session') !== c.get('sessionId')
  )
    throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
  if (
    new URL(c.req.url).search ||
    c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
};
const readBody = async (c: RouteContext) => {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
};

photoPinRoutes.get('/api/v1/photo-pins/capabilities', async (c) => {
  if (new URL(c.req.url).search)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ enabled: await repository(c).capability() });
});

photoPinRoutes.put('/api/v1/photos/:photoId/pin', async (c) => {
  try {
    checkWrite(c);
    return c.json(
      await repository(c).set(c.req.param('photoId'), await readBody(c)),
    );
  } catch (error) {
    return fail(c, error);
  }
});
