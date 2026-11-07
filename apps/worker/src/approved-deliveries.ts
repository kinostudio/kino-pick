import { z } from 'zod';
import {
  deliveryInviteIdsSchema,
  ownerDeliveryManifestSchema,
  ownerDeliveryResultSchema,
  guestDeliveryReadSchema,
} from '../../../packages/contracts/src/deliveries';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const publishSchema = z
  .object({
    requestId: z.uuid(),
    expectedOwnerId: z.uuid(),
    inviteIds: deliveryInviteIdsSchema,
    confirm: z.literal(true),
  })
  .strict();
const revokeSchema = publishSchema.omit({ inviteIds: true });
type Scope = { workspace_id: string; project_id: string; album_id: string };
type Publication = Scope & {
  event_id: string;
  actor_id: string;
  session_id: string;
  request_id: string;
  photo_id: string;
  version_id: string;
  after_json: string;
  occurred_at_utc: string;
  revoked: number;
  confirmed_at: string;
};
export type DeliveryFile = Scope & {
  delivery_id: string;
  photo_id: string;
  version_id: string;
  asset_id: string;
  guest_id: string;
  guest_session_id: string;
  invite_id: string;
  storage_node_id: string;
  object_key: string;
  filename: string;
  byte_size: number;
  mime: string;
  checksum_sha256: string;
  requestId: string;
  afterJson: string;
};
const uuid = (v: string) => z.uuid().parse(v).toLowerCase();
const publicationSelect = `SELECT d.*,EXISTS(SELECT 1 FROM audit_events revoked WHERE revoked.action='delivery.revoked' AND json_extract(revoked.after_json,'$.deliveryId')=d.event_id) AS revoked,(SELECT min(receipt.occurred_at_utc) FROM version_approval_receipts receipt WHERE receipt.approval_request_id=json_extract(d.after_json,'$.approvalRequestId') AND receipt.event_id=json_extract(d.after_json,'$.approvalReceiptId')) AS confirmed_at FROM audit_events d`;
function manifest(row: Publication) {
  const data = JSON.parse(row.after_json);
  return ownerDeliveryManifestSchema.parse({
    id: row.event_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    albumId: row.album_id,
    status: row.revoked ? 'revoked' : 'published',
    createdBy: row.actor_id,
    createdAt: row.occurred_at_utc,
    publishedAt: row.occurred_at_utc,
    expiresAt: null,
    inviteIds: data.inviteIds,
    items: [
      {
        ...data.item,
        approval: {
          requestId: data.approvalRequestId,
          photoId: row.photo_id,
          versionId: row.version_id,
          confirmedAt: row.confirmed_at,
        },
      },
    ],
  });
}
export class D1ApprovedDeliveries {
  constructor(private db: D1Database) {}
  private async owner(actor: string, session: string, album: string) {
    const scope = await this.db
      .prepare(
        `SELECT a.workspace_id,a.project_id,a.id AS album_id FROM albums a JOIN workspaces w ON w.id=a.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE a.id=? AND o.user_id=?`,
      )
      .bind(session, uuid(album), actor)
      .first<Scope>();
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);
    return scope;
  }
  async ownerList(
    actor: string,
    session: string,
    album: string,
    photo: string,
    approvalId?: string,
    cursor?: string,
  ) {
    const scope = await this.owner(actor, session, album);
    let where =
      " WHERE d.action='delivery.published' AND d.actor_id=? AND d.workspace_id=? AND d.project_id=? AND d.album_id=? AND d.photo_id=?";
    const values: string[] = [
      actor,
      scope.workspace_id,
      scope.project_id,
      scope.album_id,
      uuid(photo),
    ];
    if (approvalId) {
      where += " AND json_extract(d.after_json,'$.approvalRequestId')=?";
      values.push(uuid(approvalId));
    }
    if (cursor) {
      cursor = uuid(cursor);
      const pivot = await this.db
        .prepare(
          'SELECT d.occurred_at_utc FROM audit_events d' +
            where +
            ' AND d.event_id=?',
        )
        .bind(...values, cursor)
        .first<{ occurred_at_utc: string }>();
      if (!pivot) throw new WorkspaceFailure('INVALID_CURSOR', 400);
      where += ' AND (d.occurred_at_utc,d.event_id)<(?,?)';
      values.push(pivot.occurred_at_utc, cursor);
    }
    const rows = await this.db
      .prepare(
        publicationSelect +
          where +
          ' ORDER BY d.occurred_at_utc DESC,d.event_id DESC LIMIT 25',
      )
      .bind(...values)
      .all<Publication>();
    const visible = rows.results.slice(0, 24);
    await this.owner(actor, session, album);
    return {
      deliveries: visible.map(manifest),
      nextCursor: rows.results.length > 24 ? visible.at(-1)!.event_id : null,
    };
  }
  async publish(
    actor: string,
    session: string,
    album: string,
    photo: string,
    approval: string,
    input: unknown,
  ) {
    const body = publishSchema.parse(input);
    const scope = await this.owner(actor, session, album);
    if (uuid(body.expectedOwnerId) !== uuid(actor))
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    photo = uuid(photo);
    approval = uuid(approval);
    const requestId = uuid(body.requestId);
    const inviteIds = body.inviteIds.map(uuid).sort();
    const prior = await this.db
      .prepare(
        publicationSelect +
          ` WHERE d.action='delivery.published' AND d.actor_id=? AND d.request_id=?`,
      )
      .bind(actor, requestId)
      .first<Publication>();
    if (prior) {
      const old = JSON.parse(prior.after_json);
      if (
        prior.session_id !== session ||
        prior.album_id !== scope.album_id ||
        prior.photo_id !== photo ||
        old.approvalRequestId !== approval ||
        JSON.stringify(old.inviteIds) !== JSON.stringify(inviteIds)
      )
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      return ownerDeliveryResultSchema.parse({
        requestId,
        delivery: manifest(prior),
        eventId: prior.event_id,
        occurredAt: prior.occurred_at_utc,
      });
    }
    const src = await this.db
      .prepare(
        `SELECT src.*,(SELECT receipt.event_id FROM version_approval_receipts receipt WHERE receipt.approval_request_id=ar.id ORDER BY receipt.occurred_at_utc,receipt.event_id LIMIT 1) AS receipt_id FROM approved_delivery_sources src JOIN version_approval_requests ar ON ar.workspace_id=src.workspace_id AND ar.project_id=src.project_id AND ar.album_id=src.album_id AND ar.photo_id=src.photo_id AND ar.version_id=src.version_id WHERE ar.id=? AND ar.owner_id=? AND src.workspace_id=? AND src.project_id=? AND src.album_id=? AND src.photo_id=? AND EXISTS(SELECT 1 FROM version_approval_receipts r WHERE r.approval_request_id=ar.id)`,
      )
      .bind(
        approval,
        actor,
        scope.workspace_id,
        scope.project_id,
        scope.album_id,
        photo,
      )
      .first<{
        version_id: string;
        version_no: number;
        asset_id: string;
        filename: string;
        byte_size: number;
        mime: string;
        checksum_sha256: string;
        verified_at_ms: number;
        receipt_id: string;
      }>();
    if (!src) throw new WorkspaceFailure('APPROVED_VERSION_REQUIRED', 409);
    const after = JSON.stringify({
      approvalRequestId: approval,
      approvalReceiptId: src.receipt_id,
      inviteIds,
      expiresAt: null,
      item: {
        photoId: photo,
        versionId: src.version_id,
        versionNo: src.version_no,
        asset: {
          id: src.asset_id,
          assetKind: 'original',
          filename: src.filename,
          byteSize: src.byte_size,
          mime: src.mime,
          checksumSha256: src.checksum_sha256,
          verification: {
            state: 'verified',
            verifiedAt: new Date(src.verified_at_ms).toISOString(),
          },
        },
      },
    });
    try {
      await this.db
        .prepare(
          `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) VALUES(?,'user',?,?,?,?,?,?,?,'delivery.published',?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          actor,
          session,
          scope.workspace_id,
          scope.project_id,
          scope.album_id,
          photo,
          src.version_id,
          after,
          requestId,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('INVALID_DELIVERY_RECIPIENTS'))
        throw new WorkspaceFailure('INVALID_DELIVERY_RECIPIENTS', 409);
      if (message.includes('REQUEST_ID_CONFLICT'))
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (message.includes('APPROVED_VERSION_REQUIRED'))
        throw new WorkspaceFailure('APPROVED_VERSION_REQUIRED', 409);
      throw new WorkspaceFailure('DELIVERY_UNAVAILABLE', 503);
    }
    const row = await this.db
      .prepare(
        publicationSelect +
          ` WHERE d.action='delivery.published' AND d.actor_id=? AND d.request_id=? AND d.session_id=? AND d.after_json=?`,
      )
      .bind(actor, requestId, session, after)
      .first<Publication>();
    if (!row) throw new WorkspaceFailure('DELIVERY_UNAVAILABLE', 503);
    await this.owner(actor, session, album);
    return ownerDeliveryResultSchema.parse({
      requestId,
      delivery: manifest(row),
      eventId: row.event_id,
      occurredAt: row.occurred_at_utc,
    });
  }
  async revoke(
    actor: string,
    session: string,
    album: string,
    delivery: string,
    input: unknown,
  ) {
    const body = revokeSchema.parse(input);
    const scope = await this.owner(actor, session, album);
    if (uuid(body.expectedOwnerId) !== uuid(actor))
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    const row = await this.db
      .prepare(
        `SELECT * FROM audit_events WHERE action='delivery.published' AND event_id=? AND actor_id=? AND workspace_id=? AND project_id=? AND album_id=?`,
      )
      .bind(
        uuid(delivery),
        actor,
        scope.workspace_id,
        scope.project_id,
        scope.album_id,
      )
      .first<Publication>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    try {
      await this.db
        .prepare(
          `INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) VALUES(?,'user',?,?,?,?,?,?,?,'delivery.revoked',?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          actor,
          session,
          scope.workspace_id,
          scope.project_id,
          scope.album_id,
          row.photo_id,
          row.version_id,
          JSON.stringify({ deliveryId: row.event_id }),
          uuid(body.requestId),
        )
        .run();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('REQUEST_ID_CONFLICT')
      )
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (error instanceof Error && error.message.includes('ALREADY_REVOKED'))
        throw new WorkspaceFailure('ALREADY_REVOKED', 409);
      throw new WorkspaceFailure('DELIVERY_UNAVAILABLE', 503);
    }
    await this.owner(actor, session, album);
    return { revoked: true as const };
  }
  private async secret(value: string | null) {
    if (!value) throw new GuestAccessDenied();
    return hashGuestSessionSecret(value);
  }
  async guestList(secret: string | null, album: string, cursor?: string) {
    const hash = await this.secret(secret);
    album = uuid(album);
    // Require current album access even when no publications exist.
    const scope = await this.db
      .prepare(
        `SELECT s.id,i.id AS invite_id FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id JOIN guest_invite_seals sealed ON sealed.invite_id=i.id JOIN guest_invite_albums ia ON ia.invite_id=i.id JOIN albums a ON a.id=ia.album_id AND a.state='active' JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id AND p.status NOT IN('archived','deleting','deleted') JOIN workspaces w ON w.id=i.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id WHERE s.secret_hash=? AND ia.album_id=? AND i.workspace_id=a.workspace_id AND i.project_id=a.project_id AND (i.permissions_mask&5)<>0 AND i.expires_at_ms>unixepoch('subsec')*1000 AND s.expires_at_ms>unixepoch('subsec')*1000 AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id) AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)`,
      )
      .bind(hash, album)
      .first<{ invite_id: string }>();
    if (!scope) throw new GuestAccessDenied();
    let seek = '';
    const values: string[] = [hash, album];
    if (cursor) {
      cursor = uuid(cursor);
      const pivot = await this.db
        .prepare(
          "SELECT d.occurred_at_utc FROM audit_events d WHERE d.action='delivery.published' AND d.album_id=? AND d.event_id=? AND EXISTS(SELECT 1 FROM json_each(d.after_json,'$.inviteIds') member WHERE member.value=?)",
        )
        .bind(album, cursor, scope.invite_id)
        .first<{ occurred_at_utc: string }>();
      if (!pivot) throw new WorkspaceFailure('INVALID_CURSOR', 400);
      seek = ' AND (d.occurred_at_utc,d.event_id)<(?,?)';
      values.push(pivot.occurred_at_utc, cursor);
    }
    const rows = await this.db
      .prepare(
        `SELECT live.*,d.occurred_at_utc FROM approved_delivery_live_guests live JOIN audit_events d ON d.event_id=live.delivery_id WHERE live.secret_hash=? AND live.album_id=? ${seek} ORDER BY d.occurred_at_utc DESC,d.event_id DESC LIMIT 25`,
      )
      .bind(...values)
      .all<{
        delivery_id: string;
        project_id: string;
        album_id: string;
        invite_id: string;
        expires_at_ms: number;
        permissions_mask: number;
        after_json: string;
        occurred_at_utc: string;
      }>();
    return {
      deliveries: rows.results.slice(0, 24).map((row) =>
        guestDeliveryReadSchema.parse({
          access: {
            deliveryId: row.delivery_id,
            inviteId: row.invite_id,
            expiresAt: new Date(row.expires_at_ms).toISOString(),
            permissions: {
              can_view_delivery: (row.permissions_mask & 1) === 1,
              can_download_delivery: (row.permissions_mask & 4) === 4,
            },
          },
          delivery: {
            id: row.delivery_id,
            projectId: row.project_id,
            albumId: row.album_id,
            status: 'published',
            publishedAt: row.occurred_at_utc,
            expiresAt: null,
            items: [JSON.parse(row.after_json).item],
          },
        }),
      ),
      nextCursor:
        rows.results.length > 24 ? rows.results[23]!.delivery_id : null,
    };
  }
  async requested(
    secret: string | null,
    album: string,
    delivery: string,
    asset: string,
    requestId: string,
    clientIp: string | null = null,
  ) {
    const hash = await this.secret(secret);
    const row = await this.db
      .prepare(
        `SELECT * FROM approved_delivery_live_guests WHERE secret_hash=? AND album_id=? AND delivery_id=? AND asset_id=? AND (permissions_mask&4)=4`,
      )
      .bind(hash, uuid(album), uuid(delivery), uuid(asset))
      .first<Omit<DeliveryFile, 'requestId' | 'afterJson'>>();
    if (!row) throw new GuestAccessDenied();
    const file: DeliveryFile = {
      ...row,
      requestId: uuid(requestId),
      afterJson: JSON.stringify({
        deliveryId: row.delivery_id,
        assetId: row.asset_id,
        filename: row.filename,
        byteSize: row.byte_size,
        mime: row.mime,
        clientIp,
      }),
    };
    await this.audit(file, 'delivery.download_requested');
    return file;
  }
  async generated(file: DeliveryFile) {
    await this.audit(file, 'delivery.download_generated');
  }
  private async audit(file: DeliveryFile, action: string) {
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) VALUES(?,'guest',?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          file.guest_id,
          file.guest_session_id,
          file.workspace_id,
          file.project_id,
          file.album_id,
          file.photo_id,
          file.version_id,
          action,
          file.afterJson,
          file.requestId,
        )
        .run();
      if (!result.success || result.meta.changes !== 1) throw new Error();
    } catch {
      throw new WorkspaceFailure('DOWNLOAD_AUDIT_UNAVAILABLE', 503);
    }
  }
}
