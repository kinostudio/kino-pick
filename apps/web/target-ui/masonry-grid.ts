import { useLayoutEffect } from 'react';

/** Grid row unit in px; must match `grid-auto-rows` on `.gallery-masonry`. */
const MASONRY_ROW_PX = 4;

/**
 * Packs a `.gallery-masonry` grid. The column count comes from CSS
 * (`repeat(auto-fill, minmax(...))`), so it follows the container width; this
 * hook only sets each card's row span from its measured height (plus its
 * bottom margin as the vertical gap). DOM order stays the photo order.
 */
export function useMasonryGrid(list: HTMLElement | null, enabled: boolean) {
  useLayoutEffect(() => {
    if (!list || !enabled || typeof ResizeObserver === 'undefined') return;
    const place = (item: HTMLElement) => {
      const gap = parseFloat(getComputedStyle(item).marginBottom) || 0;
      const height = item.getBoundingClientRect().height;
      item.style.gridRowEnd = `span ${Math.max(1, Math.ceil((height + gap) / MASONRY_ROW_PX))}`;
    };
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) place(entry.target as HTMLElement);
    });
    const observeAll = () => {
      for (const child of Array.from(list.children)) {
        if (child instanceof HTMLElement) {
          place(child);
          resize.observe(child);
        }
      }
    };
    observeAll();
    const mutations = new MutationObserver(() => {
      resize.disconnect();
      observeAll();
    });
    mutations.observe(list, { childList: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
      for (const child of Array.from(list.children))
        if (child instanceof HTMLElement) child.style.gridRowEnd = '';
    };
  }, [list, enabled]);
}
