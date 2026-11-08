import { z } from 'zod';
import {
  createVersionApprovalRequestSchema,
  guestVersionApprovalConfirmationSchema,
  guestVersionApprovalConfirmationResultSchema,
  guestVersionApprovalListSchema,
  guestVersionApprovalRequestSchema,
  ownerVersionApprovalListSchema,
  ownerVersionApprovalReadSchema,
  ownerVersionApprovalResultSchema,
  versionApprovalInviteIdsSchema,
} from '../../../packages/contracts/src/version-approvals';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { WorkspaceFailure } from './workspaces';

const PAGE_SIZE = 24;
const FETCH_SIZE = PAGE_SIZE + 1;

type OwnerScope = {
  workspace_id: string;
  project_id: string;
  album_id: string;
  album_state: string;
  project_status: string;
};

type GuestScope = {
  id: string;
  guest_id: string;
  invite_id: string;
  workspace_id: string;
  project_id: string;
  secret_hash: string;
};

type GuestApprovalTarget = {
  id: string;
  workspace_id: string;
  project_id: string;
  album_id: string;
  photo_id: string;
  version_id: string;
  head_revision: number;
  version_no: number;
};

function uuid(value: string): string {
  return z.uuid().parse(value).toLowerCase();
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function ownerWriteFailure(error: unknown): never {
  const message = failureMessage(error);
  if (message.includes('OWNER_REQUIRED'))
    throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND'))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (message.includes('RESOURCE_NOT_EDITABLE'))
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
  if (message.includes('PHOTO_VERSION_REVISION_CONFLICT'))
    throw new WorkspaceFailure('PHOTO_VERSION_REVISION_CONFLICT', 409);
  if (message.includes('VERSION_APPROVAL_INVALID_INVITES'))
    throw new WorkspaceFailure('VERSION_APPROVAL_INVALID_INVITES', 409);
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (
    message.includes('INVALID_INPUT') ||
    message.includes('INVALID_TIMESTAMP')
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  throw new WorkspaceFailure('VERSION_APPROVALS_UNAVAILABLE', 503);
}

function guestWriteFailure(error: unknown): never {
  const message = failureMessage(error);
  if (message.includes('GUEST_ACCESS_REQUIRED')) throw new GuestAccessDenied();
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (
    message.includes('INVALID_INPUT') ||
    message.includes('INVALID_TIMESTAMP')
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  throw new WorkspaceFailure('VERSION_APPROVALS_UNAVAILABLE', 503);
}

function stored<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new WorkspaceFailure('VERSION_APPROVALS_UNAVAILABLE', 503);
  return parsed.data;
}

function storedJson<T>(schema: z.ZodType<T>, value: string): T {
  try {
    return stored(schema, JSON.parse(value) as unknown);
  } catch (error) {
    if (error instanceof WorkspaceFailure) throw error;
    throw new WorkspaceFailure('VERSION_APPROVALS_UNAVAILABLE', 503);
  }
}

export class D1OwnerVersionApprovals {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}

  private async authorize(): Promise<void> {
    const owner = await this.db
      .prepare(
        "SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE o.user_id=? AND o.enabled=1",
      )
      .bind(this.session, this.actor)
      .first();
    if (!owner) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  private async scope(albumId: string, photoId: string): Promise<OwnerScope> {
    await this.authorize();
    const scope = await this.db
      .prepare(
        "SELECT w.id AS workspace_id,p.id AS project_id,a.id AS album_id,a.state AS album_state,p.status AS project_status FROM owners o JOIN owner_sessions session ON session.userId=o.user_id AND session.id=? AND session.expiresAt>unixepoch('subsec')*1000 JOIN workspaces w ON w.owner_user_id=o.user_id JOIN projects p ON p.workspace_id=w.id JOIN albums a ON a.project_id=p.id AND a.workspace_id=w.id JOIN photos ph ON ph.album_id=a.id AND ph.project_id=p.id AND ph.workspace_id=w.id WHERE o.user_id=? AND o.enabled=1 AND a.id=? AND ph.id=?",
      )
      .bind(this.session, this.actor, albumId, photoId)
      .first<OwnerScope>();
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);
    return scope;
  }

  async create(albumIdInput: string, photoIdInput: string, input: unknown) {
    const albumId = uuid(albumIdInput);
    const photoId = uuid(photoIdInput);
    const request = createVersionApprovalRequestSchema.parse(input);
    const requestId = uuid(request.requestId);
    const expectedOwnerId = uuid(request.expectedOwnerId);
    const versionId = uuid(request.expectedHead.versionId);
    const inviteIds = versionApprovalInviteIdsSchema.parse(
      request.inviteIds.map((inviteId) => inviteId.toLowerCase()),
    );
    if (expectedOwnerId !== uuid(this.actor))
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);

    const scope = await this.scope(albumId, photoId);
    if (
      ['archived', 'deleting', 'deleted'].includes(scope.project_status) ||
      scope.album_state !== 'active'
    )
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    const canonical = {
      requestId,
      expectedOwnerId,
      expectedHead: { versionId, revision: request.expectedHead.revision },
      inviteIds,
      confirm: true as const,
    };
    const commandId = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          'INSERT INTO version_approval_owner_commands(id,actor_id,expected_owner_id,session_id,request_id,workspace_id,project_id,album_id,photo_id,version_id,head_revision,request_resource_id,invite_ids_json,confirm,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)',
        )
        .bind(
          commandId,
          this.actor,
          expectedOwnerId,
          this.session,
          requestId,
          scope.workspace_id,
          scope.project_id,
          albumId,
          photoId,
          versionId,
          request.expectedHead.revision,
          crypto.randomUUID(),
          JSON.stringify(inviteIds),
          JSON.stringify(canonical),
        )
        .run();
    } catch (error) {
      ownerWriteFailure(error);
    }

    const result = await this.db
      .prepare(
        "SELECT result.result_json FROM version_approval_owner_commands command JOIN version_approval_owner_results result ON result.command_id=command.id JOIN owners o ON o.user_id=command.actor_id AND o.enabled=1 JOIN owner_sessions session ON session.userId=o.user_id AND session.id=? AND session.expiresAt>unixepoch('subsec')*1000 JOIN workspaces w ON w.id=command.workspace_id AND w.owner_user_id=o.user_id JOIN projects p ON p.id=command.project_id AND p.workspace_id=w.id JOIN albums a ON a.id=command.album_id AND a.workspace_id=w.id AND a.project_id=p.id JOIN photos ph ON ph.id=command.photo_id AND ph.workspace_id=w.id AND ph.project_id=p.id AND ph.album_id=a.id WHERE command.actor_id=? AND command.session_id=? AND command.request_id=? AND command.workspace_id=? AND command.project_id=? AND command.album_id=? AND command.photo_id=?",
      )
      .bind(
        this.session,
        this.actor,
        this.session,
        requestId,
        scope.workspace_id,
        scope.project_id,
        albumId,
        photoId,
      )
      .first<{ result_json: string }>();
    if (!result) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    return storedJson(ownerVersionApprovalResultSchema, result.result_json);
  }

  async list(
    albumIdInput: string,
    photoIdInput: string,
    cursorInput: string | null,
  ) {
    const albumId = uuid(albumIdInput);
    const photoId = uuid(photoIdInput);
    const cursor = cursorInput === null ? null : uuid(cursorInput);
    const scope = await this.scope(albumId, photoId);
    let after: { id: string; created_at_ms: number } | null = null;
    if (cursor !== null) {
      after = await this.db
        .prepare(
          "SELECT r.id,r.created_at_ms FROM version_approval_requests r JOIN workspaces w ON w.id=r.workspace_id AND w.owner_user_id=? JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions session ON session.userId=o.user_id AND session.id=? AND session.expiresAt>unixepoch('subsec')*1000 WHERE r.id=? AND r.workspace_id=? AND r.project_id=? AND r.album_id=? AND r.photo_id=?",
        )
        .bind(
          this.actor,
          this.session,
          cursor,
          scope.workspace_id,
          scope.project_id,
          albumId,
          photoId,
        )
        .first<{ id: string; created_at_ms: number }>();
      if (!after) throw new WorkspaceFailure('INVALID_INPUT', 400);
    }

    const rows = await this.db
      .prepare(
        "SELECT r.id,r.workspace_id AS workspaceId,r.project_id AS projectId,r.album_id AS albumId,r.photo_id AS photoId,r.version_id AS versionId,r.version_no AS versionNo,r.head_revision AS headRevision,(SELECT json_group_array(member.invite_id) FROM (SELECT invite_id FROM version_approval_request_invites WHERE approval_request_id=r.id ORDER BY invite_id) member) AS inviteIdsJson,CASE WHEN EXISTS(SELECT 1 FROM version_approval_receipts receipt WHERE receipt.approval_request_id=r.id) THEN 'confirmed' ELSE 'open' END AS status,strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch') AS createdAt,(SELECT min(receipt.occurred_at_utc) FROM version_approval_receipts receipt WHERE receipt.approval_request_id=r.id) AS confirmedAt,CASE WHEN head.version_id=r.version_id AND head.revision=r.head_revision THEN 1 ELSE 0 END AS isCurrent FROM version_approval_requests r JOIN workspaces w ON w.id=r.workspace_id AND w.owner_user_id=? JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions session ON session.userId=o.user_id AND session.id=? AND session.expiresAt>unixepoch('subsec')*1000 LEFT JOIN photo_version_heads head ON head.photo_id=r.photo_id AND head.workspace_id=r.workspace_id AND head.project_id=r.project_id AND head.album_id=r.album_id WHERE r.workspace_id=? AND r.project_id=? AND r.album_id=? AND r.photo_id=? AND (? IS NULL OR (r.created_at_ms,r.id)<(?,?)) ORDER BY r.created_at_ms DESC,r.id DESC LIMIT ?",
      )
      .bind(
        this.actor,
        this.session,
        scope.workspace_id,
        scope.project_id,
        albumId,
        photoId,
        after?.created_at_ms ?? null,
        after?.created_at_ms ?? null,
        after?.id ?? null,
        FETCH_SIZE,
      )
      .all<{
        id: string;
        workspaceId: string;
        projectId: string;
        albumId: string;
        photoId: string;
        versionId: string;
        versionNo: number;
        headRevision: number;
        inviteIdsJson: string;
        status: string;
        createdAt: string;
        confirmedAt: string | null;
        isCurrent: number;
      }>();

    const requests = rows.results.slice(0, PAGE_SIZE).map((row) =>
      stored(ownerVersionApprovalReadSchema, {
        id: row.id,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        albumId: row.albumId,
        photoId: row.photoId,
        versionId: row.versionId,
        versionNo: row.versionNo,
        headRevision: row.headRevision,
        inviteIds: storedJson(
          versionApprovalInviteIdsSchema,
          row.inviteIdsJson,
        ),
        status: row.status,
        createdAt: row.createdAt,
        confirmedAt: row.confirmedAt,
        isCurrent: row.isCurrent === 1,
      }),
    );
    const last = requests.at(-1);
    return stored(ownerVersionApprovalListSchema, {
      requests,
      nextCursor: rows.results.length > PAGE_SIZE && last ? last.id : null,
    });
  }
}

