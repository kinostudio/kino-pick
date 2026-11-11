import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, vi } from 'vitest';
import { accountProviderRoutes } from '../../apps/worker/src/account-providers';
import { createAuth } from '../../apps/worker/src/auth';
import type { WorkerEnv } from '../../apps/worker/src/config';
import {
  stagingCollaborationOwnerRequestAllowed,
  stagingCollaborationGuestRequestAllowed,
} from '../../apps/worker/src/staging-collaboration-boundary';

const require = createRequire(resolve('apps/worker/package.json'));
const { Hono } = require('hono') as {
  Hono: new () => typeof accountProviderRoutes;
};
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { unstable_splitSqlQuery } = require('wrangler') as {
  unstable_splitSqlQuery(sql: string): string[];
};

test('native account lifecycle: scoped reads, atomic last-source protection and real BetterAuth callback with synthetic provider', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'account-lifecycle',
          modules: true,
          script: "export default {fetch(){return new Response('ok')}}",
          compatibilityDate: '2026-10-23',
          d1Databases: { DB: 'account-lifecycle' },
        },
      ],
    }),
  );
  const db = (await mf.getD1Database('DB', 'account-lifecycle')) as D1Database;
  const origin = 'http://localhost:8787';
  const owner = randomUUID(),
    sessionId = randomUUID(),
    token = randomUUID();
  const secret = 'synthetic-account-lifecycle-secret-not-a-real-credential';
  const env = {
    DB: db,
    APP_ENV: 'local',
    APP_URL: origin,
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    BETTER_AUTH_SECRET: secret,
    GITHUB_CLIENT_ID: 'synthetic-github-client',
    GITHUB_CLIENT_SECRET: 'synthetic-github-secret',
    GOOGLE_CLIENT_ID: 'synthetic-google-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
  } as unknown as WorkerEnv;
  let actor = owner;
  // Synthetic middleware isolates the route tests; the OAuth callback below validates an actual signed session cookie.
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('ownerId', actor);
    c.set('sessionId', sessionId);
    await next();
  });
  app.route('/api/v1/account', accountProviderRoutes);
  const request = (
    provider: string,
    headers: Record<string, string> = {},
    method = 'POST',
  ) =>
    app.request(
      origin + '/api/v1/account/providers' + provider,
      {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
      },
      env,
    );
  try {
    const sql = await readFile(
      resolve('apps/worker/migrations/0001_closed_owner.sql'),
      'utf8',
    );
    await db.batch(unstable_splitSqlQuery(sql).map((part) => db.prepare(part)));
    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
      )
      .bind(owner, 'synthetic-google-subject')
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,createdAt,updatedAt,expiresAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        sessionId,
        token,
        owner,
        Date.now(),
        Date.now(),
        Date.now() + 3600000,
      )
      .run();
    const addGithub = () =>
      db
        .prepare(
          'INSERT INTO oauth_accounts(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          randomUUID(),
          'synthetic-existing-github',
          'github',
          owner,
          Date.now(),
          Date.now(),
        )
        .run();
    await addGithub();
    const read = await request('', {}, 'GET');
    const body = await read.text();
    assert.equal(read.status, 200);
    assert.equal(
      JSON.parse(body).providers.filter((p: { linked: boolean }) => p.linked)
        .length,
      2,
    );
    assert(
      !body.includes(token) &&
        !body.includes('synthetic-google-subject') &&
        !body.includes('synthetic-existing-github'),
    );
    assert.equal(
      (await request('/google/unlink', { Origin: 'https://foreign.example' }))
        .status,
      403,
    );
    actor = randomUUID();
    assert.equal((await request('/google/unlink')).status, 401);
    actor = owner;
    await db
      .prepare('UPDATE owner_sessions SET createdAt=? WHERE id=?')
      .bind(Date.now() - 301000, sessionId)
      .run();
    assert.equal((await request('/google/unlink')).status, 403);
    await db
      .prepare('UPDATE owner_sessions SET createdAt=? WHERE id=?')
      .bind(Date.now(), sessionId)
      .run();
    const pair = await Promise.all([
      request('/google/unlink'),
      request('/github/unlink'),
    ]);
    assert.deepEqual(pair.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) n FROM oauth_accounts WHERE userId=?')
          .bind(owner)
          .first<{ n: number }>()
      )?.n,
      1,
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='owner.provider_unlinked'",
          )
          .first<{ n: number }>()
      )?.n,
      1,
    );
    assert(
      stagingCollaborationOwnerRequestAllowed(
        'GET',
        '/api/v1/account/providers',
      ),
    );
    assert(
      !stagingCollaborationGuestRequestAllowed(
        'GET',
        '/api/v1/account/providers',
      ),
    );

    // Reset only synthetic identities, then exercise the actual BetterAuth authorize/callback chain.
    await db
      .prepare(
        "DELETE FROM oauth_accounts WHERE userId=? AND providerId='github'",
      )
      .bind(owner)
      .run();
    if (
      !(await db
        .prepare(
          "SELECT 1 FROM oauth_accounts WHERE userId=? AND providerId='google'",
        )
        .bind(owner)
        .first())
    )
      await db
        .prepare(
          "INSERT INTO oauth_accounts(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,'google',?,?,?)",
        )
        .bind(
          randomUUID(),
          'synthetic-google-subject',
          owner,
          Date.now(),
          Date.now(),
        )
        .run();
    const { makeSignature } = (await import(
      require.resolve('better-auth/crypto')
    )) as { makeSignature(token: string, secret: string): Promise<string> };
    const sessionCookie =
      'kino-owner.session_token=' +
      encodeURIComponent(token + '.' + (await makeSignature(token, secret)));
    const auth = createAuth(env);
    const start = await request('/github/link', { Cookie: sessionCookie });
    assert.equal(start.status, 200);
    const redirect = new URL(((await start.json()) as { url: string }).url);
    const cookies = [
      sessionCookie,
      ...start.headers.getSetCookie().map((cookie) => cookie.split(';')[0]),
    ].join('; ');
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (
          url.hostname === 'github.com' &&
          url.pathname.includes('access_token')
        )
          return Response.json({
            access_token: 'synthetic-provider-token',
            token_type: 'bearer',
            scope: 'read:user user:email',
          });
        if (url.hostname === 'api.github.com')
          return Response.json(
            url.pathname.endsWith('/emails')
              ? [
                  {
                    email: 'synthetic-owner@example.test',
                    verified: true,
                    primary: true,
                  },
                ]
              : {
                  id: 123456789,
                  login: 'synthetic-owner',
                  name: 'Synthetic Owner',
                  email: 'synthetic-owner@example.test',
                },
          );
        if (['localhost', '127.0.0.1'].includes(url.hostname))
          return realFetch(input, init);
        throw new Error('UNEXPECTED_OUTBOUND');
      },
    );
    const callback = await auth.handler(
      new Request(
        origin +
          '/api/auth/callback/github?code=synthetic-code&state=' +
          encodeURIComponent(redirect.searchParams.get('state')!),
        { headers: { Cookie: cookies } },
      ),
    );
    assert.equal(callback.status, 302);
    assert.equal(
      new URL(callback.headers.get('Location')!).searchParams.get('link'),
      'success',
    );
    assert(
      await db
        .prepare(
          "SELECT 1 FROM oauth_accounts WHERE userId=? AND providerId='github' AND accountId='123456789'",
        )
        .bind(owner)
        .first(),
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='owner.provider_linked'",
          )
          .first<{ n: number }>()
      )?.n,
      1,
    );
  } finally {
    vi.unstubAllGlobals();
    await mf.dispose();
  }
}, 30000);
