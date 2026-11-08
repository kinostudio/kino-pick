import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestScopeSql, readyCtes } from './human-views';
import { WorkspaceFailure } from './workspaces';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { clientActivityCapability, type WorkerEnv } from './config';

const uuidSchema = z.uuid();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ipSchema = z.union([z.ipv4(), z.ipv6()]).nullable();
const ownerSessionSchema = z.string().min(1).max(512);
const pageSize = 24;
const previewDownloadBit = guestPermissionBit('can_download_preview');
const originalDownloadBit = guestPermissionBit('can_download_original');

type Bind = string | number | null;
type ClientActivityViewState = {
  guestId: string;
  guestSessionId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  existingEventId: string | null;
  existingGuestId: string | null;
  existingGuestSessionId: string | null;
  existingInviteId: string | null;
  existingWorkspaceId: string | null;
  existingProjectId: string | null;
  existingAlbumId: string | null;
  existingPhotoId: string | null;
  existingVersionId: string | null;
  existingBrowserDigest: string | null;
};
type OwnerViewRow = {
  eventId: string;
  viewedAtMs: number;
  guestId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  rawIp: string | null;
};
type OwnerViewSummaryRow = {
  uniqueBrowserCount: number;
  visitCount: number;
  requestedDownloadCount: number;
  generatedDownloadCount: number;
};
type OwnerDownloadRow = {
  eventId: string;
  requestId: string;
  requestedAtMs: number;
  guestId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  rawIp: string | null;
  generated: number;
};
export type ClientActivityOwnerViewsCursor = {
  viewedAtMs: number;
  eventId: string;
};
export type ClientActivityOwnerDownloadsCursor = {
  requestedAtMs: number;
  eventId: string;
};

export type ClientActivityViewInput = {
  viewId: string;
  browserDigest: string;
  expectedActorId: string;
  albumId: string;
  photoId: string;
  versionId: string;
  rawIp: string | null;
};
export type ClientActivityOwnerView = OwnerViewRow;
export type ClientActivityOwnerSummary = OwnerViewSummaryRow;
export type ClientActivityOwnerViewsPage = {
  summary: ClientActivityOwnerSummary;
  items: ClientActivityOwnerView[];
  nextCursor: ClientActivityOwnerViewsCursor | null;
};
export type ClientActivityOwnerDownload = Omit<
  OwnerDownloadRow,
  'generated'
> & {
  generated: boolean;
};
export type ClientActivityOwnerDownloadsPage = {
  items: ClientActivityOwnerDownload[];
  nextCursor: ClientActivityOwnerDownloadsCursor | null;
};
export type ClientDownloadContext = {
  requestId: string;
  guestId: string;
  guestSessionId: string;
  inviteId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  versionId: string;
};

