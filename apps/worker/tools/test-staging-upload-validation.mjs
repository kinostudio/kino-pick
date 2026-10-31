import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import ts from 'typescript';
const cfg = ts.parseConfigFileTextToJson(
  'upload-validation',
  await readFile('wrangler.upload-validation.jsonc', 'utf8'),
).config;
const origin = cfg.vars.APP_URL,
  bundle = resolve(
    '.local/upload-validation-build/staging-upload-validation-worker.js',
  );
const bindings = {
  ...cfg.vars,
  BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
  GITHUB_CLIENT_ID: 'isolated-validation-client',
  GITHUB_CLIENT_SECRET: randomBytes(32).toString('hex'),
  IMAGES: {},
};
// The empty Images object is an explicit presence double. No image/provider calls occur here.
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'valid',
        modules: true,
        scriptPath: bundle,
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        d1Databases: { DB: 'isolated-upload-validation' },
        r2Buckets: { PRIMARY_STORAGE: 'isolated-upload-validation' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
      },
      {
        name: 'wrong-mode',
        modules: true,
        scriptPath: bundle,
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { ...bindings, APP_ENV: 'local' },
      },
      {
        name: 'guest-enabled',
        modules: true,
        scriptPath: bundle,
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { ...bindings, GUEST_EXCHANGE_ENABLED: 'true' },
      },
    ],
  }),
);
const checks = [];
async function check(name, path, init, status) {
  const response = await mf.dispatchFetch(origin + path, init);
  assert.equal(response.status, status, name);
  checks.push(name);
  return response;
}
try {
  await check(
    'anonymous-private-upload-denied',
    '/api/v1/uploads/init',
    {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    },
    401,
  );
  await check('anonymous-workspaces-denied', '/api/v1/workspaces', {}, 401);
  await check('anonymous-storage-denied', '/api/v1/storage/nodes', {}, 401);
  await check('guest-api-isolated', '/api/guest/capabilities', {}, 404);
  await check('guest-page-isolated', '/guest/albums/example', {}, 404);
  await check(
    'registration-route-closed',
    '/api/auth/sign-up/email',
    { method: 'POST', headers: { Origin: origin } },
    404,
  );
  await check(
    'foreign-origin-rejected',
    '/api/v1/uploads/init',
    { method: 'POST', headers: { Origin: 'https://foreign.invalid' } },
    403,
  );
  await check(
    'missing-origin-rejected',
    '/api/auth/sign-in/social',
    { method: 'POST' },
    403,
  );
  await check(
    'delete-unavailable',
    '/api/v1/workspaces/example',
    { method: 'DELETE' },
    405,
  );
  await check('encoded-guest-alias-denied', '/%67uest/albums/example', {}, 404);
  const wrongHost = await mf.dispatchFetch(
    'https://foreign.invalid/api/v1/workspaces',
  );
  assert.equal(wrongHost.status, 403);
  checks.push('wrong-host-rejected');
  for (const name of ['wrong-mode', 'guest-enabled']) {
    const worker = await mf.getWorker(name);
    assert.equal((await worker.fetch(origin + '/')).status, 503);
    checks.push(name + '-fails-closed');
  }
  const page = await check('actual-static-login-page', '/', {}, 200);
  assert.match(await page.text(), /<div id="root"/);
  assert.equal(page.headers.get('X-Kino-Validation'), 'owner-upload-only');
  const report = {
    status: 'passed_local_upload_validation',
    checks,
    remoteProviderTested: false,
    sourceSha256: createHash('sha256')
      .update(await readFile('tools/staging-upload-validation-worker.ts'))
      .digest('hex'),
    configSha256: createHash('sha256')
      .update(await readFile('wrangler.upload-validation.jsonc'))
      .digest('hex'),
    bundleSha256: createHash('sha256')
      .update(await readFile(bundle))
      .digest('hex'),
  };
  await writeFile(
    '.local/staging-upload-validation-local-proof.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: checks.length,
      remoteProviderTested: false,
    }),
  );
} finally {
  await mf.dispose();
}
