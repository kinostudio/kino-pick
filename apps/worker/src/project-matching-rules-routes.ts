import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  matchingRulesCapabilitiesSchema,
  setProjectMatchingRulesSchema,
} from '../../../packages/contracts/src/matching-rules';
import {
  configuration,
  matchingRulesCapability,
  type WorkerEnv,
} from './config';
import { D1ProjectMatchingRulesRepository } from './project-matching-rules';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;

export const projectMatchingRulesRoutes = new Hono<Environment>();

const repository = (c: RouteContext) =>
  new D1ProjectMatchingRulesRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    matchingRulesCapability(c.env),
  );

const fail = (c: RouteContext, error: unknown) => {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'MATCHING_RULES_UNAVAILABLE' } }, 503);
};

const rejectQuery = (c: RouteContext) => {
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
};

async function readJsonBody(c: RouteContext): Promise<unknown> {
  const length = c.req.header('Content-Length');
  if (length !== undefined) {
    if (!/^\d+$/.test(length) || Number(length) > 4096)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
  const contentType = c.req
    .header('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== 'application/json')
    throw new WorkspaceFailure('INVALID_INPUT', 400);

  const body = c.req.raw.body;
  if (!body) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof WorkspaceFailure) throw error;
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
}

projectMatchingRulesRoutes.get('/api/v1/matching-rules/capabilities', (c) => {
  try {
    rejectQuery(c);
    return c.json(
      matchingRulesCapabilitiesSchema.parse({
        enabled: matchingRulesCapability(c.env),
      }),
    );
  } catch (error) {
    return fail(c, error);
  }
});

projectMatchingRulesRoutes.get(
  '/api/v1/projects/:projectId/matching-rules',
  async (c) => {
    try {
      rejectQuery(c);
      return c.json(
        await repository(c).read(z.uuid().parse(c.req.param('projectId'))),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);

projectMatchingRulesRoutes.put(
  '/api/v1/projects/:projectId/matching-rules',
  async (c) => {
    try {
      rejectQuery(c);
      if (c.req.header('Origin') !== configuration(c.env).origin)
        throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('MATCHING_RULES_OWNER_CHANGED', 403);
      if (!matchingRulesCapability(c.env))
        throw new WorkspaceFailure('MATCHING_RULES_DISABLED', 403);

      const body = await readJsonBody(c);
      const input = setProjectMatchingRulesSchema.parse(body);
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
