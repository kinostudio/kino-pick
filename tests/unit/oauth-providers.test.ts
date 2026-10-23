import { it, expect } from 'vitest';
import {
  isTrustedOAuthRedirect,
  isTrustedLinkRedirect,
} from '../../apps/web/lib/auth/oauth-url';
import {
  actorSchema,
  authConfigSchema,
  supportedOAuthProviders,
  verifiedOAuthUserSchema,
} from '../../packages/contracts/src/identity';
const id = '11111111-1111-4111-8111-111111111111';
it('accepts only verified supported identities, never email or app metadata', () => {
  expect(actorSchema.parse({ id, provider: 'github' }).provider).toBe('github');
  expect(actorSchema.safeParse({ id, provider: 'email' }).success).toBe(false);
  expect(
    supportedOAuthProviders({
      id,
      identities: [
        { provider: 'github' },
        { provider: 'google' },
        { provider: 'github' },
      ],
    }),
  ).toEqual(['google', 'github']);
  expect(
    supportedOAuthProviders({
      id,
      email: 'a@example.test',
      app_metadata: { provider: 'google' },
      identities: [{ provider: 'email' }],
    }),
  ).toEqual([]);
  expect(
    verifiedOAuthUserSchema.safeParse({
      id: 'forged',
      identities: [{ provider: 'github' }],
    }).success,
  ).toBe(false);
});
it('validates configured provider allowlist and fails closed on misspellings', () => {
  expect(authConfigSchema.parse({}).AUTH_PROVIDERS).toEqual(['google']);
  expect(
    authConfigSchema.parse({ AUTH_PROVIDERS: 'github, google' }).AUTH_PROVIDERS,
  ).toEqual(['github', 'google']);
  for (const AUTH_PROVIDERS of [
    '',
    'google,google',
    'twitter',
    'google,github,email',
  ])
    expect(authConfigSchema.safeParse({ AUTH_PROVIDERS }).success).toBe(false);
});
it('requires explicit opt-in for manual linking', () => {
  expect(authConfigSchema.parse({}).AUTH_MANUAL_LINKING_ENABLED).toBe(false);
  expect(
    authConfigSchema.parse({ AUTH_MANUAL_LINKING_ENABLED: 'true' })
      .AUTH_MANUAL_LINKING_ENABLED,
  ).toBe(true);
  expect(
    authConfigSchema.safeParse({ AUTH_MANUAL_LINKING_ENABLED: 'yes' }).success,
  ).toBe(false);
});

it('allows real provider link authorize endpoints with exact Supabase callback only', () => {
  const config = {
    APP_ENV: 'production' as const,
    SUPABASE_URL: 'https://project.supabase.co',
  };
  const uri = encodeURIComponent(
    'https://project.supabase.co/auth/v1/callback',
  );
  expect(
    isTrustedLinkRedirect(
      `https://github.com/login/oauth/authorize?redirect_uri=${uri}`,
      'github',
      config,
    ),
  ).toBe(true);
  for (const path of ['/o/oauth2/auth', '/o/oauth2/v2/auth'])
    expect(
      isTrustedLinkRedirect(
        `https://accounts.google.com${path}?redirect_uri=${uri}`,
        'google',
        config,
      ),
    ).toBe(true);
  for (const url of [
    `https://github.com.attacker.example/login/oauth/authorize?redirect_uri=${uri}`,
    `https://github.com/login?redirect_uri=${uri}`,
    'https://github.com/login/oauth/authorize?redirect_uri=https://attacker.example',
    `https://github.com/login/oauth/authorize?redirect_uri=${uri}&redirect_uri=${uri}`,
    `https://user@github.com/login/oauth/authorize?redirect_uri=${uri}`,
    `https://github.com/login/oauth/authorize?redirect_uri=${uri}#token`,
    'https://project.supabase.co/auth/v1/authorize',
  ])
    expect(isTrustedLinkRedirect(url, 'github', config)).toBe(false);
  expect(
    isTrustedLinkRedirect(
      `https://github.com/login/oauth/authorize?redirect_uri=${uri}`,
      'google',
      config,
    ),
  ).toBe(false);
});
it('permits local fixture redirect only in nonproduction and keeps normal login restricted', () => {
  const config = {
    APP_ENV: 'test' as const,
    SUPABASE_URL: 'http://127.0.0.1:54329',
  };
  expect(
    isTrustedLinkRedirect(
      'http://127.0.0.1:54329/auth/v1/authorize?link_flow=fixture',
      'github',
      config,
    ),
  ).toBe(true);
  expect(
    isTrustedLinkRedirect(
      'http://127.0.0.1:54329/auth/v1/authorize',
      'github',
      { ...config, APP_ENV: 'production' },
    ),
  ).toBe(false);
  expect(
    isTrustedLinkRedirect(
      'http://127.0.0.1:54329.attacker.example/auth/v1/authorize',
      'github',
      config,
    ),
  ).toBe(false);
  expect(
    isTrustedOAuthRedirect(
      'https://project.supabase.co/auth/v1/authorize',
      'https://project.supabase.co',
    ),
  ).toBe(true);
  for (const url of [
    'https://project.supabase.co.attacker.example',
    'https://github.com/login/oauth/authorize',
    'https://user@project.supabase.co/auth/v1/authorize',
    'javascript:alert(1)',
  ])
    expect(isTrustedOAuthRedirect(url, 'https://project.supabase.co')).toBe(
      false,
    );
});
