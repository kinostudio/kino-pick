import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { fetchAlbumPhotos } from './album-gallery';

type CoverPhoto = Awaited<
  ReturnType<typeof fetchAlbumPhotos>
>['photos'][number];

/**
 * Album cover priority (first page of the authorized gallery, which already
 * lists pinned photos first): first pinned, then first photographer
 * recommendation, then the first photo. Only processed thumbnails qualify.
 */
export function pickCoverPhoto(photos: CoverPhoto[]) {
  const ready = photos.filter(
    (photo) => photo.processing === 'succeeded' && photo.thumbnailUrl,
  );
  return (
    ready.find((photo) => photo.isPinned) ??
    ready.find((photo) => photo.photographerRecommended) ??
    ready[0] ??
    null
  );
}

async function loadAlbumCover(albumId: string, signal: AbortSignal) {
  const page = await fetchAlbumPhotos(albumId, null, signal);
  return {
    url: pickCoverPhoto(page.photos)?.thumbnailUrl ?? null,
    empty: page.photos.length === 0,
  };
}

const firstAlbumSchema = z
  .object({
    albums: z.array(z.object({ id: z.string().min(1) }).loose()),
  })
  .loose();

async function loadProjectCover(projectId: string, signal: AbortSignal) {
  const response = await fetch(
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/albums',
    {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    },
  );
  if (!response.ok) throw new Error('PROJECT_COVER_UNAVAILABLE');
  const parsed = firstAlbumSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('PROJECT_COVER_UNAVAILABLE');
  const first = parsed.data.albums[0];
  if (!first) return { url: null, empty: true };
  return loadAlbumCover(first.id, signal);
}

/** Album covers reuse the authorized, bounded gallery catalogue; no public URLs. */
export function AlbumCover({
  albumId,
  name,
}: {
  albumId: string;
  name: string;
}) {
  return (
    <CoverImage
      key={'album:' + albumId}
      load={(signal) => loadAlbumCover(albumId, signal)}
      alt={name + ' 相簿封面'}
      emptyText="尚未加入照片"
      label="開啟相簿"
    />
  );
}

/** Project cover: the cover of the project's first album. */
export function ProjectCover({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  return (
    <CoverImage
      key={'project:' + projectId}
      load={(signal) => loadProjectCover(projectId, signal)}
      alt={name + ' 專案封面'}
      emptyText="尚未建立相簿"
      label="開啟專案"
    />
  );
}

function CoverImage({
  load,
  alt,
  emptyText,
  label,
}: {
  load: (
    signal: AbortSignal,
  ) => Promise<{ url: string | null; empty: boolean }>;
  alt: string;
  emptyText: string;
  label: string;
}) {
  const target = useRef<HTMLSpanElement>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [status, setStatus] = useState('載入封面…');
  useEffect(() => {
    const controller = new AbortController();
    const element = target.current;
    if (!element) return;
    setCover(null);
    setStatus('載入封面…');
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void load(controller.signal)
          .then((result) => {
            if (controller.signal.aborted) return;
            setCover(result.url);
            setStatus(result.empty ? emptyText : '照片處理中');
          })
          .catch(() => {
            if (!controller.signal.aborted) setStatus('封面暫時無法載入');
          });
      },
      { rootMargin: '100px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      controller.abort();
    };
    // load is recreated each render; the keyed wrapper remounts on id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span ref={target} className="studio-album-cover">
      {cover ? (
        <img
          src={cover}
          alt={alt}
          loading="lazy"
          draggable={false}
          onContextMenu={(event) => event.preventDefault()}
          onError={() => {
            setCover(null);
            setStatus('封面暫時無法載入');
          }}
        />
      ) : (
        <span className="studio-album-cover-empty">
          <svg
            viewBox="0 0 24 24"
            width="40"
            height="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8" cy="8" r="1.5" />
            <path d="m3 17 6-6 4 4 3-3 5 5" />
          </svg>
          {status}
        </span>
      )}
      <span className="studio-album-cover-label">{label}</span>
    </span>
  );
}
