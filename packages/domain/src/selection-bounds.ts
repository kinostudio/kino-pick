export function planSelectionBatch<T extends { id: string; versionId: string }>(
  photos: readonly T[],
  selected: ReadonlyMap<string, string>,
  selectedCount: number,
  maximum: number | null,
): T[] {
  let remaining =
    maximum === null ? Infinity : Math.max(0, maximum - selectedCount);
  return photos.filter((photo) => {
    if (selected.get(photo.id) === photo.versionId) return false;
    if (selected.has(photo.id)) return true;
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  });
}
