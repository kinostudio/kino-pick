import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  actorSchema,
  verifiedOAuthUserSchema,
  supportedOAuthProviders,
} from '@kino-pic/contracts';
import type { Database } from '@kino-pic/db';
import { authConfig, sessionCookieOptions } from './config';
import { ApiError } from '../http';
export async function serverClient(writable = false) {
  const config = authConfig();
  if (
    config.AUTH_DRIVER !== 'supabase' ||
    !config.SUPABASE_URL ||
    !config.SUPABASE_PUBLISHABLE_KEY
  )
    throw new ApiError('AUTH_UNAVAILABLE', 503, '登入服務尚未設定');
  const store = await cookies();
  return createServerClient<Database>(
    config.SUPABASE_URL,
    config.SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: sessionCookieOptions(config.APP_URL),
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items) => {
          for (const { name, value, options } of items) {
            if (writable)
              store.set(name, value, {
                ...options,
                ...sessionCookieOptions(config.APP_URL),
              });
            // Server Components cannot write cookies. Proxy refreshes them before render.
          }
        },
      },
    },
  );
}
export async function authenticatedContext(writable = false) {
  const client = await serverClient(writable);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('AUTH_REQUIRED', 401, '請先登入');
  const user = verifiedOAuthUserSchema.parse(data.user);
  const linkedProviders = supportedOAuthProviders(user);
  const config = authConfig();
  const providers = linkedProviders.filter((provider) =>
    config.AUTH_PROVIDERS.includes(provider),
  );
  const provider = providers[0];
  if (!provider)
    throw new ApiError(
      'OAUTH_IDENTITY_REQUIRED',
      403,
      '請使用平台已啟用的登入方式',
    );
  return {
    client,
    // Representative eligible identity; this does not identify the current login method.
    actor: actorSchema.parse({ id: user.id, provider }),
    providers,
    linkedProviders,
  };
}
