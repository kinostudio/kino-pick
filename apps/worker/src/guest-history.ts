import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import { guestMediaDownloadAuditSchema } from '../../../packages/contracts/src/guest-downloads';
import {
  guestZipDownloadHistoryDetailSchema,
  guestVersionApprovalHistoryDetailSchema,
  guestHistoryActionSchema,
  guestHistoryEventSchema,
  guestHistoryPageSchema,
  guestHistoryQuerySchema,
  type GuestHistoryAction,
  type GuestHistoryQuery,
} from '../../../packages/contracts/src/guest-history';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { WorkspaceFailure } from './workspaces';

const canViewOwnHistoryBit = guestPermissionBit('can_view_own_history');
const CURSOR_DOMAIN = 'kino-pic:guest-history-cursor:v1:';
const CURSOR_TTL_SECONDS = 15 * 60;
const PAGE_SIZE = 24;
const FETCH_SIZE = PAGE_SIZE + 1;
const MAX_SQLITE_ROWID = '9223372036854775807';
const HISTORY_ACTIONS_SQL = `'selection.added','selection.removed','selection.version_changed','selection.submitted',
  'rating.set','rating.cleared','favorite.added','favorite.removed',
  'tag.added','tag.removed','shared_selection.added','shared_selection.removed',
  'shared_selection.version_changed','shared_selection.submitted',
  'comment.create','comment.edit','comment.delete','comment.resolve','comment.reopen',
  'annotation.created','annotation.updated','annotation.deleted','annotation.resolved','annotation.reopened',
  'download.requested','download.generated','delivery.download_requested','delivery.download_generated',
  'delivery.zip_download_requested','delivery.zip_download_generated','version_approval.confirmed'`;

const cursorClaimsSchema = z
  .object({
    version: z.literal(1),
    guestId: z.uuid(),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    snapshotRowId: z
      .string()
      .min(1)
      .max(19)
      .regex(/^(0|[1-9][0-9]*)$/)
      .refine(
        (value) =>
          value.length < MAX_SQLITE_ROWID.length ||
          (value.length === MAX_SQLITE_ROWID.length &&
            value <= MAX_SQLITE_ROWID),
      ),
    lastOccurredAt: z.iso.datetime(),
    lastEventId: z.string().min(1).max(128),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt !== value.issuedAt + CURSOR_TTL_SECONDS) {
      context.addIssue({ code: 'custom', message: 'Invalid cursor lifetime' });
    }
  });
type CursorClaims = z.infer<typeof cursorClaimsSchema>;

type CurrentScopeRow = {
  authorizedCount: number;
  guestId: string | null;
  inviteId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  albumAuthorized: number;
  photoAllowed: number;
};

type HistoryRow = CurrentScopeRow & {
  snapshotRowId: string;
  eventId: string | null;
  occurredAt: string | null;
  albumId: string | null;
  photoId: string | null;
  versionId: string | null;
  photoStatus: 'available' | 'unavailable' | null;
  action: string | null;
  beforeJson: string | null;
  afterJson: string | null;
};

const currentScopeCte = `
  current_scope AS (
    SELECT s.id AS session_id,g.id AS guest_id,i.id AS invite_id,
      i.workspace_id AS workspace_id,i.project_id AS project_id
    FROM guest_sessions s
    JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
    JOIN guest_invites i ON i.id=s.invite_id
    JOIN guest_invite_seals sealed ON sealed.invite_id=i.id
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
    JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
      AND p.status NOT IN('archived','deleting','deleted')
    WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?
      AND s.expires_at_ms>unixepoch('subsec')*1000
      AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
      AND EXISTS(
        SELECT 1 FROM guest_invite_albums ia
        JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id
          AND a.project_id=i.project_id AND a.state='active'
        WHERE ia.invite_id=i.id AND ia.workspace_id=i.workspace_id
          AND ia.project_id=i.project_id
          AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}
      )
  )`;

