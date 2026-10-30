import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  ownerCommentProcessingCommandSchema,
  ownerCommentProcessingCapabilitiesSchema,
} from '../../../packages/contracts/src/comment-processing';
import {
  configuration,
  ownerCommentProcessingCapability,
  type WorkerEnv,
} from './config';
import { D1OwnerCommentProcessingRepository } from './comment-processing';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const commentProcessingRoutes = new Hono<Environment>();

function fail(c: RouteContext, error: unknown) {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'COMMENT_PROCESSING_UNAVAILABLE' } }, 503);
}
function enabled(c: RouteContext) {
  if (!ownerCommentProcessingCapability(c.env))
    throw new WorkspaceFailure('COMMENT_PROCESSING_DISABLED', 503);
}
function noQuery(c: RouteContext) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
commentProcessingRoutes.get('/api/v1/comment-processing/capabilities', (c) => {
  try {
    noQuery(c);
    return c.json(
      ownerCommentProcessingCapabilitiesSchema.parse({
        enabled: ownerCommentProcessingCapability(c.env),
      }),
    );
  } catch (error) {
    return fail(c, error);
  }
});
commentProcessingRoutes.post(
  '/api/v1/albums/:albumId/comment-processing/commands',
  async (c) => {
    try {
      enabled(c);
      noQuery(c);
      if (c.req.header('Origin') !== configuration(c.env).origin)
        throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('COMMENT_PROCESSING_OWNER_CHANGED', 403);
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
      const command = ownerCommentProcessingCommandSchema.parse(body);
      return c.json(
        await new D1OwnerCommentProcessingRepository(c.env.DB).command(
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
