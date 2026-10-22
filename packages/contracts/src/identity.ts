import { z } from 'zod';
export const roleSchema = z.enum([
  'workspace_owner',
  'workspace_editor',
  'photographer',
  'retoucher',
]);
// Match PostgreSQL char_length and the shared SQL Unicode whitespace normalizer.
const workspaceName = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => [...value].length <= 120,
    'Workspace name must contain at most 120 characters',
  );
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: workspaceName,
  ownerUserId: z.uuid(),
  role: roleSchema,
  createdAt: z.iso.datetime({ offset: true }),
  quotaBytes: z.number().int().positive().safe(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const createWorkspaceSchema = z
  .object({ name: workspaceName, requestId: z.uuid() })
  .strict();
export const memberInputSchema = z
  .object({
    userId: z.uuid(),
    role: z.enum(['workspace_editor', 'photographer', 'retoucher']),
    status: z.enum(['active', 'suspended']),
    requestId: z.uuid(),
  })
  .strict();
export const memberResultSchema = memberInputSchema
  .omit({ requestId: true })
  .extend({ workspaceId: z.uuid() });
export const actorSchema = z.object({
  id: z.uuid(),
  provider: z.literal('google'),
});
export type Actor = z.infer<typeof actorSchema>;
const loopback = (url: URL) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
export const authConfigSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'production']).default('local'),
    AUTH_DRIVER: z.enum(['disabled', 'supabase']).default('disabled'),
    APP_URL: z.url().default('http://localhost:3000'),
    SUPABASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url().optional(),
    ),
    SUPABASE_PUBLISHABLE_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
  })
  .superRefine((v, ctx) => {
    for (const value of [v.APP_URL, v.SUPABASE_URL].filter(
      (v): v is string => !!v,
    )) {
      const url = new URL(value);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        !(
          url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            loopback(url) &&
            v.APP_ENV !== 'production')
        )
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Only HTTPS origins or local loopback HTTP origins are allowed',
        });
    }
    if (
      v.AUTH_DRIVER === 'supabase' &&
      (!v.SUPABASE_URL || !v.SUPABASE_PUBLISHABLE_KEY)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Supabase URL and publishable key are required',
      });
    // Only publishable keys or legacy anon JWTs; never privileged credentials.
    const key = v.SUPABASE_PUBLISHABLE_KEY;
    if (key && !key.startsWith('sb_publishable_')) {
      let valid = false;
      try {
        const part = key.split('.')[1];
        valid =
          key.split('.').length === 3 &&
          !!part &&
          z
            .object({ role: z.literal('anon') })
            .safeParse(
              JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))),
            ).success;
      } catch {
        valid = false;
      }
      if (!valid)
        ctx.addIssue({
          code: 'custom',
          message: 'A publishable or legacy anon key is required',
        });
    }
  });
export type AuthConfig = z.infer<typeof authConfigSchema>;
export function isSameOriginMutation(request: Request, appUrl: string) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  // no-referrer can make native form navigation send Origin:null. Accept it
  // only with browser-controlled same-origin Fetch Metadata; sibling sites fail.
  return (
    site !== 'cross-site' &&
    (origin === new URL(appUrl).origin ||
      (origin === 'null' && site === 'same-origin'))
  );
}