const photoAllowedExpression = `CASE WHEN ? IS NULL THEN 1 ELSE
      CASE WHEN EXISTS(SELECT 1 FROM photos existing_photo WHERE existing_photo.id=?) THEN EXISTS(
        SELECT 1 FROM current_scope cs
        JOIN guest_invites i ON i.id=cs.invite_id
          AND i.workspace_id=cs.workspace_id AND i.project_id=cs.project_id
        JOIN guest_invite_albums ia ON ia.invite_id=cs.invite_id
          AND ia.workspace_id=cs.workspace_id AND ia.project_id=cs.project_id
        JOIN albums active_album ON active_album.id=ia.album_id
          AND active_album.workspace_id=cs.workspace_id
          AND active_album.project_id=cs.project_id AND active_album.state='active'
        JOIN photos live_photo ON live_photo.id=?
          AND live_photo.workspace_id=cs.workspace_id
          AND live_photo.project_id=cs.project_id
          AND live_photo.album_id=ia.album_id
        WHERE ia.album_id=? AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}
      ) ELSE EXISTS(
        SELECT 1 FROM current_scope cs
        JOIN guest_invites i ON i.id=cs.invite_id
          AND i.workspace_id=cs.workspace_id AND i.project_id=cs.project_id
        JOIN audit_events witness ON witness.actor_type='guest'
          AND witness.actor_id=cs.guest_id
          AND witness.workspace_id=cs.workspace_id
          AND witness.project_id=cs.project_id
          AND witness.photo_id=? AND witness.album_id=?
          AND witness.action IN(${HISTORY_ACTIONS_SQL})
        JOIN guest_sessions historical_session
          ON historical_session.id=witness.guest_session_id
          AND historical_session.guest_id=cs.guest_id
          AND historical_session.invite_id=cs.invite_id
        JOIN guest_invite_albums allowed_album
          ON allowed_album.invite_id=cs.invite_id
          AND allowed_album.workspace_id=cs.workspace_id
          AND allowed_album.project_id=cs.project_id
          AND allowed_album.album_id=witness.album_id
        JOIN albums active_album ON active_album.id=allowed_album.album_id
          AND active_album.workspace_id=cs.workspace_id
          AND active_album.project_id=cs.project_id
          AND active_album.state='active'
        WHERE ${guestInviteAlbumExpiryCondition('i', 'allowed_album.album_id')}
      ) END
    END`;
function scopeCheckSql() {
  return `WITH ${currentScopeCte}
    SELECT
      (SELECT count(*) FROM current_scope) AS authorizedCount,
      (SELECT min(guest_id) FROM current_scope) AS guestId,
      (SELECT min(invite_id) FROM current_scope) AS inviteId,
      (SELECT min(workspace_id) FROM current_scope) AS workspaceId,
      (SELECT min(project_id) FROM current_scope) AS projectId,
      CASE WHEN ? IS NULL THEN 1 ELSE EXISTS(
        SELECT 1 FROM current_scope cs
        JOIN guest_invites i ON i.id=cs.invite_id
          AND i.workspace_id=cs.workspace_id AND i.project_id=cs.project_id
        JOIN guest_invite_albums ia ON ia.invite_id=cs.invite_id
          AND ia.workspace_id=cs.workspace_id AND ia.project_id=cs.project_id
        JOIN albums a ON a.id=ia.album_id AND a.workspace_id=cs.workspace_id
          AND a.project_id=cs.project_id AND a.state='active'
        WHERE ia.album_id=? AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}
      ) END AS albumAuthorized,
      ${photoAllowedExpression} AS photoAllowed`;
}

