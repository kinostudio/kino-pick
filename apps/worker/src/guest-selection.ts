import { z } from 'zod';
import {
  guestSelectionRequestSchema,
  guestSelectionResultSchema,
} from '../../../packages/contracts/src/guest-actions';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { WorkspaceFailure } from './workspaces';

export class D1GuestSelectionRepository {
  constructor(private db: D1Database) {}

  async set(
    secret: string | null,
    albumId: string,
    photoId: string,
    input: unknown,
  ) {
    const album = z.uuid().parse(albumId);
    const photo = z.uuid().parse(photoId);
    const request = guestSelectionRequestSchema.parse(input);
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const session = await this.db
      .prepare(
        `SELECT s.id,s.guest_id,s.invite_id,i.workspace_id,i.project_id
         FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id
         WHERE s.secret_hash=?`,
      )
      .bind(secretHash)
      .first<{
        id: string;
        guest_id: string;
        invite_id: string;
        workspace_id: string;
        project_id: string;
      }>();
    if (!session) throw new GuestAccessDenied();

    const payload = JSON.stringify({
      selected: request.selected,
      versionId: request.versionId,
    });
    try {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO guest_selection_commands(
            id,guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,
            album_id,photo_id,version_id,selected,payload_json
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          session.guest_id,
          session.invite_id,
          session.id,
          secretHash,
          request.requestId,
          session.workspace_id,
          session.project_id,
          album,
          photo,
          request.versionId,
          request.selected ? 1 : 0,
          payload,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('GUEST_ACCESS_REQUIRED'))
        throw new GuestAccessDenied();
      if (message.includes('REQUEST_ID_CONFLICT'))
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (message.includes('SELECTION_ALREADY_SUBMITTED'))
        throw new WorkspaceFailure('SELECTION_ALREADY_SUBMITTED', 409);
      if (message.includes('SELECTION_LIMIT_REACHED'))
        throw new WorkspaceFailure('SELECTION_LIMIT_REACHED', 409);
      if (message.includes('INVALID_TIMESTAMP'))
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      throw new WorkspaceFailure('SELECTION_RESULT_UNAVAILABLE', 503);
    }

    const row = await this.db
      .prepare(
        `SELECT r.result_json
         FROM guest_selection_commands c
         JOIN guest_selection_results r ON r.command_id=c.id
         JOIN guest_sessions s ON s.id=? AND s.guest_id=c.guest_id AND s.invite_id=c.invite_id AND s.secret_hash=?
         JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
         JOIN guest_invites i ON i.id=c.invite_id AND i.workspace_id=c.workspace_id AND i.project_id=c.project_id
         JOIN guest_invite_seals seal ON seal.invite_id=i.id
         JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=c.workspace_id AND ia.project_id=c.project_id AND ia.album_id=c.album_id
         JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id AND a.project_id=c.project_id AND a.state='active'
         JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id AND p.status NOT IN('archived','deleting','deleted')
         JOIN workspaces w ON w.id=c.workspace_id
         JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
         JOIN photos ph ON ph.id=c.photo_id AND ph.workspace_id=c.workspace_id AND ph.project_id=c.project_id AND ph.album_id=c.album_id
         JOIN photo_versions v ON v.id=c.version_id AND v.workspace_id=c.workspace_id AND v.photo_id=c.photo_id
         WHERE c.guest_id=? AND c.request_id=? AND (i.permissions_mask & 8)=8
           AND s.expires_at_ms>unixepoch('subsec')*1000 AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}
           AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations ir WHERE ir.invite_id=i.id)
           AND NOT EXISTS(SELECT 1 FROM guest_session_revocations sr WHERE sr.session_id=s.id)`,
      )
      .bind(session.id, secretHash, session.guest_id, request.requestId)
      .first<{ result_json: string }>();
    if (!row) throw new GuestAccessDenied();
    try {
      return guestSelectionResultSchema.parse(JSON.parse(row.result_json));
    } catch {
      throw new WorkspaceFailure('SELECTION_RESULT_UNAVAILABLE', 503);
    }
  }
}
