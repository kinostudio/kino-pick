import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth/config';
import { serverClient } from '@/lib/auth/server';
import { ApiError, apiFailure, requireOrigin } from '@/lib/http';
export async function POST(request: Request) {
  try {
    const config = authConfig();
    requireOrigin(request, config.APP_URL);
    const client = await serverClient(true);
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error)
      throw new ApiError('AUTH_UNAVAILABLE', 503, '登出未完成，請重試');
    const response = NextResponse.redirect(
      new URL('/login', config.APP_URL),
      303,
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return apiFailure(error);
  }
}
