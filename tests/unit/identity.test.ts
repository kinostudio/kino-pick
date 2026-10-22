import { describe, it, expect } from 'vitest';
import {
  authConfigSchema,
  createWorkspaceSchema,
  memberInputSchema,
  isSameOriginMutation,
} from '../../packages/contracts/src/identity';
import { readJson, apiFailure, ApiError } from '../../apps/web/lib/http';
describe('identity input and transport policy', () => {
  it('does not accept an actor/tenant override when provisioning', () => {
    const input = {
      name: '  工作室  ',
      requestId: '11111111-1111-4111-8111-111111111111',
    };
    expect(createWorkspaceSchema.parse(input).name).toBe('工作室');
    expect(
      createWorkspaceSchema.safeParse({
        ...input,
        ownerUserId: input.requestId,
      }).success,
    ).toBe(false);
    expect(
      memberInputSchema.safeParse({
        userId: input.requestId,
        requestId: input.requestId,
        role: 'workspace_owner',
        status: 'active',
      }).success,
    ).toBe(false);
  });
  it('allows only configured HTTPS or local loopback origins', () => {
    expect(
      authConfigSchema.safeParse({ AUTH_DRIVER: 'supabase' }).success,
    ).toBe(false);
    for (const APP_URL of [
      'http://evil.example',
      'https://site.example/path',
      'https://user:pass@site.example',
      'https://site.example/?q=1',
    ])
      expect(authConfigSchema.safeParse({ APP_URL }).success).toBe(false);
    expect(
      authConfigSchema.safeParse({
        APP_URL: 'http://127.0.0.1:3100',
        AUTH_DRIVER: 'supabase',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }).success,
    ).toBe(true);
    expect(
      authConfigSchema.safeParse({
        APP_ENV: 'production',
        APP_URL: 'http://localhost:3000',
      }).success,
    ).toBe(false);
  });
  it('rejects privileged keys, including legacy JWT keys', () => {
    for (const key of [
      'sb_secret_test',
      'not-a-publishable-key',
      `e30.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`,
    ])
      expect(
        authConfigSchema.safeParse({ SUPABASE_PUBLISHABLE_KEY: key }).success,
      ).toBe(false);
  });
  it('rejects missing, cross-site, host-spoofed and prefix-matching Origins', () => {
    const request = (origin?: string, site?: string) =>
      new Request('https://attacker.example/api', {
        method: 'POST',
        headers: {
          ...(origin ? { Origin: origin } : {}),
          ...(site ? { 'sec-fetch-site': site } : {}),
        },
      });
    expect(
      isSameOriginMutation(
        request('https://kino.example'),
        'https://kino.example',
      ),
    ).toBe(true);
    for (const req of [
      request(),
      request('https://kino.example.attacker.example'),
      request('https://attacker.example'),
      request('https://kino.example', 'cross-site'),
    ])
      expect(isSameOriginMutation(req, 'https://kino.example')).toBe(false);
  });
  it('enforces actual body size, MIME, valid JSON and redacts unexpected errors', async () => {
    await expect(
      readJson(new Request('http://localhost', { method: 'POST', body: '{}' })),
    ).rejects.toThrow('需要 JSON');
    const req = (body: string) =>
      new Request('http://localhost', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      });
    await expect(readJson(req('x'.repeat(17000)))).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(readJson(req('{'))).rejects.toBeInstanceOf(ApiError);
    expect(await readJson(req('{"name":"test"}'))).toEqual({ name: 'test' });
    expect(
      JSON.stringify(await apiFailure(new Error('secret-value')).json()),
    ).not.toContain('secret-value');
  });
});

it('accepts opaque form Origin only with same-origin Fetch Metadata', () => {
  const make = (site: string) =>
    new Request('http://localhost', {
      method: 'POST',
      headers: { Origin: 'null', 'sec-fetch-site': site },
    });
  expect(isSameOriginMutation(make('same-origin'), 'http://localhost')).toBe(
    true,
  );
  for (const site of ['same-site', 'cross-site', 'none'])
    expect(isSameOriginMutation(make(site), 'http://localhost')).toBe(false);
});
