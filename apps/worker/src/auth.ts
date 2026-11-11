import { betterAuth } from 'better-auth';
import { getSessionFromCtx } from 'better-auth/api';
import {
  verifyGoogleIdToken,
  type GoogleProfile,
} from 'better-auth/social-providers';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import * as schema from './schema';
import { configuration, type WorkerEnv } from './config';
import {
  isFreshAccountSession,
  oauthProviderCredentials,
} from './oauth-provider-capabilities';
export const denyPublicCreation = async () => false as const;
export function createAuth(env: WorkerEnv) {
  const config = configuration(env);
  const secret = z
    .string()
    .min(32)
    .refine(
      (value) =>
        !value.startsWith('replace-') &&
        (config.APP_ENV === 'local' || !value.startsWith('synthetic-')),
      'Configure a real random signing secret',
    )
    .parse(env.BETTER_AUTH_SECRET);
  const googleCredentials = oauthProviderCredentials(env, 'google');
  const google = googleCredentials
    ? {
        ...googleCredentials,
        disableSignUp: true,
        getUserInfo: async (tokens: {
          idToken?: string | undefined;
          expectedIdTokenNonce?: string | undefined;
        }) => {
          if (!tokens.idToken) return null;
          const claims = await verifyGoogleIdToken({
            token: tokens.idToken,
            audience: googleCredentials.clientId,
            ...(tokens.expectedIdTokenNonce
              ? { nonce: tokens.expectedIdTokenNonce }
              : {}),
          });
          if (!claims) return null;
          const profile: GoogleProfile = {
            sub: z.string().min(1).parse(claims.sub),
            email: z.email().parse(claims.email),
            email_verified: claims.email_verified === true,
            name: typeof claims.name === 'string' ? claims.name : 'Owner',
            picture: typeof claims.picture === 'string' ? claims.picture : '',
            aud: googleCredentials.clientId,
            azp:
              typeof claims.azp === 'string'
                ? claims.azp
                : googleCredentials.clientId,
            iss: z.string().parse(claims.iss),
            exp: z.number().parse(claims.exp),
            iat: z.number().parse(claims.iat),
            family_name:
              typeof claims.family_name === 'string' ? claims.family_name : '',
            given_name:
              typeof claims.given_name === 'string' ? claims.given_name : '',
            locale: typeof claims.locale === 'string' ? claims.locale : '',
          };
          return {
            user: {
              name: profile.name,
              email: profile.email,
              emailVerified: profile.email_verified,
              image: profile.picture,
            },
            data: profile,
          };
        },
      }
    : undefined;
  const githubCredentials = oauthProviderCredentials(env, 'github');
  const github = githubCredentials
    ? { ...githubCredentials, disableSignUp: true }
    : undefined;
  return betterAuth({
    logger: { disabled: true },
    baseURL: config.origin,
    basePath: '/api/auth',
    secret,
    database: drizzleAdapter(drizzle(env.DB), {
      provider: 'sqlite',
      schema,
      transaction: false,
    }),
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: false, disableSignUp: true },
    socialProviders: {
      ...(google ? { google } : {}),
      ...(github ? { github } : {}),
    },
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
      storeAccountCookie: false,
    },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 86400,
      freshAge: 300,
    },
    advanced: {
      cookiePrefix: 'kino-owner',
      useSecureCookies: config.APP_ENV !== 'local',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    user: {
      validateUserInfo: async ({ user, source }, ctx) => {
        if (source.action === 'link-account' && source.method === 'oauth') {
          const session = await getSessionFromCtx(ctx);
          const created = session
            ? new Date(session.session.createdAt).getTime()
            : 0;
          if (
            !session ||
            session.user.id !== user.id ||
            !isFreshAccountSession(created)
          )
            return { error: 'recent_owner_session_required' };
          const owner = await env.DB.prepare(
            'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
          )
            .bind(session.user.id)
            .first();
          if (
            !owner ||
            !['google', 'github'].includes(source.oauth?.providerId ?? '')
          )
            return { error: 'owner_required' };
          return;
        }
        if (source.action !== 'sign-in' || source.method !== 'oauth')
          return { error: 'registration_closed' };
        const provider = source.oauth?.providerId;
        const profile = source.oauth?.profile;
        const subject =
          provider === 'google'
            ? profile?.sub
            : provider === 'github'
              ? profile?.id
              : undefined;
        if (
          (typeof subject !== 'string' && typeof subject !== 'number') ||
          !['google', 'github'].includes(provider ?? '')
        )
          return { error: 'owner_required' };
        const owner = await env.DB.prepare(
          'SELECT a.userId FROM oauth_accounts a JOIN owners o ON o.user_id=a.userId AND o.enabled=1 WHERE a.providerId=? AND a.accountId=?',
        )
          .bind(provider!, String(subject))
          .first();
        if (!owner) return { error: 'owner_required' };
      },
    },
    databaseHooks: {
      user: { create: { before: denyPublicCreation } },
      account: {
        create: {
          before: async (account, ctx) => {
            if (
              !ctx ||
              ctx.path !== '/callback/:id' ||
              ctx.params?.id !== account.providerId ||
              !['google', 'github'].includes(account.providerId)
            )
              return false;
            const session = await getSessionFromCtx(ctx);
            if (
              !session ||
              session.user.id !== account.userId ||
              !isFreshAccountSession(
                new Date(session.session.createdAt).getTime(),
              )
            )
              return false;
            const owner = await env.DB.prepare(
              'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
            )
              .bind(account.userId)
              .first();
            return owner ? { data: account } : false;
          },
          after: async (account, ctx) => {
            if (!ctx) return;
            const session = await getSessionFromCtx(ctx);
            const eventId = crypto.randomUUID();
            await env.DB.prepare(
              `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,action,after_json,request_id)
              VALUES(?,'user',?,?,'owner.provider_linked',?,?)`,
            )
              .bind(
                eventId,
                account.userId,
                session?.session.id ?? null,
                JSON.stringify({ provider: account.providerId }),
                eventId,
              )
              .run();
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const owner = await env.DB.prepare(
              'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
            )
              .bind(session.userId)
              .first();
            return owner ? { data: session } : false;
          },
        },
      },
    },
  });
}
