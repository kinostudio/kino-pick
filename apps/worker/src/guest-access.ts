import { z } from 'zod';
import {
  decodeGuestPermissions,
  guestAlbumAccessSchema,
  guestPermissionBit,
  type GuestPermission,
} from '../../../packages/contracts/src/guest-access';

const secretSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
export async function hashGuestSessionSecret(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(
    `kino-pic:guest-session:v1:${secretSchema.parse(secret)}`,
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}

// Reject ambiguous cookies rather than allowing parsers to choose different actors.
export function readGuestSessionSecret(
  cookieHeader: string | undefined,
  secure: boolean,
): string | null {
  if (!cookieHeader || cookieHeader.length > 8192) return null;
  const name = secure ? '__Host-kino_guest' : 'kino_guest';
  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf('=')) === name);
  if (matches.length !== 1) return null;
  const value = matches[0]?.slice(name.length + 1);
  const parsed = secretSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export class GuestAccessDenied extends Error {
  constructor() {
    super('GUEST_ACCESS_REQUIRED');
  }
}

export class D1GuestAccessResolver {
  constructor(private db: D1Database) {}

  // This is a read snapshot, not a reusable mutation/download grant. Future writes
  // must repeat the same ACL inside their atomic state+event SQL operation.
  async album(
    secret: string | null,
    albumId: string,
    permission: GuestPermission,
  ) {
    z.uuid().parse(albumId);
    const bit = guestPermissionBit(permission);
    if (!secret || !secretSchema.safeParse(secret).success)
      throw new GuestAccessDenied();
    const hash = await hashGuestSessionSecret(secret);
    const row = await this.db
      .prepare(
        `SELECT g.id AS guestId,i.id AS inviteId,i.workspace_id AS workspaceId,
          i.project_id AS projectId,a.id AS albumId,i.permissions_mask AS permissionsMask,
          strftime('%Y-%m-%dT%H:%M:%fZ',s.expires_at_ms/1000.0,'unixepoch') AS expiresAt
        FROM guest_sessions s
        JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
        JOIN guest_invites i ON i.id=s.invite_id
        JOIN guest_invite_seals sealed ON sealed.invite_id=i.id
        JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id
        JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id
        JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id
        JOIN workspaces w ON w.id=i.workspace_id
        JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
        WHERE s.secret_hash=? AND a.id=? AND (i.permissions_mask & ?)=?
          AND s.expires_at_ms>unixepoch('subsec')*1000
          AND i.expires_at_ms>unixepoch('subsec')*1000
          AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
          AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)
          AND a.state='active' AND p.status<>'archived'`,
      )
      .bind(hash, albumId, bit, bit)
      .first();
    if (!row) throw new GuestAccessDenied();
    const { permissionsMask, ...scope } = row;
    return guestAlbumAccessSchema.parse({
      ...scope,
      permissions: decodeGuestPermissions(permissionsMask),
    });
  }
}
