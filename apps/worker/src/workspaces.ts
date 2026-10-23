import {
  createWorkspaceSchema,
  workspaceSchema,
} from '../../../packages/contracts/src/identity';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from '../../../packages/db/src/workspace-cursor';

export class WorkspaceFailure extends Error {
  constructor(
    public code: string,
    public status: 400 | 403 | 409,
  ) {
    super(code);
  }
}
export class D1WorkspaceRepository {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}
  async create(input: unknown) {
    const value = createWorkspaceSchema.parse(input);
    try {
      await this.db
        .prepare(
          'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
        )
        .bind(
          this.actor,
          value.requestId,
          this.session,
          value.name,
          crypto.randomUUID(),
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      for (const code of [
        'OWNER_REQUIRED',
        'REQUEST_ID_CONFLICT',
        'WORKSPACE_LIMIT_REACHED',
      ]) {
        if (message.includes(code))
          throw new WorkspaceFailure(
            code,
            code === 'OWNER_REQUIRED' ? 403 : 409,
          );
      }
      throw error;
    }
    // Repeat current authorization on the result read, including idempotent retries.
    const result = await this.db
      .prepare(
        "SELECT c.result_json FROM workspace_commands c JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE c.actor_id=? AND c.request_id=?",
      )
      .bind(this.session, this.actor, value.requestId)
      .first<{ result_json: string }>();
    if (!result) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    return workspaceSchema.parse(JSON.parse(result.result_json));
  }
  async list(cursor?: string) {
    const after = decodeWorkspaceCursor(cursor);
    const rows = await this.db
      .prepare(
        "SELECT w.id,w.name,w.owner_user_id AS ownerUserId,'workspace_owner' AS role,w.created_at AS createdAt,w.quota_bytes AS quotaBytes FROM workspaces w JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE w.owner_user_id=? AND (? IS NULL OR (w.created_at,w.id)<(?,?)) ORDER BY w.created_at DESC,w.id DESC LIMIT 25",
      )
      .bind(
        this.session,
        this.actor,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
      )
      .all();
    const workspaces = rows.results
      .slice(0, 24)
      .map((row) => workspaceSchema.parse(row));
    const last = workspaces.at(-1);
    return {
      workspaces,
      nextCursor:
        rows.results.length > 24 && last
          ? encodeWorkspaceCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
}
