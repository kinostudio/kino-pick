import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { login, origin } from '../helpers/browser';

const sessionSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_at: z.number(),
    user: z
      .object({ user_metadata: z.record(z.string(), z.unknown()) })
      .passthrough(),
  })
  .passthrough();

test('expired chunked session refresh persists HttpOnly cookies; concurrent refresh and logout replay fail closed', async ({
  page,
  browser,
}) => {
  await login(page);
  const cookies = (await page.context().cookies()).filter(
    (c) => c.name.includes('auth-token') && !c.name.includes('verifier'),
  );
  expect(cookies.length).toBeGreaterThan(0);
  const base = cookies[0]!.name.replace(/\.\d+$/, '');
  const encoded = cookies
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join('');
  const original = sessionSchema.parse(
    JSON.parse(
      Buffer.from(encoded.replace(/^base64-/, ''), 'base64url').toString(
        'utf8',
      ),
    ),
  );
  const expiredResponse = await page.request.post(
    'http://127.0.0.1:54329/__test/session/expire',
    {
      headers: { Authorization: `Bearer ${original.access_token}` },
    },
  );
  expect(expiredResponse.status()).toBe(200);
  const expired = sessionSchema.parse(await expiredResponse.json());
  expect(expired.expires_at).toBeLessThan(Date.now() / 1000);
  // Force real SDK cookie chunk assembly; extra metadata is untrusted and must
  // never substitute for getUser identity verification.
  expired.user.user_metadata.padding = 'x'.repeat(6000);
  const value =
    'base64-' + Buffer.from(JSON.stringify(expired)).toString('base64url');
  const chunks = value.match(/.{1,3000}/g)!;
  expect(chunks.length).toBeGreaterThan(1);
  await page.context().clearCookies({ name: /auth-token/ });
  await page.context().addCookies(
    chunks.map((part, i) => ({
      ...cookies[0]!,
      name: `${base}.${i}`,
      value: part,
    })),
  );
  const [first, second] = await Promise.all([
    page.request.get('/api/v1/me'),
    page.request.get('/api/v1/me'),
  ]);
  expect(first.status()).toBe(200);
  expect(second.status()).toBe(200);
  expect(first.headers()['cache-control']).toContain('no-store');
  const updated = (await page.context().cookies()).filter(
    (c) => c.name.includes('auth-token') && !c.name.includes('verifier'),
  );
  expect(updated.every((c) => c.httpOnly && c.sameSite === 'Lax')).toBe(true);
  const updatedValue = updated
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join('');
  const refreshed = sessionSchema.parse(
    JSON.parse(
      Buffer.from(updatedValue.replace(/^base64-/, ''), 'base64url').toString(
        'utf8',
      ),
    ),
  );
  expect(refreshed.access_token).not.toBe(expired.access_token);
  expect(refreshed.expires_at).toBeGreaterThan(Date.now() / 1000);
  await page.reload();
  await expect(page.getByRole('heading', { name: '攝影工作台' })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'auth-token',
  );
  expect((await page.request.get('/api/v1/me')).status()).toBe(200);

  const oldReplay = await browser.newContext({ baseURL: origin });
  const rotatedReplay = await browser.newContext({ baseURL: origin });
  await oldReplay.addCookies(cookies);
  await rotatedReplay.addCookies(updated);
  expect((await oldReplay.request.get('/api/v1/me')).status()).toBe(200);
  const signout = await page.request.post('/auth/logout', {
    headers: { Origin: origin },
  });
  expect(signout.status()).toBe(200); // follows the fixed 303 login redirect
  expect((await oldReplay.request.get('/api/v1/me')).status()).toBe(401);
  expect((await rotatedReplay.request.get('/api/v1/me')).status()).toBe(401);
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await oldReplay.close();
  await rotatedReplay.close();
});

test('expired chunked session refreshes on direct dashboard navigation before any writable API', async ({
  page,
}) => {
  await login(page);
  const cookies = (await page.context().cookies()).filter(
    (c) => c.name.includes('auth-token') && !c.name.includes('verifier'),
  );
  expect(cookies.length).toBeGreaterThan(0);
  const base = cookies[0]!.name.replace(/\.\d+$/, '');
  const decode = (value: string) =>
    sessionSchema.parse(
      JSON.parse(
        Buffer.from(value.replace(/^base64-/, ''), 'base64url').toString(
          'utf8',
        ),
      ),
    );
  const original = decode(
    cookies
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.value)
      .join(''),
  );
  const expiredResponse = await page.request.post(
    'http://127.0.0.1:54329/__test/session/expire',
    { headers: { Authorization: `Bearer ${original.access_token}` } },
  );
  expect(expiredResponse.status()).toBe(200);
  const expired = sessionSchema.parse(await expiredResponse.json());
  expired.user.user_metadata.padding = 'x'.repeat(6000);
  const parts = (
    'base64-' + Buffer.from(JSON.stringify(expired)).toString('base64url')
  ).match(/.{1,3000}/g)!;
  expect(parts.length).toBeGreaterThan(1);
  await page.context().clearCookies({ name: /auth-token/ });
  await page
    .context()
    .addCookies(
      parts.map((value, i) => ({
        ...cookies[0]!,
        name: `${base}.${i}`,
        value,
      })),
    );
  // RSC auth cannot write cookies; the hosting adapter must preserve proxy updates.
  const response = await page.goto('/dashboard');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cache-control']).toContain('no-store');
  expect(response?.headers()['vary']?.toLowerCase()).toContain('cookie');
  await expect(page.getByRole('heading', { name: '攝影工作台' })).toBeVisible();
  const updated = (await page.context().cookies()).filter(
    (c) => c.name.includes('auth-token') && !c.name.includes('verifier'),
  );
  expect(updated.length).toBeGreaterThan(0);
  expect(updated.every((c) => c.httpOnly && c.sameSite === 'Lax')).toBe(true);
  const refreshed = decode(
    updated
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.value)
      .join(''),
  );
  expect(refreshed.access_token).not.toBe(expired.access_token);
  expect(refreshed.expires_at).toBeGreaterThan(Date.now() / 1000);
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'auth-token',
  );
  expect((await page.request.get('/api/v1/me')).status()).toBe(200);
});
