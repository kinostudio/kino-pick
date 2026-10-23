import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { oauthProviderSchema } from '@kino-pic/contracts';
import { OAuthLinkRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig, sessionCookieOptions } from '@/lib/auth/config';
import {
  fixedAuthRedirect,
  providerScopes,
  requireEnabledProvider,
} from '@/lib/auth/oauth';
import { isTrustedLinkRedirect } from '@/lib/auth/oauth-url';
import { ApiError, apiFailure, requireOrigin } from '@/lib/http';
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  let clearIntent: (() => void) | undefined;
  try {
    const config = authConfig();
    requireOrigin(request, config.APP_URL);
    const provider = oauthProviderSchema.parse((await context.params).provider);
    requireEnabledProvider(config, provider);
    if (!config.AUTH_MANUAL_LINKING_ENABLED)
      throw new ApiError('LINKING_DISABLED', 503, '目前尚未開放新增登入方式');
    const current = await authenticatedContext(true);
    if (current.linkedProviders.includes(provider))
      throw new ApiError('IDENTITY_ALREADY_LINKED', 409, '此登入方式已綁定');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await new OAuthLinkRepository(current.client, current.actor).begin({
      provider,
      tokenHash,
      requestId: randomUUID(),
    });
    const store = await cookies();
    const cookieOptions = sessionCookieOptions(config.APP_URL);
    store.set('kino-link-intent', token, { ...cookieOptions, maxAge: 600 });
    clearIntent = () =>
      store.set('kino-link-intent', '', { ...cookieOptions, maxAge: 0 });
    const { data, error } = await current.client.auth.linkIdentity({
      provider,
      options: {
        redirectTo: new URL('/auth/link/callback', config.APP_URL).href,
        skipBrowserRedirect: true,
        scopes: providerScopes[provider],
      },
    });
    if (
      error ||
      !data.url ||
      !isTrustedLinkRedirect(data.url, provider, config)
    )
      throw new ApiError('AUTH_UNAVAILABLE', 503, '目前無法綁定，請稍後再試');
    return fixedAuthRedirect(data.url, config.APP_URL);
  } catch (error) {
    clearIntent?.();
    return apiFailure(error);
  }
}
