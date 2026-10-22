import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  projectSchema,
  albumSchema,
  workspaceSchema,
  createProjectSchema,
  createAlbumSchema,
  renameContentSchema,
  type Actor,
  type Workspace,
} from '@kino-pic/contracts';
import type { Database } from './database.types';
import { RepositoryError, databaseError } from './workspaces';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from './workspace-cursor';
const projectColumns =
  'id,workspace_id,name,status,versioning_mode,revision,created_at';
const albumColumns =
  'id,workspace_id,project_id,name,state,is_pinned,legal_hold,revision,created_at';
type ProjectRow = Database['public']['Tables']['projects']['Row'];
type AlbumRow = Pick<
  Database['public']['Tables']['albums']['Row'],
  | 'id'
  | 'workspace_id'
  | 'project_id'
  | 'name'
  | 'state'
  | 'is_pinned'
  | 'legal_hold'
  | 'revision'
  | 'created_at'
>;
function project(row: ProjectRow) {
  return projectSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    status: row.status,
    versioningMode: row.versioning_mode,
    revision: row.revision,
    createdAt: row.created_at,
  });
}
function album(row: AlbumRow) {
  return albumSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    state: row.state,
    isPinned: row.is_pinned,
    legalHold: row.legal_hold,
    revision: row.revision,
    createdAt: row.created_at,
  });
}
function nextCursor(rows: { created_at: string; id: string }[]) {
  const tail = rows.at(23);
  return rows.length > 24 && tail
    ? encodeWorkspaceCursor({ createdAt: tail.created_at, id: tail.id })
    : null;
}
export class ProjectRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly actor: Actor,
  ) {}
  async getWorkspace(id: string): Promise<Workspace | null> {
    const workspaceId = z.uuid().parse(id);
    const { data: row, error } = await this.db
      .from('workspaces')
      .select('id,owner_user_id,name,quota_bytes,created_at')
      .eq('id', workspaceId)
      .maybeSingle();
    if (error) databaseError(error);
    if (!row) return null;
    let role: string | undefined;
    if (row.owner_user_id === this.actor.id) role = 'workspace_owner';
    else {
      const member = await this.db
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', this.actor.id)
        .eq('status', 'active')
        .maybeSingle();
      if (member.error) databaseError(member.error);
      // A revocation between the two snapshots must fail closed.
      if (!member.data) return null;
      role = member.data.role;
    }
    return workspaceSchema.parse({
      id: row.id,
      ownerUserId: row.owner_user_id,
      name: row.name,
      quotaBytes: row.quota_bytes,
      createdAt: row.created_at,
      role,
    });
  }
  async list(workspaceId: string, cursor?: string) {
    const after = decodeWorkspaceCursor(cursor);
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) throw new RepositoryError('NOT_FOUND');
    let query = this.db
      .from('projects')
      .select(projectColumns)
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(25);
    if (after)
      query = query.or(
        `created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`,
      );
    const { data, error } = await query;
    if (error) databaseError(error);
    const rows = data ?? [];
    return {
      workspace,
      projects: rows.slice(0, 24).map(project),
      nextCursor: nextCursor(rows),
    };
  }
  async get(projectId: string) {
    const id = z.uuid().parse(projectId);
    const { data, error } = await this.db
      .from('projects')
      .select(projectColumns)
      .eq('id', id)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data) throw new RepositoryError('NOT_FOUND');
    const workspace = await this.getWorkspace(data.workspace_id);
    if (!workspace) throw new RepositoryError('NOT_FOUND');
    return { workspace, project: project(data) };
  }
  async listAlbums(projectId: string, cursor?: string) {
    const after = decodeWorkspaceCursor(cursor);
    const context = await this.get(projectId);
    let query = this.db
      .from('albums')
      .select(albumColumns)
      .eq('workspace_id', context.workspace.id)
      .eq('project_id', context.project.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(25);
    if (after)
      query = query.or(
        `created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`,
      );
    const { data, error } = await query;
    if (error) databaseError(error);
    const rows = data ?? [];
    return {
      ...context,
      albums: rows.slice(0, 24).map(album),
      nextCursor: nextCursor(rows),
    };
  }
  async create(input: unknown) {
    const body = createProjectSchema.parse(input);
    const { data, error } = await this.db.rpc('create_project', {
      p_workspace_id: body.workspaceId,
      p_name: body.name,
      p_request_id: body.requestId,
    });
    if (error) databaseError(error);
    return projectSchema.parse(data);
  }
  async rename(projectId: string, input: unknown) {
    const id = z.uuid().parse(projectId);
    const body = renameContentSchema.parse(input);
    const { data, error } = await this.db.rpc('rename_project', {
      p_project_id: id,
      p_name: body.name,
      p_expected_revision: body.expectedRevision,
      p_request_id: body.requestId,
    });
    if (error) databaseError(error);
    return projectSchema.parse(data);
  }
  async createAlbum(projectId: string, input: unknown) {
    const id = z.uuid().parse(projectId);
    const body = createAlbumSchema.parse(input);
    const { data, error } = await this.db.rpc('create_album', {
      p_project_id: id,
      p_name: body.name,
      p_request_id: body.requestId,
    });
    if (error) databaseError(error);
    return albumSchema.parse(data);
  }
  async renameAlbum(albumId: string, input: unknown) {
    const id = z.uuid().parse(albumId);
    const body = renameContentSchema.parse(input);
    const { data, error } = await this.db.rpc('rename_album', {
      p_album_id: id,
      p_name: body.name,
      p_expected_revision: body.expectedRevision,
      p_request_id: body.requestId,
    });
    if (error) databaseError(error);
    return albumSchema.parse(data);
  }
}
