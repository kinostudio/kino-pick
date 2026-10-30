import { ownerAnnotationReadQuerySchema } from '../../../packages/contracts/src/owner-annotations.ts';

export type OwnerAnnotationReadTarget = {
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
};

export function ownerAnnotationsPath(
  target: OwnerAnnotationReadTarget,
  cursor?: string | null,
  annotationId?: string,
) {
  const query = ownerAnnotationReadQuerySchema.parse({
    inviteId: target.inviteId,
    ...(cursor !== undefined && cursor !== null ? { cursor } : {}),
    ...(annotationId !== undefined ? { annotationId } : {}),
  });
  const params = new URLSearchParams({ inviteId: query.inviteId });
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.annotationId !== undefined)
    params.set('annotationId', query.annotationId);

  return (
    '/api/v1/albums/' +
    encodeURIComponent(target.albumId) +
    '/photos/' +
    encodeURIComponent(target.photoId) +
    '/versions/' +
    encodeURIComponent(target.versionId) +
    '/annotations/owner?' +
    params.toString()
  );
}
