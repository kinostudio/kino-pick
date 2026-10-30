import { describe, expect, it } from 'vitest';
import { ownerAnnotationReadQuerySchema } from '../../packages/contracts/src/owner-annotations.ts';
import { ownerAnnotationsPath } from '../../apps/web/target-ui/owner-annotation-query.ts';

const target = {
  albumId: '11111111-1111-4111-8111-111111111111',
  inviteId: '22222222-2222-4222-8222-222222222222',
  photoId: '33333333-3333-4333-8333-333333333333',
  versionId: '44444444-4444-4444-8444-444444444444',
};

const annotationId = '55555555-5555-4555-8555-555555555555';

describe('Owner annotation read URL query', () => {
  it('serializes a validated paginated query with URL encoding', () => {
    const path = ownerAnnotationsPath(target, 'next page/2');
    const url = new URL(path, 'https://kino-pic.test');

    expect(url.pathname).toBe(
      '/api/v1/albums/' +
        target.albumId +
        '/photos/' +
        target.photoId +
        '/versions/' +
        target.versionId +
        '/annotations/owner',
    );
    expect(path).not.toContain('[object Object]');
    expect(
      ownerAnnotationReadQuerySchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      ),
    ).toEqual({ inviteId: target.inviteId, cursor: 'next page/2' });
  });

  it('serializes targeted receipt reads without a pagination cursor', () => {
    const url = new URL(
      ownerAnnotationsPath(target, null, annotationId),
      'https://kino-pic.test',
    );

    expect(
      ownerAnnotationReadQuerySchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      ),
    ).toEqual({ inviteId: target.inviteId, annotationId });
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('rejects a targeted read combined with pagination', () => {
    expect(() =>
      ownerAnnotationsPath(target, 'cursor', annotationId),
    ).toThrow();
  });
});
