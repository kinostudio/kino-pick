import { z } from 'zod';
import {
  DELIVERY_NOTIFICATION_LIMIT,
  guestDeliveryNotificationFeedSchema,
  ownerDeliveryNotificationFeedSchema,
} from '../../../packages/contracts/src/delivery-notifications';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { guestInviteAlbumExpiryCondition } from './guest-expiry-sql';
import { WorkspaceFailure } from './workspaces';

const uuid = (value: string) => z.uuid().parse(value).toLowerCase();
const ownerScopeSql = `SELECT w.id FROM workspaces w
JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
WHERE w.id=? AND o.user_id=?`;
const guestScopeSql = `SELECT s.id AS session_id,i.id AS invite_id FROM guest_sessions s
JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
JOIN guest_invites i ON i.id=s.invite_id
JOIN guest_invite_seals sealed ON sealed.invite_id=i.id
JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id AND ia.album_id=?
JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
JOIN workspaces w ON w.id=i.workspace_id
JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
WHERE s.secret_hash=? AND (i.permissions_mask&5)<>0
AND ${guestInviteAlbumExpiryCondition('i', 'ia.album_id')} AND s.expires_at_ms>unixepoch('subsec')*1000
AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)`;
const guestNoticeSql = `SELECT kind,occurred_at_utc FROM (
SELECT 'delivery_published' AS kind,d.occurred_at_utc,d.event_id FROM audit_events d
WHERE d.action='delivery.published' AND d.album_id=?
AND EXISTS(SELECT 1 FROM json_each(d.after_json,'$.inviteIds') member WHERE member.value=?)
UNION ALL
SELECT 'delivery_withdrawn' AS kind,r.occurred_at_utc,r.event_id FROM audit_events r
JOIN audit_events d ON d.event_id=json_extract(r.after_json,'$.deliveryId') AND d.action='delivery.published'
WHERE r.action='delivery.revoked' AND d.album_id=?
AND EXISTS(SELECT 1 FROM json_each(d.after_json,'$.inviteIds') member WHERE member.value=?)
) ORDER BY occurred_at_utc DESC,event_id DESC LIMIT ?`;

type GuestScope = { session_id: string; invite_id: string };
type NotificationRow = {
  kind: string;
  occurred_at_utc: string;
};

export class D1DeliveryNotifications {
  constructor(private readonly db: D1Database) {}

  private async ownerScope(actor: string, session: string, workspace: string) {
    const row = await this.db
      .prepare(ownerScopeSql)
      .bind(session, uuid(workspace), uuid(actor))
      .first<{ id: string }>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
  }

  async ownerList(actor: string, session: string, workspace: string) {
    workspace = uuid(workspace);
    await this.ownerScope(actor, session, workspace);
    const rows = await this.db
      .prepare(
        `SELECT action,occurred_at_utc FROM audit_events
         WHERE workspace_id=? AND action IN('version_approval.confirmed','delivery.published','delivery.revoked')
         ORDER BY occurred_at_utc DESC,event_id DESC LIMIT ?`,
      )
      .bind(workspace, DELIVERY_NOTIFICATION_LIMIT)
      .all<{ action: string; occurred_at_utc: string }>();
    await this.ownerScope(actor, session, workspace);
    return ownerDeliveryNotificationFeedSchema.parse({
      workspaceId: workspace,
      notifications: rows.results.map((row) => ({
        kind:
          row.action === 'version_approval.confirmed'
            ? 'approval_confirmed'
            : row.action === 'delivery.published'
              ? 'delivery_published'
              : row.action === 'delivery.revoked'
                ? 'delivery_withdrawn'
                : row.action,
        occurredAt: row.occurred_at_utc,
      })),
    });
  }

  private async guestScope(hash: string, album: string) {
    const scope = await this.db
      .prepare(guestScopeSql)
      .bind(uuid(album), hash)
      .first<GuestScope>();
    if (!scope) throw new GuestAccessDenied();
    return scope;
  }

  async guestList(secret: string | null, album: string) {
    if (!secret) throw new GuestAccessDenied();
    album = uuid(album);
    const hash = await hashGuestSessionSecret(secret);
    const scope = await this.guestScope(hash, album);
    const rows = await this.db
      .prepare(guestNoticeSql)
      .bind(
        album,
        scope.invite_id,
        album,
        scope.invite_id,
        DELIVERY_NOTIFICATION_LIMIT,
      )
      .all<NotificationRow>();
    const after = await this.guestScope(hash, album);
    if (
      after.session_id !== scope.session_id ||
      after.invite_id !== scope.invite_id
    )
      throw new GuestAccessDenied();
    return guestDeliveryNotificationFeedSchema.parse({
      albumId: album,
      notifications: rows.results.map((row) => ({
        kind: row.kind,
        occurredAt: row.occurred_at_utc,
      })),
    });
  }
}
