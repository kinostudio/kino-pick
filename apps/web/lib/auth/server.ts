import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { actorSchema } from '@kino-pic/contracts';
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
const verifiedUserSchema = z.object({
  id: z.uuid(),
  identities: z.array(z.object({ provider: z.string() })).optional(),
});
export async function authenticatedContext(writable = false) {
  const client = await serverClient(writable);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('AUTH_REQUIRED', 401, '請先登入');
  const user = verifiedUserSchema.parse(data.user);
  if (!user.identities?.some((i) => i.provider === 'google'))
    throw new ApiError(
      'GOOGLE_IDENTITY_REQUIRED',
      403,
      '請使用 Google 攝影師帳號登入',
    );
  return {
    client,
    actor: actorSchema.parse({ id: user.id, provider: 'google' }),
  };
}
