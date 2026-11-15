import { describe, expect, it } from 'vitest';
import {
  galleryViewUrl,
  readGalleryView,
} from '../../apps/web/target-ui/gallery-view';

describe('gallery view URL state', () => {
  it('recognizes only a single list value', () => {
    expect(readGalleryView('?aiv=list')).toBe('list');
    for (const search of [
      '',
      '?aiv=masonry',
      '?aiv=grid',
      '?aiv=list&aiv=masonry',
    ])
      expect(readGalleryView(search)).toBe('masonry');
  });

  it('changes only aiv and preserves the rest of the URL', () => {
    const base = new URL(
      'https://pick.example/album?albumId=album&tag=a&tag=b#photo',
    );
    const list = galleryViewUrl(base, 'list');
    expect(list.searchParams.get('aiv')).toBe('list');
    expect(list.searchParams.get('albumId')).toBe('album');
    expect(list.searchParams.getAll('tag')).toEqual(['a', 'b']);
    expect(list.hash).toBe('#photo');

    const masonry = galleryViewUrl(list, 'masonry');
    expect(masonry.searchParams.has('aiv')).toBe(false);
    expect(masonry.pathname + masonry.search + masonry.hash).toBe(
      '/album?albumId=album&tag=a&tag=b#photo',
    );
  });
});
