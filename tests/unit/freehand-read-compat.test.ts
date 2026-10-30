import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_CLIENT_UPGRADE_REQUIRED,
  decideAnnotationReadCompatibility,
  parseAnnotationReadCapabilities,
  preflightFreehandAnnotationRead,
  supportsFreehandAnnotationRead,
  type FreehandAnnotationReadPreflight,
} from '../../apps/worker/src/freehand-read-compat';

const authorizedWithFreehand: FreehandAnnotationReadPreflight = {
  kind: 'authorized',
  scopeKind: 'guest-own',
  containsFreehand: true,
  watermarks: { guest: 7 },
};

describe('freehand annotation read compatibility', () => {
  it('treats missing and unknown capability headers as legacy clients', () => {
    expect(supportsFreehandAnnotationRead(null)).toBe(false);
    expect(supportsFreehandAnnotationRead(undefined)).toBe(false);
    expect(supportsFreehandAnnotationRead('point-rectangle-v1')).toBe(false);
    expect(supportsFreehandAnnotationRead('freehand-v10')).toBe(false);
  });

  it('parses exact comma-separated capability tokens', () => {
    expect(
      parseAnnotationReadCapabilities('freehand-v1').has('freehand-v1'),
    ).toBe(true);
    expect(
      supportsFreehandAnnotationRead('point-rectangle-v1, freehand-v1'),
    ).toBe(true);
    expect(supportsFreehandAnnotationRead('freehand-v1, freehand-v1')).toBe(
      true,
    );
  });

  it('fails closed on malformed or oversized capability headers', () => {
    expect(supportsFreehandAnnotationRead('freehand v1,freehand-v1')).toBe(
      false,
    );
    expect(supportsFreehandAnnotationRead('freehand-v1,,other')).toBe(false);
    expect(supportsFreehandAnnotationRead('x'.repeat(257))).toBe(false);
    expect(
      supportsFreehandAnnotationRead(
        Array.from({ length: 17 }, () => 'other').join(','),
      ),
    ).toBe(false);
  });

  it('requires an upgrade only for an authorized legacy feed with freehand', () => {
    expect(
      decideAnnotationReadCompatibility(false, authorizedWithFreehand),
    ).toEqual({
      kind: 'upgrade-required',
      code: ANNOTATION_CLIENT_UPGRADE_REQUIRED,
    });
    expect(
      decideAnnotationReadCompatibility(true, authorizedWithFreehand),
    ).toEqual({ kind: 'compatible' });
    expect(
      decideAnnotationReadCompatibility(false, {
        kind: 'authorized',
        scopeKind: 'guest-shared',
        containsFreehand: false,
        watermarks: { guest: 0, owner: 0, processing: 0 },
      }),
    ).toEqual({ kind: 'compatible' });
  });

  it('does not expose a freehand boolean when authorization is denied', async () => {
    const db = {
      prepare: () => {
        throw new Error('invalid scope must not issue SQL');
      },
    } as unknown as D1Database;
    const result = await preflightFreehandAnnotationRead(db, {
      kind: 'guest-own',
      secretHash: 'not-a-secret-hash',
      albumId: '44444444-4444-4444-8444-444444444444',
      photoId: '66666666-6666-4666-8666-666666666666',
      versionId: '77777777-7777-4777-8777-777777777777',
    });
    expect(result).toEqual({ kind: 'denied' });
    expect(decideAnnotationReadCompatibility(false, result)).toEqual({
      kind: 'denied',
    });
  });
});