const GUEST_VISIBLE_REQUESTS_SQL =
  'WITH current_guest AS (' +
  'SELECT s.id AS session_id,s.guest_id,s.invite_id,i.workspace_id,i.project_id,i.permissions_mask ' +
  'FROM guest_sessions s ' +
  'JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id ' +
  'JOIN guest_invites i ON i.id=s.invite_id ' +
  'JOIN guest_invite_seals invite_seal ON invite_seal.invite_id=i.id ' +
  'JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id AND ia.album_id=? ' +
  'JOIN workspaces w ON w.id=i.workspace_id ' +
  'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id ' +
  "JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted') " +
  "JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active' " +
  'WHERE s.id=? AND s.secret_hash=? AND s.guest_id=? AND s.invite_id=? ' +
  'AND i.workspace_id=? AND i.project_id=? ' +
  `AND s.expires_at_ms>unixepoch('subsec')*1000 AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')} ` +
  'AND (i.permissions_mask & 1)=1 ' +
  'AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked WHERE revoked.invite_id=i.id) ' +
  'AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked WHERE revoked.session_id=s.id)' +
  ') ' +
  'SELECT r.id,r.workspace_id,r.project_id,r.album_id,r.photo_id,r.version_id,r.head_revision,r.version_no,' +
  "CASE WHEN EXISTS(SELECT 1 FROM version_approval_receipts receipt WHERE receipt.approval_request_id=r.id) THEN 'confirmed' ELSE 'open' END AS status," +
  "strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at_ms/1000.0,'unixepoch') AS createdAt," +
  '(SELECT min(receipt.occurred_at_utc) FROM version_approval_receipts receipt WHERE receipt.approval_request_id=r.id) AS confirmedAt,' +
  'CASE WHEN head.version_id=r.version_id AND head.revision=r.head_revision THEN 1 ELSE 0 END AS isCurrent,r.created_at_ms ' +
  'FROM version_approval_requests r ' +
  'JOIN current_guest cg ON cg.workspace_id=r.workspace_id AND cg.project_id=r.project_id ' +
  'JOIN version_approval_request_seals seal ON seal.approval_request_id=r.id AND seal.workspace_id=r.workspace_id AND seal.project_id=r.project_id AND seal.album_id=r.album_id ' +
  'AND seal.member_count=(SELECT count(*) FROM version_approval_request_invites member_count WHERE member_count.approval_request_id=r.id) ' +
  'JOIN version_approval_request_invites member ON member.approval_request_id=r.id AND member.invite_id=cg.invite_id AND member.workspace_id=r.workspace_id AND member.project_id=r.project_id AND member.album_id=r.album_id ' +
  'JOIN photos ph ON ph.id=r.photo_id AND ph.workspace_id=r.workspace_id AND ph.project_id=r.project_id AND ph.album_id=r.album_id ' +
  'JOIN photo_version_heads head ON head.photo_id=ph.id AND head.workspace_id=ph.workspace_id AND head.project_id=ph.project_id AND head.album_id=ph.album_id ' +
  'JOIN photo_versions v ON v.id=r.version_id AND v.photo_id=ph.id AND v.workspace_id=ph.workspace_id AND v.version_no=r.version_no ' +
  "JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=ph.id AND original.workspace_id=ph.workspace_id AND original.asset_kind='original' AND original.state='private' AND original.byte_size=v.byte_size AND original.mime=v.mime AND original.checksum_sha256=v.source_hash_sha256 " +
  'LEFT JOIN upload_completions source_v1 ON source_v1.asset_id=original.id AND source_v1.photo_id=ph.id AND source_v1.version_id=v.id AND source_v1.workspace_id=ph.workspace_id AND source_v1.project_id=ph.project_id AND source_v1.album_id=ph.album_id AND source_v1.actor_id=(SELECT owner_user_id FROM workspaces WHERE id=ph.workspace_id) ' +
  'LEFT JOIN upload_version_completions source_v2 ON source_v2.asset_id=original.id AND source_v2.photo_id=ph.id AND source_v2.version_id=v.id AND source_v2.workspace_id=ph.workspace_id AND source_v2.project_id=ph.project_id AND source_v2.album_id=ph.album_id AND source_v2.actor_id=(SELECT owner_user_id FROM workspaces WHERE id=ph.workspace_id) ' +
  'JOIN upload_sessions source_upload ON source_upload.id=COALESCE(source_v1.upload_session_id,source_v2.upload_session_id) AND source_upload.workspace_id=ph.workspace_id AND source_upload.project_id=ph.project_id AND source_upload.album_id=ph.album_id AND source_upload.actor_id=(SELECT owner_user_id FROM workspaces WHERE id=ph.workspace_id) AND source_upload.object_key=original.object_key ' +
  "JOIN image_processing_jobs job ON job.id=original.id AND job.status='succeeded' " +
  "JOIN image_processing_outputs thumbnail_slot ON thumbnail_slot.job_id=job.id AND thumbnail_slot.kind='thumbnail' " +
  "JOIN photo_assets thumbnail ON thumbnail.id=thumbnail_slot.asset_id AND thumbnail.object_key=thumbnail_slot.object_key AND thumbnail.version_id=v.id AND thumbnail.photo_id=ph.id AND thumbnail.workspace_id=ph.workspace_id AND thumbnail.asset_kind='thumbnail' AND thumbnail.state='private' AND thumbnail.mime='image/jpeg' " +
  "JOIN image_processing_outputs preview_slot ON preview_slot.job_id=job.id AND preview_slot.kind='preview' " +
  "JOIN photo_assets preview ON preview.id=preview_slot.asset_id AND preview.object_key=preview_slot.object_key AND preview.version_id=v.id AND preview.photo_id=ph.id AND preview.workspace_id=ph.workspace_id AND preview.asset_kind='preview' AND preview.state='private' AND preview.mime='image/jpeg' " +
  'WHERE r.album_id=? AND r.photo_id=? ' +
  'AND ((v.id=head.version_id) OR ((cg.permissions_mask & 2048)=2048 AND (v.version_no=1 OR EXISTS(' +
  'SELECT 1 FROM photo_version_head_commands head_command JOIN photo_version_head_results head_result ON head_result.command_id=head_command.id ' +
  "WHERE head_command.photo_id=ph.id AND head_command.workspace_id=ph.workspace_id AND head_command.project_id=ph.project_id AND head_command.album_id=ph.album_id AND head_command.version_id=v.id AND json_extract(head_result.result_json,'$.changed')=1)))) " +
  'AND ((source_v1.upload_session_id IS NOT NULL AND source_v2.upload_session_id IS NULL) OR (source_v2.upload_session_id IS NOT NULL AND source_v1.upload_session_id IS NULL))';

