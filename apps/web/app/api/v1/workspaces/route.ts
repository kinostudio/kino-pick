import { WorkspaceRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig } from '@/lib/auth/config';
import { apiFailure, json, readJson, requireOrigin } from '@/lib/http';
export async function GET(request: Request) {
  try {
    const { client, actor } = await authenticatedContext(true);
    return json(
      await new WorkspaceRepository(client, actor).list(
        new URL(request.url).searchParams.get('cursor') ?? undefined,
      ),
    );
  } catch (error) {
    return apiFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request, authConfig().APP_URL);
    const { client, actor } = await authenticatedContext(true);
    const workspace = await new WorkspaceRepository(client, actor).create(
      await readJson(request),
    );
    return json({ workspace }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
