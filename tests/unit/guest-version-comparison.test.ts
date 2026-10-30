import { describe, expect, it } from 'vitest';
import type { GuestPhotoVersion } from '../../packages/contracts/src/guest-versions';
import {
  createInitialGuestVersionSelection,
  mergeGuestPhotoVersions,
  selectLoadedGuestVersion,
} from '../../apps/web/target-ui/guest-version-comparison-model';

const makeId = (sequence: number) =>
  '00000000-0000-4000-8000-' + String(sequence).padStart(12, '0');

const photoId = makeId(1);
const firstVersionId = makeId(2);
const secondVersionId = makeId(3);
const thirdVersionId = makeId(4);

function makeVersion(
  versionId: string,
  versionNo: number,
  isCurrent = false,
): GuestPhotoVersion {
  return {
    versionId,
    versionNo,
    createdByLabel: '攝影師',
    labels: [],
    width: 2400,
    height: 1600,
    createdAt:
      '2026-10-' + String(versionNo).padStart(2, '0') + 'T12:00:00.000Z',
    isCurrent,
    thumbnailUrl:
      '/api/guest/photos/' +
      photoId +
      '/versions/' +
      versionId +
      '/assets/thumbnail',
    previewUrl:
      '/api/guest/photos/' +
      photoId +
      '/versions/' +
      versionId +
      '/assets/preview',
  };
}

describe('Guest version comparison selection', () => {
  it('pins After to the current head and chooses the highest other loaded Before', () => {
    const versions = [
      makeVersion(firstVersionId, 4),
      makeVersion(secondVersionId, 3),
      makeVersion(thirdVersionId, 2),
    ];

    expect(
      createInitialGuestVersionSelection(versions, thirdVersionId),
    ).toEqual({
      beforeVersionId: firstVersionId,
      afterVersionId: thirdVersionId,
    });
  });

  it('preserves a current head that is not present in the loaded history page', () => {
    const versions = [
      makeVersion(firstVersionId, 9),
      makeVersion(secondVersionId, 8),
    ];

    expect(
      createInitialGuestVersionSelection(versions, thirdVersionId),
    ).toEqual({
      beforeVersionId: firstVersionId,
      afterVersionId: thirdVersionId,
    });
  });

  it('leaves Before empty when only one version is available', () => {
    expect(
      createInitialGuestVersionSelection(
        [makeVersion(firstVersionId, 1, true)],
        firstVersionId,
      ),
    ).toEqual({
      beforeVersionId: null,
      afterVersionId: firstVersionId,
    });
  });

  it('deduplicates matching pinned and paged heads but rejects inconsistent records', () => {
    const current = makeVersion(firstVersionId, 5, true);
    const historical = makeVersion(secondVersionId, 4);

    expect(mergeGuestPhotoVersions(current, [current, historical])).toEqual([
      current,
      historical,
    ]);
    expect(
      mergeGuestPhotoVersions(current, [
        { ...current, previewUrl: '/different-authorized-route' },
      ]),
    ).toBeNull();
    expect(
      mergeGuestPhotoVersions(current, [
        makeVersion(thirdVersionId, current.versionNo),
      ]),
    ).toBeNull();
  });

  it('accepts only loaded distinct IDs for selector changes', () => {
    const versions = [
      makeVersion(firstVersionId, 3),
      makeVersion(secondVersionId, 2),
    ];
    const selection = {
      beforeVersionId: firstVersionId,
      afterVersionId: thirdVersionId,
    };

    expect(
      selectLoadedGuestVersion(selection, 'after', secondVersionId, versions),
    ).toEqual({
      beforeVersionId: firstVersionId,
      afterVersionId: secondVersionId,
    });
    expect(
      selectLoadedGuestVersion(selection, 'after', thirdVersionId, versions),
    ).toBe(selection);
    expect(
      selectLoadedGuestVersion(selection, 'after', firstVersionId, versions),
    ).toBe(selection);
  });
});
