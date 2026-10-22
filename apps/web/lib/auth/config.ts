import 'server-only';
import { authConfigSchema } from '@kino-pic/contracts';
export function authConfig() {
  return authConfigSchema.parse(process.env);
}
export function sessionCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    secure: new URL(appUrl).protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/',
  };
}
