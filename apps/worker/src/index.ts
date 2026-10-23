import { z } from 'zod';
import { D1WorkspaceRepository, WorkspaceFailure } from './workspaces';
import { D1ContentRepository } from './content';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createAuth } from './auth';
import { configuration, type WorkerEnv } from './config';
const app = new Hono<{
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
}>();
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Robots-Tag', 'noindex, nofollow');
});
app.use(
  '/api/auth/*',
  bodyLimit({
    maxSize: 16384,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
app.get('/api/health', (c) => {
  configuration(c.env);
  return c.json({
    service: 'kino-pic-cloudflare',
    phase: 'migration-foundation',
    registration: 'closed',
    autodelete: false,
    dryRun: true,
    providerConnectivity: 'not_checked',
  });
});
app.use('/api/v1/*', async (c, next) => {
  configuration(c.env);
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: { code: 'AUTH_REQUIRED' } }, 401);
  const owner = await c.env.DB.prepare(
    'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
  )
    .bind(session.user.id)
    .first();
  if (!owner) return c.json({ error: { code: 'OWNER_REQUIRED' } }, 403);
  c.set('ownerId', session.user.id);
  c.set('sessionId', session.session.id);
  await next();
});
const workspaceBodyLimit = bodyLimit({
  maxSize: 16384,
  onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
});
for (const path of [
  '/api/v1/workspaces',
  '/api/v1/projects',
  '/api/v1/projects/*',
  '/api/v1/albums/*',
])
  app.use(path, workspaceBodyLimit);
const content = (c: {
  env: WorkerEnv;
  get: (key: 'ownerId' | 'sessionId') => string;
}) => new D1ContentRepository(c.env.DB, c.get('ownerId'), c.get('sessionId'));
const contentError = (
  c: {
    json: (
      value: unknown,
      status?: 400 | 403 | 404 | 409 | 413 | 503,
    ) => Response;
  },
  error: unknown,
) => {
  if (error instanceof z.ZodError)
    return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  if (error instanceof WorkspaceFailure)
    return c.json({ error: { code: error.code } }, error.status);
  throw error;
};
const readContentBody = async (c: {
  req: {
    header: (name: string) => string | undefined;
    json: () => Promise<unknown>;
  };
}) => {
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  try {
    return await c.req.json();
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
};
const checkOrigin = (c: {
  req: { header: (name: string) => string | undefined };
  env: WorkerEnv;
}) => {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
};
function listQuery(
  url: string,
  project: true,
): { workspaceId: string; cursor?: string };
function listQuery(url: string, project: false): { cursor?: string };
function listQuery(
  url: string,
  project: boolean,
): { workspaceId?: string | undefined; cursor?: string | undefined } {
  const params = new URL(url).searchParams;
  const allowed = project ? ['workspaceId', 'cursor'] : ['cursor'];
  if (
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    [...new Set(params.keys())].some((key) => params.getAll(key).length !== 1)
  )
    throw new z.ZodError([
      { code: 'custom', path: [], message: 'Invalid query' },
    ]);
  return project
    ? z
        .object({ workspaceId: z.uuid(), cursor: z.string().optional() })
        .strict()
        .parse(Object.fromEntries(params))
    : z
        .object({ cursor: z.string().optional() })
        .strict()
        .parse(Object.fromEntries(params));
}
app.get('/api/v1/workspaces', async (c) => {
  try {
    const query = listQuery(c.req.url, false);
    return c.json(
      await new D1WorkspaceRepository(
        c.env.DB,
        c.get('ownerId'),
        c.get('sessionId'),
      ).list(query.cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/workspaces', async (c) => {
  try {
    checkOrigin(c);
    const workspace = await new D1WorkspaceRepository(
      c.env.DB,
      c.get('ownerId'),
      c.get('sessionId'),
    ).create(await readContentBody(c));
    return c.json({ workspace }, 201);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/projects', async (c) => {
  try {
    const query = listQuery(c.req.url, true);
    return c.json(
      await content(c).listProjects(query.workspaceId, query.cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/projects', async (c) => {
  try {
    checkOrigin(c);
    const project = await content(c).createProject(await readContentBody(c));
    return c.json({ project }, 201);
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/projects/:projectId', async (c) => {
  try {
    return c.json(await content(c).getProject(c.req.param('projectId')));
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/projects/:projectId', async (c) => {
  try {
    checkOrigin(c);
    const project = await content(c).renameProject(
      c.req.param('projectId'),
      await readContentBody(c),
    );
    return c.json({ project });
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/projects/:projectId/albums', async (c) => {
  try {
    const query = listQuery(c.req.url, false);
    return c.json(
      await content(c).listAlbums(c.req.param('projectId'), query.cursor),
    );
  } catch (error) {
    return contentError(c, error);
  }
});
app.post('/api/v1/projects/:projectId/albums', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).createAlbum(
      c.req.param('projectId'),
      await readContentBody(c),
    );
    return c.json({ album }, 201);
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/albums/:albumId', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).renameAlbum(
      c.req.param('albumId'),
      await readContentBody(c),
    );
    return c.json({ album });
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/albums/:albumId/protection', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).protectAlbum(
      c.req.param('albumId'),
      await readContentBody(c),
    );
    return c.json({ album });
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/projects/:projectId/archive', async (c) => {
  try {
    checkOrigin(c);
    const project = await content(c).archiveProject(
      c.req.param('projectId'),
      await readContentBody(c),
    );
    return c.json({ project });
  } catch (error) {
    return contentError(c, error);
  }
});
app.patch('/api/v1/albums/:albumId/archive', async (c) => {
  try {
    checkOrigin(c);
    const album = await content(c).archiveAlbum(
      c.req.param('albumId'),
      await readContentBody(c),
    );
    return c.json({ album });
  } catch (error) {
    return contentError(c, error);
  }
});
app.get('/api/v1/me', (c) =>
  c.json({
    actor: { id: c.get('ownerId') },
    role: 'owner',
    sessionId: c.get('sessionId'),
  }),
);
app.get('/api/v1/storage/nodes', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id,provider,status,priority,quota_bytes,used_bytes,reserved_bytes,last_reconciled_at FROM storage_nodes ORDER BY priority,id',
  ).all();
  return c.json({
    nodes: rows.results,
    multiAccountEnabled: false,
    autodelete: false,
    dryRun: true,
  });
});
app.all('/api/auth/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  const publicPaths = [
    '/api/auth/sign-in/social',
    '/api/auth/callback/google',
    '/api/auth/callback/github',
    '/api/auth/get-session',
    '/api/auth/sign-out',
  ];
  if (!publicPaths.includes(path))
    return c.json({ error: { code: 'AUTH_OPERATION_NOT_AVAILABLE' } }, 404);
  const config = configuration(c.env);
  if (c.req.method !== 'GET' && c.req.header('Origin') !== config.origin)
    return c.json({ error: { code: 'FORBIDDEN_ORIGIN' } }, 403);
  const auth = createAuth(c.env);
  if (path === '/api/auth/get-session') {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (
      session &&
      !(await c.env.DB.prepare(
        'SELECT user_id FROM owners WHERE user_id=? AND enabled=1',
      )
        .bind(session.user.id)
        .first())
    )
      return c.json({ error: { code: 'OWNER_REQUIRED' } }, 403);
  }
  return auth.handler(c.req.raw);
});
app.get('*', (c) => {
  configuration(c.env);
  return c.env.ASSETS.fetch(c.req.raw);
});
app.onError(
  () =>
    new Response(JSON.stringify({ error: { code: 'SERVICE_NOT_READY' } }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
      },
    }),
);
export default {
  fetch: app.fetch,
  async scheduled(event, env) {
    configuration(env);
    // Dry-run observation only. No eligibility/deletion implementation or R2 delete call.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO audit_events(event_id,actor_type,action,after_json,request_id) VALUES(?,'system','retention.dry_run_observed',?,?)",
    )
      .bind(
        `cron:${event.scheduledTime}`,
        JSON.stringify({ deleted: 0, eligibility: 'not_implemented' }),
        `cron:${event.scheduledTime}`,
      )
      .run();
  },
} satisfies ExportedHandler<WorkerEnv>;
