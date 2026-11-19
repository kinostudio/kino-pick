import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { StudioIcon } from './studio-icons';

const scales = [1, 1.5, 2];

export function photoZoomLevelAfterWheel(level: number, deltaY: number) {
  return Math.max(0, Math.min(2, level + (deltaY < 0 ? 1 : -1)));
}

export function photoZoomAnchoredOffset(
  scrollOffset: number,
  pointerOffset: number,
  previousExtent: number,
  nextExtent: number,
) {
  return previousExtent > 0
    ? Math.max(
        0,
        ((scrollOffset + pointerOffset) * nextExtent) / previousExtent -
          pointerOffset,
      )
    : 0;
}

export function PhotoZoom({
  children,
  downloads,
}: {
  children: ReactNode;
  downloads?: { preview?: string | undefined; original?: string | undefined };
}) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const mayDownload = Boolean(downloads?.preview || downloads?.original);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const openedByHold = useRef(false);
  const cancelHold = useCallback(() => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  }, []);
  useEffect(() => cancelHold, [cancelHold]);

  const [level, setLevel] = useState(0);
  const levelRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const changeZoom = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      if (next === levelRef.current) return;
      const scroll = scrollRef.current;
      const image = imageRef.current;
      if (scroll && image) {
        const bounds = scroll.getBoundingClientRect();
        anchorRef.current = {
          x: Math.max(
            0,
            Math.min(
              scroll.clientWidth,
              clientX === undefined
                ? scroll.clientWidth / 2
                : clientX - bounds.left - scroll.clientLeft,
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              scroll.clientHeight,
              clientY === undefined
                ? scroll.clientHeight / 2
                : clientY - bounds.top - scroll.clientTop,
            ),
          ),
          left: scroll.scrollLeft,
          top: scroll.scrollTop,
          width: image.offsetWidth,
          height: image.offsetHeight,
        };
      }
      levelRef.current = next;
      setLevel(next);
    },
    [],
  );
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroll = scrollRef.current;
    const image = imageRef.current;
    anchorRef.current = null;
    if (!anchor || !scroll || !image) return;
    scroll.scrollLeft = photoZoomAnchoredOffset(
      anchor.left,
      anchor.x,
      anchor.width,
      image.offsetWidth,
    );
    scroll.scrollTop = photoZoomAnchoredOffset(
      anchor.top,
      anchor.y,
      anchor.height,
      image.offsetHeight,
    );
  }, [level]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      changeZoom(
        photoZoomLevelAfterWheel(levelRef.current, event.deltaY),
        event.clientX,
        event.clientY,
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [changeZoom]);
  return (
    <div className="kino-photo-zoom">
      <div
        ref={scrollRef}
        className="kino-photo-zoom-scroll"
        data-zoomed={level > 0}
      >
        <div
          ref={imageRef}
          className="kino-photo-zoom-image"
          style={{
            width: `${scales[level]! * 100}%`,
            height: `${scales[level]! * 100}%`,
          }}
          onPointerDown={(event) => {
            cancelHold();
            openedByHold.current = false;
            if (
              !mayDownload ||
              event.pointerType !== 'touch' ||
              !event.isPrimary ||
              !(event.target instanceof HTMLImageElement)
            )
              return;
            hold.current = {
              x: event.clientX,
              y: event.clientY,
              timer: window.setTimeout(() => {
                hold.current = null;
                openedByHold.current = true;
                setDownloadOpen(true);
              }, 500),
            };
          }}
          onPointerMove={(event) => {
            if (
              hold.current &&
              Math.hypot(
                event.clientX - hold.current.x,
                event.clientY - hold.current.y,
              ) > 10
            )
              cancelHold();
          }}
          onPointerCancel={cancelHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onContextMenu={(event) => {
            if (!(event.target instanceof HTMLImageElement)) return;
            event.preventDefault();
            if (mayDownload) {
              cancelHold();
              openedByHold.current = true;
              setDownloadOpen(true);
            }
          }}
          onClick={(event) => {
            if (openedByHold.current) {
              openedByHold.current = false;
              return;
            }
            if (event.target instanceof HTMLImageElement)
              changeZoom(
                (levelRef.current + 1) % scales.length,
                event.clientX,
                event.clientY,
              );
          }}
        >
          {children}
        </div>
      </div>
      {mayDownload && (
        <div className="kino-photo-download">
          <button
            type="button"
            aria-label="下載這張照片"
            title="下載這張照片"
            aria-expanded={downloadOpen}
            onClick={() => setDownloadOpen((open) => !open)}
          >
            <StudioIcon name="download" width={21} height={21} />
          </button>
          {downloadOpen && (
            <div
              className="kino-photo-download-options"
              role="group"
              aria-label="下載畫質"
            >
              {downloads?.preview && (
                <a
                  download
                  href={downloads.preview}
                  onClick={() => setDownloadOpen(false)}
                >
                  縮圖
                </a>
              )}
              {downloads?.original && (
                <a
                  download
                  href={downloads.original}
                  onClick={() => setDownloadOpen(false)}
                >
                  原始畫質
                </a>
              )}
            </div>
          )}
        </div>
      )}
      <div
        className="kino-photo-zoom-controls"
        role="group"
        aria-label="照片縮放"
      >
        <button
          type="button"
          aria-label="縮小照片"
          title="縮小照片"
          disabled={level === 0}
          onClick={() => changeZoom(Math.max(0, levelRef.current - 1))}
        >
          −
        </button>
        <button
          type="button"
          aria-label="重設照片縮放"
          title="重設照片縮放"
          onClick={() => changeZoom(0)}
        >
          {[100, 150, 200][level]}%
        </button>
        <button
          type="button"
          aria-label="放大照片"
          title="放大照片"
          disabled={level === 2}
          onClick={() => changeZoom(Math.min(2, levelRef.current + 1))}
        >
          ＋
        </button>
      </div>
    </div>
  );
}
