import { z } from 'zod';
import { ProjectRepository } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig } from '@/lib/auth/config';
import { apiFailure, json, readJson, requireOrigin } from '@/lib/http';
export async function PATCH(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
) {
  try {
    requireOrigin(request, authConfig().APP_URL);
    const { client, actor } = await authenticatedContext(true);
    const id = z.uuid().parse((await context.params).albumId);
    return json({
      album: await new ProjectRepository(client, actor).setAlbumProtection(
        id,
        await readJson(request),
      ),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
