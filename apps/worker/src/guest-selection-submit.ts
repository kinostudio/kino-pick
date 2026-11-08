import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import {
  guestSelectionSubmissionRequestSchema,
  guestSelectionSubmissionResultSchema,
} from '../../../packages/contracts/src/guest-actions';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { WorkspaceFailure } from './workspaces';
import { z } from 'zod';

const canSubmitBit = guestPermissionBit('can_submit');

type GuestScope = {
  id: string;
  guest_id: string;
  invite_id: string;
  workspace_id: string;
  project_id: string;
};

export class D1GuestSelectionSubmissionRepository {
  constructor(private db: D1Database) {}

  async submit(secret: string | null, albumId: string, input: unknown) {
    const album = z.uuid().parse(albumId);
    const request = guestSelectionSubmissionRequestSchema.parse(input);
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const session = await this.db
      .prepare(
        `SELECT s.id,s.guest_id,s.invite_id,i.workspace_id,i.project_id
         FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id
         WHERE s.secret_hash=?`,
      )
      .bind(secretHash)
      .first<GuestScope>();
    if (!session) throw new GuestAccessDenied();

    const payload = JSON.stringify({
      expectedRoundNo: request.expectedRoundNo ?? null,
      expectedRevision: request.expectedRevision ?? null,
    });
    // Reuse the original command round for an exact retry after a later Owner reopen.
    const previous = await this.db
      .prepare(
        `SELECT round_no,selection_revision,payload_json FROM guest_selection_submissions
         WHERE guest_id=? AND request_id=?`,
      )
      .bind(session.guest_id, request.requestId)
      .first<{
        round_no: number;
        selection_revision: number;
        payload_json: string;
      }>();
    const round = previous
      ? {
          round_no: previous.round_no,
          selection_revision: previous.selection_revision,
        }
      : await this.db
          .prepare(
            `SELECT round_no,selection_revision FROM guest_selection_round_state
             WHERE invite_id=? AND guest_id=? AND album_id=?`,
          )
          .bind(session.invite_id, session.guest_id, album)
          .first<{ round_no: number; selection_revision: number }>();
    const roundNo = round?.round_no ?? 1;
    const revision = round?.selection_revision ?? 0;
    try {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO guest_selection_submissions(
            id,guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,
            album_id,round_no,selection_revision,expected_round_no,expected_revision,payload_json
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          roundNo,
          revision,
          request.expectedRoundNo ?? null,
          request.expectedRevision ?? null,
          payload,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('GUEST_ACCESS_REQUIRED'))
        throw new GuestAccessDenied();
      if (
        [
          'REQUEST_ID_CONFLICT',
          'SELECTION_REVISION_CONFLICT',
          'SELECTION_ALREADY_SUBMITTED',
        ].some((code) => message.includes(code))
      )
        throw new WorkspaceFailure(
          message.includes('REQUEST_ID_CONFLICT')
            ? 'REQUEST_ID_CONFLICT'
            : message.includes('SELECTION_ALREADY_SUBMITTED')
              ? 'SELECTION_ALREADY_SUBMITTED'
              : 'SELECTION_REVISION_CONFLICT',
          409,
        );
      for (const code of [
        'SELECTION_LIMIT_REACHED',
        'SELECTION_MINIMUM_NOT_MET',
      ])
        if (message.includes(code)) throw new WorkspaceFailure(code, 409);
      if (message.includes('EMPTY_SELECTION'))
        throw new WorkspaceFailure('EMPTY_SELECTION', 422);
      if (message.includes('INVALID_TIMESTAMP'))
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      throw new WorkspaceFailure('SELECTION_SUBMISSION_UNAVAILABLE', 503);
    }

    const result = await this.db
      .prepare(
        `SELECT r.result_json
         FROM guest_selection_submissions c
         JOIN guest_selection_submission_results r ON r.submission_id=c.id
         JOIN guest_sessions s ON s.id=? AND s.guest_id=c.guest_id AND s.invite_id=c.invite_id AND s.secret_hash=?
         JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
         JOIN guest_invites i ON i.id=c.invite_id AND i.workspace_id=c.workspace_id AND i.project_id=c.project_id
         JOIN guest_invite_seals seal ON seal.invite_id=i.id
         JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=c.workspace_id AND ia.project_id=c.project_id AND ia.album_id=c.album_id
         JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id AND a.project_id=c.project_id AND a.state='active'
         JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id AND p.status NOT IN('archived','deleting','deleted')
         JOIN workspaces w ON w.id=c.workspace_id
         JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
         WHERE c.guest_id=? AND c.request_id=? AND (i.permissions_mask & ?)=?
           AND s.expires_at_ms>unixepoch('subsec')*1000 AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}
           AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations ir WHERE ir.invite_id=i.id)
           AND NOT EXISTS(SELECT 1 FROM guest_session_revocations sr WHERE sr.session_id=s.id)`,
      )
      .bind(
        session.id,
        secretHash,
        session.guest_id,
        request.requestId,
        canSubmitBit,
        canSubmitBit,
      )
      .first<{ result_json: string }>();
    if (!result) throw new GuestAccessDenied();
    try {
      return guestSelectionSubmissionResultSchema.parse(
        JSON.parse(result.result_json),
      );
    } catch {
      throw new WorkspaceFailure('SELECTION_SUBMISSION_UNAVAILABLE', 503);
    }
  }
}
