// TEST ENTRY ONLY: never configured as the deployable Worker main.
import { R2StorageAdapter } from '../src/r2-storage';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
