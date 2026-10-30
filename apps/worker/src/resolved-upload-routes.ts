import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  resolvedUploadPreviewRequestSchema,
  resolvedUploadReserveSchema,
} from '../../../packages/contracts/src/resolved-uploads';
import {
  configuration,
  resolvedUploadCapability,
  assistedCandidateCatalogCapability,
  indexedVersionMatchingCapability,
  matchingRulesCapability,
  versionUploadCapability,
  type WorkerEnv,
} from './config';
import { D1UploadRepository } from './uploads';
import { R2StorageAdapter } from './r2-storage';
import { WorkspaceFailure } from './workspaces';

type ResolvedUploadEnvironment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<ResolvedUploadEnvironment>;
export const resolvedUploadRoutes = new Hono<ResolvedUploadEnvironment>();

const repository = (c: RouteContext) =>
  new D1UploadRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    new R2StorageAdapter(c.env.PRIMARY_STORAGE),
    {
      versionUploadsEnabled: versionUploadCapability(c.env),
      matchingUploadsEnabled: resolvedUploadCapability(c.env),
      indexedMatchingEnabled: indexedVersionMatchingCapability(c.env),
      matchingRulesEnabled: matchingRulesCapability(c.env),
      assistedCatalogEnabled: assistedCandidateCatalogCapability(c.env),
      catalogSecret: c.env.BETTER_AUTH_SECRET,
    },
  );

const fail = (c: RouteContext, error: unknown) => {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'RESOLUTION_UNAVAILABLE' } }, 503);
};

const checkWrite = (c: RouteContext) => {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  const actor = c.req.header('X-Kino-Expected-Actor');
  if (actor !== undefined && actor !== c.get('ownerId'))
    throw new WorkspaceFailure('UPLOAD_OWNER_CHANGED', 403);
};

const body = async (c: RouteContext): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
};

resolvedUploadRoutes.get('/api/v1/upload-resolution/capabilities', (c) => {
  try {
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    return c.json(repository(c).resolvedUploadCapabilities());
  } catch (error) {
    return fail(c, error);
  }
});

resolvedUploadRoutes.post(
  '/api/v1/albums/:albumId/upload-resolution',
  async (c) => {
    try {
      checkWrite(c);
      const input = resolvedUploadPreviewRequestSchema.parse(await body(c));
      return c.json(
        await repository(c).previewResolved(
          z.uuid().parse(c.req.param('albumId')),
          input,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);

resolvedUploadRoutes.post(
  '/api/v1/albums/:albumId/resolved-uploads',
  async (c) => {
    try {
      checkWrite(c);
      const input = resolvedUploadReserveSchema.parse(await body(c));
      return c.json(
        await repository(c).reserveResolved(
          z.uuid().parse(c.req.param('albumId')),
          input,
        ),
        201,
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
