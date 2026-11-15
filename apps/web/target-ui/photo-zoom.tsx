import { useState, type ReactNode } from 'react';

export function PhotoZoom({ children }: { children: ReactNode }) {
  const [level, setLevel] = useState(0);
  const scales = [1, 1.5, 2];
  return (
    <div className="kino-photo-zoom">
      <div className="kino-photo-zoom-scroll" data-zoomed={level > 0}>
        <div
          className="kino-photo-zoom-image"
          style={{
            width: `${scales[level]! * 100}%`,
            height: `${scales[level]! * 100}%`,
          }}
          onClick={(event) => {
            if (event.target instanceof HTMLImageElement)
              setLevel((value) => (value + 1) % scales.length);
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
          onClick={() => setLevel((value) => Math.max(0, value - 1))}
        >
          −
        </button>
        <button
          type="button"
          aria-label="重設照片縮放"
          title="重設照片縮放"
          onClick={() => setLevel(0)}
        >
          {[100, 150, 200][level]}%
        </button>
        <button
          type="button"
          aria-label="放大照片"
          title="放大照片"
          disabled={level === 2}
          onClick={() => setLevel((value) => Math.min(2, value + 1))}
        >
          ＋
        </button>
      </div>
    </div>
  );
}
