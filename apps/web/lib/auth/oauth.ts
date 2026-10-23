import 'server-only';
import { NextResponse } from 'next/server';
import { isTrustedOAuthRedirect } from './oauth-url';
import type { OAuthProvider, AuthConfig } from '@kino-pic/contracts';
import { authConfig } from './config';
import { serverClient } from './server';
import { ApiError, apiFailure, requireOrigin } from '../http';
export const providerLabels: Record<OAuthProvider, string> = {
  google: 'Google',
  github: 'GitHub',
};
export const providerScopes: Record<OAuthProvider, string> = {
  google: 'openid email profile',
  github: 'read:user user:email',
};
export function requireEnabledProvider(
  config: AuthConfig,
  provider: OAuthProvider,
) {
  if (!config.AUTH_PROVIDERS.includes(provider))
    throw new ApiError('OAUTH_PROVIDER_DISABLED', 503, '此登入方式尚未開放');
}
export function fixedAuthRedirect(path: string, appUrl: string) {
  const response = NextResponse.redirect(new URL(path, appUrl), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie');
  return response;
}
export function supabaseOAuthRedirect(url: string, config: AuthConfig) {
  if (!config.SUPABASE_URL || !isTrustedOAuthRedirect(url, config.SUPABASE_URL))
    throw new ApiError('AUTH_UNAVAILABLE', 503, '登入位址無效');
  return fixedAuthRedirect(url, config.APP_URL);
}
export async function startOAuth(request: Request, provider: OAuthProvider) {
  try {
    const config = authConfig();
    requireOrigin(request, config.APP_URL);
    requireEnabledProvider(config, provider);
    const client = await serverClient(true);
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: new URL('/auth/callback', config.APP_URL).href,
        skipBrowserRedirect: true,
        scopes: providerScopes[provider],
      },
    });
    if (error || !data.url)
      throw new ApiError('AUTH_UNAVAILABLE', 503, '目前無法登入');
    return supabaseOAuthRedirect(data.url, config);
  } catch (error) {
    return apiFailure(error);
  }
}
