import { z } from 'zod';
import {
  ownerRoundReopenRequestSchema,
  ownerRoundReopenResponseSchema,
  ownerSubmissionDetailResponseSchema,
  ownerSubmissionListResponseSchema,
} from '../../../packages/contracts/src/owner-selection';
import { WorkspaceFailure } from './workspaces';

type AlbumScope = {
  workspaceId: string;
  projectId: string;
  albumState: string;
  projectStatus: string;
};

export class D1OwnerSelectionRepository {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}

  private async authorize(albumId?: string): Promise<AlbumScope | null> {
    const current = await this.db
      .prepare(
        `SELECT 1 FROM owners o
         JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
         WHERE o.user_id=? AND o.enabled=1`,
      )
      .bind(this.session, this.actor)
      .first();
    if (!current) throw new WorkspaceFailure('OWNER_REQUIRED', 403);

    if (albumId) {
      const album = await this.db
        .prepare(
          `SELECT a.workspace_id, a.project_id, a.state, p.status AS project_status
           FROM albums a
           JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
           JOIN workspaces w ON w.id=a.workspace_id
           WHERE a.id=? AND w.owner_user_id=?`,
        )
        .bind(albumId, this.actor)
        .first<{
          workspace_id: string;
          project_id: string;
          state: string;
          project_status: string;
        }>();
      if (!album) throw new WorkspaceFailure('NOT_FOUND', 404);
      return {
        workspaceId: album.workspace_id,
        projectId: album.project_id,
        albumState: album.state,
        projectStatus: album.project_status,
      };
    }
    return null;
  }

  async listSubmissions(albumId: string) {
    const album = z.uuid().parse(albumId);
    const scope = await this.authorize(album);
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);

    const rows = await this.db
      .prepare(
        `SELECT s.id, s.invite_id AS inviteId, s.guest_id AS guestId, s.round_no AS roundNo,
           s.selection_revision AS selectionRevision,
           (SELECT count(*) FROM guest_selection_submission_items i WHERE i.submission_id=s.id) AS selectedCount,
           strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at_ms/1000.0, 'unixepoch') AS submittedAt,
           COALESCE(r.status, 'submitted') AS roundStatus,
           COALESCE(r.round_no, s.round_no) AS currentRoundNo,
           EXISTS(SELECT 1 FROM guest_selection_submission_seals seal WHERE seal.submission_id=s.id) AS sealed
         FROM guest_selection_submissions s
         LEFT JOIN guest_selection_round_state r ON r.invite_id=s.invite_id AND r.guest_id=s.guest_id AND r.album_id=s.album_id
         WHERE s.album_id=? AND s.workspace_id=?
         ORDER BY s.round_no DESC, s.created_at_ms DESC`,
      )
      .bind(album, scope.workspaceId)
      .all<{
        id: string;
        inviteId: string;
        guestId: string;
        roundNo: number;
        selectionRevision: number;
        selectedCount: number;
        submittedAt: string;
        roundStatus: 'open' | 'submitted';
        currentRoundNo: number;
        sealed: number;
      }>();

    const submissions = rows.results.map((row) => ({
      ...row,
      sealed: row.sealed === 1,
    }));

    return ownerSubmissionListResponseSchema.parse({ submissions });
  }

  async getSubmission(albumId: string, submissionId: string) {
    const album = z.uuid().parse(albumId);
    const submission = z.uuid().parse(submissionId);
    const scope = await this.authorize(album);
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);

    const header = await this.db
      .prepare(
        `SELECT s.id, s.invite_id AS inviteId, s.guest_id AS guestId, s.album_id AS albumId,
           s.round_no AS roundNo, s.selection_revision AS selectionRevision,
           (SELECT count(*) FROM guest_selection_submission_items i WHERE i.submission_id=s.id) AS selectedCount,
           strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at_ms/1000.0, 'unixepoch') AS submittedAt,
           COALESCE(r.status, 'submitted') AS roundStatus,
           COALESCE(r.round_no, s.round_no) AS currentRoundNo,
           EXISTS(SELECT 1 FROM guest_selection_submission_seals seal WHERE seal.submission_id=s.id) AS sealed
         FROM guest_selection_submissions s
         LEFT JOIN guest_selection_round_state r ON r.invite_id=s.invite_id AND r.guest_id=s.guest_id AND r.album_id=s.album_id
         WHERE s.id=? AND s.album_id=? AND s.workspace_id=?`,
      )
      .bind(submission, album, scope.workspaceId)
      .first<{
        id: string;
        inviteId: string;
        guestId: string;
        albumId: string;
        roundNo: number;
        selectionRevision: number;
        selectedCount: number;
        submittedAt: string;
        roundStatus: 'open' | 'submitted';
        currentRoundNo: number;
        sealed: number;
      }>();

    if (!header) throw new WorkspaceFailure('NOT_FOUND', 404);

    const items = await this.db
      .prepare(
        `SELECT i.photo_id AS photoId, i.version_id AS versionId,
           strftime('%Y-%m-%dT%H:%M:%fZ', i.selected_at_ms/1000.0, 'unixepoch') AS selectedAt,
           p.original_filename AS originalFilename,
           v.version_no AS versionNo,
           v.byte_size AS byteSize,
           v.width, v.height
         FROM guest_selection_submission_items i
         JOIN photos p ON p.id=i.photo_id AND p.album_id=i.album_id AND p.workspace_id=i.workspace_id
         JOIN photo_versions v ON v.id=i.version_id AND v.photo_id=i.photo_id AND v.workspace_id=i.workspace_id
         WHERE i.submission_id=?
         ORDER BY i.selected_at_ms ASC, i.photo_id ASC`,
      )
      .bind(submission)
      .all<{
        photoId: string;
        versionId: string;
        selectedAt: string;
        originalFilename: string;
        versionNo: number;
        byteSize: number;
        width: number | null;
        height: number | null;
      }>();

    return ownerSubmissionDetailResponseSchema.parse({
      submission: {
        ...header,
        sealed: header.sealed === 1,
        items: items.results,
      },
    });
  }

  async exportSubmission(
    albumId: string,
    submissionId: string,
    format: 'json' | 'csv' | 'txt',
  ) {
    const detail = await this.getSubmission(albumId, submissionId);
    const sub = detail.submission;
    let exported: {
      contentType: string;
      body: string;
      filename: string;
    };

    if (format === 'json') {
      exported = {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(detail, null, 2),
        filename: `selection-${sub.albumId}-round-${sub.roundNo}.json`,
      };
    } else if (format === 'csv') {
      const neutralizeSpreadsheetFormula = (value: string) =>
        /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value)
          ? `'${value}`
          : value;
      const escapeCsv = (str: string) =>
        `"${neutralizeSpreadsheetFormula(str).replace(/"/g, '""')}"`;
      const headerLine =
        'photo_id,filename,version_no,version_id,selected_at\r\n';
      const rows = sub.items
        .map(
          (item) =>
            `${item.photoId},${escapeCsv(item.originalFilename)},${item.versionNo},${item.versionId},${item.selectedAt}`,
        )
        .join('\r\n');
      exported = {
        contentType: 'text/csv; charset=utf-8',
        body: headerLine + rows,
        filename: `selection-${sub.albumId}-round-${sub.roundNo}.csv`,
      };
    } else {
      // format === 'txt' (plain list of filenames)
      const rows = sub.items.map((item) => item.originalFilename).join('\n');
      exported = {
        contentType: 'text/plain; charset=utf-8',
        body: rows,
        filename: `selection-${sub.albumId}-round-${sub.roundNo}-filenames.txt`,
      };
    }

    const album = z.uuid().parse(albumId);
    const submission = z.uuid().parse(submissionId);
    const scope = await this.authorize(album);
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);

    const eventId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const afterJson = JSON.stringify({
      submissionId: submission,
      format,
      selectedCount: sub.items.length,
    });
    const audit = await this.db
      .prepare(
        `INSERT INTO audit_events(
           event_id, actor_type, actor_id, session_id, workspace_id, project_id, album_id,
           action, after_json, request_id
         )
         SELECT ?, 'user', o.user_id, s.id, w.id, p.id, a.id,
           'download.generated', ?, ?
         FROM owners o
         JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?
           AND s.expiresAt>unixepoch('subsec')*1000
         JOIN workspaces w ON w.id=? AND w.owner_user_id=o.user_id
         JOIN projects p ON p.id=? AND p.workspace_id=w.id
         JOIN albums a ON a.id=? AND a.project_id=p.id AND a.workspace_id=w.id
         JOIN guest_selection_submissions sub
           ON sub.id=? AND sub.album_id=a.id AND sub.workspace_id=w.id
           AND sub.project_id=p.id
         WHERE o.user_id=? AND o.enabled=1`,
      )
      .bind(
        eventId,
        afterJson,
        requestId,
        this.session,
        scope.workspaceId,
        scope.projectId,
        album,
        submission,
        this.actor,
      )
      .run();

    if (audit.meta.changes !== 1) {
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    }

    return exported;
  }

  async reopenRound(albumId: string, input: unknown) {
    const album = z.uuid().parse(albumId);
    const request = ownerRoundReopenRequestSchema.parse(input);
    const scope = await this.authorize(album);
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);

    if (
      ['archived', 'deleting', 'deleted'].includes(scope.projectStatus) ||
      ['archived', 'deleting', 'deleted'].includes(scope.albumState)
    ) {
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    }

    // Cross-ledger request ID collision checks
    const crossLedgerCollision = await this.db
      .prepare(
        `SELECT 1 WHERE
      EXISTS(SELECT 1 FROM request_commands WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM upload_requests WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM upload_workflow_requests WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM processing_review_commands WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM invite_revocation_commands WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM invite_creation_commands WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM selection_policy_commands WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM selection_policy_configuration_commands WHERE actor_id=? AND request_id=?) OR
      EXISTS(SELECT 1 FROM shared_review_owner_commands WHERE actor_id=? AND request_id=?)`,
      )
      .bind(
        ...Array.from({ length: 9 }, () => [
          this.actor,
          request.requestId,
        ]).flat(),
      )
      .first();
    if (crossLedgerCollision) {
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    }

    // Check for idempotent replay
    const newRoundNo = request.expectedRoundNo + 1;
    const eventId = `guest-selection-reopen:${request.inviteId}:${request.guestId}:${album}:${newRoundNo}`;
    const priorAudit = await this.db
      .prepare(
        `SELECT event_id, actor_id, occurred_at_utc, before_json, after_json,
           workspace_id, project_id, album_id
         FROM audit_events
         WHERE request_id=? AND action='selection.reopened'`,
      )
      .bind(request.requestId)
      .first<{
        event_id: string;
        actor_id: string;
        occurred_at_utc: string;
        before_json: string;
        after_json: string;
        workspace_id: string;
        project_id: string;
        album_id: string;
      }>();

    if (priorAudit) {
      const before = JSON.parse(priorAudit.before_json) as {
        status?: string;
        roundNo: number;
      };
      const after = JSON.parse(priorAudit.after_json) as {
        status?: string;
        roundNo: number;
        selectionRevision?: 0 | 1;
      };
      if (
        priorAudit.actor_id === this.actor &&
        priorAudit.workspace_id === scope.workspaceId &&
        priorAudit.project_id === scope.projectId &&
        priorAudit.album_id === album &&
        priorAudit.event_id === eventId &&
        before.status === 'submitted' &&
        before.roundNo === request.expectedRoundNo &&
        after.status === 'open' &&
        after.roundNo === newRoundNo
      ) {
        return ownerRoundReopenResponseSchema.parse({
          reopen: {
            albumId: album,
            inviteId: request.inviteId,
            guestId: request.guestId,
            roundNo: after.roundNo,
            selectionRevision: after.selectionRevision ?? 0,
            status: 'open',
            reopenedAt: priorAudit.occurred_at_utc,
            eventId: priorAudit.event_id,
          },
        });
      }
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    }

    // Read current round state
    const currentRound = await this.db
      .prepare(
        `SELECT round_no, selection_revision, status
         FROM guest_selection_round_state
         WHERE invite_id=? AND guest_id=? AND album_id=?`,
      )
      .bind(request.inviteId, request.guestId, album)
      .first<{
        round_no: number;
        selection_revision: number;
        status: string;
      }>();

    if (!currentRound) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (currentRound.status !== 'submitted') {
      throw new WorkspaceFailure('ROUND_NOT_SUBMITTED', 409);
    }
    if (currentRound.round_no !== request.expectedRoundNo) {
      throw new WorkspaceFailure('ROUND_CONFLICT', 409);
    }

    const nowMs = Date.now();
    const nowUtc = new Date(nowMs).toISOString();
    const beforeJson = JSON.stringify({
      status: 'submitted',
      roundNo: request.expectedRoundNo,
    });
    const afterJson = JSON.stringify({
      status: 'open',
      roundNo: newRoundNo,
      selectionRevision: 1,
    });

    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO audit_events(
               event_id, actor_type, actor_id, session_id, workspace_id, project_id, album_id,
               action, before_json, after_json, request_id, occurred_at_utc
             ) VALUES(?, 'user', ?, ?, ?, ?, ?, 'selection.reopened', ?, ?, ?, ?)`,
          )
          .bind(
            eventId,
            this.actor,
            this.session,
            scope.workspaceId,
            scope.projectId,
            album,
            beforeJson,
            afterJson,
            request.requestId,
            nowUtc,
          ),
        this.db
          .prepare(
            `UPDATE guest_selection_round_state
             SET status='open', round_no=?, selection_revision=1, submitted_at_ms=NULL, updated_at_ms=?
             WHERE invite_id=? AND guest_id=? AND album_id=? AND status='submitted' AND round_no=?`,
          )
          .bind(
            newRoundNo,
            nowMs,
            request.inviteId,
            request.guestId,
            album,
            request.expectedRoundNo,
          ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('REQUEST_ID_CONFLICT'))
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (
        message.includes('INVALID_GUEST_SELECTION_ROUND_TRANSITION') ||
        message.includes('IMMUTABLE_GUEST_SELECTION_ROUND_SCOPE')
      ) {
        throw new WorkspaceFailure('ROUND_CONFLICT', 409);
      }
      if (message.includes('UNIQUE constraint failed: audit_events.event_id')) {
        throw new WorkspaceFailure('ROUND_ALREADY_REOPENED', 409);
      }
      throw error;
    }

    return ownerRoundReopenResponseSchema.parse({
      reopen: {
        albumId: album,
        inviteId: request.inviteId,
        guestId: request.guestId,
        roundNo: newRoundNo,
        selectionRevision: 1,
        status: 'open',
        reopenedAt: nowUtc,
        eventId,
      },
    });
  }
}
