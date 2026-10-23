import { workspaceChecks } from './workspaces.mjs';
// Real local workerd + D1 + R2; synthetic Google/GitHub services only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const base = 'http://127.0.0.1:8787';
const owner = '99999999-9999-4999-8999-999999999999';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  BETTER_AUTH_SECRET: 'synthetic-test-only-secret-at-least-forty-characters',
  GOOGLE_CLIENT_ID: 'local-google',
  GOOGLE_CLIENT_SECRET: 'fixture',
  GITHUB_CLIENT_ID: 'local-github',
  GITHUB_CLIENT_SECRET: 'fixture',
};
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'local-test',
  alg: 'RS256',
  use: 'sig',
};
let githubSubject = 101;
let googleSubject = '12345001';
let corruptGoogleSignature = false;
let activeAuth;
const jwt = (claims) => {
  const head = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'local-test', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  let signature = sign(
    'RSA-SHA256',
    Buffer.from(`${head}.${body}`),
    privateKey,
  ).toString('base64url');
  if (corruptGoogleSignature) signature = 'AAAA' + signature.slice(4);
  return `${head}.${body}.${signature}`;
};
const outbound = async (request) => {
  const url = new URL(request.url);
  if (url.href === 'https://www.googleapis.com/oauth2/v3/certs')
    return Response.json({ keys: [jwk] });
  if (
    url.href === 'https://oauth2.googleapis.com/token' ||
    url.href === 'https://github.com/login/oauth/access_token'
  ) {
    const body = new URLSearchParams(await request.text());
    if (activeAuth?.searchParams.get('code_challenge'))
      assert.equal(
        createHash('sha256')
          .update(body.get('code_verifier') ?? '')
          .digest('base64url'),
        activeAuth.searchParams.get('code_challenge'),
      );
    const now = Math.floor(Date.now() / 1000);
    return Response.json({
      access_token: 'synthetic-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read:user user:email',
      ...(url.hostname === 'oauth2.googleapis.com'
        ? {
            id_token: jwt({
              iss: 'https://accounts.google.com',
              aud: 'local-google',
              sub: googleSubject,
              email: 'shared@example.test',
              email_verified: true,
              name: 'Local owner',
              iat: now,
              exp: now + 3600,
              nonce: activeAuth?.searchParams.get('nonce') ?? undefined,
            }),
          }
        : {}),
    });
  }
  if (url.href === 'https://api.github.com/user')
    return Response.json({
      id: githubSubject,
      login: 'fixture',
      name: 'Local owner',
      email: 'shared@example.test',
      avatar_url: null,
    });
  if (url.href === 'https://api.github.com/user/emails')
    return Response.json([
      { email: 'shared@example.test', primary: true, verified: true },
    ]);
  throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
};
const temporary = await mkdtemp(join(tmpdir(), 'kino-cloudflare-'));
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('public'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'storage-test',
        modules: true,
        scriptPath: resolve('.build-storage/storage-harness.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        r2Buckets: { PRIMARY_STORAGE: 'test' },
      },
    ],
    d1Persist: join(temporary, 'd1'),
    r2Persist: join(temporary, 'r2'),
  }),
);
let checks = 0;
async function check(label, fn) {
  await fn();
  checks++;
  process.stdout.write(`passed: ${label}\n`);
}
try {
  const db = await mf.getD1Database('DB', 'app');
  for (const file of (await readdir('migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      (await readFile(join('migrations', file), 'utf8'))
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith('--'))
        .join('\n'),
    );
  const request = (path, init) => mf.dispatchFetch(base + path, init);
  await check(
    'static site, honest health and anonymous owner API denied',
    async () => {
      const page = await request('/');
      const pageText = await page.text();
      assert.equal(page.status, 200, pageText.slice(0, 1200));
      assert.match(pageText, /KINO Pic/);
      const health = await request('/api/health');
      assert.equal(health.status, 200);
      assert.equal((await health.json()).autodelete, false);
      assert.equal((await request('/api/v1/me')).status, 401);
      assert.equal((await request('/api/v1/storage/nodes')).status, 401);
    },
  );
  await check(
    'first OAuth visitor cannot self-provision an Owner',
    async () => {
      const result = await oauth('github');
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: result.cookies.headers() },
          })
        ).status,
        401,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        0,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM owners').first()).n,
        0,
      );
    },
  );
  await check(
    'one explicit bootstrap with two subjects to one fixed internal ID',
    async () => {
      const output = join(temporary, 'bootstrap.sql');
      const cli = spawnSync(
        process.execPath,
        [
          resolve('../../tools/bootstrap-cloudflare-owner.mjs'),
          '--user-id',
          owner,
          '--google-sub',
          '12345001',
          '--github-id',
          '101',
          '--verified-subjects',
          '--out',
          output,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(cli.status, 0, cli.stderr);
      const sql = (await readFile(output, 'utf8'))
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.startsWith('--'))
        .join('\n');
      await db.exec(
        "CREATE TRIGGER reject_bootstrap_audit BEFORE INSERT ON audit_events WHEN NEW.action='owner.bootstrapped' BEGIN SELECT RAISE(ABORT,'INJECTED_BOOTSTRAP_AUDIT_FAILURE'); END;",
      );
      await assert.rejects(db.exec(sql), /INJECTED_BOOTSTRAP_AUDIT_FAILURE/);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        0,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM owner_bootstrap').first())
          .n,
        0,
      );
      await db.exec('DROP TRIGGER reject_bootstrap_audit');
      await db.exec(sql);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(DISTINCT userId) AS n FROM oauth_accounts')
            .first()
        ).n,
        1,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM oauth_accounts').first())
          .n,
        2,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
          )
          .bind(crypto.randomUUID(), '102')
          .run(),
        /BOOTSTRAP_CLOSED/,
      );
      await assert.rejects(
        db.prepare('DELETE FROM owner_bootstrap').run(),
        /BOOTSTRAP_CLOSED/,
      );
    },
  );
  function jar() {
    const values = new Map();
    return {
      headers() {
        return [...values].map(([key, value]) => `${key}=${value}`).join('; ');
      },
      save(response) {
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';')[0];
          const index = pair.indexOf('=');
          const key = pair.slice(0, index);
          const value = pair.slice(index + 1);
          if (value) values.set(key, value);
          else values.delete(key);
        }
      },
      values,
    };
  }
  async function oauth(provider) {
    const cookies = jar();
    const start = await request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, callbackURL: base + '/' }),
    });
    assert.equal(start.status, 200);
    cookies.save(start);
    activeAuth = new URL((await start.json()).url);
    const state = activeAuth.searchParams.get('state');
    assert.ok(state);
    if (provider === 'google') {
      assert.ok(activeAuth.searchParams.get('code_challenge'));
      assert.equal(
        activeAuth.searchParams.get('code_challenge_method'),
        'S256',
      );
    }
    const callback = await request(
      `/api/auth/callback/${provider}?code=synthetic&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: cookies.headers() }, redirect: 'manual' },
    );
    cookies.save(callback);
    return { cookies, callback };
  }
  let githubCookies, googleCookies;
  await check(
    'mature GitHub OAuth state fixture logs into bootstrapped owner',
    async () => {
      const result = await oauth('github');
      assert.ok([302, 303].includes(result.callback.status));
      githubCookies = result.cookies;
      const me = await request('/api/v1/me', {
        headers: { Cookie: githubCookies.headers() },
      });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).actor.id, owner);
      const session = result.callback.headers
        .getSetCookie()
        .find((c) => c.startsWith('kino-owner.session_token='));
      assert.ok(session);
      assert.match(session, /HttpOnly/i);
      assert.match(session, /SameSite=Lax/i);
    },
  );
  await check(
    'mature Google OAuth validates fixture RSA ID token and returns same internal ID',
    async () => {
      const result = await oauth('google');
      googleCookies = result.cookies;
      assert.ok([302, 303].includes(result.callback.status));
      const me = await request('/api/v1/me', {
        headers: { Cookie: googleCookies.headers() },
      });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).actor.id, owner);
    },
  );
  await check(
    'same-email unapproved Google/GitHub subjects never register or implicitly link',
    async () => {
      githubSubject = 102;
      googleSubject = '12345002';
      for (const provider of ['github', 'google']) {
        const result = await oauth(provider);
        assert.equal(
          (
            await request('/api/v1/me', {
              headers: { Cookie: result.cookies.headers() },
            })
          ).status,
          401,
        );
      }
      githubSubject = 101;
      googleSubject = '12345001';
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        1,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM oauth_accounts').first())
          .n,
        2,
      );
      assert.equal(
        (
          await request('/api/auth/sign-up/email', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request('/api/auth/link-social', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
        404,
      );
    },
  );
  await check(
    'invalid Google ID token signature cannot create a session',
    async () => {
      corruptGoogleSignature = true;
      const result = await oauth('google');
      corruptGoogleSignature = false;
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: result.cookies.headers() },
          })
        ).status,
        401,
      );
    },
  );
  await check(
    'owner-only node metadata excludes endpoint/credential refs and cross-account routing stays off',
    async () => {
      const response = await request('/api/v1/storage/nodes', {
        headers: { Cookie: githubCookies.headers() },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const body = await response.json();
      assert.equal(body.nodes.length, 1);
      assert.equal(body.multiAccountEnabled, false);
      assert.equal(body.nodes[0].quota_bytes, 9000000000);
      assert.equal(body.nodes[0].credential_ref, undefined);
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO storage_nodes SELECT 'second',provider,account_id,bucket_name,endpoint,credential_ref,status,priority,quota_bytes,used_bytes,reserved_bytes,last_reconciled_at FROM storage_nodes WHERE id='primary'",
          )
          .run(),
        /MULTI_NODE_DISABLED/,
      );
    },
  );
  await check(
    'current owner disabled denies existing valid sessions; forged and revoked cookies fail closed',
    async () => {
      await db.prepare('UPDATE owners SET enabled=0').run();
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: githubCookies.headers() },
          })
        ).status,
        403,
      );
      await db.prepare('UPDATE owners SET enabled=1').run();
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: 'kino-owner.session_token=forged' },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request('/api/auth/sign-out', {
            method: 'POST',
            headers: {
              Origin: 'https://attacker.invalid',
              Cookie: githubCookies.headers(),
            },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/api/auth/sign-out', {
            method: 'POST',
            headers: {
              Origin: base,
              Cookie: githubCookies.headers(),
              'Content-Type': 'application/json',
            },
            body: '{}',
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: githubCookies.headers() },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: googleCookies.headers() },
          })
        ).status,
        200,
      );
    },
  );
  await workspaceChecks({
    check,
    request,
    db,
    cookies: googleCookies,
    owner,
    base,
  });
  await check(
    'SQL session/audit atomic rollback and append-only history',
    async () => {
      await db.exec(
        "CREATE TRIGGER fail_session_audit BEFORE INSERT ON audit_events WHEN NEW.action='owner.signed_in' BEGIN SELECT RAISE(ABORT,'INJECTED_AUDIT_FAILURE'); END;",
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            'rollback',
            'never-a-live-token',
            owner,
            Date.now() + 3600000,
            Date.now(),
            Date.now(),
          )
          .run(),
        /INJECTED_AUDIT_FAILURE/,
      );
      assert.equal(
        await db
          .prepare("SELECT id FROM owner_sessions WHERE id='rollback'")
          .first(),
        null,
      );
      await db.exec('DROP TRIGGER fail_session_audit');
      await assert.rejects(
        db.prepare('DELETE FROM audit_events').run(),
        /APPEND_ONLY_AUDIT/,
      );
    },
  );
  await check(
    'OAuth CSRF, unknown state, callback redirect and oversized body rejected',
    async () => {
      assert.equal(
        (
          await request('/api/auth/sign-in/social', {
            method: 'POST',
            headers: {
              Origin: 'https://attacker.invalid',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ provider: 'google' }),
          })
        ).status,
        403,
      );
      const oversized = await request('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(17000) }),
      });
      assert.equal(oversized.status, 413);
      const redirect = await request('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: 'https://attacker.invalid/',
        }),
      });
      assert.ok(redirect.status >= 400);
      const callback = await request(
        '/api/auth/callback/google?code=synthetic&state=invalid',
        { redirect: 'manual' },
      );
      assert.ok([302, 303, 400, 401].includes(callback.status));
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        1,
      );
    },
  );
  await check(
    'real R2 conditional immutable write, scoped read and disabled deletion',
    async () => {
      const storage = await mf.getWorker('storage-test');
      const scope = {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        albumId: '33333333-3333-4333-8333-333333333333',
      };
      const key = `${scope.workspaceId}/${scope.projectId}/${scope.albumId}/version-1.png`;
      const params = new URLSearchParams({ ...scope, key });
      const url = 'http://local.test/object?' + params;
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(
        (await storage.fetch(url, { method: 'PUT', body: bytes })).status,
        201,
      );
      assert.equal(
        (await storage.fetch(url, { method: 'PUT', body: new Uint8Array([0]) }))
          .status,
        409,
      );
      assert.deepEqual(
        new Uint8Array(await (await storage.fetch(url)).arrayBuffer()),
        bytes,
      );
      params.set('workspaceId', '44444444-4444-4444-8444-444444444444');
      assert.equal(
        (await storage.fetch('http://local.test/object?' + params)).status,
        409,
      );
      assert.equal(
        (await storage.fetch(url, { method: 'DELETE' })).status,
        409,
      );
      assert.deepEqual(
        new Uint8Array(await (await storage.fetch(url)).arrayBuffer()),
        bytes,
      );
    },
  );
  process.stdout.write(
    `${checks} local Cloudflare checks passed; real OAuth/remote resources not checked.\n`,
  );
} finally {
  await mf.dispose();
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('kino-cloudflare-'));
  await rm(temporary, { recursive: true, force: true });
}
