import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  ownerHistoryCapabilitiesSchema,
  ownerHistoryQuerySchema,
} from '../../../packages/contracts/src/owner-history';
import {
  configuration,
  ownerHistoryCapability,
  type WorkerEnv,
} from './config';
import { D1OwnerHistoryRepository } from './owner-history';
import { WorkspaceFailure } from './workspaces';
type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const ownerHistoryRoutes = new Hono<Environment>();
function fail(c: Context<Environment>, e: unknown) {
  if (e instanceof WorkspaceFailure)
    return c.json({ error: { code: e.code } }, e.status);
  if (e instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'OWNER_HISTORY_UNAVAILABLE' } }, 503);
}
function query(c: Context<Environment>) {
  const params = new URL(c.req.url).searchParams;
  const fields: Record<string, string | string[]> = {};
  for (const [k, v] of params) {
    if (k === 'actorTypes') {
      if (!Object.hasOwn(fields, k)) {
        const actorTypes = params.getAll(k);
        Object.defineProperty(fields, k, {
          value:
            actorTypes.length === 1 && actorTypes[0] === '' ? [] : actorTypes,
          enumerable: true,
          configurable: true,
        });
      }
      continue;
    }
    if (Object.hasOwn(fields, k))
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    Object.defineProperty(fields, k, {
      value: v,
      enumerable: true,
      configurable: true,
    });
  }
  return ownerHistoryQuerySchema.parse(fields);
}
function noQuery(c: Context<Environment>) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
function guard(c: Context<Environment>) {
  if (!ownerHistoryCapability(c.env))
    throw new WorkspaceFailure('OWNER_HISTORY_DISABLED', 503);
  if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
    throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
}
function repo(c: Context<Environment>) {
  return new D1OwnerHistoryRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    c.env.BETTER_AUTH_SECRET ?? '',
  );
}
ownerHistoryRoutes.get('/api/v1/owner-history/capabilities', (c) => {
  try {
    noQuery(c);
    return c.json(
      ownerHistoryCapabilitiesSchema.parse({
        enabled: ownerHistoryCapability(c.env),
      }),
    );
  } catch (e) {
    return fail(c, e);
  }
});
const path = '/api/v1/workspaces/:workspaceId/history';
ownerHistoryRoutes.get(path, async (c) => {
  try {
    guard(c);
    return c.json(await repo(c).page(c.req.param('workspaceId'), query(c)));
  } catch (e) {
    return fail(c, e);
  }
});
ownerHistoryRoutes.use(
  path + '/export',
  bodyLimit({
    maxSize: 12288,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
ownerHistoryRoutes.post(path + '/export', async (c) => {
  try {
    if (c.req.header('Origin') !== configuration(c.env).origin)
      throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
    guard(c);
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
    return await repo(c).export(
      z.uuid().parse(c.req.param('workspaceId')),
      input,
    );
  } catch (e) {
    return fail(c, e);
  }
});
