import type { MiddlewareHandler } from 'hono';
import type { WorkerEnv } from './config';
import {
  STAGING_GUEST_SCOPE as scope,
  stagingCollaborationValidationEnabled,
} from './staging-guest-scope';
import {
  D1GuestAccessResolver,
  GuestAccessDenied,
  hashGuestSessionSecret,
  readGuestSessionSecret,
} from './guest-access';

type ScopeEnvironment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};

const uuid =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const albumRoot = '/api/guest/albums/' + scope.albumId;
const ownerAlbumRoot = '/api/v1/albums/' + scope.albumId;
const ownerProjectRoot = '/api/v1/projects/' + scope.projectId;
const ownerWorkspaceRoot = '/api/v1/workspaces/' + scope.workspaceId;
const guestCapabilityPaths = new Set([
  '/api/guest/capabilities',
  '/api/guest/version-comparison/capabilities',
  '/api/guest/comments/capabilities',
  '/api/guest/history/capabilities',
  '/api/guest/tags/capabilities',
  '/api/guest/feedback/capabilities',
  '/api/guest/annotations/capabilities',
  '/api/guest/annotations/freehand-capabilities',
]);
const ownerCapabilityPaths = new Set([
  '/api/v1/invites/capabilities',
  '/api/v1/photo-versions/capabilities',
  '/api/v1/version-uploads/capabilities',
  '/api/v1/versioning/capabilities',
  '/api/v1/comments/capabilities',
  '/api/v1/comment-processing/capabilities',
  '/api/v1/annotations/capabilities',
  '/api/v1/annotations/authoring/capabilities',
  '/api/v1/annotations/authoring/freehand-capabilities',
  '/api/v1/annotation-processing/capabilities',
  '/api/v1/owner-history/capabilities',
  '/api/v1/photographer-recommendations/capabilities',
  '/api/v1/photo-pins/capabilities',
]);

function isRead(method: string) {
  return method === 'GET' || method === 'HEAD';
}

function match(
  method: string,
  path: string,
  allowed: string[],
  pattern: RegExp,
) {
  return allowed.includes(method) && pattern.test(path);
}

/** Exact Guest route allowlist for the separate collaboration validation profile. */
export function stagingCollaborationGuestRequestAllowed(
  method: string,
  path: string,
): boolean {
  if (isRead(method) && guestCapabilityPaths.has(path)) return true;
  if (
    method === 'POST' &&
    ['/api/guest/exchange', '/api/guest/logout'].includes(path)
  )
    return true;

  const routes: Array<[string[], RegExp]> = [
    [['GET', 'HEAD'], new RegExp('^' + albumRoot + '/access$')],
    [['GET', 'HEAD'], new RegExp('^' + albumRoot + '/photos$')],
    [['GET', 'HEAD'], new RegExp('^' + albumRoot + '/selection$')],
    [['POST'], new RegExp('^' + albumRoot + '/selection/submit$')],
    [
      ['PUT'],
      new RegExp('^' + albumRoot + '/photos/(' + uuid + ')/selection$'),
    ],
    [
      ['GET', 'HEAD'],
      new RegExp('^' + albumRoot + '/photos/(' + uuid + ')/versions$'),
    ],
    [
      ['GET', 'HEAD'],
      new RegExp(
        '^' +
          albumRoot +
          '/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/comments$',
      ),
    ],
    [['POST'], new RegExp('^' + albumRoot + '/comments/commands$')],
    [['GET'], /^\/api\/guest\/me\/activity$/],
    [['GET', 'HEAD'], new RegExp('^' + albumRoot + '/tags$')],
    [['PUT'], new RegExp('^' + albumRoot + '/photos/(' + uuid + ')/tags$')],
    [['GET', 'HEAD'], new RegExp('^' + albumRoot + '/ratings$')],
    [['GET', 'HEAD'], new RegExp('^' + albumRoot + '/favorites$')],
    [
      ['PUT'],
      new RegExp('^' + albumRoot + '/photos/(' + uuid + ')/(rating|favorite)$'),
    ],
    [
      ['GET', 'HEAD'],
      new RegExp(
        '^' +
          albumRoot +
          '/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/annotations/(own|shared)$',
      ),
    ],
    [['POST'], new RegExp('^' + albumRoot + '/annotations/commands$')],
    [['GET'], new RegExp('^' + albumRoot + '/downloads$')],
    [
      ['GET'],
      new RegExp(
        '^/api/guest/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/downloads/(preview|original)$',
      ),
    ],
    [
      ['GET', 'HEAD'],
      new RegExp(
        '^/api/guest/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/assets/(thumbnail|preview)$',
      ),
    ],
  ];
  return routes.some(([methods, pattern]) =>
    match(method, path, methods, pattern),
  );
}

