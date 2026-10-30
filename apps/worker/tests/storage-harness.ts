import { versionMatchHarness } from './version-match-harness';
import { ownerIntentHarness } from './owner-intent-harness';
// TEST ENTRY ONLY: never configured as the deployable Worker main.
import { R2StorageAdapter } from '../src/r2-storage';
import { D1GuestAccessResolver } from '../src/guest-access';
import { guestPermissionSchema } from '../../../packages/contracts/src/guest-access';
import { withOwnerKdfPermit } from '../src/kdf-permits';
import {
  D1GuestExchangeAdmission,
  pruneExpiredGuestAdmissionBuckets,
} from '../src/guest-admission';
import {
  createGuestPasswordVerifier,
  verifyGuestPassword,
} from '../src/guest-credentials';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.pathname === '/test-owner-external-intent' &&
      request.method === 'POST'
    )
      return ownerIntentHarness(request, env);
    if (
      url.pathname === '/test-version-match-candidates' &&
      request.method === 'POST'
    )
      return versionMatchHarness(request, env);
    if (url.pathname === '/test-kdf-permit' && request.method === 'POST') {
      const { z } = await import('zod');
      const input = z
        .object({
          actor: z.string().uuid(),
          session: z.string(),
          requestId: z.string().uuid(),
          fail: z.boolean().optional(),
          delay: z.number().int().min(0).max(1000),
        })
        .strict()
        .parse(await request.json());
      try {
        const result = await withOwnerKdfPermit(env.DB, input, async () => {
          await new Promise((resolve) => setTimeout(resolve, input.delay));
          if (input.fail) throw new Error('TEST_WORK_FAILED');
          return 'settled';
        });
        return Response.json({ result });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'FAILED' },
          { status: 503 },
        );
      }
    }
    if (url.pathname === '/test-guest-admission' && request.method === 'POST') {
      try {
        const { z } = await import('zod');
        const input = z
          .object({ address: z.string().max(64), token: z.string().max(256) })
          .strict()
          .parse(await request.json());
        const testEnv = env as typeof env & { BETTER_AUTH_SECRET?: string };
        const result = await new D1GuestExchangeAdmission(
          testEnv.DB,
          testEnv.BETTER_AUTH_SECRET ?? '',
        ).consume({ trustedAddress: input.address, token: input.token });
        return Response.json(result);
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : 'UNKNOWN_TEST_FAILURE',
          },
          { status: 503 },
        );
      }
    }
    if (url.pathname === '/test-prune-guest-admission') {
      const result = await pruneExpiredGuestAdmissionBuckets(env.DB);
      return Response.json({ changes: result.meta.changes });
    }
    if (url.pathname === '/test-guest-kdf' && request.method === 'POST') {
      const body: unknown = await request.json();
      const input = await import('zod').then(({ z }) =>
        z
          .object({
            password: z.string().max(256),
            verifier: z.string().max(200).optional(),
          })
          .strict()
          .parse(body),
      );
      if (input.verifier !== undefined)
        return Response.json({
          valid: await verifyGuestPassword(input.password, input.verifier),
        });
      return Response.json({
        verifier: await createGuestPasswordVerifier(input.password),
      });
    }
    if (url.pathname === '/test-guest-access') {
      try {
        const access = await new D1GuestAccessResolver(env.DB).album(
          request.headers.get('X-Test-Guest-Secret'),
          url.searchParams.get('albumId') ?? '',
          guestPermissionSchema.parse(url.searchParams.get('permission')),
        );
        return Response.json(access);
      } catch {
        return Response.json({ error: 'DENIED' }, { status: 401 });
      }
    }
    const scope = {
      workspaceId: url.searchParams.get('workspaceId')!,
      projectId: url.searchParams.get('projectId')!,
      albumId: url.searchParams.get('albumId')!,
    };
    const key = url.searchParams.get('key') ?? '';
    const store = new R2StorageAdapter(env.PRIMARY_STORAGE);
    try {
      if (request.method === 'PUT') {
        await store.putImmutable(
          scope,
          key,
          new Uint8Array(await request.arrayBuffer()),
          'image/png',
        );
        return new Response(null, { status: 201 });
      }
      if (request.method === 'DELETE') {
        await store.deleteObject();
        return new Response(null, { status: 204 });
      }
      const object = await store.open(scope, key);
      return new Response(object.body, {
        headers: {
          'Content-Type':
            object.httpMetadata?.contentType ?? 'application/octet-stream',
        },
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'UNKNOWN' },
        { status: 409 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
