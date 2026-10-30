import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import {
  guestTagPageSchema,
  guestTagPhotoIdsSchema,
  guestTagRequestSchema,
  guestTagResultSchema,
} from '../../../packages/contracts/src/guest-tags';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const canTagBit = guestPermissionBit('can_tag');

type GuestTagScope = {
  id: string;
  guest_id: string;
  invite_id: string;
  workspace_id: string;
  project_id: string;
};

type GuestTagReadRow = {
  authorizedCount: number;
  requestedCount: number;
  matchedCount: number;
  guestId: string | null;
  photoId: string | null;
  matchedPhotoId: string | null;
  position: number | null;
  tagId: string | null;
  label: string | null;
  versionId: string | null;
  updatedAt: string | null;
};

function guestTagReadSql() {
  return [
    'WITH authorized AS (',
    '  SELECT s.id AS session_id,g.id AS guest_id,i.id AS invite_id,',
    '    i.workspace_id AS workspace_id,i.project_id AS project_id,ia.album_id AS album_id',
    '  FROM guest_sessions s',
    '  JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
    '  JOIN guest_invites i ON i.id=s.invite_id',
    '  JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    '  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id',
    '    AND ia.project_id=i.project_id AND ia.album_id=?',
    '  JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id',
    "    AND a.project_id=i.project_id AND a.state='active'",
    '  JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
    "    AND p.status NOT IN('archived','deleting','deleted')",
    '  JOIN workspaces w ON w.id=i.workspace_id',
    '  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
    '  WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
    "    AND s.expires_at_ms>unixepoch('subsec')*1000",
    "    AND i.expires_at_ms>unixepoch('subsec')*1000",
    '    AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)',
    '    AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)',
    '), requested AS (',
    '  SELECT CAST(key AS INTEGER) AS position,CAST(value AS TEXT) AS photo_id',
    '  FROM json_each(?)',
    '), photo_rows AS (',
    '  SELECT r.position,r.photo_id,a.guest_id,a.invite_id,a.workspace_id,',
    '    a.project_id,a.album_id,p.id AS matched_photo_id',
    '  FROM requested r CROSS JOIN authorized a',
    '  LEFT JOIN photos p ON p.id=r.photo_id AND p.workspace_id=a.workspace_id',
    '    AND p.project_id=a.project_id AND p.album_id=a.album_id',
    '), summary AS (',
    '  SELECT (SELECT count(*) FROM authorized) AS authorized_count,',
    '    (SELECT count(*) FROM requested) AS requested_count,',
    '    (SELECT count(*) FROM photo_rows WHERE matched_photo_id IS NOT NULL) AS matched_count,',
    '    (SELECT min(guest_id) FROM authorized) AS guest_id',
    ')',
    'SELECT summary.authorized_count AS authorizedCount,',
    '  summary.requested_count AS requestedCount,summary.matched_count AS matchedCount,',
    '  summary.guest_id AS guestId,photo_rows.photo_id AS photoId,',
    '  photo_rows.matched_photo_id AS matchedPhotoId,photo_rows.position AS position,',
    '  l.tag_id AS tagId,l.label AS label,st.last_version_id AS versionId,',
    '  CASE WHEN st.tag_id IS NULL THEN NULL ELSE',
    "    strftime('%Y-%m-%dT%H:%M:%fZ',st.updated_at_ms/1000.0,'unixepoch') END AS updatedAt",
    'FROM summary LEFT JOIN photo_rows ON 1=1',
    'LEFT JOIN guest_tag_state st ON st.invite_id=photo_rows.invite_id',
    '  AND st.guest_id=photo_rows.guest_id AND st.album_id=photo_rows.album_id',
    '  AND st.photo_id=photo_rows.matched_photo_id AND st.present=1',
    'LEFT JOIN guest_tag_labels l ON l.tag_id=st.tag_id',
    '  AND l.workspace_id=photo_rows.workspace_id AND l.project_id=photo_rows.project_id',
    'ORDER BY photo_rows.position,l.label COLLATE BINARY,l.tag_id',
  ].join('\n');
}

function guestTagResultSql() {
  return [
    'SELECT r.result_json',
    'FROM guest_tag_commands c',
    'JOIN guest_tag_results r ON r.command_id=c.id',
    'JOIN guest_sessions s ON s.id=? AND s.guest_id=c.guest_id',
    '  AND s.invite_id=c.invite_id AND s.secret_hash=?',
    '  AND c.session_id=s.id AND c.secret_hash=s.secret_hash',
    'JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
    'JOIN guest_invites i ON i.id=c.invite_id AND i.workspace_id=c.workspace_id',
    '  AND i.project_id=c.project_id',
    'JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    'JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=c.workspace_id',
    '  AND ia.project_id=c.project_id AND ia.album_id=c.album_id',
    "JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id AND a.project_id=c.project_id AND a.state='active'",
    'JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id',
    "  AND p.status NOT IN('archived','deleting','deleted')",
    'JOIN workspaces w ON w.id=c.workspace_id',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
    'JOIN photos ph ON ph.id=c.photo_id AND ph.workspace_id=c.workspace_id',
    '  AND ph.project_id=c.project_id AND ph.album_id=c.album_id',
    'JOIN photo_versions v ON v.id=c.version_id AND v.workspace_id=c.workspace_id',
    '  AND v.photo_id=c.photo_id',
    'WHERE c.guest_id=? AND c.expected_guest_id=? AND c.request_id=?',
    '  AND c.workspace_id=? AND c.project_id=? AND c.album_id=? AND c.photo_id=?',
    '  AND c.version_id=? AND c.label=? AND c.present=? AND c.payload_json=?',
    '  AND g.id=c.expected_guest_id AND (i.permissions_mask & ?)=?',
    "  AND s.expires_at_ms>unixepoch('subsec')*1000",
    "  AND i.expires_at_ms>unixepoch('subsec')*1000",
    '  AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)',
    '  AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)',
  ].join(' ');
}