function pageSql() {
  return `WITH ${currentScopeCte},
    request_snapshot AS (
      SELECT COALESCE(?,CAST(COALESCE(MAX(rowid),0) AS TEXT)) AS high_rowid
      FROM audit_events
    ),
    scope_summary AS (
      SELECT
        (SELECT count(*) FROM current_scope) AS authorizedCount,
        (SELECT min(guest_id) FROM current_scope) AS guestId,
        (SELECT min(invite_id) FROM current_scope) AS inviteId,
        (SELECT min(workspace_id) FROM current_scope) AS workspaceId,
        (SELECT min(project_id) FROM current_scope) AS projectId,
        CASE WHEN ? IS NULL THEN 1 ELSE EXISTS(
          SELECT 1 FROM current_scope cs
          JOIN guest_invites i ON i.id=cs.invite_id
            AND i.workspace_id=cs.workspace_id AND i.project_id=cs.project_id
          JOIN guest_invite_albums ia ON ia.invite_id=cs.invite_id
            AND ia.workspace_id=cs.workspace_id AND ia.project_id=cs.project_id
          JOIN albums a ON a.id=ia.album_id AND a.workspace_id=cs.workspace_id
            AND a.project_id=cs.project_id AND a.state='active'
          WHERE ia.album_id=? AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')}
        ) END AS albumAuthorized,
        ${photoAllowedExpression} AS photoAllowed,
        (SELECT high_rowid FROM request_snapshot) AS snapshotRowId
    ),
    visible_events AS (
      SELECT e.rowid AS source_rowid,e.event_id AS eventId,
        e.occurred_at_utc AS occurredAt,e.album_id AS albumId,
        e.photo_id AS photoId,e.version_id AS versionId,
        CASE WHEN e.photo_id IS NULL THEN NULL
          WHEN photo.id IS NULL OR event_version.id IS NULL THEN 'unavailable'
          ELSE 'available' END AS photoStatus,
        e.action AS action,e.before_json AS beforeJson,e.after_json AS afterJson
      FROM audit_events e
      JOIN current_scope cs ON e.actor_type='guest' AND e.actor_id=cs.guest_id
        AND e.workspace_id=cs.workspace_id AND e.project_id=cs.project_id
      JOIN guest_invites i ON i.id=cs.invite_id
        AND i.workspace_id=cs.workspace_id AND i.project_id=cs.project_id
      JOIN guest_sessions historical_session
        ON historical_session.id=e.guest_session_id
        AND historical_session.guest_id=cs.guest_id
        AND historical_session.invite_id=cs.invite_id
      JOIN guest_invite_albums allowed_album
        ON allowed_album.invite_id=cs.invite_id
        AND allowed_album.workspace_id=cs.workspace_id
        AND allowed_album.project_id=cs.project_id
        AND allowed_album.album_id=e.album_id
      JOIN albums active_album ON active_album.id=allowed_album.album_id
        AND active_album.workspace_id=cs.workspace_id
        AND active_album.project_id=cs.project_id AND active_album.state='active'
      LEFT JOIN photos photo ON photo.id=e.photo_id
        AND photo.workspace_id=cs.workspace_id AND photo.project_id=cs.project_id
        AND photo.album_id=e.album_id
      LEFT JOIN photo_versions event_version ON event_version.id=e.version_id
        AND event_version.workspace_id=cs.workspace_id
        AND event_version.photo_id=e.photo_id
      WHERE e.action IN(${HISTORY_ACTIONS_SQL})
        AND ${guestInviteAlbumExpiryCondition('i', 'allowed_album.album_id')}
        AND e.rowid<=CAST((SELECT high_rowid FROM request_snapshot) AS INTEGER)
        AND (? IS NULL OR e.album_id=?)
        AND (? IS NULL OR e.photo_id=?)
        AND (? IS NULL OR (e.occurred_at_utc,e.event_id)<(?,?))
      ORDER BY e.occurred_at_utc DESC,e.event_id DESC
      LIMIT ${FETCH_SIZE}
    )
    SELECT summary.authorizedCount,summary.guestId,summary.inviteId,
      summary.workspaceId,summary.projectId,summary.albumAuthorized,
      summary.photoAllowed,summary.snapshotRowId,
      event.eventId,event.occurredAt,event.albumId,event.photoId,
      event.versionId,event.photoStatus,event.action,event.beforeJson,event.afterJson
    FROM scope_summary summary
    LEFT JOIN visible_events event ON 1=1
    ORDER BY event.occurredAt DESC,event.eventId DESC`;
}

function isAuthorizedScope(
  row: CurrentScopeRow | null,
): row is CurrentScopeRow & {
  guestId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
} {
  return (
    !!row &&
    row.authorizedCount === 1 &&
    !!row.guestId &&
    !!row.inviteId &&
    !!row.workspaceId &&
    !!row.projectId &&
    row.albumAuthorized === 1 &&
    row.photoAllowed === 1
  );
}

function failInvalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function failUnavailable(): never {
  throw new WorkspaceFailure('HISTORY_UNAVAILABLE', 503);
}

