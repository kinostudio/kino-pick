import type { AuthConfig, OAuthProvider } from '@kino-pic/contracts';
function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}
export function isTrustedOAuthRedirect(value: string, supabaseUrl: string) {
  const target = safeUrl(value);
  const supabase = safeUrl(supabaseUrl);
  return !!target && !!supabase && target.origin === supabase.origin;
}
export function isTrustedLinkRedirect(
  value: string,
  provider: OAuthProvider,
  config: Pick<AuthConfig, 'APP_ENV' | 'SUPABASE_URL'>,
) {
  const target = safeUrl(value);
  const supabase = config.SUPABASE_URL ? safeUrl(config.SUPABASE_URL) : null;
  if (!target || !supabase) return false;
  // The independent test Auth service replaces the external provider on loopback.
  const localFixture =
    ['local', 'test'].includes(config.APP_ENV) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(supabase.hostname) &&
    ['http:', 'https:'].includes(supabase.protocol) &&
    target.origin === supabase.origin;
  if (localFixture) return true;
  const expectedProvider =
    provider === 'google'
      ? target.origin === 'https://accounts.google.com' &&
        ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(target.pathname)
      : target.origin === 'https://github.com' &&
        target.pathname === '/login/oauth/authorize';
  return (
    expectedProvider &&
    target.searchParams.getAll('redirect_uri').length === 1 &&
    target.searchParams.get('redirect_uri') ===
      new URL('/auth/v1/callback', supabase).href
  );
}
