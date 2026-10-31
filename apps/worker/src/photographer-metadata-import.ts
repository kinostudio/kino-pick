import { z } from 'zod';
import { extractPhotographerContainerMetadata } from '../../../packages/image-processing/src/photographer-container';
import { D1PhotographerRecommendationsRepository } from './photographer-recommendations';
import {
  photographerRecommendationsCapability,
  type WorkerEnv,
} from './config';
import { WorkspaceFailure } from './workspaces';
import {
  STAGING_GUEST_SCOPE,
  stagingGuestValidationEnabled,
} from './staging-guest-scope';

const sourceSchema = z.object({
  assetId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  albumId: z.uuid(),
  photoId: z.uuid(),
  versionId: z.uuid(),
  objectKey: z.string().min(1),
  size: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Reads server-owned immutable original evidence; no metadata or object key comes from a client. */
export async function importPhotographerOriginal(
  env: WorkerEnv,
  actorId: string,
  sessionId: string,
  photoId: string,
  input: { requestId: string; expectedRevision: number; versionId: string },
) {
  const repo = new D1PhotographerRecommendationsRepository(
    env.DB,
    actorId,
    sessionId,
    photographerRecommendationsCapability(env),
  );
  await repo.readPhoto(photoId, input.versionId);
  const row = await env.DB.prepare(
    `SELECT a.id AS assetId,p.workspace_id AS workspaceId,
    p.project_id AS projectId,p.album_id AS albumId,p.id AS photoId,v.id AS versionId,
    a.object_key AS objectKey,a.byte_size AS size,a.mime,a.checksum_sha256 AS sourceSha256
    FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id
    JOIN photo_assets a ON a.version_id=v.id AND a.photo_id=p.id AND a.workspace_id=p.workspace_id
      AND a.asset_kind='original' AND a.state='private'
    JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?
    JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
    JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id
    JOIN albums al ON al.id=p.album_id AND al.project_id=pr.id AND al.workspace_id=p.workspace_id
    WHERE p.id=? AND v.id=? AND pr.status NOT IN('archived','deleting','deleted')
    AND al.state NOT IN('archived','deleting','deleted')`,
  )
    .bind(
      actorId,
      sessionId,
      z.uuid().parse(photoId),
      z.uuid().parse(input.versionId),
    )
    .first();
  if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
  const source = sourceSchema.parse(row);
  if (
    stagingGuestValidationEnabled(env) &&
    source.albumId !== STAGING_GUEST_SCOPE.albumId
  )
    throw new WorkspaceFailure('NOT_FOUND', 404);
  const head = await env.PRIMARY_STORAGE.head(source.objectKey);
  const checksum = head?.checksums.sha256
    ? Array.from(new Uint8Array(head.checksums.sha256), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('')
    : null;
  if (
    !head ||
    head.size !== source.size ||
    checksum !== source.sourceSha256 ||
    head.httpMetadata?.contentType !== source.mime
  )
    throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
  const metadata = await extractPhotographerContainerMetadata(
    {
      size: source.size,
      read: async (offset, length) => {
        const object = await env.PRIMARY_STORAGE.get(source.objectKey, {
          range: { offset, length },
          onlyIf: { etagMatches: head.etag },
        });
        if (!object || !('body' in object) || object.etag !== head.etag)
          throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
        return new Uint8Array(await object.arrayBuffer());
      },
    },
    source.mime,
  );
  return repo.importFromVerifiedSource({
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    workspaceId: source.workspaceId,
    projectId: source.projectId,
    albumId: source.albumId,
    photoId: source.photoId,
    versionId: source.versionId,
    assetId: source.assetId,
    sourceSha256: source.sourceSha256,
    sourceMime: source.mime,
    metadata,
  });
}

/** Completion wake-up only; retries never overwrite manual values or create repeated imports. */
export async function importCompletedUploadMetadata(
  env: WorkerEnv,
  actorId: string,
  sessionId: string,
  uploadId: string,
) {
  if (!photographerRecommendationsCapability(env)) return;
  const repo = new D1PhotographerRecommendationsRepository(
    env.DB,
    actorId,
    sessionId,
    true,
  );
  if (!(await repo.capability())) return;
  const source = await env.DB.prepare(
    `SELECT a.photo_id AS photoId,a.version_id AS versionId
    FROM upload_sessions u JOIN photo_assets a ON a.object_key=u.object_key AND a.workspace_id=u.workspace_id
    WHERE u.id=? AND u.actor_id=? AND a.asset_kind='original' AND a.state='private'
    AND (EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id
      AND c.actor_id=u.actor_id AND c.photo_id=a.photo_id AND c.version_id=a.version_id AND c.asset_id=a.id)
      OR EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=u.id
      AND c.actor_id=u.actor_id AND c.photo_id=a.photo_id AND c.version_id=a.version_id AND c.asset_id=a.id))`,
  )
    .bind(uploadId, actorId)
    .first<{ photoId: string; versionId: string }>();
  if (!source) return;
  const previous = await repo.readPhoto(source.photoId, source.versionId);
  if (previous.source !== null) return;
  await importPhotographerOriginal(env, actorId, sessionId, source.photoId, {
    requestId: crypto.randomUUID(),
    expectedRevision: previous.revision,
    versionId: source.versionId,
  });
}