function parseCursorEncoding(token: string) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) failInvalidInput();
  const [payloadSegment, signatureSegment] = token.split('.');
  if (!payloadSegment || !signatureSegment) failInvalidInput();
  try {
    const payloadBytes = Buffer.from(payloadSegment, 'base64url');
    const signatureBytes = Buffer.from(signatureSegment, 'base64url');
    if (
      payloadBytes.length === 0 ||
      payloadBytes.length > 1400 ||
      signatureBytes.length !== 32 ||
      payloadBytes.toString('base64url') !== payloadSegment ||
      signatureBytes.toString('base64url') !== signatureSegment
    )
      failInvalidInput();
    return { payloadSegment, payloadBytes, signatureBytes };
  } catch {
    failInvalidInput();
  }
}

async function importCursorKey(signingSecret: string) {
  if (
    typeof signingSecret !== 'string' ||
    new TextEncoder().encode(signingSecret).byteLength < 32
  )
    failUnavailable();
  try {
    return await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  } catch {
    failUnavailable();
  }
}

function cursorMessage(payloadSegment: string) {
  return new TextEncoder().encode(`${CURSOR_DOMAIN}${payloadSegment}`);
}

async function scopeFingerprint(
  scope: CurrentScopeRow & {
    guestId: string;
    inviteId: string;
    workspaceId: string;
    projectId: string;
  },
  query: GuestHistoryQuery,
): Promise<string> {
  const canonical = JSON.stringify([
    scope.guestId,
    scope.inviteId,
    scope.workspaceId,
    scope.projectId,
    query.albumId ?? null,
    query.photoId ?? null,
  ]);
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`kino-pic:guest-history-scope:v1:${canonical}`),
    );
    return Buffer.from(digest).toString('hex');
  } catch {
    failUnavailable();
  }
}
async function verifyCursor(
  token: string,
  signingSecret: string,
  scope: CurrentScopeRow & {
    guestId: string;
    inviteId: string;
    workspaceId: string;
    projectId: string;
  },
  query: GuestHistoryQuery,
): Promise<CursorClaims> {
  const encoded = parseCursorEncoding(token);
  const key = await importCursorKey(signingSecret);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      encoded.signatureBytes,
      cursorMessage(encoded.payloadSegment),
    );
  } catch {
    failUnavailable();
  }
  if (!valid) failInvalidInput();

  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded.payloadBytes.toString('utf8')) as unknown;
  } catch {
    failInvalidInput();
  }
  const parsed = cursorClaimsSchema.safeParse(decoded);
  if (!parsed.success) failInvalidInput();
  const claims = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  const currentScopeHash = await scopeFingerprint(scope, query);
  if (
    claims.expiresAt <= now ||
    claims.issuedAt > now ||
    claims.guestId !== scope.guestId ||
    claims.scopeHash !== currentScopeHash
  )
    failInvalidInput();
  return claims;
}

async function signCursor(
  claims: CursorClaims,
  signingSecret: string,
): Promise<string> {
  const key = await importCursorKey(signingSecret);
  const payloadSegment = Buffer.from(
    JSON.stringify(cursorClaimsSchema.parse(claims)),
    'utf8',
  ).toString('base64url');
  try {
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      cursorMessage(payloadSegment),
    );
    return `${payloadSegment}.${Buffer.from(signature).toString('base64url')}`;
  } catch {
    failUnavailable();
  }
}

function objectFromJson(value: string | null): Record<string, unknown> {
  if (value === null) failUnavailable();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    failUnavailable();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    failUnavailable();
  return parsed as Record<string, unknown>;
}

