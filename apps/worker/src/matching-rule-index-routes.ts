import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { advanceMatchingRuleIndexSchema } from '../../../packages/contracts/src/matching-rules';
import {
  configuration,
  matchingRulesCapability,
  type WorkerEnv,
} from './config';
import { D1MatchingRuleFilenameIndex } from './matching-rule-filename-index';
import { WorkspaceFailure } from './workspaces';
type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const matchingRuleIndexRoutes = new Hono<Environment>();
const repository = (c: RouteContext) =>
  new D1MatchingRuleFilenameIndex(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    matchingRulesCapability(c.env),
  );
function checkQuery(c: RouteContext) {
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  const actor = c.req.header('X-Kino-Expected-Actor');
  if (actor !== undefined && actor !== c.get('ownerId'))
    throw new WorkspaceFailure('MATCHING_RULES_OWNER_CHANGED', 403);
}
function fail(c: RouteContext, error: unknown) {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'MATCHING_RULES_UNAVAILABLE' } }, 503);
}
async function body(c: RouteContext): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/iu.test(c.req.header('Content-Type') ?? '')
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      }
      chunks.push(next.value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer),
    ) as unknown;
  } catch (error) {
    if (error instanceof WorkspaceFailure) throw error;
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  } finally {
    reader.releaseLock();
  }
}
matchingRuleIndexRoutes.get(
  '/api/v1/albums/:albumId/matching-rule-index',
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
matchingRuleIndexRoutes.post(
  '/api/v1/albums/:albumId/matching-rule-index',
  async (c) => {
    try {
      checkQuery(c);
      if (c.req.header('Origin') !== configuration(c.env).origin)
        throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('MATCHING_RULES_OWNER_CHANGED', 403);
      const input = advanceMatchingRuleIndexSchema.parse(await body(c));
      return c.json(
        await repository(c).advance(
          z.uuid().parse(c.req.param('albumId')),
          input,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
