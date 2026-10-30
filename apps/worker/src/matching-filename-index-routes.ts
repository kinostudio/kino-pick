import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { matchingFilenameIndexCapabilitiesSchema } from '../../../packages/contracts/src/matching-filename-index';
import {
  configuration,
  matchingFilenameIndexCapability,
  type WorkerEnv,
} from './config';
import { D1MatchingFilenameIndex } from './matching-filename-index';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const matchingFilenameIndexRoutes = new Hono<Environment>();
const repository = (c: RouteContext) =>
  new D1MatchingFilenameIndex(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    matchingFilenameIndexCapability(c.env),
  );
const checkQuery = (c: RouteContext) => {
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
};
const fail = (c: RouteContext, error: unknown) => {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'MATCHING_INDEX_UNAVAILABLE' } }, 503);
};
matchingFilenameIndexRoutes.get(
  '/api/v1/matching-filename-index/capabilities',
  (c) => {
    try {
      checkQuery(c);
      return c.json(
        matchingFilenameIndexCapabilitiesSchema.parse({
          enabled: matchingFilenameIndexCapability(c.env),
        }),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
matchingFilenameIndexRoutes.get(
  '/api/v1/albums/:albumId/matching-filename-index',
  async (c) => {
    try {
      checkQuery(c);
      return c.json(
        await repository(c).read(z.uuid().parse(c.req.param('albumId'))),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
matchingFilenameIndexRoutes.post(
  '/api/v1/albums/:albumId/matching-filename-index',
  bodyLimit({
    maxSize: 1024,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
  async (c) => {
    try {
      checkQuery(c);
      if (c.req.header('Origin') !== configuration(c.env).origin)
        throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('MATCHING_INDEX_OWNER_CHANGED', 403);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      }
      z.object({}).strict().parse(body);
      return c.json(
        await repository(c).advance(z.uuid().parse(c.req.param('albumId'))),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