function projection(action: GuestHistoryAction, row: HistoryRow) {
  const after = objectFromJson(row.afterJson);
  if (action === 'version_approval.confirmed') {
    const parsed = guestVersionApprovalHistoryDetailSchema.safeParse({
      approvalRequestId: after.approvalRequestId,
      photoId: after.photoId,
      versionId: after.versionId,
    });
    if (!parsed.success) failUnavailable();
    return parsed.data;
  }
  if (
    action === 'delivery.zip_download_requested' ||
    action === 'delivery.zip_download_generated'
  ) {
    const parsed = guestZipDownloadHistoryDetailSchema.safeParse({
      ticketId: after.ticketId,
    });
    if (!parsed.success) failUnavailable();
    return parsed.data;
  }
  if (
    action === 'download.requested' ||
    action === 'download.generated' ||
    action === 'delivery.download_requested' ||
    action === 'delivery.download_generated'
  ) {
    const parsed = guestMediaDownloadAuditSchema.safeParse({
      assetKind: action.startsWith('delivery.') ? 'original' : after.assetKind,
      assetId: after.assetId,
      filename: after.filename,
      byteSize: after.byteSize,
      mime: after.mime,
    });
    if (!parsed.success) failUnavailable();
    return parsed.data;
  }
  const before = objectFromJson(row.beforeJson);
  if (
    action === 'selection.added' ||
    action === 'selection.removed' ||
    action === 'selection.version_changed' ||
    action === 'shared_selection.added' ||
    action === 'shared_selection.removed' ||
    action === 'shared_selection.version_changed'
  ) {
    return {
      before: { selected: before.selected, versionId: before.versionId },
      after: { selected: after.selected, versionId: after.versionId },
    };
  }
  if (
    action === 'selection.submitted' ||
    action === 'shared_selection.submitted'
  ) {
    const submitState = (value: Record<string, unknown>) => ({
      roundNo: value.roundNo,
      status: value.status,
      ...(Object.hasOwn(value, 'selectedCount')
        ? { selectedCount: value.selectedCount }
        : {}),
    });
    return { before: submitState(before), after: submitState(after) };
  }
  if (action === 'rating.set' || action === 'rating.cleared') {
    return {
      before: { stars: before.stars },
      after: { stars: after.stars },
    };
  }
  if (action === 'favorite.added' || action === 'favorite.removed') {
    return {
      before: { favored: before.favored },
      after: { favored: after.favored },
    };
  }
  if (action === 'tag.added' || action === 'tag.removed') {
    return {
      before: { label: before.label, present: before.present },
      after: { label: after.label, present: after.present },
    };
  }
  if (action.startsWith('comment.')) {
    const safe = (state: Record<string, unknown>) => ({
      commentId: state.commentId,
      revision: state.revision,
      state: state.state,
    });
    return { before: safe(before), after: safe(after) };
  }
  if (action.startsWith('annotation.')) {
    const safe = (state: Record<string, unknown>) => ({
      annotationId: state.annotationId,
      revision: state.revision,
      state:
        state.revision === 0 && state.state === null ? 'absent' : state.state,
    });
    return { before: safe(before), after: safe(after) };
  }
  return failUnavailable();
}

function eventFromRow(row: HistoryRow) {
  if (
    !row.eventId ||
    !row.occurredAt ||
    !row.albumId ||
    !row.action ||
    row.photoStatus === undefined
  )
    failUnavailable();
  const action = guestHistoryActionSchema.safeParse(row.action);
  if (!action.success) failUnavailable();
  const isZipBatch =
    action.data === 'delivery.zip_download_requested' ||
    action.data === 'delivery.zip_download_generated';
  const detail = projection(action.data, row);
  if (action.data === 'tag.added' || action.data === 'tag.removed') {
    for (const state of [
      (detail as { before: { label: unknown } }).before,
      (detail as { after: { label: unknown } }).after,
    ]) {
      if (typeof state.label !== 'string') failUnavailable();
      // Persisted tag labels are already canonical; do not silently rewrite corrupt history.
      const canonical = state.label.normalize('NFC').trim().normalize('NFC');
      if (
        canonical !== state.label ||
        [...state.label].length < 1 ||
        [...state.label].length > 40 ||
        /[\p{Cc}\p{Cf}]/u.test(state.label)
      )
        failUnavailable();
    }
  }
  try {
    return guestHistoryEventSchema.parse({
      eventId: row.eventId,
      occurredAt: row.occurredAt,
      albumId: row.albumId,
      photoId: isZipBatch ? null : row.photoId,
      versionId: isZipBatch ? null : row.versionId,
      photoStatus: isZipBatch ? null : row.photoStatus,
      action: action.data,
      detail,
    });
  } catch {
    failUnavailable();
  }
}

