import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authConfigSchema } from '@kino-pic/contracts';
import type { Database } from '@kino-pic/db';
export async function proxy(request: NextRequest) {
  const parsed = authConfigSchema.safeParse(process.env);
  let response = NextResponse.next({ request });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie');
  if (!parsed.success || parsed.data.AUTH_DRIVER !== 'supabase')
    return response;
  const config = parsed.data;
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return response;
  const client = createServerClient<Database>(
    config.SUPABASE_URL,
    config.SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        httpOnly: true,
        secure: new URL(config.APP_URL).protocol === 'https:',
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          response.headers.set('Cache-Control', 'private, no-store');
          response.headers.set('Vary', 'Cookie');
          for (const { name, value, options } of items)
            response.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              secure: new URL(config.APP_URL).protocol === 'https:',
              sameSite: 'lax',
              path: '/',
            });
        },
      },
    },
  );
  // Refresh only. Every protected handler independently verifies identity and DB scope.
  try {
    await client.auth.getUser();
  } catch {
    /* handlers fail closed */
  }
  return response;
}
export const config = { matcher: ['/dashboard/:path*', '/api/v1/:path*'] };
