import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  ownerCommentCommandSchema,
  ownerCommentReadQuerySchema,
  ownerCommentsCapabilitiesSchema,
} from '../../../packages/contracts/src/owner-comments';
import {
  configuration,
  ownerCommentsCapability,
  type WorkerEnv,
} from './config';
import { D1OwnerCommentsRepository } from './owner-comments';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const ownerCommentRoutes = new Hono<Environment>();

function fail(c: RouteContext, error: unknown) {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'OWNER_COMMENTS_UNAVAILABLE' } }, 503);
}
function enabled(c: RouteContext) {
  if (!ownerCommentsCapability(c.env))
    throw new WorkspaceFailure('OWNER_COMMENTS_DISABLED', 503);
}
function noQuery(c: RouteContext) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
ownerCommentRoutes.get('/api/v1/comments/capabilities', (c) => {
  try {
    noQuery(c);
    return c.json(
      ownerCommentsCapabilitiesSchema.parse({
        enabled: ownerCommentsCapability(c.env),
      }),
    );
  } catch (error) {
    return fail(c, error);
  }
});
ownerCommentRoutes.get(
  '/api/v1/albums/:albumId/photos/:photoId/versions/:versionId/comment-threads',
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
      const query = ownerCommentReadQuerySchema.parse(
        Object.fromEntries(params),
      );
      return c.json(
        await new D1OwnerCommentsRepository(c.env.DB).read(
          c.get('ownerId'),
          c.get('sessionId'),
          z.uuid().parse(c.req.param('albumId')),
          z.uuid().parse(c.req.param('photoId')),
          z.uuid().parse(c.req.param('versionId')),
          query,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
ownerCommentRoutes.post(
  '/api/v1/albums/:albumId/comment-replies/commands',
  async (c) => {
    try {
      enabled(c);
      noQuery(c);
      if (c.req.header('Origin') !== configuration(c.env).origin)
        throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('OWNER_COMMENTS_OWNER_CHANGED', 403);
      if (
        c.req.header('Content-Type')?.split(';')[0]?.trim() !==
        'application/json'
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      }
      const command = ownerCommentCommandSchema.parse(body);
      return c.json(
        await new D1OwnerCommentsRepository(c.env.DB).command(
          c.get('ownerId'),
          c.get('sessionId'),
          z.uuid().parse(c.req.param('albumId')),
          command,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
