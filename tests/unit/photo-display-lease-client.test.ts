import { describe, expect, it } from 'vitest';
import {
  isPhotoDisplayLeaseCurrent,
  photoDisplayLeaseRemaining,
} from '../../apps/web/target-ui/photo-display-lease-client';

describe('photo display lease clock window', () => {
  it('expires from request start on either clock', () => {
    const lease = {
      startedAtWall: 10_000,
      startedAtPerformance: 5_000,
      displayForMs: 600_000,
    };
    expect(isPhotoDisplayLeaseCurrent(lease, 609_999, 604_999)).toBe(true);
    expect(photoDisplayLeaseRemaining(lease, 609_999, 604_999)).toBe(1);
    expect(isPhotoDisplayLeaseCurrent(lease, 610_000, 605_000)).toBe(false);
  });

  it('fails closed after clock jumps or sleep disagreement', () => {
    const lease = {
      startedAtWall: 10_000,
      startedAtPerformance: 5_000,
      displayForMs: 600_000,
    };
    expect(isPhotoDisplayLeaseCurrent(lease, 20_000, 5_100)).toBe(false);
    expect(isPhotoDisplayLeaseCurrent(lease, 20_000, 5_000)).toBe(false);
    expect(photoDisplayLeaseRemaining(lease, 20_000, 5_000)).toBe(0);
  });
});
