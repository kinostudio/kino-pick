import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { OAuthLinkRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig, sessionCookieOptions } from '@/lib/auth/config';
import { fixedAuthRedirect } from '@/lib/auth/oauth';
import { apiFailure } from '@/lib/http';
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const codeSchema = z.string().min(1).max(4096);
export async function GET(request: Request) {
  try {
    const config = authConfig();
    const store = await cookies();
    const finish = (success: boolean) => {
      store.set('kino-link-intent', '', {
        ...sessionCookieOptions(config.APP_URL),
        maxAge: 0,
      });
      return fixedAuthRedirect(
        success
          ? '/dashboard/account?notice=linked'
          : '/dashboard/account?error=link_failed',
        config.APP_URL,
      );
    };
    if (
      config.AUTH_DRIVER !== 'supabase' ||
      !config.AUTH_MANUAL_LINKING_ENABLED
    )
      return finish(false);
    const query = new URL(request.url).searchParams;
    const token = tokenSchema.safeParse(store.get('kino-link-intent')?.value);
    const code = codeSchema.safeParse(query.get('code'));
    if (
      !token.success ||
      !code.success ||
      query.has('error') ||
      query.getAll('code').length !== 1
    )
      return finish(false);
    const tokenHash = createHash('sha256').update(token.data).digest('hex');
    let unverifiedSessionClient:
      Awaited<ReturnType<typeof authenticatedContext>>['client'] | null = null;
    try {
      // Check the current browser actor and server-held intent before accepting an OAuth code.
      const before = await authenticatedContext(true);
      const intent = await new OAuthLinkRepository(
        before.client,
        before.actor,
      ).get(tokenHash);
      if (
        intent.actorId !== before.actor.id ||
        !config.AUTH_PROVIDERS.includes(intent.provider)
      )
        return finish(false);
      unverifiedSessionClient = before.client;
      const { error } = await before.client.auth.exchangeCodeForSession(
        code.data,
      );
      if (error) return finish(false);
      const after = await authenticatedContext(true);
      if (
        after.actor.id !== before.actor.id ||
        !after.linkedProviders.includes(intent.provider)
      ) {
        await before.client.auth.signOut({ scope: 'local' });
        return finish(false);
      }
      unverifiedSessionClient = null;
      await new OAuthLinkRepository(after.client, after.actor).complete(
        tokenHash,
      );
      return finish(true);
    } catch {
      if (unverifiedSessionClient) {
        try {
          await unverifiedSessionClient.auth.signOut({ scope: 'local' });
        } catch {
          /* Keep a generic failure; never expose Auth errors or tokens. */
        }
      }
      return finish(false);
    }
  } catch (error) {
    return apiFailure(error);
  }
}