export async function clientActivitySchemaReady(
  db: D1Database,
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT count(*) AS objectCount FROM sqlite_schema WHERE
          (type='table' AND name IN(
            'client_browse_events','client_album_browser_receipts',
            'guest_download_ip_sidecars')) OR
          (type='view' AND name='client_activity_ready_versions') OR
          (type='index' AND name IN(
            'guest_sessions_client_activity_scope',
            'client_browse_events_owner_page','client_browse_events_album_digest',
            'client_browse_events_guest_rate','client_album_browser_receipts_owner',
            'guest_download_ip_sidecars_owner')) OR
          (type='trigger' AND name IN(
            'client_album_browser_receipts_insert_guard',
            'client_album_browser_receipts_no_update',
            'client_album_browser_receipts_no_delete',
            'client_browse_events_insert_guard','client_browse_events_no_update',
            'client_browse_events_no_delete',
            'guest_download_ip_sidecars_insert_guard',
            'guest_download_ip_sidecars_no_update',
            'guest_download_ip_sidecars_no_delete'))`,
      )
      .first<{ objectCount: number }>();
    return row?.objectCount === 19;
  } catch {
    return false;
  }
}

export async function clientActivityEnabled(
  env: WorkerEnv,
  db: D1Database,
): Promise<boolean> {
  if (!clientActivityCapability(env)) return false;
  return clientActivitySchemaReady(db);
}

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}
function unavailable(
  phase: string,
  requestId?: string,
  error?: unknown,
): never {
  console.error('client_activity_unavailable', {
    phase,
    ...(requestId ? { requestId } : {}),
    ...(error instanceof Error ? { message: error.message } : {}),
  });
  throw new WorkspaceFailure('CLIENT_ANALYTICS_UNAVAILABLE', 503);
}
function ownerRequired(): never {
  throw new WorkspaceFailure('OWNER_REQUIRED', 404);
}
function uuid(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data.toLowerCase();
}
function ip(value: string | null): string | null {
  const parsed = ipSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}
function ownerInput(
  ownerIdInput: string,
  sessionIdInput: string,
  albumIdInput: string,
) {
  const ownerId = uuid(ownerIdInput);
  const sessionId = ownerSessionSchema.safeParse(sessionIdInput);
  if (!sessionId.success) invalidInput();
  return { ownerId, sessionId: sessionId.data, albumId: uuid(albumIdInput) };
}
function bindOwner(
  ownerId: string,
  sessionId: string,
  albumId: string,
): Bind[] {
  return [ownerId, sessionId, albumId];
}

function clientViewInput(input: ClientActivityViewInput) {
  const parsed = z
    .object({
      viewId: z.uuid(),
      browserDigest: digestSchema,
      expectedActorId: z.uuid(),
      albumId: z.uuid(),
      photoId: z.uuid(),
      versionId: z.uuid(),
      rawIp: ipSchema,
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) invalidInput();
  return {
    ...parsed.data,
    viewId: parsed.data.viewId.toLowerCase(),
    expectedActorId: parsed.data.expectedActorId.toLowerCase(),
    albumId: parsed.data.albumId.toLowerCase(),
    photoId: parsed.data.photoId.toLowerCase(),
    versionId: parsed.data.versionId.toLowerCase(),
  };
}

function downloadContext(input: ClientDownloadContext) {
  const parsed = z
    .object({
      requestId: z.uuid(),
      guestId: z.uuid(),
      guestSessionId: z.uuid(),
      inviteId: z.uuid(),
      workspaceId: z.uuid(),
      projectId: z.uuid(),
      albumId: z.uuid(),
      photoId: z.uuid(),
      versionId: z.uuid(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) invalidInput();
  return Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [
      key,
      value.toLowerCase(),
    ]),
  ) as ClientDownloadContext;
}

const guestViewStateSql = `${readyCtes(guestScopeSql)}
  SELECT ready.actorId AS guestId,ready.authorizationSessionId AS guestSessionId,
    session.invite_id AS inviteId,ready.workspaceId AS workspaceId,
    ready.projectId AS projectId,ready.albumId AS albumId,
    event.event_id AS existingEventId,event.guest_id AS existingGuestId,
    event.guest_session_id AS existingGuestSessionId,event.invite_id AS existingInviteId,
    event.workspace_id AS existingWorkspaceId,event.project_id AS existingProjectId,
    event.album_id AS existingAlbumId,event.photo_id AS existingPhotoId,
    event.version_id AS existingVersionId,event.browser_digest AS existingBrowserDigest
  FROM ready
  JOIN guest_sessions session ON session.id=ready.authorizationSessionId
  LEFT JOIN client_browse_events event ON event.event_id=?6
  LIMIT 1
`;

const ownerScopeSql = `
  SELECT owner.user_id AS ownerId,workspace.id AS workspaceId,
    project.id AS projectId,album.id AS albumId
  FROM owners owner
  JOIN owner_sessions session ON session.userId=owner.user_id
    AND session.id=?2 AND session.expiresAt>unixepoch('subsec')*1000
  JOIN albums album ON album.id=?3
  JOIN projects project ON project.id=album.project_id
    AND project.workspace_id=album.workspace_id
  JOIN workspaces workspace ON workspace.id=album.workspace_id
    AND workspace.owner_user_id=owner.user_id
  WHERE owner.user_id=?1 AND owner.enabled=1
`;

const ownerViewsSql = `
  WITH authorized AS (${ownerScopeSql})
  SELECT event.event_id AS eventId,event.viewed_at_ms AS viewedAtMs,
    event.guest_id AS guestId,event.invite_id AS inviteId,
    event.photo_id AS photoId,event.version_id AS versionId,event.raw_ip AS rawIp
  FROM authorized
  JOIN client_browse_events event ON event.workspace_id=authorized.workspaceId
    AND event.project_id=authorized.projectId AND event.album_id=authorized.albumId
  WHERE (?4 IS NULL OR event.viewed_at_ms<?4
    OR (event.viewed_at_ms=?4 AND event.event_id<?5 COLLATE BINARY))
  ORDER BY event.viewed_at_ms DESC,event.event_id COLLATE BINARY DESC
  LIMIT 25
`;

const ownerViewSummarySql = `
  WITH authorized AS (${ownerScopeSql})
  SELECT
    (SELECT COUNT(DISTINCT event.browser_digest) FROM client_browse_events event
      WHERE event.workspace_id=authorized.workspaceId
        AND event.project_id=authorized.projectId AND event.album_id=authorized.albumId)
      AS uniqueBrowserCount,
    (SELECT COUNT(*) FROM client_browse_events event
      WHERE event.workspace_id=authorized.workspaceId
        AND event.project_id=authorized.projectId AND event.album_id=authorized.albumId)
      AS visitCount,
    (SELECT COUNT(*) FROM audit_events audit
      WHERE audit.workspace_id=authorized.workspaceId AND audit.project_id=authorized.projectId
        AND audit.album_id=authorized.albumId AND audit.actor_type='guest'
        AND audit.action='download.requested') AS requestedDownloadCount,
    (SELECT COUNT(*) FROM audit_events audit
      WHERE audit.workspace_id=authorized.workspaceId AND audit.project_id=authorized.projectId
        AND audit.album_id=authorized.albumId AND audit.actor_type='guest'
        AND audit.action='download.generated') AS generatedDownloadCount
  FROM authorized LIMIT 1
`;
const ownerAuthSql = `WITH authorized AS (${ownerScopeSql})
  SELECT 1 AS ok FROM authorized LIMIT 1`;

const ownerDownloadsSql = `
  WITH authorized AS (${ownerScopeSql}), downloads AS (
    SELECT requested.event_id AS eventId,requested.request_id AS requestId,
      CAST(strftime('%s',substr(requested.occurred_at_utc,1,19)) AS INTEGER)*1000
        +CAST(substr(requested.occurred_at_utc,21,3) AS INTEGER) AS requestedAtMs,
      requested.actor_id AS guestId,session.invite_id AS inviteId,
      requested.photo_id AS photoId,requested.version_id AS versionId,
      sidecar.raw_ip AS rawIp,
      EXISTS(SELECT 1 FROM audit_events generated
        WHERE generated.action='download.generated'
          AND generated.request_id=requested.request_id
          AND generated.actor_type='guest' AND generated.actor_id=requested.actor_id
          AND generated.guest_session_id=requested.guest_session_id
          AND generated.workspace_id=requested.workspace_id
          AND generated.project_id=requested.project_id
          AND generated.album_id=requested.album_id
          AND generated.photo_id=requested.photo_id
          AND generated.version_id=requested.version_id) AS generated
    FROM authorized
    JOIN audit_events requested ON requested.workspace_id=authorized.workspaceId
      AND requested.project_id=authorized.projectId AND requested.album_id=authorized.albumId
      AND requested.actor_type='guest' AND requested.action='download.requested'
    JOIN guest_sessions session ON session.id=requested.guest_session_id
      AND session.guest_id=requested.actor_id
    LEFT JOIN guest_download_ip_sidecars sidecar
      ON sidecar.request_id=requested.request_id AND sidecar.audit_event_id=requested.event_id
  )
  SELECT eventId,requestId,requestedAtMs,guestId,inviteId,photoId,versionId,rawIp,generated
  FROM downloads
  WHERE (?4 IS NULL OR requestedAtMs<?4
    OR (requestedAtMs=?4 AND eventId<?5 COLLATE BINARY))
  ORDER BY requestedAtMs DESC,eventId COLLATE BINARY DESC
  LIMIT 25
`;

function matchesExistingView(
  row: ClientActivityViewState,
  input: ReturnType<typeof clientViewInput>,
): boolean {
  return (
    row.existingEventId === input.viewId &&
    row.existingGuestId === row.guestId &&
    row.existingGuestSessionId === row.guestSessionId &&
    row.existingInviteId === row.inviteId &&
    row.existingWorkspaceId === row.workspaceId &&
    row.existingProjectId === row.projectId &&
    row.existingAlbumId === input.albumId &&
    row.existingPhotoId === input.photoId &&
    row.existingVersionId === input.versionId &&
    row.existingBrowserDigest === input.browserDigest
  );
}

function viewInsertStatements(
  db: D1Database,
  secretHash: string,
  input: ReturnType<typeof clientViewInput>,
) {
  const scopeBinds = [
    secretHash,
    input.expectedActorId,
    input.albumId,
    input.photoId,
    input.versionId,
  ];
  const event = db
    .prepare(
      `${readyCtes(guestScopeSql)}
      INSERT INTO client_browse_events(
        event_id,workspace_id,project_id,album_id,photo_id,version_id,
        guest_id,guest_session_id,invite_id,browser_digest,viewed_at_ms,raw_ip
      )
      SELECT ?6,ready.workspaceId,ready.projectId,ready.albumId,ready.photoId,
        ready.versionId,ready.actorId,session.id,session.invite_id,?7,
        CAST(unixepoch('subsec')*1000 AS INTEGER),?8
      FROM ready JOIN guest_sessions session ON session.id=ready.authorizationSessionId
    `,
    )
    .bind(...scopeBinds, input.viewId, input.browserDigest, input.rawIp);
  const receipt = db
    .prepare(
      `
      INSERT INTO client_album_browser_receipts(
        workspace_id,project_id,album_id,browser_digest,guest_id,
        guest_session_id,invite_id,first_event_id,first_seen_at_ms
      )
      SELECT event.workspace_id,event.project_id,event.album_id,event.browser_digest,
        event.guest_id,event.guest_session_id,event.invite_id,event.event_id,event.viewed_at_ms
      FROM client_browse_events event
      WHERE event.event_id=?1 AND event.guest_id=?2 AND event.album_id=?3
        AND event.photo_id=?4 AND event.version_id=?5 AND event.browser_digest=?6
        AND NOT EXISTS(SELECT 1 FROM client_album_browser_receipts prior
          WHERE prior.album_id=event.album_id AND prior.browser_digest=event.browser_digest)
    `,
    )
    .bind(
      input.viewId,
      input.expectedActorId,
      input.albumId,
      input.photoId,
      input.versionId,
      input.browserDigest,
    );
  return [event, receipt];
}

function clientActivitySummary(
  row: OwnerViewSummaryRow,
): ClientActivityOwnerSummary {
  for (const value of Object.values(row)) {
    if (!Number.isSafeInteger(value) || value < 0)
      unavailable('owner_summary_shape');
  }
  return row;
}

function ownerView(row: OwnerViewRow): ClientActivityOwnerView {
  const parsed = z
    .object({
      eventId: z.uuid(),
      viewedAtMs: z.number().int().nonnegative().safe(),
      guestId: z.uuid(),
      inviteId: z.uuid(),
      photoId: z.uuid(),
      versionId: z.uuid(),
      rawIp: ipSchema,
    })
    .safeParse(row);
  if (!parsed.success) unavailable('owner_view_shape');
  return {
    ...parsed.data,
    eventId: parsed.data.eventId.toLowerCase(),
    guestId: parsed.data.guestId.toLowerCase(),
    inviteId: parsed.data.inviteId.toLowerCase(),
    photoId: parsed.data.photoId.toLowerCase(),
    versionId: parsed.data.versionId.toLowerCase(),
  };
}

function ownerDownload(row: OwnerDownloadRow): ClientActivityOwnerDownload {
  const parsed = z
    .object({
      eventId: z.uuid(),
      requestId: z.uuid(),
      requestedAtMs: z.number().int().nonnegative().safe(),
      guestId: z.uuid(),
      inviteId: z.uuid(),
      photoId: z.uuid(),
      versionId: z.uuid(),
      rawIp: ipSchema,
      generated: z.union([z.literal(0), z.literal(1)]),
    })
    .safeParse(row);
  if (!parsed.success) unavailable('owner_download_shape');
  return {
    ...parsed.data,
    eventId: parsed.data.eventId.toLowerCase(),
    requestId: parsed.data.requestId.toLowerCase(),
    guestId: parsed.data.guestId.toLowerCase(),
    inviteId: parsed.data.inviteId.toLowerCase(),
    photoId: parsed.data.photoId.toLowerCase(),
    versionId: parsed.data.versionId.toLowerCase(),
    generated: parsed.data.generated === 1,
  };
}

function viewCursor(
  rows: OwnerViewRow[],
): ClientActivityOwnerViewsCursor | null {
  if (rows.length <= pageSize) return null;
  const last = rows[pageSize - 1];
  if (!last) return null;
  return { viewedAtMs: last.viewedAtMs, eventId: last.eventId };
}

function downloadCursor(
  rows: OwnerDownloadRow[],
): ClientActivityOwnerDownloadsCursor | null {
  if (rows.length <= pageSize) return null;
  const last = rows[pageSize - 1];
  if (!last) return null;
  return { requestedAtMs: last.requestedAtMs, eventId: last.eventId };
}

function parsedViewCursor(
  input: ClientActivityOwnerViewsCursor | undefined,
): ClientActivityOwnerViewsCursor | undefined {
  if (input === undefined) return undefined;
  const parsed = z
    .object({
      viewedAtMs: z.number().int().nonnegative().safe(),
      eventId: z.uuid(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) invalidInput();
  return {
    ...parsed.data,
    eventId: parsed.data.eventId.toLowerCase(),
  };
}

function parsedDownloadCursor(
  input: ClientActivityOwnerDownloadsCursor | undefined,
): ClientActivityOwnerDownloadsCursor | undefined {
  if (input === undefined) return undefined;
  const parsed = z
    .object({
      requestedAtMs: z.number().int().nonnegative().safe(),
      eventId: z.uuid(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) invalidInput();
  return {
    ...parsed.data,
    eventId: parsed.data.eventId.toLowerCase(),
  };
}

export class D1ClientActivityRepository {
  constructor(private readonly db: D1Database) {}

  async recordGuestView(
    secret: string | null,
    inputInput: ClientActivityViewInput,
  ): Promise<{ recorded: boolean }> {
    const input = clientViewInput(inputInput);
    if (!secret) throw new GuestAccessDenied();
    let secretHash: string;
    try {
      secretHash = await hashGuestSessionSecret(secret);
    } catch {
      throw new GuestAccessDenied();
    }
    const readState = async (): Promise<ClientActivityViewState | null> => {
      try {
        return await this.db
          .prepare(guestViewStateSql)
          .bind(
            secretHash,
            input.expectedActorId,
            input.albumId,
            input.photoId,
            input.versionId,
            input.viewId,
          )
          .first<ClientActivityViewState>();
      } catch (error) {
        return unavailable('view_authorization', input.viewId, error);
      }
    };
    const before = await readState();
    if (!before) throw new GuestAccessDenied();
    if (before.existingEventId) {
      if (!matchesExistingView(before, input))
        throw new WorkspaceFailure('CLIENT_ACTIVITY_IDEMPOTENCY_CONFLICT', 409);
      return { recorded: false };
    }
    let results: D1Result<unknown>[];
    try {
      results = await this.db.batch(
        viewInsertStatements(this.db, secretHash, input),
      );
    } catch (error) {
      const current = await readState();
      if (!current) throw new GuestAccessDenied();
      if (current.existingEventId && matchesExistingView(current, input))
        return { recorded: false };
      return unavailable('view_batch', input.viewId, error);
    }
    if (results.length !== 2 || results[0]?.meta.changes === undefined)
      return unavailable('view_batch_result', input.viewId);
    if (results[0].meta.changes === 1) return { recorded: true };
    const after = await readState();
    if (!after) throw new GuestAccessDenied();
    if (after.existingEventId && matchesExistingView(after, input))
      return { recorded: false };
    return unavailable('view_batch_without_event', input.viewId);
  }

  async recordDownload(
    contextInput: ClientDownloadContext,
    rawIpInput: string | null,
  ): Promise<void> {
    const context = downloadContext(contextInput);
    const rawIp = ip(rawIpInput);
    const sql = `
      INSERT INTO guest_download_ip_sidecars(
        request_id,audit_event_id,workspace_id,project_id,album_id,photo_id,
        version_id,guest_id,guest_session_id,invite_id,raw_ip,recorded_at_ms
      )
      SELECT requested.request_id,requested.event_id,requested.workspace_id,
        requested.project_id,requested.album_id,requested.photo_id,requested.version_id,
        requested.actor_id,session.id,session.invite_id,?10,
        CAST(unixepoch('subsec')*1000 AS INTEGER)
      FROM audit_events requested
      JOIN guest_sessions session ON session.id=requested.guest_session_id
        AND session.guest_id=requested.actor_id
      JOIN guest_identities guest ON guest.id=session.guest_id
        AND guest.invite_id=session.invite_id
      JOIN guest_invites invite ON invite.id=session.invite_id
      JOIN guest_invite_seals sealed ON sealed.invite_id=invite.id
      JOIN guest_invite_albums invite_album ON invite_album.invite_id=invite.id
        AND invite_album.workspace_id=invite.workspace_id
        AND invite_album.project_id=invite.project_id
        AND invite_album.album_id=requested.album_id
      JOIN workspaces workspace ON workspace.id=invite.workspace_id
      JOIN owners owner ON owner.user_id=workspace.owner_user_id AND owner.enabled=1
        AND invite.created_by=owner.user_id
      JOIN projects project ON project.id=requested.project_id
        AND project.workspace_id=requested.workspace_id
        AND project.workspace_id=invite.workspace_id
        AND project.id=invite.project_id
        AND project.status NOT IN('archived','deleting','deleted')
      JOIN albums album ON album.id=requested.album_id
        AND album.workspace_id=requested.workspace_id
        AND album.project_id=requested.project_id AND album.state='active'
      WHERE requested.request_id=?1 AND requested.action='download.requested'
        AND requested.actor_type='guest' AND requested.actor_id=?2
        AND requested.guest_session_id=?3 AND session.id=?3
        AND invite.id=?4 AND requested.workspace_id=?5
        AND requested.project_id=?6 AND requested.album_id=?7
        AND requested.photo_id=?8 AND requested.version_id=?9
        AND requested.session_id IS NULL AND requested.before_json IS NULL
        AND session.expires_at_ms>unixepoch('subsec')*1000
        AND ${guestInviteAlbumExpiryCondition('invite', 'invite_album.album_id')}
        AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked
          WHERE revoked.invite_id=invite.id)
        AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked
          WHERE revoked.session_id=session.id)
        AND ((json_extract(requested.after_json,'$.assetKind')='preview'
            AND (invite.permissions_mask & ${previewDownloadBit})=${previewDownloadBit})
          OR (json_extract(requested.after_json,'$.assetKind')='original'
            AND (invite.permissions_mask & ${originalDownloadBit})=${originalDownloadBit}))
        AND NOT EXISTS(SELECT 1 FROM guest_download_ip_sidecars prior
          WHERE prior.request_id=requested.request_id)
    `;
    let result: D1Result<unknown>;
    try {
      result = await this.db
        .prepare(sql)
        .bind(
          context.requestId,
          context.guestId,
          context.guestSessionId,
          context.inviteId,
          context.workspaceId,
          context.projectId,
          context.albumId,
          context.photoId,
          context.versionId,
          rawIp,
        )
        .run();
    } catch (error) {
      return unavailable('download_ip_insert', context.requestId, error);
    }
    if (result.meta.changes === 1) return;
    if (result.meta.changes !== 0)
      return unavailable('download_ip_result', context.requestId);
    let existing: {
      requestId: string;
      auditEventId: string;
      workspaceId: string;
      projectId: string;
      albumId: string;
      photoId: string;
      versionId: string;
      guestId: string;
      guestSessionId: string;
      inviteId: string;
      rawIp: string | null;
    } | null;
    try {
      existing = await this.db
        .prepare(
          `SELECT request_id AS requestId,audit_event_id AS auditEventId,
            workspace_id AS workspaceId,project_id AS projectId,album_id AS albumId,
            photo_id AS photoId,version_id AS versionId,guest_id AS guestId,
            guest_session_id AS guestSessionId,invite_id AS inviteId,raw_ip AS rawIp
          FROM guest_download_ip_sidecars WHERE request_id=?1`,
        )
        .bind(context.requestId)
        .first();
    } catch (error) {
      return unavailable('download_ip_replay', context.requestId, error);
    }
    if (
      existing &&
      existing.workspaceId === context.workspaceId &&
      existing.projectId === context.projectId &&
      existing.albumId === context.albumId &&
      existing.photoId === context.photoId &&
      existing.versionId === context.versionId &&
      existing.guestId === context.guestId &&
      existing.guestSessionId === context.guestSessionId &&
      existing.inviteId === context.inviteId
    )
      return;
    return unavailable('download_ip_not_recorded', context.requestId);
  }

  async listOwnerViews(input: {
    ownerId: string;
    ownerSessionId: string;
    albumId: string;
    before?: ClientActivityOwnerViewsCursor;
  }): Promise<ClientActivityOwnerViewsPage> {
    const auth = ownerInput(input.ownerId, input.ownerSessionId, input.albumId);
    const before = parsedViewCursor(input.before);
    const binds = bindOwner(auth.ownerId, auth.sessionId, auth.albumId);
    let results: D1Result<unknown>[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(ownerViewsSql)
          .bind(...binds, before?.viewedAtMs ?? null, before?.eventId ?? null),
        this.db.prepare(ownerViewSummarySql).bind(...binds),
      ]);
    } catch (error) {
      return unavailable('owner_views', undefined, error);
    }
    const rows = results[0]?.results as OwnerViewRow[] | undefined;
    const summaryRow = results[1]?.results[0] as
      OwnerViewSummaryRow | undefined;
    if (!summaryRow) return ownerRequired();
    if (!rows || rows.length > pageSize + 1)
      return unavailable('owner_views_shape');
    const summary = clientActivitySummary(summaryRow);
    const items = rows.slice(0, pageSize).map(ownerView);
    const next = viewCursor(rows);
    return {
      summary,
      items,
      nextCursor: next,
    };
  }

  async listOwnerDownloads(input: {
    ownerId: string;
    ownerSessionId: string;
    albumId: string;
    before?: ClientActivityOwnerDownloadsCursor;
  }): Promise<ClientActivityOwnerDownloadsPage> {
    const auth = ownerInput(input.ownerId, input.ownerSessionId, input.albumId);
    const before = parsedDownloadCursor(input.before);
    const binds = bindOwner(auth.ownerId, auth.sessionId, auth.albumId);
    let results: D1Result<unknown>[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(ownerDownloadsSql)
          .bind(
            ...binds,
            before?.requestedAtMs ?? null,
            before?.eventId ?? null,
          ),
        this.db.prepare(ownerAuthSql).bind(...binds),
      ]);
    } catch (error) {
      return unavailable('owner_downloads', undefined, error);
    }
    const authRow = results[1]?.results[0] as { ok: number } | undefined;
    if (!authRow) return ownerRequired();
    const rows = results[0]?.results as OwnerDownloadRow[] | undefined;
    if (!rows || rows.length > pageSize + 1)
      return unavailable('owner_downloads_shape');
    const items = rows.slice(0, pageSize).map(ownerDownload);
    const next = downloadCursor(rows);
    return {
      items,
      nextCursor: next,
    };
  }
}
