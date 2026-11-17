import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  albumOwnerFeedbackCommandSchema,
  albumOwnerFeedbackReadQuerySchema,
} from '../../../packages/contracts/src/album-owner-feedback';
import {
  configuration,
  freehandAnnotationsCapability,
  ownerAnnotationAuthoringCapability,
  ownerCommentsCapability,
  type WorkerEnv,
} from './config';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { D1GuestGalleryRepository } from './guest-gallery';
import { D1AlbumOwnerFeedbackRepository } from './album-owner-feedback';
import { freehandAnnotationSchemaCapability } from './freehand-annotation-schema';
import { logUnhandledRouteError } from './diagnostic-log';
import { productionRuntimeAllowed } from './production-runtime';
import { guestCoreRuntimeAllowed } from './staging-guest-scope';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const albumOwnerFeedbackRoutes = new Hono<Environment>();

function failure(c: RouteContext, error: unknown) {
  if (error instanceof GuestAccessDenied)
    return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
  if (error instanceof WorkspaceFailure && error.status !== 503)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  logUnhandledRouteError('album-owner-feedback', error, c.req.raw);
  return c.json({ error: { code: 'ALBUM_OWNER_FEEDBACK_UNAVAILABLE' } }, 503);
}

function secret(c: RouteContext) {
  return readGuestSessionSecret(
    c.req.header('Cookie'),
    configuration(c.env).origin.startsWith('https:'),
  );
}

function query(c: RouteContext) {
  const params = new URL(c.req.url).searchParams;
  if (
    [...new Set(params.keys())].some((key) => params.getAll(key).length !== 1)
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return albumOwnerFeedbackReadQuerySchema.parse(Object.fromEntries(params));
}

function ownerIds(c: RouteContext) {
  return {
    albumId: z.uuid().parse(c.req.param('albumId')),
    photoId: z.uuid().parse(c.req.param('photoId')),
    versionId: z.uuid().parse(c.req.param('versionId')),
  };
}

function guestRuntimeAllowed(c: RouteContext): boolean {
  const config = configuration(c.env);
  return (
    guestCoreRuntimeAllowed(c.env) &&
    (config.APP_ENV !== 'production' || productionRuntimeAllowed(c.env))
  );
}

albumOwnerFeedbackRoutes.get(
  '/api/v1/albums/:albumId/photos/:photoId/versions/:versionId/owner-feedback',
  async (c) => {
    try {
      const scope = ownerIds(c);
      const input = query(c);
      return c.json(
        await new D1AlbumOwnerFeedbackRepository(c.env.DB).readOwner(
          c.get('ownerId'),
          c.get('sessionId'),
          scope.albumId,
          scope.photoId,
          scope.versionId,
          input.cursor,
        ),
      );
    } catch (error) {
      return failure(c, error);
    }
  },
);

albumOwnerFeedbackRoutes.use(
  '/api/v1/albums/:albumId/owner-feedback/commands',
  bodyLimit({
    maxSize: 16384,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
albumOwnerFeedbackRoutes.post(
  '/api/v1/albums/:albumId/owner-feedback/commands',
  async (c) => {
    try {
      if (new URL(c.req.url).searchParams.size)
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      if (c.req.header('Origin') !== configuration(c.env).origin)
        throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
      if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
        throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 403);
      if (
        c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      let input: unknown;
      try {
        input = await c.req.json();
      } catch {
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      }
      const command = albumOwnerFeedbackCommandSchema.parse(input);
      const isComment = command.operation.endsWith('_comment');
      if (isComment && !ownerCommentsCapability(c.env))
        throw new WorkspaceFailure('OWNER_COMMENTS_DISABLED', 503);
      if (!isComment && !ownerAnnotationAuthoringCapability(c.env))
        throw new WorkspaceFailure('OWNER_ANNOTATION_AUTHORING_DISABLED', 503);
      const freehandWriteEnabled =
        (command.operation === 'create_annotation' ||
          command.operation === 'update_annotation') &&
        command.geometry.type === 'freehand' &&
        freehandAnnotationsCapability(c.env) &&
        (await freehandAnnotationSchemaCapability(c.env.DB));
      return c.json(
        await new D1AlbumOwnerFeedbackRepository(
          c.env.DB,
          freehandWriteEnabled,
        ).command(
          c.get('ownerId'),
          c.get('sessionId'),
          z.uuid().parse(c.req.param('albumId')),
          command,
        ),
      );
    } catch (error) {
      return failure(c, error);
    }
  },
);

albumOwnerFeedbackRoutes.get(
  '/api/guest/albums/:albumId/photos/:photoId/versions/:versionId/owner-feedback',
  async (c) => {
    try {
      if (!guestRuntimeAllowed(c))
        throw new WorkspaceFailure('GUEST_ACCESS_REQUIRED', 404);
      const scope = ownerIds(c);
      const input = query(c);
      const guestSecret = secret(c);
      const gallery = new D1GuestGalleryRepository(c.env.DB);
      await gallery.asset(
        guestSecret,
        scope.photoId,
        scope.versionId,
        'preview',
      );
      const page = await new D1AlbumOwnerFeedbackRepository(c.env.DB).readGuest(
        guestSecret,
        scope.albumId,
        scope.photoId,
        scope.versionId,
        input.cursor,
      );
      await gallery.asset(
        guestSecret,
        scope.photoId,
        scope.versionId,
        'preview',
      );
      return c.json(page);
    } catch (error) {
      return failure(c, error);
    }
  },
);
