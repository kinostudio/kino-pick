import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createAuth } from './auth';
import { configuration, type WorkerEnv } from './config';
import {
  isFreshAccountSession,
  oauthProviderCapabilities,
  oauthProviderNames,
} from './oauth-provider-capabilities';

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};

export const accountProviderRoutes = new Hono<Environment>();
accountProviderRoutes.use('*', bodyLimit({ maxSize: 1024 }));
accountProviderRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (new URL(c.req.url).searchParams.size)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  await next();
});

async function currentOwnerSession(
  env: WorkerEnv,
  ownerId: string,
  sessionId: string,
) {
  return env.DB.prepare(
    `SELECT s.createdAt FROM owner_sessions s JOIN owners o ON o.user_id=s.userId AND o.enabled=1
     WHERE s.id=? AND s.userId=? AND s.expiresAt>unixepoch()*1000`,
  )
    .bind(sessionId, ownerId)
    .first<{ createdAt: number }>();
}

accountProviderRoutes.get('/providers', async (c) => {
  const session = await currentOwnerSession(
    c.env,
    c.get('ownerId'),
    c.get('sessionId'),
  );
  if (!session) return c.json({ error: { code: 'AUTH_REQUIRED' } }, 401);
  const rows = await c.env.DB.prepare(
    'SELECT DISTINCT providerId FROM oauth_accounts WHERE userId=?',
  )
    .bind(c.get('ownerId'))
    .all<{ providerId: string }>();
  const configured = oauthProviderCapabilities(c.env).providers;
  const linked = new Set(rows.results.map((row) => row.providerId));
  return c.json({
    fresh: isFreshAccountSession(session.createdAt),
    providers: oauthProviderNames.map((provider) => ({
      provider,
      configured: configured.includes(provider),
      linked: linked.has(provider),
      canUnlink:
        linked.has(provider) &&
        configured.some((other) => other !== provider && linked.has(other)),
    })),
  });
});

accountProviderRoutes.post('/providers/:provider/:action', async (c) => {
  const provider = c.req.param('provider');
  const action = c.req.param('action');
  if (
    (provider !== 'google' && provider !== 'github') ||
    (action !== 'link' && action !== 'unlink')
  )
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const origin = configuration(c.env).origin;
  if (c.req.header('Origin') !== origin)
    return c.json({ error: { code: 'FORBIDDEN_ORIGIN' } }, 403);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length
  )
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  const session = await currentOwnerSession(
    c.env,
    c.get('ownerId'),
    c.get('sessionId'),
  );
  if (!session) return c.json({ error: { code: 'AUTH_REQUIRED' } }, 401);
  if (!isFreshAccountSession(session.createdAt))
    return c.json({ error: { code: 'SESSION_NOT_FRESH' } }, 403);
  const configured = oauthProviderCapabilities(c.env).providers;
  if (action === 'link') {
    if (!configured.includes(provider))
      return c.json({ error: { code: 'PROVIDER_NOT_CONFIGURED' } }, 409);
    const headers = new Headers(c.req.raw.headers);
    headers.set('Content-Type', 'application/json');
    headers.delete('Content-Length');
    const response = await createAuth(c.env).handler(
      new Request(origin + '/api/auth/link-social', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider,
          callbackURL: origin + '/dashboard/account?link=success',
          errorCallbackURL: origin + '/dashboard/account?link=error',
          disableRedirect: true,
        }),
      }),
    );
    if (!response.ok)
      return c.json({ error: { code: 'ACCOUNT_LINK_FAILED' } }, 409);
    const result = (await response.clone().json()) as { url?: unknown };
    const url = typeof result.url === 'string' ? new URL(result.url) : null;
    const host = provider === 'google' ? 'accounts.google.com' : 'github.com';
    if (
      !url ||
      url.protocol !== 'https:' ||
      url.hostname !== host ||
      url.username ||
      url.password
    )
      return c.json({ error: { code: 'ACCOUNT_LINK_FAILED' } }, 409);
    return response;
  }
  const other = configured.filter((item) => item !== provider);
  if (!other.length)
    return c.json({ error: { code: 'LAST_LOGIN_PROVIDER' } }, 409);
  const eventId = crypto.randomUUID();
  // Audit and removal share a transaction; concurrent unlink requests cannot remove both sources.
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,action,before_json,after_json,request_id)
      SELECT ?,'user',?,?,'owner.provider_unlinked',?,NULL,? WHERE EXISTS(
        SELECT 1 FROM oauth_accounts WHERE userId=? AND providerId=?) AND EXISTS(
        SELECT 1 FROM oauth_accounts WHERE userId=? AND providerId=?) AND EXISTS(
        SELECT 1 FROM owner_sessions s JOIN owners o ON o.user_id=s.userId AND o.enabled=1
        WHERE s.id=? AND s.userId=? AND s.expiresAt>unixepoch()*1000
          AND s.createdAt>unixepoch()*1000-300000 AND s.createdAt<=unixepoch()*1000+1000)`,
    ).bind(
      eventId,
      c.get('ownerId'),
      c.get('sessionId'),
      JSON.stringify({ provider }),
      eventId,
      c.get('ownerId'),
      provider,
      c.get('ownerId'),
      other[0]!,
      c.get('sessionId'),
      c.get('ownerId'),
    ),
    c.env.DB.prepare(
      `DELETE FROM oauth_accounts WHERE userId=? AND providerId=?
      AND EXISTS(SELECT 1 FROM audit_events WHERE event_id=? AND action='owner.provider_unlinked')`,
    ).bind(c.get('ownerId'), provider, eventId),
  ]);
  if (!result[1]?.meta.changes)
    return c.json({ error: { code: 'LAST_LOGIN_PROVIDER' } }, 409);
  return c.json({ status: true });
});