/** Exact Owner route allowlist; Owner identity is checked earlier by index.ts. */
export function stagingCollaborationOwnerRequestAllowed(
  method: string,
  path: string,
): boolean {
  if (isRead(method) && ownerCapabilityPaths.has(path)) return true;
  const routes: Array<[string[], RegExp]> = [
    [['GET'], /^\/api\/v1\/me$/],
    [['GET'], /^\/api\/v1\/workspaces$/],
    [['GET'], /^\/api\/v1\/projects$/],
    [['GET'], new RegExp('^' + ownerProjectRoot + '$')],
    [['GET'], new RegExp('^' + ownerProjectRoot + '/albums$')],
    [['GET', 'POST'], new RegExp('^' + ownerProjectRoot + '/invites$')],
    [['GET'], new RegExp('^/api/v1/invites/creation/(' + uuid + ')$')],
    [['POST'], new RegExp('^/api/v1/invites/(' + uuid + ')/revoke$')],
    [['GET'], new RegExp('^' + ownerWorkspaceRoot + '/upload-capabilities$')],
    [['GET'], /^\/api\/v1\/uploads\/capabilities$/],
    [['POST'], /^\/api\/v1\/uploads\/init$/],
    [['GET'], new RegExp('^/api/v1/uploads/recovery/(' + uuid + ')$')],
    [['GET'], new RegExp('^/api/v1/uploads/(' + uuid + ')$')],
    [
      ['POST'],
      new RegExp(
        '^/api/v1/uploads/(' + uuid + ')/(authorize|complete|cancel)$',
      ),
    ],
    [['GET'], new RegExp('^' + ownerAlbumRoot + '/photos$')],
    [['GET'], new RegExp('^' + ownerAlbumRoot + '/activation-capabilities$')],
    [['POST'], new RegExp('^' + ownerAlbumRoot + '/activate$')],
    [['GET', 'PUT'], new RegExp('^' + ownerAlbumRoot + '/selection-policy$')],
    [
      ['GET', 'PUT'],
      new RegExp('^' + ownerAlbumRoot + '/selection-policy-configuration$'),
    ],
    [['GET'], new RegExp('^' + ownerAlbumRoot + '/submissions$')],
    [
      ['GET'],
      new RegExp('^' + ownerAlbumRoot + '/submissions/(' + uuid + ')$'),
    ],
    [
      ['GET'],
      new RegExp('^' + ownerAlbumRoot + '/submissions/(' + uuid + ')/export$'),
    ],
    [
      ['GET', 'PUT'],
      new RegExp('^' + ownerProjectRoot + '/selection-policy-configuration$'),
    ],
    [['GET'], new RegExp('^/api/v1/photos/(' + uuid + ')/versions$')],
    [
      ['POST'],
      new RegExp('^/api/v1/photos/(' + uuid + ')/versions/set-current$'),
    ],
    [
      ['GET'],
      new RegExp(
        '^/api/v1/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/assets/(thumbnail|preview|original)$',
      ),
    ],
    [['POST'], new RegExp('^/api/v1/photos/(' + uuid + ')/versions/init$')],
    [
      ['GET'],
      new RegExp('^/api/v1/photos/(' + uuid + ')/versions/uploads/recovery$'),
    ],
    [
      ['POST'],
      new RegExp(
        '^/api/v1/photos/(' + uuid + ')/versions/(' + uuid + ')/complete$',
      ),
    ],
    [['GET'], new RegExp('^' + ownerProjectRoot + '/versioning$')],
    [['PUT'], new RegExp('^' + ownerProjectRoot + '/versioning$')],
    [
      ['GET'],
      new RegExp(
        '^' +
          ownerAlbumRoot +
          '/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/comment-threads$',
      ),
    ],
    [['POST'], new RegExp('^' + ownerAlbumRoot + '/comment-replies/commands$')],
    [
      ['POST'],
      new RegExp('^' + ownerAlbumRoot + '/comment-processing/commands$'),
    ],
    [
      ['GET'],
      new RegExp(
        '^' +
          ownerAlbumRoot +
          '/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/annotations$',
      ),
    ],
    [
      ['GET'],
      new RegExp(
        '^' +
          ownerAlbumRoot +
          '/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/annotations/owner$',
      ),
    ],
    [
      ['POST'],
      new RegExp('^' + ownerAlbumRoot + '/annotations/owner/commands$'),
    ],
    [
      ['POST'],
      new RegExp('^' + ownerAlbumRoot + '/annotation-processing/commands$'),
    ],
    [['GET'], new RegExp('^' + ownerWorkspaceRoot + '/history$')],
    [['POST'], new RegExp('^' + ownerWorkspaceRoot + '/history/export$')],
    [
      ['GET', 'PUT'],
      new RegExp('^' + ownerAlbumRoot + '/photographer-recommendations$'),
    ],
    [
      ['GET', 'PUT'],
      new RegExp('^/api/v1/photos/(' + uuid + ')/photographer-metadata$'),
    ],
    [['PUT'], new RegExp('^/api/v1/photos/(' + uuid + ')/pin$')],
    [
      ['POST'],
      new RegExp(
        '^/api/v1/photos/(' + uuid + ')/photographer-metadata/import$',
      ),
    ],
  ];
  return routes.some(([methods, pattern]) =>
    match(method, path, methods, pattern),
  );
}

