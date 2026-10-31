import type { MiddlewareHandler } from 'hono';
import type { WorkerEnv } from './config';
import {
  STAGING_GUEST_SCOPE as scope,
  stagingGuestValidationEnabled,
} from './staging-guest-scope';
import {
  D1GuestAccessResolver,
  GuestAccessDenied,
  hashGuestSessionSecret,
  readGuestSessionSecret,
} from './guest-access';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const capabilities = new Set([
  '/api/guest/capabilities',
  '/api/guest/version-comparison/capabilities',
  '/api/guest/comments/capabilities',
  '/api/guest/history/capabilities',
  '/api/guest/tags/capabilities',
  '/api/guest/feedback/capabilities',
  '/api/guest/annotations/capabilities',
  '/api/guest/annotations/freehand-capabilities',
  '/api/guest/shared-reviews/capabilities',
  '/api/guest/version-approvals/capabilities',
]);
const assetPath = new RegExp(
  `^/api/guest/photos/(${uuid})/versions/(${uuid})/assets/(thumbnail|preview)$`,
);
const selectionPath = new RegExp(
  `^/api/guest/albums/${scope.albumId}/photos/(${uuid})/selection$`,
);

type ScopeEnvironment = { Bindings: WorkerEnv };
/** Extra validation boundary, never a replacement for the product's live ACL. */
export const stagingGuestApiScope: MiddlewareHandler<ScopeEnvironment> = async (
  c,
  next,
) => {
  if (c.env.STAGING_GUEST_VALIDATION !== 'true') return next();
  if (!stagingGuestValidationEnabled(c.env))
    return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const read = method === 'GET' || method === 'HEAD';
  const denied = () => c.json({ error: { code: 'NOT_FOUND' } }, 404);
  if (path.includes('%')) return denied();
  if (read && capabilities.has(path)) return next();
  if (method === 'POST' && path === '/api/guest/exchange') return next();
  try {
    if (method === 'POST' && path === '/api/guest/logout') {
      const secret = readGuestSessionSecret(c.req.header('Cookie'), true);
      if (secret) {
        const session = await c.env.DB.prepare(
          `SELECT i.workspace_id,i.project_id,
          (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id) AS albums,
          (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.album_id=?) AS scoped_albums
          FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id WHERE s.secret_hash=?`,
        )
          .bind(scope.albumId, await hashGuestSessionSecret(secret))
          .first<{
            workspace_id: string;
            project_id: string;
            albums: number;
            scoped_albums: number;
          }>();
        if (
          session &&
          (session.workspace_id !== scope.workspaceId ||
            session.project_id !== scope.projectId ||
            session.albums !== 1 ||
            session.scoped_albums !== 1)
        )
          return denied();
      }
      // Missing/expired/revoked own cookie may still be cleared by the real logout service.
      return next();
    }
    const albumRoot = '/api/guest/albums/' + scope.albumId;
    if (
      read &&
      ['/access', '/photos', '/selection'].some(
        (suffix) => path === albumRoot + suffix,
      )
    )
      return next();
    if (method === 'POST' && path === albumRoot + '/selection/submit')
      return next();
    if (method === 'PUT' && selectionPath.test(path)) return next();
    const asset = read ? assetPath.exec(path) : null;
    if (asset) {
      // Authenticate first so unauthenticated callers cannot probe photo membership.
      const secret = readGuestSessionSecret(c.req.header('Cookie'), true);
      await new D1GuestAccessResolver(c.env.DB).album(
        secret,
        scope.albumId,
        'can_view',
      );
      const row = await c.env.DB.prepare(
        `SELECT 1 FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id
        WHERE p.id=? AND v.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=?`,
      )
        .bind(
          asset[1],
          asset[2],
          scope.workspaceId,
          scope.projectId,
          scope.albumId,
        )
        .first();
      if (!row) return denied();
      return next();
    }
    return denied();
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
  }
};

/** Existing Owner authentication runs first; only newly promoted collaboration scope is narrowed. */
export const stagingOwnerSelectionScope: MiddlewareHandler<
  ScopeEnvironment
> = async (c, next) => {
  if (c.env.STAGING_GUEST_VALIDATION !== 'true') return next();
  if (!stagingGuestValidationEnabled(c.env))
    return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
  const path = new URL(c.req.url).pathname;
  const denied = () => c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const project =
    /^\/api\/v1\/projects\/([^/]+)\/(invites|selection-policy-configuration)(?:\/|$)/.exec(
      path,
    );
  if (project && project[1] !== scope.projectId) return denied();
  const album =
    /^\/api\/v1\/albums\/([^/]+)\/(selection-policy(?:-configuration)?|submissions|rounds|activate|activation-capabilities)(?:\/|$)/.exec(
      path,
    );
  if (album && album[1] !== scope.albumId) return denied();
  const recovery = /^\/api\/v1\/invites\/creation\/([^/]+)$/.exec(path);
  const revoke = /^\/api\/v1\/invites\/([^/]+)\/revoke$/.exec(path);
  if (recovery || revoke) {
    try {
      const row = recovery
        ? await c.env.DB.prepare(
            'SELECT 1 FROM invite_creation_commands c JOIN guest_invites i ON i.id=c.invite_id WHERE c.request_id=? AND i.workspace_id=? AND i.project_id=? AND (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id)=1 AND EXISTS(SELECT 1 FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.album_id=?)',
          )
            .bind(
              recovery[1],
              scope.workspaceId,
              scope.projectId,
              scope.albumId,
            )
            .first()
        : await c.env.DB.prepare(
            'SELECT 1 FROM guest_invites i WHERE id=? AND workspace_id=? AND project_id=? AND (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id)=1 AND EXISTS(SELECT 1 FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.album_id=?)',
          )
            .bind(
              revoke?.[1],
              scope.workspaceId,
              scope.projectId,
              scope.albumId,
            )
            .first();
      if (!row) return denied();
    } catch {
      return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
    }
  }
  return next();
};
