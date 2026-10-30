import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { assistedCandidatePageSchema } from '../../../packages/contracts/src/assisted-candidate-catalog';
import { assistedCandidateCatalogCapability, type WorkerEnv } from './config';
import { D1AssistedCandidateCatalog } from './assisted-candidate-catalog';
import { WorkspaceFailure } from './workspaces';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
type RouteContext = Context<Environment>;
export const assistedCandidateCatalogRoutes = new Hono<Environment>();

function fail(c: RouteContext, error: unknown) {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'RESOLUTION_CATALOG_UNAVAILABLE' } }, 503);
}

function catalog(c: RouteContext) {
  return new D1AssistedCandidateCatalog(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    c.env.BETTER_AUTH_SECRET,
    assistedCandidateCatalogCapability(c.env),
  );
}

function cursorQuery(c: RouteContext): string {
  const params = new URL(c.req.url).searchParams;
  if (
    params.size !== 1 ||
    params.getAll('cursor').length !== 1 ||
    !params.has('cursor')
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return z.string().min(1).max(4096).parse(params.get('cursor'));
}

function guard(c: RouteContext): void {
  if (!assistedCandidateCatalogCapability(c.env))
    throw new WorkspaceFailure('RESOLUTION_CATALOG_DISABLED', 403);
  if (c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId'))
    throw new WorkspaceFailure('RESOLUTION_CATALOG_OWNER_CHANGED', 403);
}

assistedCandidateCatalogRoutes.get(
  '/api/v1/albums/:albumId/upload-candidates',
  async (c) => {
    try {
      guard(c);
      const page = await catalog(c).list(
        z.uuid().parse(c.req.param('albumId')),
        cursorQuery(c),
      );
      return c.json(assistedCandidatePageSchema.parse(page));
    } catch (error) {
      return fail(c, error);
    }
  },
);
