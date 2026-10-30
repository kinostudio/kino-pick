import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createAuth } from '../src/auth';
import { configuration, type WorkerEnv } from '../src/config';

type Bindings = WorkerEnv & { STAGING_AUTH_VALIDATION: string };
const app = new Hono<{ Bindings: Bindings }>();
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  try {
    if (c.env.APP_ENV !== 'staging' || c.env.STAGING_AUTH_VALIDATION !== 'true')
      return c.text('Validation disabled', 503);
    const { origin } = configuration(c.env);
    if (new URL(c.req.url).origin !== origin)
      return c.text('Invalid host', 403);
    if (!['GET', 'POST'].includes(c.req.method))
      return c.text('Method denied', 405);
    if (c.req.method === 'POST' && c.req.header('Origin') !== origin)
      return c.text('Invalid origin', 403);
    await next();
  } catch {
    c.res = new Response('Authentication validation unavailable', {
      status: 503,
    });
  }
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
});
app.use(
  '*',
  bodyLimit({ maxSize: 16_384, onError: (c) => c.text('Body too large', 413) }),
);
async function ownerAuthenticated(request: Request, env: Bindings) {
  const session = await createAuth(env).api.getSession({
    headers: request.headers,
  });
  if (!session) return false;
  return !!(await env.DB.prepare(
    'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
  )
    .bind(session.user.id)
    .first());
}
app.get('/api/validation/session', async (c) =>
  c.json({
    authenticated: await ownerAuthenticated(c.req.raw, c.env),
    mode: 'staging-auth-only',
  }),
);
app.get('/', async (c) => {
  const authenticated = await ownerAuthenticated(c.req.raw, c.env);
  const nonce = crypto.randomUUID();
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  );
  return c.html(
    `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kino Pick staging 登入驗收</title><h1>Kino Pick staging 登入驗收</h1><p>此入口僅驗證登入，尚未發佈 MVP；沒有相簿、照片或產品操作。</p><p data-testid="auth-state">${authenticated ? '已驗證 Owner 登入' : '尚未登入'}</p><button id="auth-action">${authenticated ? '登出' : '使用 GitHub 登入驗收'}</button><p id="result" role="status"></p><script nonce="${nonce}">document.getElementById('auth-action').onclick=async()=>{const button=document.getElementById('auth-action');button.disabled=true;try{const signed=${authenticated};const response=await fetch(signed?'/api/auth/sign-out':'/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signed?{}:{provider:'github',callbackURL:location.origin+'/'})});if(!response.ok)throw new Error();if(signed){location.reload();return;}const data=await response.json();const url=new URL(data.url);if(url.origin!=='https://github.com')throw new Error();location.assign(url.href);}catch{document.getElementById('result').textContent='登入驗收未成功，請稍後重試。';button.disabled=false;}};</script></html>`,
  );
});
app.all('/api/auth/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  if (
    ![
      '/api/auth/sign-in/social',
      '/api/auth/callback/github',
      '/api/auth/sign-out',
    ].includes(path)
  )
    return c.text('Not available in validation', 404);
  if (c.req.method === 'POST') {
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      return c.text('JSON required', 415);
    if (path === '/api/auth/sign-in/social') {
      let body: Record<string, unknown>;
      try {
        body = await c.req.raw.clone().json();
      } catch {
        return c.text('Invalid JSON', 400);
      }
      if (
        !body ||
        body.provider !== 'github' ||
        body.callbackURL !== configuration(c.env).origin + '/' ||
        Object.keys(body).some(
          (key) => !['provider', 'callbackURL'].includes(key),
        )
      )
        return c.text('Validation intent required', 400);
    }
  }
  return createAuth(c.env).handler(c.req.raw);
});
app.notFound((c) => c.text('Product routes are not released', 404));
export default app;
