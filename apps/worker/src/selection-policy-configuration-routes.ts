import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { configuration, type WorkerEnv } from './config';
import { WorkspaceFailure } from './workspaces';
import { D1SelectionPolicyConfigurationRepository } from './selection-policy-configuration';

type PolicyEnv = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
const router = new Hono<PolicyEnv>();
const projectPath =
  '/api/v1/projects/:projectId/selection-policy-configuration' as const;
const albumPath =
  '/api/v1/albums/:albumId/selection-policy-configuration' as const;

function enabled(c: Context<PolicyEnv>): void {
  if (new URL(c.req.url).searchParams.size !== 0)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (configuration(c.env).GUEST_SELECTION_ENABLED !== 'true')
    throw new WorkspaceFailure('GUEST_SELECTION_DISABLED', 503);
}
function checkOrigin(c: Context<PolicyEnv>): void {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
}
async function readBody(c: Context<PolicyEnv>): Promise<unknown> {
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  }
}
function repository(c: Context<PolicyEnv>) {
  return new D1SelectionPolicyConfigurationRepository(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
  );
}
async function guarded(
  c: Context<PolicyEnv>,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof z.ZodError)
      return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
    if (error instanceof WorkspaceFailure)
      return c.json({ error: { code: error.code } }, error.status);
    return c.json(
      { error: { code: 'SELECTION_POLICY_CONFIGURATION_UNAVAILABLE' } },
      503,
    );
  }
}

router.get(projectPath, (c) =>
  guarded(c, async () => {
    enabled(c);
    return c.json(await repository(c).getProject(c.req.param('projectId')));
  }),
);
router.put(projectPath, (c) =>
  guarded(c, async () => {
    checkOrigin(c);
    enabled(c);
    return c.json(
      await repository(c).setProject(
        c.req.param('projectId'),
        await readBody(c),
      ),
    );
  }),
);
router.get(albumPath, (c) =>
  guarded(c, async () => {
    enabled(c);
    return c.json(await repository(c).getAlbum(c.req.param('albumId')));
  }),
);
router.put(albumPath, (c) =>
  guarded(c, async () => {
    checkOrigin(c);
    enabled(c);
    return c.json(
      await repository(c).setAlbum(c.req.param('albumId'), await readBody(c)),
    );
  }),
);

export { router as selectionPolicyConfigurationRoutes };
