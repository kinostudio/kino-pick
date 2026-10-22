import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceRepository } from '@kino-pic/db';
import { authConfig } from '@/lib/auth/config';
import { serverClient, authenticatedContext } from '@/lib/auth/server';
import { apiFailure } from '@/lib/http';
export async function GET(request: Request) {
  try {
    const config = authConfig();
    const query = new URL(request.url).searchParams;
    const code = z.string().min(1).max(4096).safeParse(query.get('code'));
    const failed = () => {
      const res = NextResponse.redirect(
        new URL('/login?error=auth_failed', config.APP_URL),
        303,
      );
      res.headers.set('Cache-Control', 'no-store');
      return res;
    };
    if (
      !code.success ||
      query.has('error') ||
      query.getAll('code').length !== 1
    )
      return failed();
    const client = await serverClient(true);
    const { error } = await client.auth.exchangeCodeForSession(code.data);
    if (error) return failed();
    try {
      const context = await authenticatedContext(true);
      await new WorkspaceRepository(
        context.client,
        context.actor,
      ).ensureProfile(randomUUID());
    } catch {
      await client.auth.signOut({ scope: 'local' });
      return failed();
    }
    // Fixed, configured destination. Ignore next/redirect/Host supplied by the browser.
    const response = NextResponse.redirect(
      new URL('/dashboard', config.APP_URL),
      303,
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return apiFailure(error);
  }
}
