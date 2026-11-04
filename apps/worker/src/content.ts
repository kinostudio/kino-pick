import { z } from 'zod';
import { workspaceSchema } from '../../../packages/contracts/src/identity';
import {
  projectSchema,
  albumSchema,
  createProjectSchema,
  createAlbumSchema,
  renameContentSchema,
  albumProtectionSchema,
  contentArchiveSchema,
  type Project,
  type Album,
} from '../../../packages/contracts/src/projects';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from '../../../packages/db/src/workspace-cursor';
import { WorkspaceFailure } from './workspaces';

const albumRowSchema = z
  .object({
    isPinned: z.union([z.boolean(), z.number().int()]),
    legalHold: z.union([z.boolean(), z.number().int()]),
  })
  .passthrough();
function parseAlbumRow(input: unknown): Album {
  const row = albumRowSchema.parse(input);
  return albumSchema.parse({
    ...row,
    isPinned: row.isPinned === true || row.isPinned === 1,
    legalHold: row.legalHold === true || row.legalHold === 1,
  });
}

export class D1ContentRepository {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}
  private async mutate<T>(
    operation: string,
    payload: Record<string, unknown>,
    resourceId: string,
    parse: (value: unknown) => T,
  ) {
    const tombstone = await this.db
      .prepare(
        "SELECT 1 FROM audit_events WHERE (project_id=? AND action='project.deleted') OR (album_id=? AND action='album.deleted') LIMIT 1",
      )
      .bind(resourceId, resourceId)
      .first();
    if (tombstone) throw new WorkspaceFailure('NOT_FOUND', 404);
    try {
      await this.db
        .prepare(
          'INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          this.actor,
          payload.requestId as string,
          operation,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(payload).filter(([key]) => key !== 'requestId'),
            ),
          ),
          this.session,
          resourceId,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      for (const code of [
        'OWNER_REQUIRED',
        'REQUEST_ID_CONFLICT',
        'WORKSPACE_LIMIT_REACHED',
        'NOT_FOUND',
        'CONCURRENT_MODIFICATION',
        'RESOURCE_NOT_EDITABLE',
        'PROTECTION_CONFIRMATION_REQUIRED',
        'INVALID_STATE_TRANSITION',
        'CONTENT_NOT_EMPTY_OR_IDLE',
        'UPLOADS_IN_PROGRESS',
        'PROCESSING_IN_PROGRESS',
      ]) {
        if (message.includes(code))
          throw new WorkspaceFailure(
            code,
            code === 'OWNER_REQUIRED'
              ? 403
              : code === 'NOT_FOUND'
                ? 404
                : code === 'INVALID_STATE_TRANSITION' ||
                    code === 'CONTENT_NOT_EMPTY_OR_IDLE' ||
                    code === 'CONCURRENT_MODIFICATION' ||
                    code === 'RESOURCE_NOT_EDITABLE' ||
                    code === 'PROTECTION_CONFIRMATION_REQUIRED' ||
                    code === 'UPLOADS_IN_PROGRESS' ||
                    code === 'PROCESSING_IN_PROGRESS' ||
                    code === 'REQUEST_ID_CONFLICT' ||
                    code === 'WORKSPACE_LIMIT_REACHED'
                  ? 409
                  : 400,
          );
      }
      throw error;
    }
    const row = await this.db
      .prepare(
        "SELECT c.result_json FROM request_commands c JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE c.actor_id=? AND c.request_id=? AND c.operation=?",
      )
      .bind(this.session, this.actor, payload.requestId as string, operation)
      .first<{ result_json: string }>();
    if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    return parse(JSON.parse(row.result_json));
  }
  private async workspace(workspaceId: string) {
    const row = await this.db
      .prepare(
        "SELECT w.id,w.owner_user_id AS ownerUserId,w.name,w.quota_bytes AS quotaBytes,w.created_at AS createdAt,'workspace_owner' AS role FROM workspaces w JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE w.id=? AND w.owner_user_id=?",
      )
      .bind(this.session, workspaceId, this.actor)
      .first();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return workspaceSchema.parse(row);
  }
  private async project(projectId: string) {
    const row = await this.db
      .prepare(
        "SELECT p.id,p.workspace_id AS workspaceId,p.name,p.status,p.versioning_mode AS versioningMode,p.revision,p.created_at AS createdAt FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE p.id=? AND w.owner_user_id=? AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.project_id=p.id AND e.action='project.deleted')",
      )
      .bind(this.session, projectId, this.actor)
      .first();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    const project = projectSchema.parse(row);
    return { workspace: await this.workspace(project.workspaceId), project };
  }
  async listProjects(workspaceId: string, cursor?: string) {
    const workspace = await this.workspace(z.uuid().parse(workspaceId));
    const after = decodeWorkspaceCursor(cursor);
    const rows = await this.db
      .prepare(
        "SELECT p.id,p.workspace_id AS workspaceId,p.name,p.status,p.versioning_mode AS versioningMode,p.revision,p.created_at AS createdAt FROM projects p WHERE p.workspace_id=? AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.project_id=p.id AND e.action='project.deleted') AND (? IS NULL OR (p.created_at,p.id)<(?,?)) ORDER BY p.created_at DESC,p.id DESC LIMIT 25",
      )
      .bind(
        workspace.id,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
      )
      .all();
    const projects = rows.results
      .slice(0, 24)
      .map((row) => projectSchema.parse(row));
    const last = projects.at(-1);
    return {
      workspace,
      projects,
      nextCursor:
        rows.results.length > 24 && last
          ? encodeWorkspaceCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
  async getProject(projectId: string) {
    return this.project(z.uuid().parse(projectId));
  }
  async createProject(input: unknown): Promise<Project> {
    const body = createProjectSchema.parse(input);
    const resource = crypto.randomUUID();
    return this.mutate('project.created', body, resource, (value) =>
      projectSchema.parse(value),
    );
  }
  async renameProject(projectId: string, input: unknown): Promise<Project> {
    const id = z.uuid().parse(projectId);
    const body = renameContentSchema.parse(input);
    return this.mutate(
      'project.renamed',
      { projectId: id, ...body },
      id,
      (value) => projectSchema.parse(value),
    );
  }
  async listAlbums(projectId: string, cursor?: string) {
    const context = await this.project(z.uuid().parse(projectId));
    const after = decodeWorkspaceCursor(cursor);
    const rows = await this.db
      .prepare(
        "SELECT a.id,a.workspace_id AS workspaceId,a.project_id AS projectId,a.name,a.state,a.is_pinned AS isPinned,a.legal_hold AS legalHold,a.revision,a.created_at AS createdAt FROM albums a WHERE a.workspace_id=? AND a.project_id=? AND a.state<>'deleted' AND (? IS NULL OR (a.created_at,a.id)<(?,?)) ORDER BY a.created_at DESC,a.id DESC LIMIT 25",
      )
      .bind(
        context.workspace.id,
        context.project.id,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
      )
      .all();
    const albums = rows.results.slice(0, 24).map(parseAlbumRow);
    const last = albums.at(-1);
    return {
      ...context,
      albums,
      nextCursor:
        rows.results.length > 24 && last
          ? encodeWorkspaceCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
  async createAlbum(projectId: string, input: unknown): Promise<Album> {
    const id = z.uuid().parse(projectId);
    const body = createAlbumSchema.parse(input);
    return this.mutate(
      'album.created',
      { projectId: id, ...body },
      crypto.randomUUID(),
      (value) => albumSchema.parse(value),
    );
  }
  async renameAlbum(albumId: string, input: unknown): Promise<Album> {
    const id = z.uuid().parse(albumId);
    const body = renameContentSchema.parse(input);
    return this.mutate('album.renamed', { albumId: id, ...body }, id, (value) =>
      albumSchema.parse(value),
    );
  }
  async protectAlbum(albumId: string, input: unknown): Promise<Album> {
    const id = z.uuid().parse(albumId);
    const body = albumProtectionSchema.parse(input);
    return this.mutate(
      'album.protection_changed',
      { albumId: id, ...body },
      id,
      (value) => albumSchema.parse(value),
    );
  }
  async archiveProject(projectId: string, input: unknown): Promise<Project> {
    const id = z.uuid().parse(projectId);
    const body = contentArchiveSchema.parse(input);
    const operation = body.archived ? 'project.archived' : 'project.restored';
    return this.mutate(operation, { resourceId: id, ...body }, id, (value) =>
      projectSchema.parse(value),
    );
  }
  async archiveAlbum(albumId: string, input: unknown): Promise<Album> {
    const id = z.uuid().parse(albumId);
    const body = contentArchiveSchema.parse(input);
    const operation = body.archived ? 'album.archived' : 'album.restored';
    return this.mutate(operation, { resourceId: id, ...body }, id, (value) =>
      albumSchema.parse(value),
    );
  }
}
