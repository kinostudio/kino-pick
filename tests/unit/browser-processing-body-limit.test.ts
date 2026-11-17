import { Hono } from '../../apps/worker/node_modules/hono';
import { expect, it } from 'vitest';
import { browserDerivativesBodyLimit } from '../../apps/worker/src/browser-processing-routes';

it('rejects oversized derivative requests before invoking the upload handler', async () => {
  const app = new Hono();
  let handled = false;
  app.use('*', browserDerivativesBodyLimit);
  app.post('/', async (c) => {
    await c.req.arrayBuffer();
    handled = true;
    return c.text('accepted');
  });
  const declared = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Length': String(5 * 1024 * 1024) },
    body: 'tiny',
  });
  expect(declared.status).toBe(413);
  expect(handled).toBe(false);
  const actual = await app.request('/', {
    method: 'POST',
    body: new Uint8Array(5 * 1024 * 1024),
  });
  expect(actual.status).toBe(413);
  expect(handled).toBe(false);
  expect(await actual.json()).toEqual({ error: { code: 'BODY_TOO_LARGE' } });
});