function canonicalTagLabel(value: string): string {
  const label = value.normalize('NFC').trim().normalize('NFC');
  if (
    label.length === 0 ||
    Array.from(label).length > 40 ||
    /[\p{Cc}\p{Cf}]/u.test(label)
  )
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  return label;
}

export class D1GuestTagsRepository {
  constructor(private db: D1Database) {}

  async read(secret: string | null, albumId: string, photoIdsInput: unknown) {
    const album = zUuid(albumId);
    const photoIds = guestTagPhotoIdsSchema.parse(photoIdsInput);
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const rows = await this.db
      .prepare(guestTagReadSql())
      .bind(album, secretHash, canTagBit, canTagBit, JSON.stringify(photoIds))
      .all<GuestTagReadRow>();
    const summary = rows.results[0];
    if (
      !summary ||
      summary.authorizedCount !== 1 ||
      summary.requestedCount !== photoIds.length ||
      summary.matchedCount !== photoIds.length ||
      !summary.guestId
    )
      throw new GuestAccessDenied();

    const tagsByPhoto = new Map<
      string,
      Array<{
        tagId: string;
        label: string;
        versionId: string;
        updatedAt: string;
      }>
    >(photoIds.map((photoId) => [photoId, []]));
    for (const row of rows.results) {
      if (
        row.matchedPhotoId === null ||
        row.tagId === null ||
        row.label === null ||
        row.versionId === null ||
        row.updatedAt === null
      )
        continue;
      tagsByPhoto.get(row.photoId ?? '')?.push({
        tagId: row.tagId,
        label: row.label,
        versionId: row.versionId,
        updatedAt: row.updatedAt,
      });
    }

    return guestTagPageSchema.parse({
      guestId: summary.guestId,
      items: photoIds.map((photoId) => ({
        photoId,
        tags: tagsByPhoto.get(photoId) ?? [],
      })),
    });
  }

  async set(
    secret: string | null,
    albumId: string,
    photoId: string,
    input: unknown,
  ) {
    const album = zUuid(albumId);
    const photo = zUuid(photoId);
    const request = guestTagRequestSchema.parse(input);
    const label = canonicalTagLabel(request.label);
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const session = await this.db
      .prepare(
        'SELECT s.id,s.guest_id,s.invite_id,i.workspace_id,i.project_id ' +
          'FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id ' +
          'WHERE s.secret_hash=?',
      )
      .bind(secretHash)
      .first<GuestTagScope>();
    if (!session || session.guest_id !== request.expectedGuestId)
      throw new GuestAccessDenied();

    const payload = JSON.stringify({
      requestId: request.requestId,
      expectedGuestId: request.expectedGuestId,
      versionId: request.versionId,
      label,
      present: request.present,
    });
    const presentValue = request.present ? 1 : 0;
    try {
      await this.db
        .prepare(
          [
            'INSERT INTO guest_tag_commands(',
            'id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,',
            'workspace_id,project_id,album_id,photo_id,version_id,label,present,payload_json',
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ].join(' '),
        )
        .bind(
          crypto.randomUUID(),
          session.guest_id,
          session.invite_id,
          session.id,
          secretHash,
          request.expectedGuestId,
          request.requestId,
          session.workspace_id,
          session.project_id,
          album,
          photo,
          request.versionId,
          label,
          presentValue,
          payload,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('GUEST_ACCESS_REQUIRED'))
        throw new GuestAccessDenied();
      if (message.includes('REQUEST_ID_CONFLICT'))
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (message.includes('TAG_LIMIT_REACHED'))
        throw new WorkspaceFailure('TAG_LIMIT_REACHED', 409);
      if (message.includes('TAG_CATALOG_LIMIT_REACHED'))
        throw new WorkspaceFailure('TAG_CATALOG_LIMIT_REACHED', 409);
      if (
        message.includes('INVALID_TIMESTAMP') ||
        message.includes('INVALID_INPUT')
      )
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      throw new WorkspaceFailure('GUEST_TAG_UNAVAILABLE', 503);
    }

    const row = await this.db
      .prepare(guestTagResultSql())
      .bind(
        session.id,
        secretHash,
        session.guest_id,
        request.expectedGuestId,
        request.requestId,
        session.workspace_id,
        session.project_id,
        album,
        photo,
        request.versionId,
        label,
        presentValue,
        payload,
        canTagBit,
        canTagBit,
      )
      .first<{ result_json: string }>();
    if (!row) throw new GuestAccessDenied();
    try {
      return guestTagResultSchema.parse(JSON.parse(row.result_json) as unknown);
    } catch {
      throw new WorkspaceFailure('GUEST_TAG_UNAVAILABLE', 503);
    }
  }
}

function zUuid(value: string) {
  return z.uuid().parse(value);
}
