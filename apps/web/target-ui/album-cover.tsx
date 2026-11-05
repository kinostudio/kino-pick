import { useEffect, useRef, useState } from 'react';
import { fetchAlbumPhotos } from './album-gallery';

/** Album covers reuse the authorized, bounded gallery catalogue; no public URLs. */
export function AlbumCover({
  albumId,
  name,
}: {
  albumId: string;
  name: string;
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
        void fetchAlbumPhotos(albumId, null, controller.signal)
          .then((page) => {
            if (controller.signal.aborted) return;
            const photo = page.photos.find(
              (item) => item.processing === 'succeeded' && item.thumbnailUrl,
            );
            setCover(photo?.thumbnailUrl ?? null);
            setStatus(page.photos.length ? '照片處理中' : '尚未加入照片');
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
  }, [albumId]);
  return (
    <span ref={target} className="studio-album-cover">
      {cover ? (
        <img
          src={cover}
          alt={name + ' 相簿封面'}
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
      <span className="studio-album-cover-label">開啟相簿</span>
    </span>
  );
}