export class D1GuestHistoryRepository {
  constructor(
    private db: D1Database,
    private signingSecret: string,
  ) {}

  async list(secret: string | null, input: unknown) {
    let query: GuestHistoryQuery;
    try {
      query = guestHistoryQuerySchema.parse(input);
    } catch {
      failInvalidInput();
    }
    if (!secret) throw new GuestAccessDenied();

    let secretHash: string;
    try {
      secretHash = await hashGuestSessionSecret(secret);
    } catch {
      throw new GuestAccessDenied();
    }

    try {
      await importCursorKey(this.signingSecret);
      let currentScope:
        | (CurrentScopeRow & {
            guestId: string;
            inviteId: string;
            workspaceId: string;
            projectId: string;
          })
        | null = null;
      let cursor: CursorClaims | null = null;
      if (query.cursor !== undefined) {
        const row = await this.db
          .prepare(scopeCheckSql())
          .bind(
            secretHash,
            canViewOwnHistoryBit,
            canViewOwnHistoryBit,
            query.albumId ?? null,
            query.albumId ?? null,
            query.photoId ?? null,
            query.photoId ?? null,
            query.photoId ?? null,
            query.albumId ?? null,
            query.photoId ?? null,
            query.albumId ?? null,
          )
          .first<CurrentScopeRow>();
        if (!isAuthorizedScope(row)) throw new GuestAccessDenied();
        currentScope = row;
        cursor = await verifyCursor(
          query.cursor,
          this.signingSecret,
          currentScope,
          query,
        );
      }

      const rows = await this.db
        .prepare(pageSql())
        .bind(
          secretHash,
          canViewOwnHistoryBit,
          canViewOwnHistoryBit,
          cursor?.snapshotRowId ?? null,
          query.albumId ?? null,
          query.albumId ?? null,
          query.photoId ?? null,
          query.photoId ?? null,
          query.photoId ?? null,
          query.albumId ?? null,
          query.photoId ?? null,
          query.albumId ?? null,
          query.albumId ?? null,
          query.albumId ?? null,
          query.photoId ?? null,
          query.photoId ?? null,
          cursor?.lastOccurredAt ?? null,
          cursor?.lastOccurredAt ?? null,
          cursor?.lastEventId ?? null,
        )
        .all<HistoryRow>();
      const summary = rows.results[0];
      if (!summary) throw new WorkspaceFailure('HISTORY_UNAVAILABLE', 503);
      if (!isAuthorizedScope(summary)) throw new GuestAccessDenied();
      if (cursor) {
        const finalScopeHash = await scopeFingerprint(summary, query);
        if (
          cursor.guestId !== summary.guestId ||
          cursor.scopeHash !== finalScopeHash
        )
          failInvalidInput();
      }
      if (!/^(0|[1-9][0-9]*)$/.test(summary.snapshotRowId)) failUnavailable();

      const eventRows = rows.results.filter((row) => row.eventId !== null);
      const pageRows = eventRows.slice(0, PAGE_SIZE);
      const items = pageRows.map(eventFromRow);
      const last = pageRows.at(-1);
      const issuedAt = Math.floor(Date.now() / 1000);
      const nextCursor =
        eventRows.length > PAGE_SIZE && last
          ? await signCursor(
              cursorClaimsSchema.parse({
                version: 1,
                guestId: summary.guestId,
                scopeHash: await scopeFingerprint(summary, query),
                snapshotRowId: summary.snapshotRowId,
                lastOccurredAt: last.occurredAt,
                lastEventId: last.eventId,
                issuedAt: cursor?.issuedAt ?? issuedAt,
                expiresAt: cursor?.expiresAt ?? issuedAt + CURSOR_TTL_SECONDS,
              }),
              this.signingSecret,
            )
          : null;
      return guestHistoryPageSchema.parse({
        guestId: summary.guestId,
        items,
        nextCursor,
      });
    } catch (error) {
      if (
        error instanceof GuestAccessDenied ||
        error instanceof WorkspaceFailure
      )
        throw error;
      throw new WorkspaceFailure('HISTORY_UNAVAILABLE', 503);
    }
  }
}
