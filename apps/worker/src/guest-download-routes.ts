import { Hono } from 'hono';
import { z } from 'zod';
import {
  guestDownloadFilename,
  guestDownloadKindSchema,
  guestDownloadsQuerySchema,
} from '../../../packages/contracts/src/guest-downloads';
import {
  configuration,
  guestDownloadsCapability,
  type WorkerEnv,
} from './config';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { D1GuestDownloadsRepository } from './guest-downloads';
import { R2StorageAdapter } from './r2-storage';
import { storageBucketForNode } from './private-storage';
import { WorkspaceFailure } from './workspaces';
import {
  D1ClientActivityRepository,
  clientActivityEnabled,
} from './client-activity';
import { clientActivityIp } from './client-ip';
import { logUnhandledRouteError } from './diagnostic-log';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Vary: 'Cookie',
};

function failure(error: unknown): Response {
  if (error instanceof GuestAccessDenied)
    return Response.json(
      { error: { code: 'GUEST_ACCESS_REQUIRED' } },
      { status: 401, headers: privateHeaders },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      { error: { code: 'INVALID_INPUT' } },
      { status: 400, headers: privateHeaders },
    );
  if (error instanceof WorkspaceFailure)
    return Response.json(
      { error: { code: error.code } },
      { status: error.status, headers: privateHeaders },
    );
  logUnhandledRouteError('guest-downloads', error);
  return Response.json(
    { error: { code: 'DOWNLOAD_UNAVAILABLE' } },
    { status: 503, headers: privateHeaders },
  );
}

function disposition(filename: string, mime: string) {
  const suffix =
    mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="KINO-Pic.${suffix}"; filename*=UTF-8''${encoded}`;
}

export const guestDownloadRoutes = new Hono<{ Bindings: WorkerEnv }>();

guestDownloadRoutes.get('/api/guest/albums/:albumId/downloads', async (c) => {
  try {
    if (!guestDownloadsCapability(c.env))
      throw new WorkspaceFailure('GUEST_DOWNLOADS_DISABLED', 503);
    const query = c.req.queries();
    if (Object.values(query).some((values) => values.length !== 1))
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const parsed = guestDownloadsQuerySchema.parse(
      Object.fromEntries(
        Object.entries(query).map(([key, values]) => [key, values[0]]),
      ),
    );
    const secret = readGuestSessionSecret(
      c.req.header('Cookie'),
      configuration(c.env).origin.startsWith('https:'),
    );
    const page = await new D1GuestDownloadsRepository(c.env.DB).page(
      secret,
      c.req.param('albumId'),
      parsed,
    );
    return Response.json(page, { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
});

guestDownloadRoutes.get(
  '/api/guest/photos/:photoId/versions/:versionId/downloads/:kind',
  async (c) => {
    let object: R2ObjectBody | null = null;
    try {
      if (!guestDownloadsCapability(c.env))
        throw new WorkspaceFailure('GUEST_DOWNLOADS_DISABLED', 503);
      // A HEAD probe does not represent a requested file download.
      if (c.req.method !== 'GET')
        return Response.json(
          { error: { code: 'METHOD_NOT_ALLOWED' } },
          { status: 405, headers: privateHeaders },
        );
      z.object({}).strict().parse(c.req.query());
      const photoId = z.uuid().parse(c.req.param('photoId'));
      const versionId = z.uuid().parse(c.req.param('versionId'));
      const kind = guestDownloadKindSchema.parse(c.req.param('kind'));
      const secret = readGuestSessionSecret(
        c.req.header('Cookie'),
        configuration(c.env).origin.startsWith('https:'),
      );
      const repository = new D1GuestDownloadsRepository(c.env.DB);
      const item = await repository.request(secret, photoId, versionId, kind);
      if (await clientActivityEnabled(c.env, c.env.DB)) {
        await new D1ClientActivityRepository(c.env.DB).recordDownload(
          {
            requestId: item.requestId,
            guestId: item.guestId,
            guestSessionId: item.guestSessionId,
            inviteId: item.inviteId,
            workspaceId: item.workspaceId,
            projectId: item.projectId,
            albumId: item.albumId,
            photoId: item.photoId,
            versionId: item.versionId,
          },
          clientActivityIp(c.req.raw, configuration(c.env).APP_ENV === 'local'),
        );
      }
      try {
        const storage = new R2StorageAdapter(
          storageBucketForNode(c.env, item.storageNodeId),
          item.storageNodeId,
        );
        object = await storage.open(
          {
            workspaceId: item.workspaceId,
            projectId: item.projectId,
            albumId: item.albumId,
          },
          item.objectKey,
        );
      } catch {
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      }
      const checksum = object.checksums.sha256
        ? Array.from(new Uint8Array(object.checksums.sha256), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('')
        : null;
      if (
        object.size !== item.byteSize ||
        checksum !== item.checksumSha256 ||
        object.httpMetadata?.contentType !== item.mime ||
        (kind === 'preview' && object.size > 8_388_608)
      )
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      // This means the private file is ready to stream, not that the browser has
      // received/saved every byte. The current ACL is checked again atomically.
      await repository.generated(secret, item);
      return new Response(object.body, {
        headers: {
          ...privateHeaders,
          'Content-Type': item.mime,
          'Content-Length': String(object.size),
          'Content-Disposition': disposition(
            guestDownloadFilename(item.filename, kind),
            item.mime,
          ),
        },
      });
    } catch (error) {
      if (object) await object.body.cancel().catch(() => undefined);
      return failure(error);
    }
  },
);