async function onlyScopeRow(
  db: D1Database,
  countSql: string,
  countBindings: unknown[],
  targetSql: string,
  targetBindings: unknown[],
): Promise<boolean> {
  const count = await db
    .prepare(countSql)
    .bind(...countBindings)
    .first<{ n: number }>();
  const target = await db
    .prepare(targetSql)
    .bind(...targetBindings)
    .first();
  return Number(count?.n) === 1 && !!target;
}

async function ownerWorkspaceScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
) {
  return onlyScopeRow(
    c.env.DB,
    'SELECT count(*) AS n FROM workspaces WHERE owner_user_id=?',
    [c.get('ownerId')],
    'SELECT 1 FROM workspaces WHERE id=? AND owner_user_id=?',
    [scope.workspaceId, c.get('ownerId')],
  );
}

async function ownerProjectScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
) {
  if (!(await ownerWorkspaceScope(c))) return false;
  return onlyScopeRow(
    c.env.DB,
    'SELECT count(*) AS n FROM projects WHERE workspace_id=?',
    [scope.workspaceId],
    "SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND status NOT IN('archived','deleting','deleted')",
    [scope.projectId, scope.workspaceId],
  );
}

async function ownerAlbumScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
) {
  if (!(await ownerProjectScope(c))) return false;
  return onlyScopeRow(
    c.env.DB,
    'SELECT count(*) AS n FROM albums WHERE workspace_id=? AND project_id=?',
    [scope.workspaceId, scope.projectId],
    "SELECT 1 FROM albums WHERE id=? AND workspace_id=? AND project_id=? AND state NOT IN('archived','deleting','deleted')",
    [scope.albumId, scope.workspaceId, scope.projectId],
  );
}

async function ownerPhotoScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  photoId: string,
  versionId?: string,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c))) return false;
  const row = versionId
    ? await c.env.DB.prepare(
        'SELECT 1 FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id WHERE p.id=? AND v.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=?',
      )
        .bind(
          photoId,
          versionId,
          scope.workspaceId,
          scope.projectId,
          scope.albumId,
        )
        .first()
    : await c.env.DB.prepare(
        'SELECT 1 FROM photos p WHERE p.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=?',
      )
        .bind(photoId, scope.workspaceId, scope.projectId, scope.albumId)
        .first();
  return !!row;
}

async function ownerInviteRecoveryScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  requestId: string,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM invite_creation_commands c JOIN guest_invites i ON i.id=c.invite_id WHERE c.actor_id=? AND c.request_id=? AND i.workspace_id=? AND i.project_id=? AND (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id)=1 AND EXISTS(SELECT 1 FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.workspace_id=? AND a.project_id=? AND a.album_id=?)',
  )
    .bind(
      c.get('ownerId'),
      requestId,
      scope.workspaceId,
      scope.projectId,
      scope.workspaceId,
      scope.projectId,
      scope.albumId,
    )
    .first();
  return !!row;
}

