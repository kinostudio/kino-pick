import { importCompletedUploadMetadata } from './photographer-metadata-import';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { versionUploadInitSchema } from '../../../packages/contracts/src/version-uploads';
import { uploadCompleteSchema } from '../../../packages/contracts/src/uploads';
import {
  configuration,
  indexedVersionMatchingCapability,
  matchingRulesCapability,
  versionUploadCapability,
  type WorkerEnv,
} from './config';
import { D1UploadRepository } from './uploads';
import { R2StorageAdapter } from './r2-storage';
import { WorkspaceFailure } from './workspaces';

type VersionEnvironment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const versionUploadRoutes = new Hono<VersionEnvironment>();
type RouteContext = Context<VersionEnvironment>;
const repository = (c: RouteContext) =>
  new D1UploadRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
    new R2StorageAdapter(c.env.PRIMARY_STORAGE),
    {
      versionUploadsEnabled: versionUploadCapability(c.env),
      indexedMatchingEnabled: indexedVersionMatchingCapability(c.env),
      matchingRulesEnabled: matchingRulesCapability(c.env),
    },
  );
const fail = (c: RouteContext, error: unknown) => {
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  return c.json({ error: { code: 'VERSION_UPLOAD_UNAVAILABLE' } }, 503);
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

versionUploadRoutes.get('/api/v1/version-uploads/capabilities', (c) =>
  c.json(repository(c).versionUploadCapabilities()),
);
versionUploadRoutes.post('/api/v1/photos/:photoId/versions/init', async (c) => {
  try {
    checkWrite(c);
    const input = versionUploadInitSchema.parse(await body(c));
    return c.json(
      await repository(c).reserveVersion(
        z.uuid().parse(c.req.param('photoId')),
        input,
      ),
      201,
    );
  } catch (error) {
    return fail(c, error);
  }
});
versionUploadRoutes.get(
  '/api/v1/photos/:photoId/versions/uploads/recovery',
  async (c) => {
    try {
      const query = new URL(c.req.url).searchParams;
      if (
        [...query.keys()].some((key) => key !== 'requestId') ||
        query.getAll('requestId').length !== 1
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      return c.json(
        await repository(c).recoveryVersion(
          z.uuid().parse(c.req.param('photoId')),
          z.uuid().parse(query.get('requestId')),
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  },
);
versionUploadRoutes.post(
  '/api/v1/photos/:photoId/versions/:uploadSessionId/complete',
  async (c) => {
    try {
      checkWrite(c);
      const input = uploadCompleteSchema.parse(await body(c));
      const uploadId = z.uuid().parse(c.req.param('uploadSessionId'));
      const completion = await repository(c).completeVersionForPhoto(
        z.uuid().parse(c.req.param('photoId')),
        uploadId,
        input,
      );
      c.executionCtx.waitUntil(
        importCompletedUploadMetadata(
          c.env,
          c.get('ownerId'),
          c.get('sessionId'),
          uploadId,
        ).catch(() => {
          console.error('PHOTOGRAPHER_METADATA_IMPORT_FAILED');
        }),
      );
      return c.json(completion);
    } catch (error) {
      return fail(c, error);
    }
  },
);
