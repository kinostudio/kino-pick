import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  approvedDeliveriesCapability,
  configuration,
  type WorkerEnv,
} from './config';
import { D1DeliveryNotifications } from './delivery-notifications';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
const router = new Hono<Environment>();
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Vary: 'Cookie',
};

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
    error instanceof GuestAccessDenied
      ? 'GUEST_ACCESS_REQUIRED'
      : error instanceof z.ZodError
        ? 'INVALID_INPUT'
        : error instanceof WorkspaceFailure
          ? error.code
          : 'DELIVERY_NOTIFICATIONS_UNAVAILABLE';
  return Response.json({ error: { code } }, { status, headers });
}

function noQuery(c: Context<Environment>) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function enabled(c: Context<Environment>) {
  if (!approvedDeliveriesCapability(c.env))
    throw new WorkspaceFailure('DELIVERIES_DISABLED', 503);
}

router.get(
  '/api/v1/workspaces/:workspaceId/delivery-notifications',
  async (c) => {
    try {
      enabled(c);
      noQuery(c);
      const ownerId = c.get('ownerId');
      if (c.req.header('X-Kino-Expected-Actor') !== ownerId)
        throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
      const feed = await new D1DeliveryNotifications(c.env.DB).ownerList(
        ownerId,
        c.get('sessionId'),
        c.req.param('workspaceId'),
      );
      return Response.json(feed, { headers });
    } catch (error) {
      return failure(error);
    }
  },
);

router.get('/api/guest/albums/:albumId/delivery-notifications', async (c) => {
  try {
    enabled(c);
    noQuery(c);
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      configuration(c.env).origin.startsWith('https:'),
    );
    const feed = await new D1DeliveryNotifications(c.env.DB).guestList(
      secret,
      c.req.param('albumId'),
    );
    return Response.json(feed, { headers });
  } catch (error) {
    return failure(error);
  }
});

export { router as deliveryNotificationRoutes };
