import { describe, expect, it } from 'vitest';
import {
  guestRatingRequestSchema,
  guestFavoriteRequestSchema,
  guestFeedbackPhotoIdsSchema,
} from '../../packages/contracts/src/guest-feedback';

const photo = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';

describe('Guest feedback input boundaries', () => {
  it('permits exact integer ratings and an explicit clear', () => {
    for (const stars of [1, 2, 3, 4, 5, null])
      expect(
        guestRatingRequestSchema.parse({ requestId, versionId, stars }).stars,
      ).toBe(stars);
    for (const stars of [0, 6, 1.5, '5', false, undefined])
      expect(
        guestRatingRequestSchema.safeParse({ requestId, versionId, stars })
          .success,
      ).toBe(false);
  });

  it('rejects forged scope and non-boolean favorite values', () => {
    for (const favored of [true, false])
      expect(
        guestFavoriteRequestSchema.parse({ requestId, versionId, favored })
          .favored,
      ).toBe(favored);
    for (const favored of [0, 1, 'true', null, undefined])
      expect(
        guestFavoriteRequestSchema.safeParse({ requestId, versionId, favored })
          .success,
      ).toBe(false);
    expect(
      guestRatingRequestSchema.safeParse({
        requestId,
        versionId,
        stars: 3,
        guestId: photo,
      }).success,
    ).toBe(false);
    expect(
      guestFavoriteRequestSchema.safeParse({
        requestId,
        versionId,
        favored: true,
        workspaceId: photo,
      }).success,
    ).toBe(false);
  });

  it('bounds batch reads and refuses duplicate or malformed targets', () => {
    expect(guestFeedbackPhotoIdsSchema.parse([photo])).toEqual([photo]);
    for (const values of [
      [],
      [photo, photo],
      ['invalid'],
      Array.from({ length: 25 }, () => photo),
    ])
      expect(guestFeedbackPhotoIdsSchema.safeParse(values).success).toBe(false);
  });
});
