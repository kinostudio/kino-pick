import product from '../src/index';
import { configuration, type WorkerEnv } from '../src/config';
import {
  STAGING_GUEST_SCOPE,
  stagingGuestValidationEnabled,
} from '../src/staging-guest-scope';

type ValidationEnv = WorkerEnv & { STAGING_GUEST_VALIDATION?: string };
const origin = STAGING_GUEST_SCOPE.origin;
const activeFlags = new Set([
  'DIRECT_UPLOAD_ENABLED',
  'CLOUDFLARE_IMAGE_PROCESSING_ENABLED',
  'GUEST_INVITE_ISSUANCE_ENABLED',
  'GUEST_EXCHANGE_ENABLED',
  'GUEST_SELECTION_ENABLED',
]);

function ready(env: ValidationEnv): boolean {
  try {
    const config = configuration(env);
    return (
      env.STAGING_GUEST_VALIDATION === 'true' &&
      stagingGuestValidationEnabled(env) &&
      config.APP_ENV === 'staging' &&
      config.origin === origin &&
      config.REGISTRATION_MODE === 'closed' &&
      config.STORAGE_RETENTION_DRY_RUN === 'true' &&
      !!env.DB &&
      !!env.PRIMARY_STORAGE &&
      !!env.IMAGES &&
      !!env.ASSETS &&
      [...activeFlags].every(
        (flag) => config[flag as keyof typeof config] === 'true',
      ) &&
      Object.entries(env).every(
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

/** Closed staging entry for the fixed synthetic Guest album and existing Owner flow. */
export default {
  async fetch(request: Request, env: ValidationEnv, ctx: ExecutionContext) {
    if (!ready(env)) return denied(503);

    const url = new URL(request.url);
    if (url.origin !== origin) return denied(403);

    const allowedMethods = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT'];
    if (!allowedMethods.includes(request.method)) return denied(405);

    const read = request.method === 'GET' || request.method === 'HEAD';
    const write =
      request.method === 'POST' ||
      request.method === 'PATCH' ||
      request.method === 'PUT';
    if (write && request.headers.get('Origin') !== origin) return denied(403);

    const path = url.pathname;
    if (path.includes('%')) return denied(404);

    // Keep the existing Owner validation auth surface and its method/path pairs.
    const authRead =
      read &&
      ['/api/auth/get-session', '/api/auth/callback/github'].includes(path);
    const authWrite =
      ['POST', 'PATCH'].includes(request.method) &&
      ['/api/auth/sign-in/social', '/api/auth/sign-out'].includes(path);

    // Product middleware remains authoritative for authenticated Owner/API scope.
    const ownerApi = path.startsWith('/api/v1/');
    // Product middleware enforces exact synthetic Guest scope, including asset rows.
    const guestApi = path.startsWith('/api/guest/');

    const fixedGuestAlbum = STAGING_GUEST_SCOPE.albumId;
    const guestPage =
      read &&
      (path === `/guest/albums/${fixedGuestAlbum}` ||
        path === `/guest/albums/${fixedGuestAlbum}/enter`);
    const ownerPage =
      read &&
      (path === '/' ||
        path === '/dashboard' ||
        path.startsWith('/dashboard/') ||
        /^\/assets\/[A-Za-z0-9_.-]+$/.test(path));
    const providers = read && path === '/api/oauth/providers';

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
    result.headers.set('X-Kino-Validation', 'synthetic-guest-only');
    return result;
  },
} satisfies ExportedHandler<ValidationEnv>;
