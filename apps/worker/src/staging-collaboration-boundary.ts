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

type OwnerScope = { workspaceId: string; projectId: string; albumId: string };

const uuid =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const albumRoot = '/api/guest/albums/' + scope.albumId;
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
  '/api/v1/version-approvals/capabilities',
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
    [['POST'], new RegExp('^' + albumRoot + '/activity$')],
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
  target: OwnerScope = scope,
): boolean {
  const ownerProjectRoot = '/api/v1/projects/' + target.projectId;
  const ownerAlbumRoot = '/api/v1/albums/' + target.albumId;
  if (isRead(method) && ownerCapabilityPaths.has(path)) return true;
  const routes: Array<[string[], RegExp]> = [
    [['GET'], /^\/api\/v1\/me$/],
    [['GET', 'PUT'], /^\/api\/v1\/storage\/oracle-policy$/],
    [['GET'], /^\/api\/v1\/workspaces$/],
    [['GET', 'POST'], /^\/api\/v1\/projects$/],
    [['GET', 'PATCH', 'DELETE'], new RegExp('^' + ownerProjectRoot + '$')],
    [['DELETE'], new RegExp('^' + ownerAlbumRoot + '$')],
    [['GET'], new RegExp('^' + ownerAlbumRoot + '/deletion$')],
    [['POST'], new RegExp('^' + ownerAlbumRoot + '/deletion/retry$')],
    [['PATCH'], new RegExp('^' + ownerProjectRoot + '/archive$')],
    [
      ['PATCH'],
      new RegExp('^' + ownerAlbumRoot + '(?:/archive|/protection)?$'),
    ],
    [['GET', 'POST'], new RegExp('^' + ownerProjectRoot + '/albums$')],
    [['GET', 'POST'], new RegExp('^' + ownerProjectRoot + '/invites$')],
    [['GET'], new RegExp('^/api/v1/invites/creation/(' + uuid + ')$')],
    [['POST'], new RegExp('^/api/v1/invites/(' + uuid + ')/revoke$')],
    [['GET'], new RegExp('^' + ownerWorkspaceRoot + '/upload-capabilities$')],
    [
      ['GET', 'POST'],
      new RegExp('^' + ownerWorkspaceRoot + '/image-processing-policy$'),
    ],
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
    [
      ['GET'],
      new RegExp('^' + ownerAlbumRoot + '/(?:activity|download-activity)$'),
    ],
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
    [
      ['POST'],
      new RegExp(
        '^/api/v1/photos/(' +
          uuid +
          ')/versions/(' +
          uuid +
          ')/processing-retry$',
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
  if (
    method === 'DELETE' &&
    ((target.projectId === scope.projectId &&
      path.startsWith('/api/v1/projects/')) ||
      (target.albumId === scope.albumId && path.startsWith('/api/v1/albums/')))
  )
    return false;
  if (
    method === 'POST' &&
    target.albumId === scope.albumId &&
    path === ownerAlbumRoot + '/deletion/retry'
  )
    return false;
  // Managed projects may read their invitations; hosted issuance remains separately fenced.
  if (
    method !== 'GET' &&
    target.projectId !== scope.projectId &&
    /\/invites$/.test(path)
  )
    return false;
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

// Creation commands are immutable, successful Owner-authorized management witnesses.
const managedProjectSql = `(p.id=? OR EXISTS(SELECT 1 FROM request_commands c
  WHERE c.actor_id=? AND c.operation='project.created' AND c.resource_id=p.id
  AND c.workspace_id=p.workspace_id AND json_extract(c.result_json,'$.id')=p.id
  AND json_extract(c.result_json,'$.workspaceId')=p.workspace_id))`;
const managedAlbumSql = `(a.id=? OR EXISTS(SELECT 1 FROM request_commands c
  WHERE c.actor_id=? AND c.operation='album.created' AND c.resource_id=a.id
  AND c.workspace_id=a.workspace_id AND json_extract(c.result_json,'$.id')=a.id
  AND json_extract(c.result_json,'$.projectId')=a.project_id
  AND json_extract(c.result_json,'$.workspaceId')=a.workspace_id))`;

async function ownerProjectScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  target: OwnerScope = scope,
  allowDeleted = false,
) {
  if (!(await ownerWorkspaceScope(c))) return false;
  return !!(await c.env.DB.prepare(
    `SELECT 1 FROM projects p WHERE p.id=? AND p.workspace_id=? AND ${managedProjectSql}
     AND (?=1 OR NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.project_id=p.id AND e.action='project.deleted'))`,
  )
    .bind(
      target.projectId,
      scope.workspaceId,
      scope.projectId,
      c.get('ownerId'),
      Number(allowDeleted),
    )
    .first());
}

async function ownerAlbumScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  target: OwnerScope = scope,
  allowArchived = false,
  allowDeleted = false,
) {
  if (!(await ownerProjectScope(c, target))) return false;
  return !!(await c.env.DB.prepare(
    `SELECT 1 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
     WHERE a.id=? AND a.workspace_id=? AND a.project_id=? AND ${managedAlbumSql}
     AND (?=1 OR a.state NOT IN('deleting','deleted'))
     AND (?=1 OR (a.state<>'archived' AND p.status<>'archived'))`,
  )
    .bind(
      target.albumId,
      scope.workspaceId,
      target.projectId,
      scope.albumId,
      c.get('ownerId'),
      Number(allowDeleted),
      Number(allowArchived),
    )
    .first());
}

async function managedListing(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  projectId?: string,
) {
  const sql = projectId
    ? `SELECT 1 FROM albums a WHERE a.workspace_id=? AND a.project_id=? AND NOT ${managedAlbumSql} LIMIT 1`
    : `SELECT 1 FROM projects p WHERE p.workspace_id=? AND NOT ${managedProjectSql} LIMIT 1`;
  const bindings = projectId
    ? [scope.workspaceId, projectId, scope.albumId, c.get('ownerId')]
    : [scope.workspaceId, scope.projectId, c.get('ownerId')];
  return !(await c.env.DB.prepare(sql)
    .bind(...bindings)
    .first());
}

async function requestOwnerScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  path: string,
): Promise<OwnerScope | null> {
  const project = new RegExp('^/api/v1/projects/(' + uuid + ')(?:/|$)').exec(
    path,
  );
  if (project?.[1]) return { ...scope, projectId: project[1] };
  const album = new RegExp('^/api/v1/albums/(' + uuid + ')(?:/|$)').exec(path);
  const photo = new RegExp('^/api/v1/photos/(' + uuid + ')(?:/|$)').exec(path);
  const upload = new RegExp('^/api/v1/uploads/(' + uuid + ')(?:/|$)').exec(
    path,
  );
  const recovery = new RegExp('^/api/v1/uploads/recovery/(' + uuid + ')$').exec(
    path,
  );
  let row: { projectId: string; albumId: string } | null = null;
  if (album?.[1])
    row = await c.env.DB.prepare(
      'SELECT project_id AS projectId,id AS albumId FROM albums WHERE id=? AND workspace_id=?',
    )
      .bind(album[1], scope.workspaceId)
      .first();
  else if (photo?.[1])
    row = await c.env.DB.prepare(
      'SELECT project_id AS projectId,album_id AS albumId FROM photos WHERE id=? AND workspace_id=?',
    )
      .bind(photo[1], scope.workspaceId)
      .first();
  else if (upload?.[1])
    row = await c.env.DB.prepare(
      'SELECT project_id AS projectId,album_id AS albumId FROM upload_sessions WHERE id=? AND workspace_id=? AND actor_id=?',
    )
      .bind(upload[1], scope.workspaceId, c.get('ownerId'))
      .first();
  else if (recovery?.[1])
    row = await c.env.DB.prepare(
      `SELECT u.project_id AS projectId,u.album_id AS albumId FROM upload_requests r
     JOIN upload_sessions u ON u.id=r.upload_session_id WHERE r.actor_id=? AND r.request_id=?
     AND r.operation='upload.reserved' AND u.actor_id=? AND u.workspace_id=?`,
    )
      .bind(c.get('ownerId'), recovery[1], c.get('ownerId'), scope.workspaceId)
      .first();
  else if (path === '/api/v1/uploads/init') {
    const body = (await c.req.raw.clone().json()) as Record<string, unknown>;
    if (
      body.workspaceId !== scope.workspaceId ||
      typeof body.projectId !== 'string' ||
      typeof body.albumId !== 'string'
    )
      return null;
    return {
      workspaceId: scope.workspaceId,
      projectId: body.projectId,
      albumId: body.albumId,
    };
  } else return scope;
  return row ? { workspaceId: scope.workspaceId, ...row } : null;
}

async function ownerPhotoScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  photoId: string,
  versionId?: string,
  target: OwnerScope = scope,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c, target))) return false;
  const row = versionId
    ? await c.env.DB.prepare(
        'SELECT 1 FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id WHERE p.id=? AND v.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=?',
      )
        .bind(
          photoId,
          versionId,
          target.workspaceId,
          target.projectId,
          target.albumId,
        )
        .first()
    : await c.env.DB.prepare(
        'SELECT 1 FROM photos p WHERE p.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=?',
      )
        .bind(photoId, target.workspaceId, target.projectId, target.albumId)
        .first();
  return !!row;
}

