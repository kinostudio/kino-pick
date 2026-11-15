export type GalleryView = 'masonry' | 'list';

export function readGalleryView(search: string): GalleryView {
  const values = new URLSearchParams(search).getAll('aiv');
  return values.length === 1 && values[0] === 'list' ? 'list' : 'masonry';
}

export function galleryViewUrl(url: URL, view: GalleryView): URL {
  const next = new URL(url.href);
  if (view === 'list') next.searchParams.set('aiv', 'list');
  else next.searchParams.delete('aiv');
  return next;
}
