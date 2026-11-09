import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  albumReadProtectionCapability,
  configuration,
  deliveryZipCapability,
  type WorkerEnv,
} from './config';
import { readGuestSessionSecret, GuestAccessDenied } from './guest-access';
import { WorkspaceFailure } from './workspaces';
import { D1DeliveryZips, type ZipFile } from './delivery-zips';
import { protectAlbumRead } from './album-read-protections';
import { boundAssetStream } from './bounded-asset-stream';
import { storageBucketForNode } from './private-storage';
import { clientActivityIp } from './client-ip';
import { streamZip } from './zip-stream';

type Env = { Bindings: WorkerEnv };
const router = new Hono<Env>();
const base = '/api/guest/albums/:albumId/delivery-zips';
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Vary: 'Cookie',
};
function secret(c: Context<Env>) {
  return readGuestSessionSecret(
    c.req.header('Cookie'),
    configuration(c.env).origin.startsWith('https:'),
  );
}
function enabled(c: Context<Env>) {
  if (!deliveryZipCapability(c.env))
    throw new WorkspaceFailure('DELIVERY_ZIP_DISABLED', 503);
}
function failure(error: unknown) {
  const status =
    error instanceof GuestAccessDenied
      ? 401
      : error instanceof z.ZodError
        ? 400
        : error instanceof WorkspaceFailure
          ? error.status
          : 503;
  return Response.json(
    {
      error: {
        code:
          error instanceof GuestAccessDenied
            ? 'GUEST_ACCESS_REQUIRED'
            : error instanceof WorkspaceFailure
              ? error.code
              : error instanceof z.ZodError
                ? 'INVALID_INPUT'
                : 'ZIP_UNAVAILABLE',
      },
    },
    { status, headers },
  );
}
router.get('/api/guest/delivery-zips/capabilities', (c) =>
  Response.json({ enabled: deliveryZipCapability(c.env) }, { headers }),
);
router.use(
  base,
  bodyLimit({
    maxSize: 16384,
    onError: () =>
      Response.json(
        { error: { code: 'BODY_TOO_LARGE' } },
        { status: 413, headers },
      ),
  }),
);
router.post(base, async (c) => {
  try {
    enabled(c);
    if (
      new URL(c.req.url).search ||
      c.req.header('Origin') !== configuration(c.env).origin
    )
      throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
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
    const result = await new D1DeliveryZips(c.env.DB).create(
      secret(c),
      z.uuid().parse(c.req.param('albumId')),
      input,
    );
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
});
router.get(base + '/:zipId', async (c) => {
  try {
    enabled(c);
    if (new URL(c.req.url).search)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    return Response.json(
      await new D1DeliveryZips(c.env.DB).read(
        secret(c),
        z.uuid().parse(c.req.param('albumId')),
        z.uuid().parse(c.req.param('zipId')),
      ),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
});
router.get(base + '/:zipId/download', async (c) => {
  try {
    enabled(c);
    if (c.req.method !== 'GET')
      return Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED' } },
        { status: 405, headers },
      );
    const params = new URL(c.req.url).searchParams;
    if (
      [...params.keys()].some((key) => key !== 'requestId') ||
      params.getAll('requestId').length !== 1
    )
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const requestId = z.uuid().parse(params.get('requestId')),
      key = secret(c),
      repo = new D1DeliveryZips(c.env.DB),
      ticket = await repo.ticket(
        key,
        z.uuid().parse(c.req.param('albumId')),
        z.uuid().parse(c.req.param('zipId')),
      );
    const readScope = {
      workspace_id: ticket.workspace_id,
      project_id: ticket.project_id,
      album_id: ticket.album_id,
    };
    const ip = clientActivityIp(
      c.req.raw,
      configuration(c.env).APP_ENV === 'local',
    );
    await repo.audit(ticket, requestId, ip, false);
    await protectAlbumRead(c.env, readScope);
    const sources: Array<ZipFile & { etag: string }> = [];
    // Preflight every immutable original before the first archive byte is sent.
    for (const item of ticket.contents.items) {
      const source = await repo.source(ticket, item),
        store = storageBucketForNode(c.env, source.storage_node_id),
        head = await store.head(source.object_key);
      const checksum = head?.checksums.sha256
        ? Array.from(new Uint8Array(head.checksums.sha256), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('')
        : null;
      if (
        !head ||
        head.size !== item.byteSize ||
        head.httpMetadata?.contentType !== item.mime ||
        checksum !== item.sha256
      )
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      sources.push({ ...source, etag: head.etag });
    }
    if (albumReadProtectionCapability(c.env))
      await repo.ticket(key, ticket.album_id, ticket.ticket_id);
    const deadline = await protectAlbumRead(c.env, readScope);
    const body = streamZip(
      ticket.contents.items,
      async (item) => {
        await repo.ticket(key, ticket.album_id, ticket.ticket_id);
        await protectAlbumRead(c.env, readScope);
        const expected = sources.find(
          (candidate) => candidate.deliveryId === item.deliveryId,
        )!;
        const object = await storageBucketForNode(
          c.env,
          expected.storage_node_id,
        ).get(expected.object_key, { onlyIf: { etagMatches: expected.etag } });
        if (!object || !('body' in object) || object.etag !== expected.etag)
          throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
        return object.body;
      },
      async () => {
        await repo.ticket(key, ticket.album_id, ticket.ticket_id);
        await repo.audit(ticket, requestId, ip, true);
      },
    );
    return new Response(boundAssetStream(body, deadline), {
      headers: {
        ...headers,
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="Kino-Pick.zip"',
      },
    });
  } catch (error) {
    return failure(error);
  }
});
export { router as deliveryZipRoutes };
