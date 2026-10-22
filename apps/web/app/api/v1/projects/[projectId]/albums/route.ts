import { z } from 'zod';
import { ProjectRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig } from '@/lib/auth/config';
import { apiFailure, json, readJson, requireOrigin } from '@/lib/http';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { client, actor } = await authenticatedContext(true);
    const id = z.uuid().parse((await context.params).projectId);
    return json(
      await new ProjectRepository(client, actor).listAlbums(
        id,
        new URL(request.url).searchParams.get('cursor') ?? undefined,
      ),
    );
  } catch (error) {
    return apiFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireOrigin(request, authConfig().APP_URL);
    const { client, actor } = await authenticatedContext(true);
    const id = z.uuid().parse((await context.params).projectId);
    return json(
      {
        album: await new ProjectRepository(client, actor).createAlbum(
          id,
          await readJson(request),
        ),
      },
      201,
    );
  } catch (error) {
    return apiFailure(error);
  }
}
