import product from '../src/index';
import { configuration, type WorkerEnv } from '../src/config';
import {
  STAGING_GUEST_SCOPE,
  stagingCollaborationValidationEnabled,
} from '../src/staging-guest-scope';
import {
  stagingCollaborationGuestRequestAllowed,
  stagingCollaborationOwnerRequestAllowed,
} from '../src/staging-collaboration-boundary';

type CollaborationEnv = WorkerEnv & {
  STAGING_GUEST_VALIDATION?: string;
  STAGING_COLLABORATION_VALIDATION?: string;
};
const origin = STAGING_GUEST_SCOPE.origin;
const activeFlags = new Set([
  'ORACLE_STORAGE_ENABLED',
  'CLIENT_ACTIVITY_ENABLED',
  'DIRECT_UPLOAD_ENABLED',
  'CLOUDFLARE_IMAGE_PROCESSING_ENABLED',
  'GUEST_INVITE_ISSUANCE_ENABLED',
  'GUEST_EXCHANGE_ENABLED',
  'GUEST_SELECTION_ENABLED',
  'ALBUM_ACTIVATION_ENABLED',
  'GUEST_FEEDBACK_ENABLED',
  'GUEST_TAGS_ENABLED',
  'GUEST_HISTORY_ENABLED',
  'GUEST_DOWNLOADS_ENABLED',
  'GUEST_VERSION_COMPARISON_ENABLED',
  'GUEST_COMMENTS_ENABLED',
  'GUEST_ANNOTATIONS_ENABLED',
  'FREEHAND_ANNOTATIONS_ENABLED',
  'OWNER_COMMENTS_ENABLED',
  'OWNER_COMMENT_PROCESSING_ENABLED',
  'OWNER_ANNOTATIONS_ENABLED',
  'OWNER_ANNOTATION_AUTHORING_ENABLED',
  'OWNER_ANNOTATION_PROCESSING_ENABLED',
  'OWNER_HISTORY_ENABLED',
  'PHOTO_VERSIONS_ENABLED',
  'VERSION_APPROVALS_ENABLED',
  'APPROVED_DELIVERIES_ENABLED',
  'DELIVERY_ZIP_ENABLED',
  'PHOTO_VERSION_UPLOADS_ENABLED',
  'PROJECT_VERSIONING_CONFIGURATION_ENABLED',
  'PHOTOGRAPHER_RECOMMENDATIONS_ENABLED',
]);

function ready(env: CollaborationEnv): boolean {
  try {
    const config = configuration(env);
    return (
      env.STAGING_GUEST_VALIDATION === 'true' &&
      env.STAGING_COLLABORATION_VALIDATION === 'true' &&
      stagingCollaborationValidationEnabled(env) &&
      config.APP_ENV === 'staging' &&
      config.origin === origin &&
      config.REGISTRATION_MODE === 'closed' &&
      config.STORAGE_AUTODELETE_ENABLED === 'false' &&
      config.STORAGE_RETENTION_DRY_RUN === 'true' &&
      config.MULTI_ACCOUNT_STORAGE_ENABLED === 'false' &&
      !!env.DB &&
      !!env.PRIMARY_STORAGE &&
      !!env.IMAGES &&
      !!env.ASSETS &&
      [...activeFlags].every(
        (flag) => config[flag as keyof typeof config] === 'true',
      ) &&
      Object.entries(config).every(
        ([key, value]) =>
          !key.endsWith('_ENABLED') ||
          value === (activeFlags.has(key) ? 'true' : 'false'),
      )
    );
  } catch {
    return false;
  }
}

const denied = (status: number) =>
  new Response('Validation unavailable', {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** Exact B-only collaboration validation; product auth and D1 ACLs remain authoritative. */
export default {
  async fetch(request: Request, env: CollaborationEnv, ctx: ExecutionContext) {
    if (!ready(env)) return denied(503);
    const url = new URL(request.url);
    if (url.origin !== origin) return denied(403);

    const allowedMethods = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'];
    if (!allowedMethods.includes(request.method)) return denied(405);
    const read = request.method === 'GET' || request.method === 'HEAD';
    const write =
      request.method === 'POST' ||
      request.method === 'PATCH' ||
      request.method === 'PUT' ||
      request.method === 'DELETE';
    if (write && request.headers.get('Origin') !== origin) return denied(403);

    const path = url.pathname;
    if (path.includes('%')) return denied(404);

    const authRead =
      read &&
      [
        '/api/auth/get-session',
        '/api/auth/callback/github',
        '/api/auth/callback/google',
      ].includes(path);
    const authWrite =
      ['POST', 'PATCH'].includes(request.method) &&
      ['/api/auth/sign-in/social', '/api/auth/sign-out'].includes(path);
    const providers =
      read &&
      ['/api/oauth/providers', '/api/client-activity/capabilities'].includes(
        path,
      );
    const uuid =
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
    const projectId = new RegExp(
      '^/api/v1/projects/(' + uuid + ')(?:/|$)',
    ).exec(path)?.[1];
    const ownerAlbumId = new RegExp(
      '^/api/v1/albums/(' + uuid + ')(?:/|$)',
    ).exec(path)?.[1];
    // This outer route filter is structural; product middleware verifies managed DB witnesses.
    const ownerApi =
      path.startsWith('/api/v1/') &&
      stagingCollaborationOwnerRequestAllowed(request.method, path, {
        ...STAGING_GUEST_SCOPE,
        projectId: projectId ?? STAGING_GUEST_SCOPE.projectId,
        albumId: ownerAlbumId ?? STAGING_GUEST_SCOPE.albumId,
      });
    const guestAlbumId = new RegExp(
      '^/api/guest/albums/(' + uuid + ')(?:/|$)',
    ).exec(path)?.[1];
    const guestApi =
      path.startsWith('/api/guest/') &&
      stagingCollaborationGuestRequestAllowed(
        request.method,
        path,
        guestAlbumId,
      );
    const guestPage =
      read &&
      (path === '/guest/history' ||
        new RegExp('^/guest/albums/(' + uuid + ')(?:/enter)?$').test(path));
    const ownerPage =
      read &&
      (path === '/' ||
        path === '/dashboard' ||
        path.startsWith('/dashboard/') ||
        /^\/assets\/[A-Za-z0-9_.-]+$/.test(path));

    if (
      !authRead &&
      !authWrite &&
      !ownerApi &&
      !guestApi &&
      !guestPage &&
      !ownerPage &&
      !providers
    )
      return denied(404);

    const response = await product.fetch(request, env, ctx);
    const result = new Response(response.body, response);
    result.headers.set('X-Kino-Validation', 'scoped-collaboration');
    return result;
  },
} satisfies ExportedHandler<CollaborationEnv>;
