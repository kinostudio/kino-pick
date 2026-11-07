import { describe, expect, it } from 'vitest';
import { photoFilmstripWindow } from '../../apps/web/target-ui/photo-filmstrip';

const photos = Array.from({ length: 10 }, (_, index) => `photo-${index}`);

describe('photo filmstrip window', () => {
  it('shows the active photo when capacity is one', () => {
    expect(photoFilmstripWindow(photos, 5, 1)).toEqual([
      { photo: 'photo-5', index: 5 },
    ]);
  });

  it('uses the full measured capacity and centers the active photo', () => {
    expect(
      photoFilmstripWindow(photos, 5, 6).map(({ index }) => index),
    ).toEqual([3, 4, 5, 6, 7, 8]);
    expect(
      photoFilmstripWindow(photos, 5, 21).map(({ index }) => index),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('shows every photo in a small album that fits', () => {
    expect(photoFilmstripWindow(photos.slice(0, 4), 2, 6)).toEqual([
      { photo: 'photo-0', index: 0 },
      { photo: 'photo-1', index: 1 },
      { photo: 'photo-2', index: 2 },
      { photo: 'photo-3', index: 3 },
    ]);
  });

  it('fills the measured capacity from the available side at either boundary', () => {
    expect(
      photoFilmstripWindow(photos, 0, 6).map(({ index }) => index),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(
      photoFilmstripWindow(photos, 9, 6).map(({ index }) => index),
    ).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('does not mutate photos and treats invalid inputs safely', () => {
    const original = [...photos];
    expect(
      photoFilmstripWindow(photos, 5, 0).map(({ index }) => index),
    ).toEqual([5]);
    expect(
      photoFilmstripWindow(photos, 5, Number.NaN).map(({ index }) => index),
    ).toEqual([5]);
    expect(photoFilmstripWindow(photos, -1, 6)).toEqual([]);
    expect(photoFilmstripWindow(photos, photos.length, 6)).toEqual([]);
    expect(photoFilmstripWindow(photos, 1.5, 6)).toEqual([]);
    expect(photoFilmstripWindow([], 0, 6)).toEqual([]);
    expect(photos).toEqual(original);
  });
});
