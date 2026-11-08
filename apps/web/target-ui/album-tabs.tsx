import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

type AlbumTab = { id: string; name: string };

export function AlbumTabs({
  albums,
  selectedAlbumId,
  onSelect,
}: {
  albums: readonly AlbumTab[];
  selectedAlbumId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => {
      const active = element.querySelector<HTMLButtonElement>(
        '[aria-current="page"]',
      );
      setPill(
        active ? { left: active.offsetLeft, width: active.offsetWidth } : null,
      );
    };
    measure();
    const active = element.querySelector<HTMLButtonElement>(
      '[aria-current="page"]',
    );
    const scroller = element.parentElement;
    if (active && scroller) {
      const bounds = scroller.getBoundingClientRect();
      const target = active.getBoundingClientRect();
      if (target.left < bounds.left)
        scroller.scrollLeft += target.left - bounds.left;
      else if (target.right > bounds.right)
        scroller.scrollLeft += target.right - bounds.right;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element
      .querySelectorAll('button')
      .forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [albums, selectedAlbumId]);

  const items = [{ id: null, name: '全部相簿' }, ...albums];
  return (
    <nav className="studio-album-tabs" aria-label="切換同專案相簿">
      <div className="studio-album-tabs-track" ref={track}>
        <span
          className="studio-album-tabs-pill"
          aria-hidden="true"
          style={
            {
              '--pill-x': `${pill?.left ?? 0}px`,
              '--pill-width': `${pill?.width ?? 0}px`,
              opacity: pill ? 1 : 0,
            } as CSSProperties
          }
        />
        {items.map((item, index) => (
          <button
            key={item.id ?? 'all'}
            type="button"
            aria-current={selectedAlbumId === item.id ? 'page' : undefined}
            title={item.name}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % items.length
                  : event.key === 'ArrowLeft'
                    ? (index - 1 + items.length) % items.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              const button = track.current?.querySelectorAll('button')[next];
              button?.focus({ preventScroll: true });
              button?.click();
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
    </nav>
  );
}
