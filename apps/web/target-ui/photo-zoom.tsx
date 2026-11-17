import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

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

export function PhotoZoom({ children }: { children: ReactNode }) {
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
          onClick={(event) => {
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