async function ownerUploadRecoveryScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  requestId: string,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c))) return false;
  const row = await c.env.DB.prepare(
    "SELECT 1 FROM upload_requests r JOIN upload_sessions u ON u.id=r.upload_session_id WHERE r.actor_id=? AND r.request_id=? AND r.operation='upload.reserved' AND u.actor_id=? AND u.workspace_id=? AND u.project_id=? AND u.album_id=? AND NOT EXISTS(SELECT 1 FROM upload_version_targets t WHERE t.upload_session_id=u.id)",
  )
    .bind(
      c.get('ownerId'),
      requestId,
      c.get('ownerId'),
      scope.workspaceId,
      scope.projectId,
      scope.albumId,
    )
    .first();
  return !!row;
}

async function ownerInviteScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  inviteId: string,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM guest_invites i WHERE i.id=? AND i.workspace_id=? AND i.project_id=? AND (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id)=1 AND EXISTS(SELECT 1 FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.workspace_id=? AND a.project_id=? AND a.album_id=?)',
  )
    .bind(
      inviteId,
      scope.workspaceId,
      scope.projectId,
      scope.workspaceId,
      scope.projectId,
      scope.albumId,
    )
    .first();
  return !!row;
}

async function ownerVersionUploadScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  photoId: string,
  uploadSessionId: string,
): Promise<boolean> {
  if (!(await ownerPhotoScope(c, photoId))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM upload_sessions u JOIN upload_version_targets t ON t.upload_session_id=u.id WHERE u.id=? AND t.photo_id=? AND u.workspace_id=? AND u.project_id=? AND u.album_id=?',
  )
    .bind(
      uploadSessionId,
      photoId,
      scope.workspaceId,
      scope.projectId,
      scope.albumId,
    )
    .first();
  return !!row;
}

async function ownerUploadScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  uploadSessionId: string,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM upload_sessions WHERE id=? AND workspace_id=? AND project_id=? AND album_id=?',
  )
    .bind(uploadSessionId, scope.workspaceId, scope.projectId, scope.albumId)
    .first();
  return !!row;
}

function queryKeysAreOnly(url: URL, allowed: string[]) {
  const keys = [...url.searchParams.keys()];
  return (
    keys.every((key) => allowed.includes(key)) &&
    new Set(keys).size === keys.length
  );
}

async function ownerBodyTargetsSyntheticAlbum(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
) {
  try {
    const body = (await c.req.raw.clone().json()) as Record<string, unknown>;
    return (
      body.workspaceId === scope.workspaceId &&
      body.projectId === scope.projectId &&
      body.albumId === scope.albumId
    );
  } catch {
    return false;
  }
}

export const stagingCollaborationGuestApiScope: MiddlewareHandler<
  ScopeEnvironment
> = async (c, next) => {
  if (c.env.STAGING_COLLABORATION_VALIDATION !== 'true') return next();
  if (!stagingCollaborationValidationEnabled(c.env))
    return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
  const path = new URL(c.req.url).pathname;
  if (
    path.includes('%') ||
    !stagingCollaborationGuestRequestAllowed(c.req.method, path)
  )
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);

  if (c.req.method === 'POST' && path === '/api/guest/logout') {
    try {
      const secret = readGuestSessionSecret(c.req.header('Cookie'), true);
      if (secret) {
        const session = await c.env.DB.prepare(
          'SELECT i.workspace_id,i.project_id,(SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id) AS albums,(SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.album_id=?) AS scoped_albums FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id WHERE s.secret_hash=?',
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
          return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      }
    } catch {
      return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
    }
  }

  const asset = new RegExp(
    '^/api/guest/photos/(' +
      uuid +
      ')/versions/(' +
      uuid +
      ')/assets/(thumbnail|preview)$',
  ).exec(path);
  const download = new RegExp(
    '^/api/guest/photos/(' +
      uuid +
      ')/versions/(' +
      uuid +
      ')/downloads/(preview|original)$',
  ).exec(path);
  if (asset || download) {
    try {
      const secret = readGuestSessionSecret(c.req.header('Cookie'), true);
      await new D1GuestAccessResolver(c.env.DB).album(
        secret,
        scope.albumId,
        'can_view',
      );
      const row = await c.env.DB.prepare(
        'SELECT 1 FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id WHERE p.id=? AND v.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=?',
      )
        .bind(
          asset?.[1] ?? download?.[1],
          asset?.[2] ?? download?.[2],
          scope.workspaceId,
          scope.projectId,
          scope.albumId,
        )
        .first();
      if (!row) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } catch (error) {
      if (error instanceof GuestAccessDenied)
        return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
      return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
    }
  }
  return next();
};