async function ownerInviteRecoveryScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  requestId: string,
  target: OwnerScope = scope,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c, target))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM invite_creation_commands c JOIN guest_invites i ON i.id=c.invite_id WHERE c.actor_id=? AND c.request_id=? AND i.workspace_id=? AND i.project_id=? AND (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id)=1 AND EXISTS(SELECT 1 FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.workspace_id=? AND a.project_id=? AND a.album_id=?)',
  )
    .bind(
      c.get('ownerId'),
      requestId,
      target.workspaceId,
      target.projectId,
      target.workspaceId,
      target.projectId,
      target.albumId,
    )
    .first();
  return !!row;
}

async function ownerUploadRecoveryScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  requestId: string,
  target: OwnerScope = scope,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c, target))) return false;
  const row = await c.env.DB.prepare(
    "SELECT 1 FROM upload_requests r JOIN upload_sessions u ON u.id=r.upload_session_id WHERE r.actor_id=? AND r.request_id=? AND r.operation='upload.reserved' AND u.actor_id=? AND u.workspace_id=? AND u.project_id=? AND u.album_id=? AND NOT EXISTS(SELECT 1 FROM upload_version_targets t WHERE t.upload_session_id=u.id)",
  )
    .bind(
      c.get('ownerId'),
      requestId,
      c.get('ownerId'),
      target.workspaceId,
      target.projectId,
      target.albumId,
    )
    .first();
  return !!row;
}

