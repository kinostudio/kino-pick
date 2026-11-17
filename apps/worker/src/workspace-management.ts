import { z } from 'zod';
import { workspaceSchema } from '../../../packages/contracts/src/identity';
import { WorkspaceFailure } from './workspaces';

const workspaceName = z
  .string()
  .trim()
  .min(1)
  .refine((value) => [...value].length <= 120);
const renameInput = z
  .object({
    name: workspaceName,
    expectedName: workspaceName,
    requestId: z.uuid(),
  })
  .strict();
const deleteInput = z
  .object({ expectedName: workspaceName, requestId: z.uuid() })
  .strict();
const deleteResult = z
  .object({
    id: z.uuid(),
    name: workspaceName,
    deletedAtMs: z.number().int().positive(),
  })
  .strict();

type WorkspaceManagementOperation = 'workspace.renamed' | 'workspace.deleted';

export class D1WorkspaceManagementRepository {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}

  async rename(workspaceId: string, input: unknown) {
    const id = z.uuid().parse(workspaceId);
    const body = renameInput.parse(input);
    return this.mutate(
      id,
      body.requestId,
      'workspace.renamed',
      { name: body.name, expectedName: body.expectedName },
      (value) => workspaceSchema.parse(value),
    );
  }

  async delete(workspaceId: string, input: unknown) {
    const id = z.uuid().parse(workspaceId);
    const body = deleteInput.parse(input);
    return this.mutate(
      id,
      body.requestId,
      'workspace.deleted',
      { expectedName: body.expectedName },
      (value) => deleteResult.parse(value),
    );
  }

  private async mutate<T>(
    workspaceId: string,
    requestId: string,
    operation: WorkspaceManagementOperation,
    payload: Record<string, unknown>,
    parse: (value: unknown) => T,
  ): Promise<T> {
    try {
      await this.db
        .prepare(
          "INSERT INTO workspace_management_commands(actor_id,request_id,operation,payload_json,session_id,workspace_id,created_at_ms) VALUES(?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))",
        )
        .bind(
          this.actor,
          requestId,
          operation,
          JSON.stringify(payload),
          this.session,
          workspaceId,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      for (const [code, status] of [
        ['OWNER_REQUIRED', 403],
        ['NOT_FOUND', 404],
        ['INVALID_INPUT', 400],
        ['REQUEST_ID_CONFLICT', 409],
        ['CONCURRENT_MODIFICATION', 409],
        ['WORKSPACE_NOT_EMPTY', 409],
        ['WORKSPACE_NAME_CONFLICT', 409],
      ] as const) {
        if (message.includes(code)) throw new WorkspaceFailure(code, status);
      }
      throw error;
    }

    const row = await this.db
      .prepare(
        "SELECT c.result_json FROM workspace_management_commands c JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE c.actor_id=? AND c.request_id=? AND c.operation=? AND c.workspace_id=?",
      )
      .bind(this.session, this.actor, requestId, operation, workspaceId)
      .first<{ result_json: string }>();
    if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    try {
      return parse(JSON.parse(row.result_json));
    } catch {
      throw new WorkspaceFailure('WORKSPACE_MANAGEMENT_UNAVAILABLE', 503);
    }
  }
}
