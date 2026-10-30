import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  configuration,
  versionApprovalsCapability,
  type WorkerEnv,
} from './config';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';
import {
  D1OwnerVersionApprovals,
  D1GuestVersionApprovals,
} from './version-approvals';

type ApprovalEnv = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
const router = new Hono<ApprovalEnv>();
const ownerBase =
  '/api/v1/albums/:albumId/photos/:photoId/version-approvals' as const;
const guestBase =
  '/api/guest/albums/:albumId/photos/:photoId/version-approvals' as const;
const guestConfirm =
  '/api/guest/albums/:albumId/photos/:photoId/version-approvals/:approvalId/confirm' as const;
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
};
for (const path of [ownerBase, guestConfirm])
  router.use(
    path,
    bodyLimit({
      maxSize: 16384,
      onError: () =>
        Response.json(
          { error: { code: 'BODY_TOO_LARGE' } },
          { status: 413, headers: privateHeaders },
        ),
    }),
  );
function enabled(c: Context<ApprovalEnv>) {
  if (!versionApprovalsCapability(c.env))
    throw new WorkspaceFailure('VERSION_APPROVALS_DISABLED', 503);
}
function cursor(c: Context<ApprovalEnv>): string | null {
  const entries = new URL(c.req.url).searchParams;
  if (
    [...entries.keys()].some(
      (key) => key !== 'cursor' || entries.getAll(key).length !== 1,
    )
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  const value = entries.get('cursor');
  return value === null ? null : z.uuid().parse(value).toLowerCase();
}
function mutation(c: Context<ApprovalEnv>) {
  if (new URL(c.req.url).search)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
}
async function body(c: Context<ApprovalEnv>): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
}
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
  return Response.json(
    { error: { code: 'VERSION_APPROVALS_UNAVAILABLE' } },
    { status: 503, headers: privateHeaders },
  );
}
async function guarded(run: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await run(), { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
function secret(c: Context<ApprovalEnv>) {
  return readGuestSessionSecret(
    c.req.header('Cookie'),
    configuration(c.env).origin.startsWith('https:'),
  );
}
function capability(c: Context<ApprovalEnv>) {
  if (new URL(c.req.url).search)
    return Response.json(
      { error: { code: 'INVALID_INPUT' } },
      { status: 400, headers: privateHeaders },
    );
  return Response.json(
    { enabled: versionApprovalsCapability(c.env) },
    { headers: privateHeaders },
  );
}
router.get('/api/v1/version-approvals/capabilities', capability);
router.get('/api/guest/version-approvals/capabilities', capability);
router.get(ownerBase, (c) =>
  guarded(async () => {
    enabled(c);
    return new D1OwnerVersionApprovals(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).list(c.req.param('albumId'), c.req.param('photoId'), cursor(c));
  }),
);
router.post(ownerBase, (c) =>
  guarded(async () => {
    enabled(c);
    mutation(c);
    return new D1OwnerVersionApprovals(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).create(c.req.param('albumId'), c.req.param('photoId'), await body(c));
  }),
);
router.get(guestBase, (c) =>
  guarded(async () => {
    enabled(c);
    return new D1GuestVersionApprovals(c.env.DB).list(
      secret(c),
      c.req.param('albumId'),
      c.req.param('photoId'),
      cursor(c),
    );
  }),
);
router.post(guestConfirm, (c) =>
  guarded(async () => {
    enabled(c);
    mutation(c);
    return new D1GuestVersionApprovals(c.env.DB).confirm(
      secret(c),
      c.req.param('albumId'),
      c.req.param('photoId'),
      c.req.param('approvalId'),
      await body(c),
    );
  }),
);
export { router as versionApprovalRoutes };
