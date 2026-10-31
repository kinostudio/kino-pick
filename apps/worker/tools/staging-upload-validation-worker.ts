import product from '../src/index';
import { configuration, type WorkerEnv } from '../src/config';

type ValidationEnv = WorkerEnv & { STAGING_UPLOAD_VALIDATION: string };
const origin = 'https://kino-pic-staging.kino-pick-aaron2026.workers.dev';
const activeFlags = new Set([
  'DIRECT_UPLOAD_ENABLED',
  'CLOUDFLARE_IMAGE_PROCESSING_ENABLED',
]);
function ready(env: ValidationEnv): boolean {
  try {
    const config = configuration(env);
    return (
      env.STAGING_UPLOAD_VALIDATION === 'true' &&
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

/** Temporary Owner-only acceptance surface; never a production/MVP deployment entry. */
export default {
  async fetch(request: Request, env: ValidationEnv, ctx: ExecutionContext) {
    if (!ready(env)) return denied(503);
    const url = new URL(request.url);
    if (url.origin !== origin) return denied(403);
    if (!['GET', 'HEAD', 'POST', 'PATCH'].includes(request.method))
      return denied(405);
    if (
      ['POST', 'PATCH'].includes(request.method) &&
      request.headers.get('Origin') !== origin
    )
      return denied(403);
    const path = url.pathname;
    if (path.includes('%')) return denied(404);
    const read = request.method === 'GET' || request.method === 'HEAD';
    const auth = read
      ? ['/api/auth/get-session', '/api/auth/callback/github'].includes(path)
      : ['/api/auth/sign-in/social', '/api/auth/sign-out'].includes(path);
    // All /api/v1 routes retain the product's live Owner/session/tenant checks.
    const owner = path.startsWith('/api/v1/');
    const page =
      read &&
      (path === '/' ||
        path === '/dashboard' ||
        path.startsWith('/dashboard/') ||
        /^\/assets\/[A-Za-z0-9_.-]+$/.test(path));
    const providers = read && path === '/api/oauth/providers';
    if (!auth && !owner && !page && !providers) return denied(404);
    const response = await product.fetch(request, env, ctx);
    const result = new Response(response.body, response);
    result.headers.set('X-Kino-Validation', 'owner-upload-only');
    return result;
  },
  async scheduled(event: ScheduledController, env: ValidationEnv) {
    if (ready(env)) await product.scheduled(event, env);
  },
} satisfies ExportedHandler<ValidationEnv>;
