import { z } from 'zod';
import {
  galleryPhotoSchema,
  galleryPageSchema,
} from '../../../packages/contracts/src/gallery';
import { WorkspaceFailure } from './workspaces';

const galleryCursorSchema = z.union([
  z
    .object({
      createdAt: z.iso.datetime({ offset: true }),
      id: z.uuid(),
      isPinned: z.boolean(),
    })
    .strict(),
  z
    .object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
    .strict(),
]);

type GalleryCursor = z.infer<typeof galleryCursorSchema> & {
  isPinned?: boolean;
};

function decodeGalleryCursor(input?: string): GalleryCursor | null {
  if (input === undefined) return null;
  const raw = z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(input);
  let parsed: unknown;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.length === 0 || bytes.toString('base64url') !== raw)
      throw new Error('Invalid gallery cursor');
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new z.ZodError([
      { code: 'custom', path: [], message: 'Invalid gallery cursor' },
    ]);
  }
  return galleryCursorSchema.parse(parsed);
}

function encodeGalleryCursor(input: {
  createdAt: string;
  id: string;
  isPinned: boolean;
}) {
  const value = z
    .object({
      createdAt: z.iso.datetime({ offset: true }),
      id: z.uuid(),
      isPinned: z.boolean(),
    })
    .strict()
    .parse(input);
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

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
    const after = decodeGalleryCursor(cursor);
    const baseSelect = (
      includeRecommendation: boolean,
      includePins: boolean,
    ) => {
      const pinValue = includePins ? 'COALESCE(pin.is_pinned,0)' : '0';
      const pinOrder = includePins ? `${pinValue} DESC,` : '';
      const pinProjection = includePins
        ? ',COALESCE(pin.is_pinned,0) AS isPinned,COALESCE(pin.revision,0) AS pinRevision'
        : '';
      const recommendation = includeRecommendation
        ? `,${recommendedExpression} AS photographerRecommended`
        : '';
      const pinJoin = includePins
        ? 'LEFT JOIN photo_pin_states pin ON pin.photo_id=p.id AND pin.workspace_id=p.workspace_id AND pin.project_id=p.project_id AND pin.album_id=p.album_id'
        : '';
      return `SELECT p.id,v.id AS versionId,p.original_filename AS filename,v.width,v.height,p.created_at AS createdAt,CASE WHEN j.status='running' AND j.lease_until_ms<=unixepoch('subsec')*1000 THEN 'retryable' ELSE COALESCE(j.status,'unavailable') END AS processing${pinProjection}${recommendation}
      FROM photos p JOIN photo_version_heads head ON head.photo_id=p.id AND head.workspace_id=p.workspace_id AND head.project_id=p.project_id AND head.album_id=p.album_id JOIN photo_versions v ON v.id=head.version_id AND v.photo_id=p.id AND v.workspace_id=p.workspace_id JOIN photo_assets original ON original.version_id=v.id AND original.asset_kind='original'
      JOIN workspaces w ON w.id=p.workspace_id JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      JOIN albums al ON al.id=p.album_id JOIN projects pr ON pr.id=p.project_id
      LEFT JOIN image_processing_jobs j ON j.id=original.id ${pinJoin}
      WHERE p.workspace_id=? AND p.album_id=? AND w.owner_user_id=? AND al.state NOT IN('deleting','deleted') AND pr.status NOT IN('deleting','deleted')
        AND (? IS NULL OR ${pinValue}<? OR (${pinValue}=? AND (p.created_at,p.id)<(?,?)))
      ORDER BY ${pinOrder}p.created_at DESC,p.id DESC LIMIT 25`;
    };
    const binds = (includePins: boolean) => [
      this.session,
      context.workspace_id,
      albumId,
      this.actor,
      after?.createdAt ?? null,
      includePins && after?.isPinned ? 1 : 0,
      includePins && after?.isPinned ? 1 : 0,
      after?.createdAt ?? null,
      after?.id ?? null,
    ];
    const ratingExpression =
      "CASE metadata.rating_state WHEN 'set' THEN metadata.rating_value WHEN 'clear' THEN NULL " +
      "ELSE CASE WHEN json_extract(metadata.imported_metadata_json,'$.rating.status')='value' " +
      "THEN json_extract(metadata.imported_metadata_json,'$.rating.value') END END";
    const labelExpression =
      "CASE metadata.label_state WHEN 'set' THEN metadata.label_value WHEN 'clear' THEN NULL " +
      "ELSE CASE WHEN json_extract(metadata.imported_metadata_json,'$.label.status')='value' " +
      "THEN json_extract(metadata.imported_metadata_json,'$.label.value') END END";
    const recommendedExpression =
      'COALESCE((SELECT CASE WHEN policy.visible=1 AND (' +
      "COALESCE(metadata.decision,'inherit')='recommend' OR " +
      "(COALESCE(metadata.decision,'inherit')='inherit' AND (" +
      `(policy.min_rating IS NOT NULL AND (${ratingExpression})>=policy.min_rating) OR ` +
      `EXISTS(SELECT 1 FROM json_each(policy.allowed_labels_json) allowed WHERE allowed.value=(${labelExpression}))` +
      '))) THEN 1 ELSE 0 END ' +
      'FROM album_photographer_recommendation_policy policy ' +
      'LEFT JOIN photographer_photo_metadata metadata ON metadata.photo_id=p.id ' +
      'AND metadata.version_id=head.version_id AND metadata.album_id=p.album_id ' +
      'WHERE policy.album_id=p.album_id),0)';
    let rows: D1Result<Record<string, unknown>>;
    try {
      rows = await this.db
        .prepare(baseSelect(true, true))
        .bind(...binds(true))
        .all<Record<string, unknown>>();
    } catch {
      try {
        // A prior schema may have recommendation metadata but not the additive
        // pin projection yet. Keep the recommendation badge available there.
        rows = await this.db
          .prepare(baseSelect(true, false))
          .bind(...binds(false))
          .all<Record<string, unknown>>();
      } catch {
        try {
          // Older compatible schemas can still serve the gallery while either
          // optional migration is pending.
          rows = await this.db
            .prepare(baseSelect(false, false))
            .bind(...binds(false))
            .all<Record<string, unknown>>();
        } catch {
          // Pin-only schemas are not expected in migration order, but keeping
          // this path makes rolling upgrades safe if they are ever rehearsed.
          rows = await this.db
            .prepare(baseSelect(false, true))
            .bind(...binds(true))
            .all<Record<string, unknown>>();
        }
      }
    }
    const photos = rows.results.slice(0, 24).map((row) => {
      const base = `/api/v1/photos/${String(row.id)}/versions/${String(row.versionId)}/assets/`;
      return galleryPhotoSchema.parse({
        ...row,
        ...(row.photographerRecommended === undefined
          ? {}
          : {
              photographerRecommended:
                row.photographerRecommended === true ||
                row.photographerRecommended === 1,
            }),
        ...(row.isPinned === undefined
          ? {}
          : { isPinned: row.isPinned === true || row.isPinned === 1 }),
        ...(row.pinRevision === undefined
          ? {}
          : { pinRevision: Number(row.pinRevision) }),
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
          ? encodeGalleryCursor({
              createdAt: last.createdAt,
              id: last.id,
              isPinned: last.isPinned ?? false,
            })
          : null,
    });
  }
  async asset(photoId: string, versionId: string, kind: string) {
    z.uuid().parse(photoId);
    z.uuid().parse(versionId);
    z.enum(['thumbnail', 'preview']).parse(kind);
    const row = await this.db
      .prepare(
        `SELECT a.object_key,a.byte_size,a.checksum_sha256,a.storage_node_id,p.album_id,p.workspace_id,p.project_id FROM photo_assets a
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
        storage_node_id: string;
        album_id: string;
        workspace_id: string;
        project_id: string;
      }>();
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    return row;
  }
}
