import { describe, expect, it } from 'vitest';
import type { FreehandStroke } from '../../packages/contracts/src/freehand-stroke.ts';
import {
  canShowGuestFreehandControl,
  draftWithGuestFreehandStroke,
  guestAnnotationReadHeaders,
  isGuestAnnotationCommandConflict,
  isGuestAnnotationReadUpgradeRequired,
  shouldDiscardGuestFreehandDraft,
} from '../../apps/web/target-ui/guest-annotations.tsx';

const point = {
  type: 'point',
  coordinateSpace: 'normalized_1e6',
  x: 125_000,
  y: 250_000,
} as const;

const stroke: FreehandStroke = {
  geometry: {
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points: [
      { x: 100_000, y: 200_000 },
      { x: 400_000, y: 800_000 },
    ],
  },
  style: { color: 'blue' },
} as const;

describe('Guest freehand editor wiring', () => {
  it('requires independent read and write capabilities before showing the brush', () => {
    expect(canShowGuestFreehandControl(undefined, true, true)).toBe(false);
    expect(canShowGuestFreehandControl(true, true, undefined)).toBe(false);
    expect(canShowGuestFreehandControl(false, true, true)).toBe(false);
    expect(canShowGuestFreehandControl(true, false, true)).toBe(false);
    expect(canShowGuestFreehandControl(true, true, true)).toBe(true);
  });

  it('advertises freehand reads only when the Guest read gate is enabled', () => {
    expect(guestAnnotationReadHeaders(false)).toEqual({});
    expect(guestAnnotationReadHeaders(true)).toEqual({
      'X-Kino-Annotation-Read-Capabilities': 'freehand-v1',
    });
    expect(
      isGuestAnnotationReadUpgradeRequired(
        426,
        'ANNOTATION_CLIENT_UPGRADE_REQUIRED',
      ),
    ).toBe(true);
    expect(
      isGuestAnnotationReadUpgradeRequired(
        426,
        'FREEHAND_ANNOTATIONS_DISABLED',
      ),
    ).toBe(false);
  });

  it('keeps a disabled freehand write retryable instead of treating it as a conflict', () => {
    expect(
      isGuestAnnotationCommandConflict(409, 'FREEHAND_ANNOTATIONS_DISABLED'),
    ).toBe(false);
    expect(
      isGuestAnnotationCommandConflict(409, 'ANNOTATION_REVISION_CONFLICT'),
    ).toBe(true);
    expect(
      isGuestAnnotationCommandConflict(503, 'ANNOTATION_REVISION_CONFLICT'),
    ).toBe(false);
  });

  it('discards only an unsaved freehand draft when its capability is revoked', () => {
    expect(shouldDiscardGuestFreehandDraft(true, false, stroke.geometry)).toBe(
      true,
    );
    expect(
      shouldDiscardGuestFreehandDraft(true, undefined, stroke.geometry),
    ).toBe(true);
    expect(shouldDiscardGuestFreehandDraft(true, false, point)).toBe(false);
    expect(shouldDiscardGuestFreehandDraft(true, true, stroke.geometry)).toBe(
      false,
    );
  });

  it('replaces geometry while preserving an existing Guest edit identity', () => {
    const expectedCurrent = {
      revision: 4,
      state: 'open' as const,
      geometry: point,
      style: { color: 'amber' as const },
      commentId: null,
    };
    const current = {
      geometry: point,
      color: 'amber' as const,
      annotationId: '55555555-5555-4555-8555-555555555555',
      expectedCurrent,
    };

    expect(draftWithGuestFreehandStroke(current, stroke)).toEqual({
      geometry: stroke.geometry,
      color: 'blue',
      annotationId: current.annotationId,
      expectedCurrent,
    });
  });

  it('starts a new stroke draft without inventing an annotation or image payload', () => {
    expect(draftWithGuestFreehandStroke(null, stroke)).toEqual({
      geometry: stroke.geometry,
      color: 'blue',
      annotationId: null,
      expectedCurrent: null,
    });
    expect(
      JSON.stringify(draftWithGuestFreehandStroke(null, stroke)),
    ).not.toContain('data:image');
  });
});
