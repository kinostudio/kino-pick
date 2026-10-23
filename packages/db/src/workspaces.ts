import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from './workspace-cursor';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  workspaceSchema,
  memberResultSchema,
  createWorkspaceSchema,
  memberInputSchema,
  type Actor,
} from '@kino-pic/contracts';
import type { Database } from './database.types';
export class RepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function databaseError(error: { message: string; code: string }): never {
  const allowed = [
    'AUTH_REQUIRED',
    'GOOGLE_IDENTITY_REQUIRED',
    'OAUTH_IDENTITY_REQUIRED',
    'IDENTITY_ALREADY_LINKED',
    'LINK_LIMIT_REACHED',
    'LINK_INTENT_INVALID',
    'LINK_NOT_VERIFIED',
    'INVALID_INPUT',
    'FORBIDDEN_SCOPE',
    'OWNER_ROLE_IMMUTABLE',
    'MEMBER_NOT_FOUND',
    'REQUEST_ID_CONFLICT',
    'WORKSPACE_LIMIT_REACHED',
    'NOT_FOUND',
    'CONCURRENT_MODIFICATION',
  ];
  throw new RepositoryError(
    allowed.find((code) => error.message === code) ?? 'DATABASE_UNAVAILABLE',
  );
}
export class WorkspaceRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly actor: Actor,
  ) {}
  async ensureProfile(requestId: string) {
    const { error } = await this.db.rpc('ensure_photographer_profile', {
      p_request_id: requestId,
    });
    if (error) databaseError(error);
  }
  async list(cursor?: string) {
    const after = decodeWorkspaceCursor(cursor);
    let query = this.db
      .from('workspaces')
      .select('id,owner_user_id,name,quota_bytes,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(25);
    if (after)
      query = query.or(
        `created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`,
      );
    const { data: allRows, error } = await query;
    const rows = allRows?.slice(0, 24) ?? [];
    if (error) databaseError(error);
    const ids = (rows ?? []).map((row) => row.id);
    const memberResult = ids.length
      ? await this.db
          .from('workspace_members')
          .select('workspace_id,role,status')
          .eq('user_id', this.actor.id)
          .eq('status', 'active')
          .in('workspace_id', ids)
      : { data: [], error: null };
    if (memberResult.error) databaseError(memberResult.error);
    const members = memberResult.data;
    // Membership may be revoked between the two RLS snapshots. Fail closed
    // for those rows while advancing the cursor using the original page.
    const visibleRows = rows.filter(
      (row) =>
        row.owner_user_id === this.actor.id ||
        members?.some((m) => m.workspace_id === row.id),
    );
    const workspaces = visibleRows.map((row) =>
      workspaceSchema.parse({
        id: row.id,
        name: row.name,
        ownerUserId: row.owner_user_id,
        quotaBytes: row.quota_bytes,
        createdAt: row.created_at,
        role:
          row.owner_user_id === this.actor.id
            ? 'workspace_owner'
            : members?.find((m) => m.workspace_id === row.id)?.role,
      }),
    );
    const tail = rows.at(-1);
    return {
      workspaces,
      nextCursor:
        (allRows?.length ?? 0) > 24 && tail
          ? encodeWorkspaceCursor({ createdAt: tail.created_at, id: tail.id })
          : null,
    };
  }
  async create(input: unknown) {
    const body = createWorkspaceSchema.parse(input);
    const { data, error } = await this.db.rpc('create_workspace', {
      p_name: body.name,
      p_request_id: body.requestId,
    });
    if (error) databaseError(error);
    return workspaceSchema.parse(data);
  }
  async setMember(workspaceId: string, input: unknown) {
    const body = memberInputSchema.parse(input);
    const { data, error } = await this.db.rpc('set_workspace_member', {
      p_workspace_id: workspaceId,
      p_user_id: body.userId,
      p_role: body.role,
      p_status: body.status,
      p_request_id: body.requestId,
    });
    if (error) databaseError(error);
    return memberResultSchema.parse(data);
  }
}
