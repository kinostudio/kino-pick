import { z } from 'zod';
import { ProjectRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig } from '@/lib/auth/config';
import { apiFailure, json, readJson, requireOrigin } from '@/lib/http';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { client, actor } = await authenticatedContext(true);
    const id = z.uuid().parse((await context.params).projectId);
    return json(await new ProjectRepository(client, actor).get(id));
  } catch (error) {
    return apiFailure(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    requireOrigin(request, authConfig().APP_URL);
    const { client, actor } = await authenticatedContext(true);
    const id = z.uuid().parse((await context.params).projectId);
    return json({
      project: await new ProjectRepository(client, actor).rename(
        id,
        await readJson(request),
      ),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