async function ownerInviteScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  inviteId: string,
  target: OwnerScope = scope,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c, target))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM guest_invites i WHERE i.id=? AND i.workspace_id=? AND i.project_id=? AND (SELECT count(*) FROM guest_invite_albums a WHERE a.invite_id=i.id)=1 AND EXISTS(SELECT 1 FROM guest_invite_albums a WHERE a.invite_id=i.id AND a.workspace_id=? AND a.project_id=? AND a.album_id=?)',
  )
    .bind(
      inviteId,
      target.workspaceId,
      target.projectId,
      target.workspaceId,
      target.projectId,
      target.albumId,
    )
    .first();
  return !!row;
}

async function ownerVersionUploadScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  photoId: string,
  uploadSessionId: string,
  target: OwnerScope = scope,
): Promise<boolean> {
  if (!(await ownerPhotoScope(c, photoId, undefined, target))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM upload_sessions u JOIN upload_version_targets t ON t.upload_session_id=u.id WHERE u.id=? AND t.photo_id=? AND u.workspace_id=? AND u.project_id=? AND u.album_id=?',
  )
    .bind(
      uploadSessionId,
      photoId,
      target.workspaceId,
      target.projectId,
      target.albumId,
    )
    .first();
  return !!row;
}

async function ownerUploadScope(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  uploadSessionId: string,
  target: OwnerScope = scope,
): Promise<boolean> {
  if (!(await ownerAlbumScope(c, target))) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM upload_sessions WHERE id=? AND workspace_id=? AND project_id=? AND album_id=?',
  )
    .bind(uploadSessionId, target.workspaceId, target.projectId, target.albumId)
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

