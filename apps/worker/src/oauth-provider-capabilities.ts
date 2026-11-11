import type { WorkerEnv } from './config';

export const oauthProviderNames = ['google', 'github'] as const;
export type OAuthProviderName = (typeof oauthProviderNames)[number];

export function isFreshAccountSession(createdAt: number, now = Date.now()) {
  return (
    Number.isSafeInteger(createdAt) &&
    createdAt <= now &&
    now - createdAt < 300_000
  );
}

type OAuthProviderEnv = Pick<
  WorkerEnv,
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'GITHUB_CLIENT_ID'
  | 'GITHUB_CLIENT_SECRET'
>;

export type OAuthProviderCredentials = {
  clientId: string;
  clientSecret: string;
};

/** Match the exact credential pair that createAuth uses to configure a provider. */
export function oauthProviderCredentials(
  env: OAuthProviderEnv,
  provider: OAuthProviderName,
): OAuthProviderCredentials | null {
  const [clientId, clientSecret] =
    provider === 'google'
      ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET]
      : [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET];

  if (
    typeof clientId !== 'string' ||
    clientId.trim().length === 0 ||
    typeof clientSecret !== 'string' ||
    clientSecret.trim().length === 0
  )
    return null;

  return { clientId, clientSecret };
}

/** Public capability DTO contains provider names only; credential values stay server-side. */
export function oauthProviderCapabilities(env: OAuthProviderEnv): {
  providers: OAuthProviderName[];
} {
  return {
    providers: oauthProviderNames.filter(
      (provider) => oauthProviderCredentials(env, provider) !== null,
    ),
  };
}
