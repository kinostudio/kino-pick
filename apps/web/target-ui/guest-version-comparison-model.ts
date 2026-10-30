import type { GuestPhotoVersion } from '../../../packages/contracts/src/guest-versions';

export type GuestVersionSelection = {
  beforeVersionId: string | null;
  afterVersionId: string | null;
};

export type GuestVersionSelectionSlot = 'before' | 'after';

function sameVersionSnapshot(
  left: GuestPhotoVersion,
  right: GuestPhotoVersion,
): boolean {
  return (
    left.versionId === right.versionId &&
    left.versionNo === right.versionNo &&
    left.createdByLabel === right.createdByLabel &&
    left.labels.length === right.labels.length &&
    left.labels.every((label, index) => label === right.labels[index]) &&
    left.width === right.width &&
    left.height === right.height &&
    left.createdAt === right.createdAt &&
    left.isCurrent === right.isCurrent &&
    left.thumbnailUrl === right.thumbnailUrl &&
    left.previewUrl === right.previewUrl
  );
}

/** Merge the separately pinned current head with descending history pages. */
export function mergeGuestPhotoVersions(
  pinnedCurrent: GuestPhotoVersion | null,
  items: readonly GuestPhotoVersion[],
): GuestPhotoVersion[] | null {
  const byId = new Map<string, GuestPhotoVersion>();
  const byVersionNo = new Map<number, string>();

  for (const item of pinnedCurrent ? [pinnedCurrent, ...items] : items) {
    const existing = byId.get(item.versionId);
    if (existing && !sameVersionSnapshot(existing, item)) return null;

    const existingIdForNumber = byVersionNo.get(item.versionNo);
    if (existingIdForNumber && existingIdForNumber !== item.versionId) {
      return null;
    }

    byId.set(item.versionId, item);
    byVersionNo.set(item.versionNo, item.versionId);
  }

  return [...byId.values()].sort(
    (left, right) => right.versionNo - left.versionNo,
  );
}

/** Pin After to the server-authorized head, even when history has not loaded it. */
export function createInitialGuestVersionSelection(
  versions: readonly GuestPhotoVersion[],
  headVersionId: string,
): GuestVersionSelection {
  const beforeVersion = versions
    .filter((version) => version.versionId !== headVersionId)
    .reduce<GuestPhotoVersion | null>(
      (highest, version) =>
        highest === null || version.versionNo > highest.versionNo
          ? version
          : highest,
      null,
    );

  return {
    beforeVersionId: beforeVersion?.versionId ?? null,
    afterVersionId: headVersionId,
  };
}

/** Selector changes must use loaded IDs and keep the two sides distinct. */
export function selectLoadedGuestVersion(
  selection: GuestVersionSelection,
  slot: GuestVersionSelectionSlot,
  candidateVersionId: string,
  loadedVersions: readonly GuestPhotoVersion[],
): GuestVersionSelection {
  if (
    !loadedVersions.some((version) => version.versionId === candidateVersionId)
  ) {
    return selection;
  }

  const otherVersionId =
    slot === 'before' ? selection.afterVersionId : selection.beforeVersionId;
  if (candidateVersionId === otherVersionId) return selection;

  if (slot === 'before') {
    return { ...selection, beforeVersionId: candidateVersionId };
  }
  return { ...selection, afterVersionId: candidateVersionId };
}
