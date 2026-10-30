import { z } from 'zod';
import {
  galleryPhotoSchema,
  galleryPageSchema,
} from '../../../packages/contracts/src/gallery';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from '../../../packages/db/src/workspace-cursor';
import { WorkspaceFailure } from './workspaces';

export class D1GalleryRepository {
  constructor(
    private db: D1Database,
    private actor: string,
    private session: string,
  ) {}
  private async album(albumId: string) {
    const row = await this.db
      .prepare(
        `SELECT a.workspace_id FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id JOIN workspaces w ON w.id=a.workspace_id
      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      WHERE a.id=? AND w.owner_user_id=? AND a.state NOT IN('deleting','deleted') AND p.status NOT IN('deleting','deleted')`,
      )
      .bind(this.session, z.uuid().parse(albumId), this.actor)
      .first<{ workspace_id: string }>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return row;
  }
  async list(albumId: string, cursor?: string) {
    const context = await this.album(albumId);
    const after = decodeWorkspaceCursor(cursor);
    const rows = await this.db
      .prepare(
        `SELECT p.id,v.id AS versionId,p.original_filename AS filename,v.width,v.height,p.created_at AS createdAt,COALESCE(j.status,'unavailable') AS processing
      FROM photos p JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id JOIN photo_versions v ON v.id=head.version_id AND v.photo_id=p.id AND v.workspace_id=p.workspace_id JOIN photo_assets original ON original.version_id=v.id AND original.asset_kind='original'
      JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      JOIN albums al ON al.id=p.album_id JOIN projects pr ON pr.id=p.project_id
      LEFT JOIN image_processing_jobs j ON j.id=original.id WHERE p.workspace_id=? AND p.album_id=? AND w.owner_user_id=? AND al.state NOT IN('deleting','deleted') AND pr.status NOT IN('deleting','deleted') AND (? IS NULL OR(p.created_at,p.id)<(?,?))
      ORDER BY p.created_at DESC,p.id DESC LIMIT 25`,
      )
      .bind(
        this.session,
        context.workspace_id,
        albumId,
        this.actor,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
      )
      .all<Record<string, unknown>>();
    const photos = rows.results.slice(0, 24).map((row) => {
      const base = `/api/v1/photos/${String(row.id)}/versions/${String(row.versionId)}/assets/`;
      return galleryPhotoSchema.parse({
        ...row,
        thumbnailUrl:
          row.processing === 'succeeded' ? base + 'thumbnail' : null,
        previewUrl: row.processing === 'succeeded' ? base + 'preview' : null,
      });
    });
    const last = photos.at(-1);
    return galleryPageSchema.parse({
      photos,
      nextCursor:
        rows.results.length > 24 && last
          ? encodeWorkspaceCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    });
  }
  async asset(photoId: string, versionId: string, kind: string) {
    z.uuid().parse(photoId);
    z.uuid().parse(versionId);
    z.enum(['thumbnail', 'preview']).parse(kind);
    const row = await this.db
      .prepare(
        `SELECT a.object_key,a.byte_size,a.checksum_sha256,p.album_id,p.workspace_id,p.project_id FROM photo_assets a
      JOIN photos p ON p.id=a.photo_id AND p.workspace_id=a.workspace_id JOIN photo_assets original ON original.version_id=a.version_id AND original.asset_kind='original'
      JOIN image_processing_jobs j ON j.id=original.id AND j.status='succeeded' JOIN image_processing_outputs slot ON slot.job_id=j.id AND slot.kind=a.asset_kind AND slot.asset_id=a.id AND slot.object_key=a.object_key
      JOIN albums al ON al.id=p.album_id JOIN projects pr ON pr.id=p.project_id JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      WHERE p.id=? AND a.version_id=? AND a.asset_kind=? AND w.owner_user_id=? AND a.state='private' AND al.state NOT IN('deleting','deleted') AND pr.status NOT IN('deleting','deleted')`,
      )
      .bind(this.session, photoId, versionId, kind, this.actor)
      .first<{
        object_key: string;
        byte_size: number;
        checksum_sha256: string;
        album_id: string;
        workspace_id: string;
        project_id: string;
      }>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return row;
  }
}