export const stagingCollaborationOwnerScope: MiddlewareHandler<
  ScopeEnvironment
> = async (c, next) => {
  if (c.env.STAGING_COLLABORATION_VALIDATION !== 'true') return next();
  if (!stagingCollaborationValidationEnabled(c.env))
    return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
  const url = new URL(c.req.url);
  const path = url.pathname;
  if (
    path.includes('%') ||
    !stagingCollaborationOwnerRequestAllowed(c.req.method, path)
  )
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);

  try {
    if (path === '/api/v1/workspaces') {
      if (!queryKeysAreOnly(url, ['cursor']) || !(await ownerWorkspaceScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path === '/api/v1/projects') {
      if (
        !queryKeysAreOnly(url, ['workspaceId', 'cursor']) ||
        url.searchParams.getAll('workspaceId').length !== 1 ||
        url.searchParams.get('workspaceId') !== scope.workspaceId ||
        !(await ownerProjectScope(c))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path.startsWith(ownerProjectRoot)) {
      if (!(await ownerProjectScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      if (path === ownerProjectRoot + '/albums' && !(await ownerAlbumScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path.startsWith(ownerAlbumRoot)) {
      if (!(await ownerAlbumScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path.startsWith(ownerWorkspaceRoot)) {
      if (!(await ownerWorkspaceScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    }

    const photoVersion = new RegExp(
      '^/api/v1/(?:albums/' +
        scope.albumId +
        '/photos/(' +
        uuid +
        ')/versions/(' +
        uuid +
        ')/(?:comment-threads|annotations(?:/owner)?)|photos/(' +
        uuid +
        ')/versions/(' +
        uuid +
        ')/assets/(?:thumbnail|preview|original))$',
    ).exec(path);
    const photoOnly = new RegExp(
      '^/api/v1/photos/(' +
        uuid +
        ')/(?:pin|versions(?:/set-current|/init|/uploads/recovery)?|versions/(' +
        uuid +
        ')/complete|photographer-metadata(?:/import)?)$',
    ).exec(path);
    if (photoVersion) {
      const photoId = photoVersion[1] ?? photoVersion[3];
      const versionId = photoVersion[2] ?? photoVersion[4];
      if (
        !photoId ||
        !versionId ||
        !(await ownerPhotoScope(c, photoId, versionId))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (photoOnly) {
      const photoId = photoOnly[1];
      if (!photoId || !(await ownerPhotoScope(c, photoId)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      const versionUploadComplete =
        /\/versions\/([0-9a-fA-F-]{36})\/complete$/.exec(path);
      const uploadSessionId = versionUploadComplete?.[1];
      if (
        versionUploadComplete &&
        (!uploadSessionId ||
          !(await ownerVersionUploadScope(c, photoId, uploadSessionId)))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    }

    const inviteRecovery =
      /^\/api\/v1\/invites\/creation\/([0-9a-fA-F-]{36})$/.exec(path);
    const inviteRevoke =
      /^\/api\/v1\/invites\/([0-9a-fA-F-]{36})\/revoke$/.exec(path);
    const inviteRecoveryRequestId = inviteRecovery?.[1];
    const inviteRevokeId = inviteRevoke?.[1];
    if (
      inviteRecovery &&
      (!inviteRecoveryRequestId ||
        !(await ownerInviteRecoveryScope(c, inviteRecoveryRequestId)))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    if (
      inviteRevoke &&
      (!inviteRevokeId || !(await ownerInviteScope(c, inviteRevokeId)))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);

    const uploadRecovery =
      /^\/api\/v1\/uploads\/recovery\/([0-9a-fA-F-]{36})$/.exec(path);
    const uploadRecoveryRequestId = uploadRecovery?.[1];
    if (
      uploadRecovery &&
      (!uploadRecoveryRequestId ||
        !(await ownerUploadRecoveryScope(c, uploadRecoveryRequestId)))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);

    const uploadSession =
      /^\/api\/v1\/uploads\/([0-9a-fA-F-]{36})(?:\/(authorize|complete|cancel))?$/.exec(
        path,
      );
    const uploadSessionId = uploadSession?.[1];
    if (
      uploadSession &&
      (!uploadSessionId || !(await ownerUploadScope(c, uploadSessionId)))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);

    if (
      path === '/api/v1/uploads/init' &&
      !(await ownerBodyTargetsSyntheticAlbum(c))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);

    return next();
  } catch {
    return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
  }
};
