import { describe, expect, it } from 'vitest';
import {
  photoZoomAnchoredOffset,
  photoZoomLevelAfterWheel,
} from '../../apps/web/target-ui/photo-zoom';

describe('photo zoom wheel levels', () => {
  it('steps between 100%, 150%, and 200% without passing the ends', () => {
    expect(photoZoomLevelAfterWheel(0, -1)).toBe(1);
    expect(photoZoomLevelAfterWheel(1, -1)).toBe(2);
    expect(photoZoomLevelAfterWheel(2, -1)).toBe(2);
    expect(photoZoomLevelAfterWheel(2, 1)).toBe(1);
    expect(photoZoomLevelAfterWheel(1, 1)).toBe(0);
    expect(photoZoomLevelAfterWheel(0, 1)).toBe(0);
  });

  it('keeps the cursor point fixed when zooming and after panning', () => {
    expect(photoZoomAnchoredOffset(0, 240, 800, 1200)).toBe(120);
    const enlarged = photoZoomAnchoredOffset(180, 340, 1200, 1600);
    expect((enlarged + 340) / 1600).toBeCloseTo((180 + 340) / 1200);
    expect(photoZoomAnchoredOffset(enlarged, 340, 1600, 1200)).toBeCloseTo(180);
    expect(photoZoomAnchoredOffset(0, 200, 1200, 800)).toBe(0);
    expect(photoZoomAnchoredOffset(0, 200, 0, 800)).toBe(0);
  });
});
