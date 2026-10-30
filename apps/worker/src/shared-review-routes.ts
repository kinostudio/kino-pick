import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { configuration, type WorkerEnv } from './config';
import { GuestAccessDenied, readGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';
import { D1OwnerSharedReviews, D1GuestSharedReviews } from './shared-review';
import { sharedReviewCapabilitiesSchema } from '../../../packages/contracts/src/shared-review';

type SharedEnv = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
const router = new Hono<SharedEnv>();
const ownerBase = '/api/v1/albums/:albumId/shared-reviews' as const;
const guestBase = '/api/guest/albums/:albumId/shared-reviews' as const;
const ownerReopen = `${ownerBase}/:reviewId/reopen` as const;
const ownerHistory = `${ownerBase}/:reviewId/submissions` as const;
const ownerDetail = `${ownerHistory}/:submissionId` as const;
const ownerDownload = `${ownerDetail}/download` as const;
const guestMetadata = `${guestBase}/:reviewId` as const;
const guestSelection = `${guestMetadata}/selection` as const;
const guestSet = `${guestMetadata}/photos/:photoId/selection` as const;
const guestSubmit = `${guestMetadata}/submit` as const;

router.use(
  `${guestBase}/*`,
  bodyLimit({
    maxSize: 16384,
    onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
  }),
);
function enabled(c: Context<SharedEnv>) {
  if (configuration(c.env).GUEST_SHARED_SELECTION_ENABLED !== 'true')
    throw new WorkspaceFailure('SHARED_REVIEW_DISABLED', 503);
}
function origin(c: Context<SharedEnv>) {
  if (c.req.header('Origin') !== configuration(c.env).origin)
    throw new WorkspaceFailure('FORBIDDEN_ORIGIN', 403);
}
function query(c: Context<SharedEnv>, allowed: readonly string[]) {
  const values = new URL(c.req.url).searchParams;
  if (
    [...values.keys()].some(
      (key) => !allowed.includes(key) || values.getAll(key).length !== 1,
    )
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return values;
}
async function body(c: Context<SharedEnv>): Promise<unknown> {
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
function owner(c: Context<SharedEnv>) {
  return new D1OwnerSharedReviews(
    c.env.DB,
    c.get('ownerId'),
    c.get('sessionId'),
  );
}
function guest(c: Context<SharedEnv>) {
  return new D1GuestSharedReviews(c.env.DB);
}
function secret(c: Context<SharedEnv>) {
  return readGuestSessionSecret(
    c.req.header('Cookie'),
    configuration(c.env).origin.startsWith('https:'),
  );
}
async function guarded(
  c: Context<SharedEnv>,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GuestAccessDenied)
      return c.json({ error: { code: 'GUEST_ACCESS_REQUIRED' } }, 401);
    if (error instanceof z.ZodError)
      return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
    if (error instanceof WorkspaceFailure)
      return c.json({ error: { code: error.code } }, error.status);
    return c.json({ error: { code: 'SHARED_REVIEW_UNAVAILABLE' } }, 503);
  }
}
router.get('/api/guest/shared-reviews/capabilities', (c) =>
  c.json(
    sharedReviewCapabilitiesSchema.parse({
      enabled: configuration(c.env).GUEST_SHARED_SELECTION_ENABLED === 'true',
    }),
  ),
);
router.get(ownerBase, (c) =>
  guarded(c, async () => {
    enabled(c);
    query(c, []);
    return c.json(await owner(c).list(c.req.param('albumId')));
  }),
);
router.post(ownerBase, (c) =>
  guarded(c, async () => {
    origin(c);
    enabled(c);
    return c.json(await owner(c).create(c.req.param('albumId'), await body(c)));
  }),
);
router.post(ownerReopen, (c) =>
  guarded(c, async () => {
    origin(c);
    enabled(c);
    return c.json(
      await owner(c).reopen(
        c.req.param('albumId'),
        c.req.param('reviewId'),
        await body(c),
      ),
    );
  }),
);
router.get(ownerHistory, (c) =>
  guarded(c, async () => {
    enabled(c);
    const q = query(c, ['beforeRoundNo']);
    return c.json(
      await owner(c).submissions(
        c.req.param('albumId'),
        c.req.param('reviewId'),
        q.get('beforeRoundNo') ?? undefined,
      ),
    );
  }),
);
router.get(ownerDetail, (c) =>
  guarded(c, async () => {
    enabled(c);
    const q = query(c, ['cursor']);
    return c.json(
      await owner(c).detail(
        c.req.param('albumId'),
        c.req.param('reviewId'),
        c.req.param('submissionId'),
        q.get('cursor') ?? undefined,
      ),
    );
  }),
);
router.get(ownerDownload, (c) =>
  guarded(c, async () => {
    enabled(c);
    const q = query(c, ['format']);
    return owner(c).download(
      c.req.param('albumId'),
      c.req.param('reviewId'),
      c.req.param('submissionId'),
      q.get('format') ?? undefined,
    );
  }),
);
router.get(guestBase, (c) =>
  guarded(c, async () => {
    enabled(c);
    query(c, []);
    return c.json(await guest(c).discover(secret(c), c.req.param('albumId')));
  }),
);
router.get(guestMetadata, (c) =>
  guarded(c, async () => {
    enabled(c);
    query(c, []);
    return c.json(
      await guest(c).metadata(
        secret(c),
        c.req.param('albumId'),
        c.req.param('reviewId'),
      ),
    );
  }),
);
router.get(guestSelection, (c) =>
  guarded(c, async () => {
    enabled(c);
    const q = query(c, ['cursor']);
    return c.json(
      await guest(c).selection(
        secret(c),
        c.req.param('albumId'),
        c.req.param('reviewId'),
        q.get('cursor') ?? undefined,
      ),
    );
  }),
);
router.put(guestSet, (c) =>
  guarded(c, async () => {
    origin(c);
    enabled(c);
    return c.json(
      await guest(c).set(
        secret(c),
        c.req.param('albumId'),
        c.req.param('reviewId'),
        c.req.param('photoId'),
        await body(c),
      ),
    );
  }),
);
router.post(guestSubmit, (c) =>
  guarded(c, async () => {
    origin(c);
    enabled(c);
    return c.json(
      await guest(c).submit(
        secret(c),
        c.req.param('albumId'),
        c.req.param('reviewId'),
        await body(c),
      ),
    );
  }),
);
export { router as sharedReviewRoutes };
