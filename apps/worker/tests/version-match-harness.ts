import { z } from 'zod';
import { D1VersionMatchCandidates } from '../src/version-match-candidates';
import { WorkspaceFailure } from '../src/workspaces';

const inputSchema = z
  .object({
    actor: z.uuid(),
    session: z.string().min(1).max(255),
    albumId: z.uuid(),
    evidence: z.unknown().optional(),
  })
  .strict();

/** Test entry helper only. The deployable Worker never imports this module. */
export async function versionMatchHarness(request: Request, env: Env) {
  try {
    const input = inputSchema.parse(await request.json());
    const candidates = new D1VersionMatchCandidates(
      env.DB,
      input.actor,
      input.session,
    );
    const result = Object.prototype.hasOwnProperty.call(input, 'evidence')
      ? await candidates.resolve(input.albumId, input.evidence)
      : await candidates.read(input.albumId);
    return Response.json(result);
  } catch (error) {
    if (error instanceof WorkspaceFailure)
      return Response.json(
        { error: { code: error.code } },
        { status: error.status },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        { error: { code: 'INVALID_INPUT' } },
        { status: 400 },
      );
    return Response.json(
      { error: { code: 'VERSION_MATCH_TEST_FAILED' } },
      { status: 503 },
    );
  }
}
