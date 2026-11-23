import type { GalleryPhoto } from '../../../packages/contracts/src/gallery';

export type GallerySort = 'newest' | 'oldest' | 'filename';
const filenameOrder = new Intl.Collator('zh-TW', { numeric: true });

export function sortGalleryPhotos(photos: GalleryPhoto[], sort: GallerySort) {
  return [...photos].sort((left, right) => {
    const pinned =
      Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned));
    if (pinned) return pinned;
    if (sort === 'filename')
      return filenameOrder.compare(left.filename, right.filename);
    const chronological = left.createdAt.localeCompare(right.createdAt);
    return sort === 'oldest' ? chronological : -chronological;
  });
}

export function GallerySortSelect({
  value,
  onChange,
}: {
  value: GallerySort;
  onChange: (sort: GallerySort) => void;
}) {
  return (
    <select
      aria-label="排序已載入照片"
      title="排序已載入照片"
      value={value}
      onChange={(event) => {
        const sort = event.currentTarget.value;
        if (sort === 'newest' || sort === 'oldest' || sort === 'filename')
          onChange(sort);
      }}
      className="rounded-md border border-stone-300 bg-white px-2 py-2 text-sm text-stone-700"
    >
      <option value="newest">最近上傳</option>
      <option value="oldest">最早上傳</option>
      <option value="filename">檔名</option>
    </select>
  );
}
