import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth/config';
import { serverClient } from '@/lib/auth/server';
import { ApiError, apiFailure, requireOrigin } from '@/lib/http';
export async function POST(request: Request) {
  try {
    const config = authConfig();
    requireOrigin(request, config.APP_URL);
    const client = await serverClient(true);
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL('/auth/callback', config.APP_URL).href,
        skipBrowserRedirect: true,
        scopes: 'openid email profile',
      },
    });
    if (error || !data.url)
      throw new ApiError('AUTH_UNAVAILABLE', 503, '目前無法登入');
    if (new URL(data.url).origin !== new URL(config.SUPABASE_URL!).origin)
      throw new ApiError('AUTH_UNAVAILABLE', 503, '登入位址無效');
    const response = NextResponse.redirect(data.url, 303);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return apiFailure(error);
  }
}
