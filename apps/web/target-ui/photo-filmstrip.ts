import { useCallback, useEffect, useState } from 'react';

export function photoFilmstripWindow<T>(
  photos: readonly T[],
  activeIndex: number,
  capacity: number,
) {
  if (
    !Number.isInteger(activeIndex) ||
    activeIndex < 0 ||
    activeIndex >= photos.length
  )
    return [];

  const visibleCount =
    Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : 1;
  const count = Math.min(visibleCount, photos.length);
  const start = Math.max(
    0,
    Math.min(activeIndex - Math.floor((count - 1) / 2), photos.length - count),
  );
  return photos
    .slice(start, start + count)
    .map((photo, index) => ({ photo, index: start + index }));
}

export function usePhotoFilmstripWindow<T>(
  photos: readonly T[],
  activeIndex: number,
) {
  const [navElement, setNavElement] = useState<HTMLElement | null>(null);
  const [capacity, setCapacity] = useState(1);
  const navRef = useCallback((element: HTMLElement | null) => {
    setNavElement((current) => (current === element ? current : element));
  }, []);
  const items = photoFilmstripWindow(photos, activeIndex, capacity);
  const firstPhoto = items[0]?.photo;

  useEffect(() => {
    if (!navElement) return;
    const measure = () => {
      const firstThumbnail = navElement.querySelector<HTMLElement>('button');
      const thumbWidth = firstThumbnail
        ? Number.parseFloat(getComputedStyle(firstThumbnail).width)
        : 0;
      const navStyle = getComputedStyle(navElement);
      const pixels = (value: string) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const gap = pixels(navStyle.columnGap);
      const padding =
        pixels(navStyle.paddingLeft) + pixels(navStyle.paddingRight);
      const available = Math.max(0, navElement.clientWidth - padding);
      const nextCapacity =
        thumbWidth > 0
          ? Math.max(1, Math.floor((available + gap) / (thumbWidth + gap)))
          : 1;
      setCapacity((current) =>
        current === nextCapacity ? current : nextCapacity,
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(navElement);
    const firstThumbnail = navElement.querySelector<HTMLElement>('button');
    if (firstThumbnail) observer.observe(firstThumbnail);
    return () => observer.disconnect();
  }, [firstPhoto, navElement]);

  return { navRef, items };
}
