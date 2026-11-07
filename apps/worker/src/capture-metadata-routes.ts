import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { WorkerEnv } from './config';
import { configuration } from './config';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import {
  readGuestCaptureMetadata,
  readOwnerCaptureMetadata,
} from './capture-metadata';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;

export const captureMetadataRoutes = new Hono<Environment>();

function fail(c: RouteContext, error: unknown) {
  if (error instanceof GuestAccessDenied)
    return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'CAPTURE_METADATA_UNAVAILABLE' } }, 503);
}

function noQuery(c: RouteContext) {
  if (new URL(c.req.url).searchParams.size)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}

const responseHeaders = {
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Cookie',
};

captureMetadataRoutes.get(
  '/api/v1/photos/:photoId/versions/:versionId/capture-metadata',
  async (c) => {
    try {
      noQuery(c);
      const result = await readOwnerCaptureMetadata(
        c.env,
        c.get('ownerId'),
        c.get('sessionId'),
        c.req.param('photoId'),
        c.req.param('versionId'),
      );
      return c.json(result, 200, responseHeaders);
    } catch (error) {
      return fail(c, error);
    }
  },
);

captureMetadataRoutes.get(
  '/api/guest/photos/:photoId/versions/:versionId/capture-metadata',
  async (c) => {
    try {
      noQuery(c);
      const config = configuration(c.env);
      const guestSecret = readGuestSessionSecret(
        c.req.header('Cookie'),
        config.origin.startsWith('https:'),
      );
      const result = await readGuestCaptureMetadata(
        c.env,
        guestSecret,
        c.req.param('photoId'),
        c.req.param('versionId'),
      );
      return c.json(result, 200, responseHeaders);
    } catch (error) {
      return fail(c, error);
    }
  },
);
