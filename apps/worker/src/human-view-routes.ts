import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { humanViewRequestSchema } from '../../../packages/contracts/src/human-views';
import { configuration, humanViewsCapability, type WorkerEnv } from './config';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { D1HumanViewsRepository } from './human-views';
import { WorkspaceFailure } from './workspaces';

type ViewEnv = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const humanViewRoutes = new Hono<ViewEnv>();
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
};

function errorResponse(error: unknown): Response {
  if (error instanceof GuestAccessDenied)
    return Response.json(
      { error: { code: 'GUEST_ACCESS_REQUIRED' } },
      { status: 401, headers },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      { error: { code: 'INVALID_INPUT' } },
      { status: 400, headers },
    );
  if (error instanceof WorkspaceFailure)
    return Response.json(
      { error: { code: error.code } },
      { status: error.status, headers },
    );
  return Response.json(
    { error: { code: 'HUMAN_VIEW_UNAVAILABLE' } },
    { status: 503, headers },
  );
}
function checkRequest(c: Context<ViewEnv>): void {
  if (!humanViewsCapability(c.env))
    throw new WorkspaceFailure('HUMAN_VIEWS_DISABLED', 503);
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  const site = c.req.header('Sec-Fetch-Site');
  if (
    c.req.header('CF-Worker') ||
    (site !== undefined && site !== 'same-origin')
  )
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  const purposeValues = [
    c.req.header('Purpose'),
    c.req.header('Sec-Purpose'),
  ].filter((value): value is string => value !== undefined);
  const prefetchOrPrerender = purposeValues.some((value) =>
    /(?:^|[\s,;])(?:prefetch|prerender)(?=$|[\s,;])/i.test(value),
  );
  if (
    prefetchOrPrerender ||
    /(?:bot|crawler|spider)/i.test(c.req.header('User-Agent') ?? '')
  )
    throw new WorkspaceFailure('NON_INTERACTIVE_VIEW', 403);
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
const paths = [
  '/api/v1/albums/:albumId/view-heartbeats',
  '/api/guest/albums/:albumId/view-heartbeats',
] as const;
for (const path of paths) {
  humanViewRoutes.use(
    path,
    bodyLimit({
      maxSize: 4096,
      onError: () =>
        Response.json(
          { error: { code: 'REQUEST_TOO_LARGE' } },
          { status: 413, headers },
        ),
    }),
  );
}
humanViewRoutes.get('/api/human-views/capabilities', (c) => {
  if (new URL(c.req.url).search)
    return Response.json(
      { error: { code: 'INVALID_INPUT' } },
      { status: 400, headers },
    );
  return Response.json(
    {
      enabled: humanViewsCapability(c.env),
      minVisibleMs: 1000,
      dedupeMs: 300000,
    },
    { headers },
  );
});
humanViewRoutes.post(paths[0], async (c) => {
  try {
    checkRequest(c);
    const albumId = z.uuid().parse(c.req.param('albumId'));
    const input = humanViewRequestSchema.parse(
      await c.req.json().catch(() => null),
    );
    const result = await new D1HumanViewsRepository(c.env.DB).owner(
      c.get('ownerId'),
      c.get('sessionId'),
      albumId,
      input,
    );
    return Response.json(result, { headers });
  } catch (error) {
    return errorResponse(error);
  }
});
humanViewRoutes.post(paths[1], async (c) => {
  try {
    checkRequest(c);
    const albumId = z.uuid().parse(c.req.param('albumId'));
    const input = humanViewRequestSchema.parse(
      await c.req.json().catch(() => null),
    );
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      configuration(c.env).origin.startsWith('https:'),
    );
    const result = await new D1HumanViewsRepository(c.env.DB).guest(
      secret,
      albumId,
      input,
    );
    return Response.json(result, { headers });
  } catch (error) {
    return errorResponse(error);
  }
});
