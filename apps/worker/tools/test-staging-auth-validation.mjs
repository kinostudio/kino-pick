import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
const cfg = ts.parseConfigFileTextToJson(
  'auth-validation',
  await readFile('wrangler.auth-validation.jsonc', 'utf8'),
).config;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'staging-auth-validation',
        modules: true,
        scriptPath: resolve(
          '.local/auth-validation-build/staging-auth-validation-worker.js',
        ),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...cfg.vars,
          BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
          GITHUB_CLIENT_ID: 'local-validation-client',
          GITHUB_CLIENT_SECRET: randomBytes(32).toString('hex'),
        },
        d1Databases: { DB: 'isolated-auth-validation' },
      },
    ],
  }),
);
const origin = cfg.vars.APP_URL,
  checks = [];
async function check(label, path, init, status, body) {
  const response = await mf.dispatchFetch(origin + path, init);
  assert.equal(response.status, status, label);
  assert.ok(
    response.headers.get('cache-control')?.includes('no-store'),
    label + ' cache',
  );
  if (body) assert.ok((await response.text()).includes(body), label + ' body');
  checks.push(label);
}
try {
  await check('anonymous-login-page', '/', {}, 200, '尚未登入');
  await check(
    'anonymous-session',
    '/api/validation/session',
    {},
    200,
    '"authenticated":false',
  );
  await check(
    'forged-session',
    '/api/validation/session',
    { headers: { Cookie: '__Secure-kino-owner.session_token=forged' } },
    200,
    '"authenticated":false',
  );
  await check('no-product-api', '/api/v1/workspaces', {}, 404);
  await check(
    'registration-closed',
    '/api/auth/sign-up/email',
    {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    },
    404,
  );
  await check(
    'origin-denial',
    '/api/auth/sign-in/social',
    {
      method: 'POST',
      headers: {
        Origin: 'https://foreign.invalid',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    403,
  );
  await check(
    'method-denial',
    '/api/auth/sign-in/social',
    { method: 'DELETE', headers: { Origin: origin } },
    405,
  );
  await check(
    'provider-denial',
    '/api/auth/sign-in/social',
    {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: origin + '/' }),
    },
    400,
  );
  await check(
    'redirect-denial',
    '/api/auth/sign-in/social',
    {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'github',
        callbackURL: 'https://foreign.invalid/',
      }),
    },
    400,
  );
  await check(
    'bounded-body',
    '/api/auth/sign-in/social',
    {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: 'x'.repeat(16385),
    },
    413,
  );
  const report = {
    status: 'passed_local_auth_validation',
    checks,
    sourceSha256: createHash('sha256')
      .update(await readFile('tools/staging-auth-validation-worker.ts'))
      .digest('hex'),
    configSha256: createHash('sha256')
      .update(await readFile('wrangler.auth-validation.jsonc'))
      .digest('hex'),
  };
  await writeFile(
    '.local/staging-auth-validation-local-proof.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: checks.length,
      remoteNetworkAuth: false,
    }),
  );
} finally {
  await mf.dispose();
}
