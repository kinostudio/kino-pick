export type GalleryView = 'masonry' | 'list' | 'large';

export function readGalleryView(search: string): GalleryView {
  const values = new URLSearchParams(search).getAll('aiv');
  return values.length === 1 && (values[0] === 'list' || values[0] === 'large')
    ? values[0]
    : 'masonry';
}

export function galleryViewUrl(url: URL, view: GalleryView): URL {
  const next = new URL(url.href);
  if (view !== 'masonry') next.searchParams.set('aiv', view);
  else next.searchParams.delete('aiv');
  return next;
}