function guestBindings(
  scope: GuestScope,
  albumId: string,
  photoId: string,
): [string, string, string, string, string, string, string, string, string] {
  return [
    albumId,
    scope.id,
    scope.secret_hash,
    scope.guest_id,
    scope.invite_id,
    scope.workspace_id,
    scope.project_id,
    albumId,
    photoId,
  ];
}

export class D1GuestVersionApprovals {
  constructor(private db: D1Database) {}

  private async scope(
    secret: string | null,
    albumId: string,
  ): Promise<GuestScope> {
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const scope = await this.db
      .prepare(
        `SELECT s.id,s.guest_id,s.invite_id,i.workspace_id,i.project_id FROM guest_sessions s JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id JOIN guest_invites i ON i.id=s.invite_id JOIN guest_invite_seals seal ON seal.invite_id=i.id JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id AND ia.album_id=? JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active' JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted') JOIN workspaces w ON w.id=i.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id WHERE s.secret_hash=? AND s.expires_at_ms>unixepoch('subsec')*1000 AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')} AND (i.permissions_mask & 1)=1 AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations revoked WHERE revoked.invite_id=i.id) AND NOT EXISTS(SELECT 1 FROM guest_session_revocations revoked WHERE revoked.session_id=s.id)`,
      )
      .bind(albumId, secretHash)
      .first<Omit<GuestScope, 'secret_hash'>>();
    if (!scope) throw new GuestAccessDenied();
    return { ...scope, secret_hash: secretHash };
  }

