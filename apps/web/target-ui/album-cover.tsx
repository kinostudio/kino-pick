import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { fetchAlbumPhotos } from './album-gallery';
import './cover-control.css';

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

const COVER_CHANGED_EVENT = 'kino-pick:cover-changed';
const albumCoverSchema = z
  .object({
    albumId: z.string().min(1),
    photoId: z.string().min(1).nullable(),
    thumbnailUrl: z.string().startsWith('/api/v1/photos/').nullable(),
    revision: z.number().int().min(0),
  })
  .strict();
const projectCoverSchema = z
  .object({
    projectId: z.string().min(1),
    albumId: z.string().min(1).nullable(),
    revision: z.number().int().min(0),
  })
  .strict();

async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error('COVER_UNAVAILABLE');
  return response.json() as Promise<unknown>;
}

function albumCoverUrl(albumId: string) {
  return '/api/v1/albums/' + encodeURIComponent(albumId) + '/cover';
}
function projectCoverUrl(projectId: string) {
  return '/api/v1/projects/' + encodeURIComponent(projectId) + '/cover';
}

async function putCover(url: string, body: object) {
  const response = await fetch(url, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
  });
  if (!response.ok) throw new Error('COVER_SAVE_FAILED');
  window.dispatchEvent(new Event(COVER_CHANGED_EVENT));
}

async function loadAlbumCover(albumId: string, signal: AbortSignal) {
  const chosen = albumCoverSchema.safeParse(
    await getJson(albumCoverUrl(albumId), signal).catch(() => null),
  );
  if (chosen.success && chosen.data.thumbnailUrl)
    return { url: chosen.data.thumbnailUrl, empty: false };
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
  const chosen = projectCoverSchema.safeParse(
    await getJson(projectCoverUrl(projectId), signal).catch(() => null),
  );
  const chosenId = chosen.success ? chosen.data.albumId : null;
  const first =
    parsed.data.albums.find((album) => album.id === chosenId) ??
    parsed.data.albums[0];
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
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    window.addEventListener(COVER_CHANGED_EVENT, bump);
    return () => window.removeEventListener(COVER_CHANGED_EVENT, bump);
  }, []);
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
    // load is recreated each render; the keyed wrapper remounts on id change
    // and `version` reloads after an Owner changes a cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
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

/** Lightbox control: make this photo the album cover, or return to automatic. */
export function AlbumCoverControl({
  albumId,
  photoId,
}: {
  albumId: string;
  photoId: string;
}) {
  const [state, setState] = useState<{
    photoId: string | null;
    revision: number;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    void getJson(albumCoverUrl(albumId))
      .catch(() => null)
      .then((body) => {
        if (!alive) return;
        const parsed = albumCoverSchema.safeParse(body);
        setState(parsed.success ? parsed.data : null);
      });
    return () => {
      alive = false;
    };
  }, [albumId, reload]);
  async function save(next: string | null) {
    if (!state || pending) return;
    setPending(true);
    setMessage('');
    try {
      await putCover(albumCoverUrl(albumId), {
        expectedRevision: state.revision,
        photoId: next,
      });
      setMessage(next ? '已設為相簿封面' : '已改回自動選擇封面');
    } catch {
      setMessage('封面暫時無法儲存，請重新整理後再試');
    } finally {
      setReload((value) => value + 1);
      setPending(false);
    }
  }
  const isCover = state?.photoId === photoId;
  return (
    <section className="kino-cover-control" aria-label="相簿封面">
      <p className="kino-photo-detail-eyebrow">COVER</p>
      <h3>相簿封面</h3>
      <p className="kino-cover-control-hint">
        {state === null
          ? '正在讀取封面設定…'
          : isCover
            ? '這張照片是目前的相簿封面。'
            : state.photoId
              ? '相簿已指定其他照片為封面。'
              : '自動：置頂照片 → 攝影師推薦 → 第一張照片。'}
      </p>
      <div className="kino-cover-control-actions">
        {!isCover && (
          <button
            type="button"
            disabled={state === null || pending}
            onClick={() => void save(photoId)}
          >
            設為相簿封面
          </button>
        )}
        {state?.photoId && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void save(null)}
          >
            改回自動
          </button>
        )}
      </div>
      {message && (
        <p className="kino-cover-control-hint" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

/** Album settings control: use this album as the project cover. */
export function ProjectCoverControl({
  projectId,
  albumId,
}: {
  projectId: string;
  albumId: string;
}) {
  const [current, setCurrent] = useState<{
    albumId: string | null;
    revision: number;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    void getJson(projectCoverUrl(projectId))
      .catch(() => null)
      .then((body) => {
        if (!alive) return;
        const parsed = projectCoverSchema.safeParse(body);
        setCurrent(parsed.success ? parsed.data : null);
      });
    return () => {
      alive = false;
    };
  }, [projectId, reload]);
  async function save(next: string | null) {
    if (!current || pending) return;
    setPending(true);
    setMessage('');
    try {
      await putCover(projectCoverUrl(projectId), {
        expectedRevision: current.revision,
        albumId: next,
      });
      setMessage(next ? '已設為專案封面' : '專案封面已改回第一本相簿');
    } catch {
      setMessage('專案封面暫時無法儲存，請重新整理後再試');
    } finally {
      setReload((value) => value + 1);
      setPending(false);
    }
  }
  const isCover = current?.albumId === albumId;
  return (
    <div className="kino-cover-control-actions">
      {isCover ? (
        <span className="kino-cover-control-badge">目前的專案封面</span>
      ) : (
        <button
          type="button"
          disabled={current === null || pending}
          onClick={() => void save(albumId)}
        >
          設為專案封面
        </button>
      )}
      {isCover && (
        <button
          type="button"
          disabled={pending}
          onClick={() => void save(null)}
        >
          專案封面改回自動
        </button>
      )}
      {message && <span role="status">{message}</span>}
    </div>
  );
}
