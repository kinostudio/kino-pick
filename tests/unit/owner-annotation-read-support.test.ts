import { describe, expect, it } from 'vitest';
import {
  OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED,
  OWNER_ANNOTATION_READ_CAPABILITIES_HEADER,
  OWNER_FREEHAND_ANNOTATION_READ_CAPABILITY,
  OWNER_FREEHAND_ANNOTATIONS_DISABLED,
  isOwnerAnnotationUpgradeRequired,
  isOwnerFreehandWriteDisabled,
  ownerAnnotationReadCapabilityHeaders,
} from '../../apps/web/target-ui/owner-annotation-read-support.ts';

describe('Owner annotation read capability', () => {
  it('is opt-in and advertises only the supported freehand version', () => {
    expect(ownerAnnotationReadCapabilityHeaders(false)).toEqual({});
    expect(ownerAnnotationReadCapabilityHeaders(true)).toEqual({
      [OWNER_ANNOTATION_READ_CAPABILITIES_HEADER]:
        OWNER_FREEHAND_ANNOTATION_READ_CAPABILITY,
    });
  });

  it('recognizes only the explicit upgrade-required 426 response', () => {
    expect(
      isOwnerAnnotationUpgradeRequired({
        statusCode: 426,
        code: OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED,
      }),
    ).toBe(true);
    expect(
      isOwnerAnnotationUpgradeRequired({
        statusCode: 426,
        code: 'OTHER_ERROR',
      }),
    ).toBe(false);
    expect(
      isOwnerAnnotationUpgradeRequired({
        statusCode: 409,
        code: OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED,
      }),
    ).toBe(false);
  });

  it('keeps the disabled freehand writer gate separate from revision conflicts', () => {
    expect(
      isOwnerFreehandWriteDisabled({
        statusCode: 409,
        code: OWNER_FREEHAND_ANNOTATIONS_DISABLED,
      }),
    ).toBe(true);
    expect(
      isOwnerFreehandWriteDisabled({
        statusCode: 409,
        code: 'ANNOTATION_REVISION_CONFLICT',
      }),
    ).toBe(false);
  });
});