  async list(
    secret: string | null,
    albumIdInput: string,
    photoIdInput: string,
    cursorInput: string | null,
  ) {
    const albumId = uuid(albumIdInput);
    const photoId = uuid(photoIdInput);
    const cursor = cursorInput === null ? null : uuid(cursorInput);
    const scope = await this.scope(secret, albumId);
    const bindings = guestBindings(scope, albumId, photoId);
    let after: { id: string; created_at_ms: number } | null = null;
    if (cursor !== null) {
      after = await this.db
        .prepare(
          'SELECT id,created_at_ms FROM (' +
            GUEST_VISIBLE_REQUESTS_SQL +
            ') visible WHERE visible.id=?',
        )
        .bind(...bindings, cursor)
        .first<{ id: string; created_at_ms: number }>();
      if (!after) throw new WorkspaceFailure('INVALID_INPUT', 400);
    }

    const rows = await this.db
      .prepare(
        'SELECT * FROM (' +
          GUEST_VISIBLE_REQUESTS_SQL +
          ') visible WHERE (? IS NULL OR (visible.created_at_ms,visible.id)<(?,?)) ORDER BY visible.created_at_ms DESC,visible.id DESC LIMIT ?',
      )
      .bind(
        ...bindings,
        after?.created_at_ms ?? null,
        after?.created_at_ms ?? null,
        after?.id ?? null,
        FETCH_SIZE,
      )
      .all<{
        id: string;
        photo_id: string;
        version_id: string;
        version_no: number;
        head_revision: number;
        status: string;
        createdAt: string;
        confirmedAt: string | null;
        isCurrent: number;
        created_at_ms: number;
      }>();

    const requests = rows.results.slice(0, PAGE_SIZE).map((row) =>
      stored(guestVersionApprovalRequestSchema, {
        id: row.id,
        photoId: row.photo_id,
        versionId: row.version_id,
        versionNo: row.version_no,
        headRevision: row.head_revision,
        isCurrent: row.isCurrent === 1,
        status: row.status,
        createdAt: row.createdAt,
        confirmedAt: row.confirmedAt,
      }),
    );
    const last = requests.at(-1);
    return stored(guestVersionApprovalListSchema, {
      requests,
      nextCursor: rows.results.length > PAGE_SIZE && last ? last.id : null,
    });
  }

