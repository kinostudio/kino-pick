import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  approvedDeliveriesCapability,
  configuration,
  type WorkerEnv,
} from './config';
import { D1ApprovedDeliveries } from './approved-deliveries';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';
import { R2StorageAdapter } from './r2-storage';
import { storageBucketForNode } from './private-storage';
import { clientActivityIp } from './client-ip';
import { logUnhandledRouteError } from './diagnostic-log';
type Env = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
const router = new Hono<Env>();
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Vary: 'Cookie',
};
const publish =
  '/api/v1/albums/:albumId/photos/:photoId/version-approvals/:approvalId/delivery';
const revoke = '/api/v1/albums/:albumId/deliveries/:deliveryId/revoke';
for (const path of [publish, revoke])
  router.use(
    path,
    bodyLimit({
      maxSize: 16384,
      onError: () =>
        Response.json(
          { error: { code: 'BODY_TOO_LARGE' } },
          { status: 413, headers },
        ),
    }),
  );
function enabled(c: Context<Env>) {
  if (!approvedDeliveriesCapability(c.env))
    throw new WorkspaceFailure('DELIVERIES_DISABLED', 503);
}
function noQuery(c: Context<Env>) {
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
function listQuery(c: Context<Env>, owner: boolean) {
  const params = new URL(c.req.url).searchParams;
  const allowed = owner ? ['cursor', 'approvalId'] : ['cursor'];
  if (
    [...params.keys()].some(
      (key) => !allowed.includes(key) || params.getAll(key).length !== 1,
    )
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return {
    cursor: params.has('cursor')
      ? z.uuid().parse(params.get('cursor'))
      : undefined,
    approvalId: params.has('approvalId')
      ? z.uuid().parse(params.get('approvalId'))
      : undefined,
  };
}
function secret(c: Context<Env>) {
  return readGuestSessionSecret(
    c.req.header('Cookie'),
    configuration(c.env).origin.startsWith('https:'),
  );
}
function mutation(c: Context<Env>) {
  noQuery(c);
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
function failure(error: unknown) {
  if (
    !(error instanceof GuestAccessDenied) &&
    !(error instanceof z.ZodError) &&
    !(error instanceof WorkspaceFailure)
  )
    logUnhandledRouteError('approved-deliveries', error);
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
          : 'DELIVERY_UNAVAILABLE';
  return Response.json({ error: { code } }, { status, headers });
}
async function body(c: Context<Env>): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
}
async function guarded(c: Context<Env>, run: () => Promise<unknown>) {
  try {
    enabled(c);
    return Response.json(await run(), { headers });
  } catch (error) {
    return failure(error);
  }
}
for (const path of [
  '/api/v1/deliveries/capabilities',
  '/api/guest/deliveries/capabilities',
])
  router.get(path, (c) => {
    try {
      noQuery(c);
      return Response.json(
        { enabled: approvedDeliveriesCapability(c.env) },
        { headers },
      );
    } catch (error) {
      return failure(error);
    }
  });
router.get('/api/v1/albums/:albumId/photos/:photoId/deliveries', (c) =>
  guarded(c, async () => {
    const query = listQuery(c, true);
    return new D1ApprovedDeliveries(c.env.DB).ownerList(
      c.get('ownerId'),
      c.get('sessionId'),
      c.req.param('albumId'),
      c.req.param('photoId'),
      query.approvalId,
      query.cursor,
    );
  }),
);
router.post(publish, (c) =>
  guarded(c, async () => {
    mutation(c);
    return new D1ApprovedDeliveries(c.env.DB).publish(
      c.get('ownerId'),
      c.get('sessionId'),
      c.req.param('albumId'),
      c.req.param('photoId'),
      c.req.param('approvalId'),
      await body(c),
    );
  }),
);
router.post(revoke, (c) =>
  guarded(c, async () => {
    mutation(c);
    return new D1ApprovedDeliveries(c.env.DB).revoke(
      c.get('ownerId'),
      c.get('sessionId'),
      c.req.param('albumId'),
      c.req.param('deliveryId'),
      await body(c),
    );
  }),
);
router.get('/api/guest/albums/:albumId/deliveries', (c) =>
  guarded(c, async () => {
    const query = listQuery(c, false);
    return new D1ApprovedDeliveries(c.env.DB).guestList(
      secret(c),
      c.req.param('albumId'),
      query.cursor,
    );
  }),
);
router.get(
  '/api/guest/albums/:albumId/deliveries/:deliveryId/assets/:assetId/download',
  async (c) => {
    let object: R2ObjectBody | null = null;
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
      const requestId = z.uuid().parse(params.get('requestId'));
      const repository = new D1ApprovedDeliveries(c.env.DB);
      const file = await repository.requested(
        secret(c),
        c.req.param('albumId'),
        c.req.param('deliveryId'),
        c.req.param('assetId'),
        requestId,
        clientActivityIp(c.req.raw, configuration(c.env).APP_ENV === 'local'),
      );
      const store = new R2StorageAdapter(
        storageBucketForNode(c.env, file.storage_node_id),
        file.storage_node_id,
      );
      object = await store.open(
        {
          workspaceId: file.workspace_id,
          projectId: file.project_id,
          albumId: file.album_id,
        },
        file.object_key,
      );
      const checksum = object.checksums.sha256
        ? Array.from(new Uint8Array(object.checksums.sha256), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('')
        : null;
      if (
        object.size !== file.byte_size ||
        object.httpMetadata?.contentType !== file.mime ||
        checksum !== file.checksum_sha256
      )
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      await repository.generated(file);
      const encoded = encodeURIComponent(file.filename).replace(
        /['()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
      );
      // Generated means authorized and ready to stream, not proof the client saved every byte.
      return new Response(object.body, {
        headers: {
          ...headers,
          'Content-Type': file.mime,
          'Content-Length': String(object.size),
          'Content-Disposition': `attachment; filename="Kino-Pick.${file.mime === 'image/png' ? 'png' : file.mime === 'image/webp' ? 'webp' : 'jpg'}"; filename*=UTF-8''${encoded}`,
        },
      });
    } catch (error) {
      if (object) await object.body.cancel().catch(() => undefined);
      return failure(error);
    }
  },
);
export { router as approvedDeliveryRoutes };
