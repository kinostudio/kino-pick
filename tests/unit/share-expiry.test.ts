import { describe, expect, it } from 'vitest';
import {
  calculateGuestSessionExpiry,
  calculateShareExpiry,
  type ShareExpiryInput,
  type ShareExpiryResolution,
} from '../../packages/domain/src/index';

const DAY_MS = 86_400_000;
const nowMs = Date.UTC(2026, 10, 9);
type InheritedShareExpiryInput = Extract<
  ShareExpiryInput,
  { mode: 'inherit_album' }
>;

function inherited(
  overrides: {
    [K in keyof InheritedShareExpiryInput]?:
      InheritedShareExpiryInput[K] | undefined;
  } = {},
) {
  return {
    mode: 'inherit_album',
    nowMs,
    cleanupAllowed: true,
    inactiveDays: 90,
    activityEvidenceVerified: true,
    createdAtMs: nowMs - DAY_MS * 100,
    ...overrides,
  } as ShareExpiryInput;
}

describe('share expiry', () => {
  it.each([
    [
      'keeps inherited links without an idle deadline when cleanup is off',
      inherited({ cleanupAllowed: false }),
      { status: 'deadline', expiresAtMs: null },
    ],
    [
      'keeps OFF when activity is unverified',
      inherited({ cleanupAllowed: false, activityEvidenceVerified: false }),
      { status: 'deadline', expiresAtMs: null },
    ],
    [
      'keeps OFF when activity timestamps are missing',
      inherited({ cleanupAllowed: false, createdAtMs: undefined }),
      { status: 'deadline', expiresAtMs: null },
    ],
    [
      'keeps OFF when an activity timestamp is in the future',
      inherited({ cleanupAllowed: false, publishedAtMs: nowMs + 1 }),
      { status: 'deadline', expiresAtMs: null },
    ],
    [
      'keeps a custom deadline independent of album cleanup evidence',
      { mode: 'custom', nowMs, expiresAtMs: nowMs + DAY_MS },
      { status: 'deadline', expiresAtMs: nowMs + DAY_MS },
    ],
    [
      'preserves an already-past custom deadline for the caller to reject',
      { mode: 'custom', nowMs, expiresAtMs: nowMs - 1 },
      { status: 'deadline', expiresAtMs: nowMs - 1 },
    ],
  ])('%s', (_name, input, expected) => {
    expect(calculateShareExpiry(input as ShareExpiryInput)).toEqual(expected);
  });

  it.each([
    [
      'uses creation when publication and valid view are missing',
      { publishedAtMs: null, lastValidHumanViewAtMs: undefined },
      nowMs - DAY_MS * 10,
    ],
    [
      'uses the latest verified album activity',
      {
        publishedAtMs: nowMs - DAY_MS * 40,
        lastValidHumanViewAtMs: nowMs - DAY_MS * 5,
      },
      nowMs - DAY_MS * 5,
    ],
  ])('%s', (_name, activity, baselineMs) => {
    const result = calculateShareExpiry(
      inherited({ ...activity, createdAtMs: nowMs - DAY_MS * 10 }),
    );
    expect(result).toEqual({
      status: 'deadline',
      expiresAtMs: baselineMs + DAY_MS * 90,
    });
  });

  it('expires exactly at the configured 90-day inactivity boundary', () => {
    expect(
      calculateShareExpiry(inherited({ createdAtMs: nowMs - DAY_MS * 90 })),
    ).toEqual({ status: 'deadline', expiresAtMs: nowMs });
  });

  it.each([
    [
      'unverified activity with cleanup on',
      { activityEvidenceVerified: false },
    ],
    ['missing creation evidence with cleanup on', { createdAtMs: undefined }],
    [
      'future publication evidence with cleanup on',
      { publishedAtMs: nowMs + 1 },
    ],
    ['invalid view timestamp', { lastValidHumanViewAtMs: 1.5 }],
    ['missing clock', { nowMs: undefined }],
    [
      'out-of-range clock with cleanup off',
      {
        nowMs: 8_640_000_000_000_001,
        createdAtMs: 8_640_000_000_000_000,
        cleanupAllowed: false,
      },
    ],
    ['invalid inactivity days', { inactiveDays: 36_501 }],
    [
      'deadline overflow',
      {
        nowMs: 8_640_000_000_000_000,
        createdAtMs: 8_640_000_000_000_000,
        inactiveDays: 1,
      },
    ],
  ])('fails closed for %s', (_name, overrides) => {
    expect(calculateShareExpiry(inherited(overrides))).toEqual({
      status: 'unavailable',
    });
  });

  it('fails closed for an unknown mode', () => {
    expect(calculateShareExpiry({ mode: 'unknown', nowMs } as never)).toEqual({
      status: 'unavailable',
    });
  });

  it.each([
    [
      'non-finite custom deadline',
      { mode: 'custom', nowMs, expiresAtMs: Infinity },
    ],
    [
      'custom deadline without a clock',
      { mode: 'custom', expiresAtMs: nowMs + DAY_MS },
    ],
    [
      'custom clock outside Date range',
      {
        mode: 'custom',
        nowMs: 8_640_000_000_000_001,
        expiresAtMs: nowMs + DAY_MS,
      },
    ],
    [
      'custom deadline outside Date range',
      { mode: 'custom', nowMs, expiresAtMs: 8_640_000_000_000_001 },
    ],
  ])('fails closed for %s', (_name, input) => {
    expect(calculateShareExpiry(input as ShareExpiryInput)).toEqual({
      status: 'unavailable',
    });
  });
});

describe('guest session expiry', () => {
  it.each([
    [
      'limits no-expiry shares to 24 hours',
      { status: 'deadline', expiresAtMs: null },
      { status: 'deadline', expiresAtMs: nowMs + DAY_MS },
    ],
    [
      'honors a shorter share deadline',
      { status: 'deadline', expiresAtMs: nowMs + 60_000 },
      { status: 'deadline', expiresAtMs: nowMs + 60_000 },
    ],
    [
      'rejects an expired share instead of reviving it',
      { status: 'deadline', expiresAtMs: nowMs },
      { status: 'expired' },
    ],
    [
      'propagates unavailable share evidence',
      { status: 'unavailable' },
      { status: 'unavailable' },
    ],
  ])('%s', (_name, resolution, expected) => {
    expect(
      calculateGuestSessionExpiry(nowMs, resolution as ShareExpiryResolution),
    ).toEqual(expected);
  });

  it('fails closed if the 24-hour deadline exceeds the supported time range', () => {
    expect(
      calculateGuestSessionExpiry(8_639_999_999_999_999, {
        status: 'deadline',
        expiresAtMs: null,
      }),
    ).toEqual({ status: 'unavailable' });
  });
});
