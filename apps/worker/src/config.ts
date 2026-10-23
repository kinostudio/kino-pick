import { z } from 'zod';
export type WorkerEnv = Env & {
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};
export function configuration(env: WorkerEnv) {
  const config = z
    .object({
      APP_ENV: z.enum(['local', 'staging', 'production']),
      APP_URL: z.url(),
      REGISTRATION_MODE: z.literal('closed'),
      STORAGE_AUTODELETE_ENABLED: z.literal('false'),
      STORAGE_RETENTION_DRY_RUN: z.literal('true'),
      MULTI_ACCOUNT_STORAGE_ENABLED: z.literal('false'),
    })
    .parse(env);
  const url = new URL(config.APP_URL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(
        config.APP_ENV === 'local' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      ))
  )
    throw new Error('INVALID_ORIGIN');
  if (url.hostname.endsWith('.invalid'))
    throw new Error('DEPLOYMENT_NOT_CONFIGURED');
  return { ...config, origin: url.origin };
}
