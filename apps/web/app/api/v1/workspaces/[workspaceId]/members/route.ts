import { z } from 'zod';
import { WorkspaceRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig } from '@/lib/auth/config';
import { apiFailure, json, readJson, requireOrigin } from '@/lib/http';
export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    requireOrigin(request, authConfig().APP_URL);
    const workspaceId = z.uuid().parse((await context.params).workspaceId);
    const { client, actor } = await authenticatedContext(true);
    return json({
      member: await new WorkspaceRepository(client, actor).setMember(
        workspaceId,
        await readJson(request),
      ),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
