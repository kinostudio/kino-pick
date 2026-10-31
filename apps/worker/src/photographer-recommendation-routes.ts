import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { D1PhotographerRecommendationsRepository } from './photographer-recommendations';
import {
  photographerRecommendationsCapability,
  configuration,
  type WorkerEnv,
} from './config';
import { WorkspaceFailure } from './workspaces';
import { importPhotographerOriginal } from './photographer-metadata-import';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const photographerRecommendationRoutes = new Hono<Environment>();
const repository = (c: RouteContext) =>
  new D1PhotographerRecommendationsRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    photographerRecommendationsCapability(c.env),
  );
const fail = (c: RouteContext, error: unknown) => {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json(
    { error: { code: 'PHOTOGRAPHER_RECOMMENDATIONS_UNAVAILABLE' } },
    503,
  );
};
const checkWrite = (c: RouteContext) => {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  if (
    c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId') ||
    c.req.header('X-Kino-Expected-Session') !== c.get('sessionId')
  )
    throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
  if (
    new URL(c.req.url).search ||
    c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
};
const readBody = async (c: RouteContext) => {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
};
photographerRecommendationRoutes.get(
  '/api/v1/photographer-recommendations/capabilities',
  async (c) => {
    if (new URL(c.req.url).search)
      return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
    return c.json({ enabled: await repository(c).capability() });
  },
);
photographerRecommendationRoutes.get(
  '/api/v1/albums/:albumId/photographer-recommendations',
  async (c) => {
    try {
      const query = new URL(c.req.url).searchParams;
      if (
        [...query.keys()].some((key) => key !== 'cursor') ||
        query.getAll('cursor').length > 1
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      return c.json(
        await repository(c).read(
          c.req.param('albumId'),
          query.has('cursor')
            ? { cursor: z.uuid().parse(query.get('cursor')) }
            : {},
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
photographerRecommendationRoutes.put(
  '/api/v1/albums/:albumId/photographer-recommendations',
  async (c) => {
    try {
      checkWrite(c);
      return c.json(
        await repository(c).setPolicy(
          c.req.param('albumId'),
          await readBody(c),
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
photographerRecommendationRoutes.get(
  '/api/v1/photos/:photoId/photographer-metadata',
  async (c) => {
    try {
      const query = new URL(c.req.url).searchParams;
      if (
        [...query.keys()].some((key) => key !== 'versionId') ||
        query.getAll('versionId').length > 1
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      return c.json(
        await repository(c).readPhoto(
          c.req.param('photoId'),
          query.has('versionId')
            ? z.uuid().parse(query.get('versionId'))
            : undefined,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
photographerRecommendationRoutes.put(
  '/api/v1/photos/:photoId/photographer-metadata',
  async (c) => {
    try {
      checkWrite(c);
      return c.json(
        await repository(c).setPhotoMetadata(
          c.req.param('photoId'),
          await readBody(c),
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
photographerRecommendationRoutes.post(
  '/api/v1/photos/:photoId/photographer-metadata/import',
  async (c) => {
    try {
      checkWrite(c);
      const input = z
        .object({
          requestId: z.uuid(),
          expectedRevision: z.number().int().min(0).safe(),
          versionId: z.uuid(),
        })
        .strict()
        .parse(await readBody(c));
      return c.json(
        await importPhotographerOriginal(
          c.env,
          c.get('ownerId'),
          c.get('sessionId'),
          c.req.param('photoId'),
          input,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
