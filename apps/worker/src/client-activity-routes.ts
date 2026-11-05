import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { configuration, type WorkerEnv } from './config';
import {
  D1GuestAccessResolver,
  GuestAccessDenied,
  readGuestSessionSecret,
} from './guest-access';
import {
  D1ClientActivityRepository,
  clientActivityEnabled,
} from './client-activity';
import {
  clientAlbumBrowserDigest,
  issueClientBrowserIdentity,
  readClientBrowserIdentity,
} from './client-browser-identity';
import { WorkspaceFailure } from './workspaces';
import { clientActivityIp } from './client-ip';

type ActivityEnv = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const clientActivityRoutes = new Hono<ActivityEnv>();
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Cookie',
};
const inputSchema = z
  .object({
    viewId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    expectedActorId: z.uuid(),
    visibleForMs: z.number().int().min(1000).max(60000),
  })
  .strict();

function failure(error: unknown) {
  const status =
    error instanceof GuestAccessDenied
      ? 401
      : error instanceof z.ZodError
        ? 400
        : error instanceof WorkspaceFailure
          ? error.status
          : 503;
  const code =
    error instanceof WorkspaceFailure
      ? error.code
      : error instanceof GuestAccessDenied
        ? 'GUEST_ACCESS_REQUIRED'
        : error instanceof z.ZodError
          ? 'INVALID_INPUT'
          : 'CLIENT_ACTIVITY_UNAVAILABLE';
  return Response.json({ error: { code } }, { status, headers });
}
clientActivityRoutes.get('/api/client-activity/capabilities', async (c) =>
  Response.json(
    {
      enabled: await clientActivityEnabled(c.env, c.env.DB),
    },
    { headers },
  ),
);
clientActivityRoutes.use(
  '/api/guest/albums/:albumId/activity',
  bodyLimit({ maxSize: 2048 }),
);
clientActivityRoutes.post('/api/guest/albums/:albumId/activity', async (c) => {
  try {
    if (!(await clientActivityEnabled(c.env, c.env.DB)))
      throw new WorkspaceFailure('CLIENT_ACTIVITY_DISABLED', 503);
    const config = configuration(c.env);
    if (
      c.req.header('Origin') !== config.origin ||
      c.req.header('CF-Worker') ||
      (c.req.header('Sec-Fetch-Site') &&
        c.req.header('Sec-Fetch-Site') !== 'same-origin')
    )
      throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
    if (
      new URL(c.req.url).search ||
      c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const albumId = z.uuid().parse(c.req.param('albumId')).toLowerCase();
    const input = inputSchema.parse(await c.req.json().catch(() => null));
    const secure = config.origin.startsWith('https:');
    const secret = readGuestSessionSecret(c.req.header('Cookie'), secure);
    const access = await new D1GuestAccessResolver(c.env.DB).album(
      secret,
      albumId,
      'can_view',
    );
    if (access.guestId !== input.expectedActorId.toLowerCase())
      throw new GuestAccessDenied();
    const signingKey = c.env.BETTER_AUTH_SECRET;
    if (!signingKey || signingKey.length < 32)
      throw new WorkspaceFailure('CLIENT_ACTIVITY_UNAVAILABLE', 503);
    const token = await readClientBrowserIdentity(
      c.req.header('Cookie') ?? '',
      signingKey,
      secure,
    );
    if (!token) {
      const identity = await issueClientBrowserIdentity(signingKey, secure);
      return Response.json(
        { retry: true },
        { status: 202, headers: { ...headers, 'Set-Cookie': identity.cookie } },
      );
    }
    const result = await new D1ClientActivityRepository(
      c.env.DB,
    ).recordGuestView(secret, {
      viewId: input.viewId,
      browserDigest: await clientAlbumBrowserDigest(token, albumId, signingKey),
      expectedActorId: input.expectedActorId,
      albumId,
      photoId: input.photoId,
      versionId: input.versionId,
      rawIp: clientActivityIp(c.req.raw, config.APP_ENV === 'local'),
    });
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
});
clientActivityRoutes.get('/api/v1/albums/:albumId/activity', async (c) => {
  try {
    if (!(await clientActivityEnabled(c.env, c.env.DB)))
      throw new WorkspaceFailure('CLIENT_ACTIVITY_DISABLED', 503);
    const query = z
      .object({
        beforeTime: z.coerce.number().int().nonnegative().safe().optional(),
        beforeId: z.uuid().optional(),
      })
      .strict()
      .parse(c.req.query());
    if (
      (query.beforeTime === undefined) !== (query.beforeId === undefined) ||
      Object.values(c.req.queries()).some((values) => values.length !== 1)
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const result = await new D1ClientActivityRepository(
      c.env.DB,
    ).listOwnerViews({
      ownerId: c.get('ownerId'),
      ownerSessionId: c.get('sessionId'),
      albumId: z.uuid().parse(c.req.param('albumId')),
      ...(query.beforeTime !== undefined && query.beforeId
        ? { before: { viewedAtMs: query.beforeTime, eventId: query.beforeId } }
        : {}),
    });
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
});

clientActivityRoutes.get(
  '/api/v1/albums/:albumId/download-activity',
  async (c) => {
    try {
      if (!(await clientActivityEnabled(c.env, c.env.DB)))
        throw new WorkspaceFailure('CLIENT_ACTIVITY_DISABLED', 503);
      const query = z
        .object({
          beforeTime: z.coerce.number().int().nonnegative().safe().optional(),
          beforeId: z.uuid().optional(),
        })
        .strict()
        .parse(c.req.query());
      if (
        (query.beforeTime === undefined) !== (query.beforeId === undefined) ||
        Object.values(c.req.queries()).some((values) => values.length !== 1)
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      const result = await new D1ClientActivityRepository(
        c.env.DB,
      ).listOwnerDownloads({
        ownerId: c.get('ownerId'),
        ownerSessionId: c.get('sessionId'),
        albumId: z.uuid().parse(c.req.param('albumId')),
        ...(query.beforeTime !== undefined && query.beforeId
          ? {
              before: {
                requestedAtMs: query.beforeTime,
                eventId: query.beforeId,
              },
            }
          : {}),
      });
      return Response.json(result, { headers });
    } catch (error) {
      return failure(error);
    }
  },
);
