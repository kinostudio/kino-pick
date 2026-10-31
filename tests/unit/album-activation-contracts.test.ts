import { describe, expect, it } from 'vitest';
import { activateAlbumSchema } from '../../packages/contracts/src/album-activation';

describe('album activation contract', () => {
  it('normalizes request UUIDs and requires explicit confirmation', () => {
    const requestId = 'ABCDEFAB-1234-4234-8234-ABCDEFABCDEF';
    expect(
      activateAlbumSchema.parse({
        requestId,
        expectedRevision: 1,
        confirmActivate: true,
      }),
    ).toEqual({
      requestId: requestId.toLowerCase(),
      expectedRevision: 1,
      confirmActivate: true,
    });
    expect(() =>
      activateAlbumSchema.parse({
        requestId,
        expectedRevision: 1,
        confirmActivate: false,
      }),
    ).toThrow();
  });

  it('caps revisions before the signed SQLite integer boundary', () => {
    expect(
      activateAlbumSchema.parse({
        requestId: 'abcdefab-1234-4234-8234-abcdefabcdef',
        expectedRevision: 2147483646,
        confirmActivate: true,
      }).expectedRevision,
    ).toBe(2147483646);
    for (const expectedRevision of [0, 2147483647, 2147483648]) {
      expect(() =>
        activateAlbumSchema.parse({
          requestId: 'abcdefab-1234-4234-8234-abcdefabcdef',
          expectedRevision,
          confirmActivate: true,
        }),
      ).toThrow();
    }
  });

  it('rejects extra command fields', () => {
    expect(() =>
      activateAlbumSchema.parse({
        requestId: 'abcdefab-1234-4234-8234-abcdefabcdef',
        expectedRevision: 1,
        confirmActivate: true,
        albumId: 'abcdefab-1234-4234-8234-abcdefabcdef',
      }),
    ).toThrow();
  });
});
