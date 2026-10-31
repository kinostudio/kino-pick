import { describe, expect, it } from 'vitest';
import {
  oauthProviderCapabilities,
  oauthProviderCredentials,
} from '../../apps/worker/src/oauth-provider-capabilities';

describe('OAuth provider capabilities', () => {
  it('reports only a provider with a complete configured credential pair', () => {
    expect(
      oauthProviderCapabilities({
        GITHUB_CLIENT_ID: 'github-client-id',
        GITHUB_CLIENT_SECRET: 'github-client-secret',
      }),
    ).toEqual({ providers: ['github'] });
  });

  it('fails closed for partial or blank credential pairs', () => {
    const env = {
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: '   ',
      GITHUB_CLIENT_ID: 'github-client-id',
    };

    expect(oauthProviderCapabilities(env)).toEqual({ providers: [] });
    expect(oauthProviderCredentials(env, 'google')).toBeNull();
    expect(oauthProviderCredentials(env, 'github')).toBeNull();
  });

  it('returns provider names only and never includes configured credentials', () => {
    const env = {
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GITHUB_CLIENT_ID: 'github-client-id',
      GITHUB_CLIENT_SECRET: 'github-client-secret',
    };
    const response = oauthProviderCapabilities(env);
    const body = JSON.stringify(response);

    expect(response).toEqual({ providers: ['google', 'github'] });
    expect(body).not.toContain('google-client-id');
    expect(body).not.toContain('google-client-secret');
    expect(body).not.toContain('github-client-id');
    expect(body).not.toContain('github-client-secret');
  });
});