  async confirm(
    secret: string | null,
    albumIdInput: string,
    photoIdInput: string,
    approvalIdInput: string,
    input: unknown,
  ) {
    const albumId = uuid(albumIdInput);
    const photoId = uuid(photoIdInput);
    const approvalId = uuid(approvalIdInput);
    const request = guestVersionApprovalConfirmationSchema.parse(input);
    const requestId = uuid(request.requestId);
    const expectedGuestId = uuid(request.expectedGuestId);
    const scope = await this.scope(secret, albumId);
    if (expectedGuestId !== scope.guest_id) throw new GuestAccessDenied();

    const bindings = guestBindings(scope, albumId, photoId);
    const target = await this.db
      .prepare(
        'SELECT id,workspace_id,project_id,album_id,photo_id,version_id,head_revision,version_no FROM (' +
          GUEST_VISIBLE_REQUESTS_SQL +
          ') visible WHERE visible.id=?',
      )
      .bind(...bindings, approvalId)
      .first<GuestApprovalTarget>();
    if (!target) throw new GuestAccessDenied();

    const canonical = {
      requestId,
      expectedGuestId,
      confirm: true as const,
    };
    try {
      await this.db
        .prepare(
          'INSERT INTO version_approval_guest_commands(id,guest_id,expected_guest_id,invite_id,session_id,request_id,approval_request_id,workspace_id,project_id,album_id,photo_id,version_id,head_revision,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          scope.guest_id,
          expectedGuestId,
          scope.invite_id,
          scope.id,
          requestId,
          approvalId,
          target.workspace_id,
          target.project_id,
          target.album_id,
          target.photo_id,
          target.version_id,
          target.head_revision,
          JSON.stringify(canonical),
        )
        .run();
    } catch (error) {
      guestWriteFailure(error);
    }

    const result = await this.db
      .prepare(
        'SELECT command_result.result_json FROM version_approval_guest_commands command JOIN version_approval_guest_results command_result ON command_result.command_id=command.id JOIN (' +
          GUEST_VISIBLE_REQUESTS_SQL +
          ') visible ON visible.id=command.approval_request_id AND visible.workspace_id=command.workspace_id AND visible.project_id=command.project_id AND visible.album_id=command.album_id AND visible.photo_id=command.photo_id AND visible.version_id=command.version_id AND visible.head_revision=command.head_revision WHERE command.guest_id=? AND command.session_id=? AND command.invite_id=? AND command.request_id=? AND command.approval_request_id=?',
      )
      .bind(
        ...bindings,
        scope.guest_id,
        scope.id,
        scope.invite_id,
        requestId,
        approvalId,
      )
      .first<{ result_json: string }>();
    if (!result) throw new GuestAccessDenied();
    return storedJson(
      guestVersionApprovalConfirmationResultSchema,
      result.result_json,
    );
  }
}
