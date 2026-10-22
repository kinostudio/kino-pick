import { z } from 'zod';
import { ProjectRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig } from '@/lib/auth/config';
import { apiFailure, json, readJson, requireOrigin } from '@/lib/http';
export async function GET(request: Request) {
  try {
    const { client, actor } = await authenticatedContext(true);
    const query = new URL(request.url).searchParams;
    const workspaceId = z.uuid().parse(query.get('workspaceId'));
    return json(
      await new ProjectRepository(client, actor).list(
        workspaceId,
        query.get('cursor') ?? undefined,
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
    return json(
      {
        project: await new ProjectRepository(client, actor).create(
          await readJson(request),
        ),
      },
      201,
    );
  } catch (error) {
    return apiFailure(error);
  }
}