async function ownerBodyTargetsAlbum(
  c: Parameters<MiddlewareHandler<ScopeEnvironment>>[0],
  target: OwnerScope,
) {
  try {
    const body = (await c.req.raw.clone().json()) as Record<string, unknown>;
    return (
      body.workspaceId === target.workspaceId &&
      body.projectId === target.projectId &&
      body.albumId === target.albumId
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
  if (path.includes('%')) return c.json({ error: { code: 'NOT_FOUND' } }, 404);

  try {
    const target = await requestOwnerScope(c, path);
    if (
      !target ||
      !stagingCollaborationOwnerRequestAllowed(c.req.method, path, target)
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    const ownerProjectRoot = '/api/v1/projects/' + target.projectId;
    const ownerAlbumRoot = '/api/v1/albums/' + target.albumId;
    if (path === '/api/v1/storage/oracle-policy') {
      if (
        c.get('ownerId') !== c.env.ORACLE_STORAGE_ADMIN_USER_ID ||
        !(await ownerWorkspaceScope(c))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path === '/api/v1/workspaces') {
      if (!queryKeysAreOnly(url, ['cursor']) || !(await ownerWorkspaceScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path === '/api/v1/projects') {
      if (!(await ownerWorkspaceScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      if (c.req.method === 'POST') {
        const body = (await c.req.raw.clone().json()) as Record<
          string,
          unknown
        >;
        if (body.workspaceId !== scope.workspaceId)
          return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      } else if (
        !queryKeysAreOnly(url, ['workspaceId', 'cursor']) ||
        url.searchParams.getAll('workspaceId').length !== 1 ||
        url.searchParams.get('workspaceId') !== scope.workspaceId ||
        !(await managedListing(c))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path.startsWith(ownerProjectRoot)) {
      if (!(await ownerProjectScope(c, target, c.req.method === 'DELETE')))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      if (
        path === ownerProjectRoot + '/albums' &&
        c.req.method === 'GET' &&
        !(await managedListing(c, target.projectId))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path.startsWith(ownerAlbumRoot)) {
      if (
        !(await ownerAlbumScope(
          c,
          target,
          ['PATCH', 'DELETE'].includes(c.req.method) ||
            path.includes('/deletion'),
          c.req.method === 'DELETE' || path.includes('/deletion'),
        ))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (path.startsWith(ownerWorkspaceRoot)) {
      if (
        path === ownerWorkspaceRoot + '/image-processing-policy' &&
        url.search !== ''
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      if (!(await ownerWorkspaceScope(c)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    }

    const photoVersion = new RegExp(
      '^/api/v1/(?:albums/' +
        target.albumId +
        '/photos/(' +
        uuid +
        ')/versions/(' +
        uuid +
        ')/(?:comment-threads|annotations(?:/owner)?)|photos/(' +
        uuid +
        ')/versions/(' +
        uuid +
        ')/(?:assets/(?:thumbnail|preview|original)|processing-retry))$',
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
        !(await ownerPhotoScope(c, photoId, versionId, target))
      )
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    } else if (photoOnly) {
      const photoId = photoOnly[1];
      if (!photoId || !(await ownerPhotoScope(c, photoId, undefined, target)))
        return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      const versionUploadComplete =
        /\/versions\/([0-9a-fA-F-]{36})\/complete$/.exec(path);
      const uploadSessionId = versionUploadComplete?.[1];
      if (
        versionUploadComplete &&
        (!uploadSessionId ||
          !(await ownerVersionUploadScope(c, photoId, uploadSessionId, target)))
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
        !(await ownerUploadRecoveryScope(c, uploadRecoveryRequestId, target)))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);

    const uploadSession =
      /^\/api\/v1\/uploads\/([0-9a-fA-F-]{36})(?:\/(authorize|complete|cancel))?$/.exec(
        path,
      );
    const uploadSessionId = uploadSession?.[1];
    if (
      uploadSession &&
      (!uploadSessionId ||
        !(await ownerUploadScope(c, uploadSessionId, target)))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);

    if (
      path === '/api/v1/uploads/init' &&
      (!(await ownerBodyTargetsAlbum(c, target)) ||
        !(await ownerAlbumScope(c, target)))
    )
      return c.json({ error: { code: 'NOT_FOUND' } }, 404);

    return next();
  } catch {
    return c.json({ error: { code: 'VALIDATION_UNAVAILABLE' } }, 503);
  }
};
