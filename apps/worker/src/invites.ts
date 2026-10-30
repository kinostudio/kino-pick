import { z } from 'zod';
import {
  invitePageSchema,
  revokeInviteSchema,
  revokedInviteSchema,
} from '../../../packages/contracts/src/invites';
import { decodeGuestPermissions } from '../../../packages/contracts/src/guest-access';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from '../../../packages/db/src/workspace-cursor';
import { WorkspaceFailure } from './workspaces';

export class D1InviteRepository {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}
  private async authorize(projectId?: string) {
    const current = await this.db
      .prepare(
        `SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE o.user_id=? AND o.enabled=1`,
      )
      .bind(this.session, this.actor)
      .first();
    if (!current) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    if (projectId) {
      const project = await this.db
        .prepare(
          'SELECT p.workspace_id FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=? AND w.owner_user_id=?',
        )
        .bind(projectId, this.actor)
        .first<{ workspace_id: string }>();
      if (!project) throw new WorkspaceFailure('NOT_FOUND', 404);
      return project.workspace_id;
    }
    return null;
  }
  async list(projectId: string, cursor?: string) {
    z.uuid().parse(projectId);
    const workspaceId = await this.authorize(projectId);
    const after = decodeWorkspaceCursor(cursor);
    // Integer-ms storage projected to a canonical ISO cursor, same tie-breaker.
    const rows = await this.db
      .prepare(
        `SELECT i.id,i.workspace_id AS workspaceId,i.project_id AS projectId,i.access_mode AS accessMode,i.permissions_mask AS mask,
      strftime('%Y-%m-%dT%H:%M:%fZ',i.created_at_ms/1000.0,'unixepoch') AS createdAt,
      strftime('%Y-%m-%dT%H:%M:%fZ',i.expires_at_ms/1000.0,'unixepoch') AS expiresAt,
      strftime('%Y-%m-%dT%H:%M:%fZ',r.revoked_at_ms/1000.0,'unixepoch') AS revokedAt,
      EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id) AS sealed,
      i.max_uses AS maxUses,(SELECT count(*) FROM guest_sessions g WHERE g.invite_id=i.id) AS issuedSessions,
      (SELECT json_group_array(json_object('id',id,'name',name)) FROM (SELECT a.id,a.name FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id ORDER BY a.id)) AS albumsJson
      FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      LEFT JOIN guest_invite_revocations r ON r.invite_id=i.id
      WHERE i.workspace_id=? AND i.project_id=? AND w.owner_user_id=? AND (? IS NULL OR (strftime('%Y-%m-%dT%H:%M:%fZ',i.created_at_ms/1000.0,'unixepoch'),i.id)<(?,?))
      ORDER BY i.created_at_ms DESC,i.id DESC LIMIT 25`,
      )
      .bind(
        this.session,
        workspaceId,
        projectId,
        this.actor,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
      )
      .all();
    await this.authorize(projectId);
    const invites = rows.results.slice(0, 24).map((row) => {
      const { mask, sealed, albumsJson, ...summary } = row;
      return {
        ...summary,
        sealed: sealed === 1,
        permissions: decodeGuestPermissions(mask),
        albums: JSON.parse(z.string().parse(albumsJson)) as unknown,
      };
    });
    const parsed = invitePageSchema.parse({ invites, nextCursor: null });
    const last = parsed.invites.at(-1);
    return {
      ...parsed,
      nextCursor:
        rows.results.length > 24 && last
          ? encodeWorkspaceCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
  async revoke(inviteId: string, input: unknown) {
    z.uuid().parse(inviteId);
    const value = revokeInviteSchema.parse(input);
    await this.authorize();
    try {
      await this.db
        .prepare(
          'INSERT INTO invite_revocation_commands(actor_id,request_id,session_id,invite_id,payload_json) VALUES(?,?,?,?,?)',
        )
        .bind(
          this.actor,
          value.requestId,
          this.session,
          inviteId,
          JSON.stringify({ confirmRevoke: true }),
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      for (const code of [
        'OWNER_REQUIRED',
        'NOT_FOUND',
        'REQUEST_ID_CONFLICT',
        'INVITE_ALREADY_REVOKED',
      ]) {
        if (message.includes(code))
          throw new WorkspaceFailure(
            code,
            code === 'OWNER_REQUIRED' ? 403 : code === 'NOT_FOUND' ? 404 : 409,
          );
      }
      throw error;
    }
    // Read committed immutable result only with the CURRENT session, even replay.
    const result = await this.db
      .prepare(
        `SELECT i.id AS inviteId,i.workspace_id AS workspaceId,i.project_id AS projectId,strftime('%Y-%m-%dT%H:%M:%fZ',r.revoked_at_ms/1000.0,'unixepoch') AS revokedAt
      FROM invite_revocation_commands c JOIN guest_invites i ON i.id=c.invite_id
      JOIN guest_invite_revocations r ON r.invite_id=i.id
      JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=c.actor_id
      JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      WHERE c.actor_id=? AND c.request_id=? AND c.invite_id=?`,
      )
      .bind(this.session, this.actor, value.requestId, inviteId)
      .first();
    if (!result) {
      await this.authorize();
      throw new WorkspaceFailure('INVITE_RESULT_UNAVAILABLE', 503);
    }
    return revokedInviteSchema.parse(result);
  }
}
