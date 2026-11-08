const DAY_MS = 86_400_000;
const MAX_INACTIVE_DAYS = 36_500;

export type ShareExpiryInput = Readonly<
  | {
      mode: 'custom';
      nowMs: number;
      expiresAtMs: number;
    }
  | {
      mode: 'inherit_album';
      nowMs: number;
      cleanupAllowed: boolean;
      inactiveDays: number;
      activityEvidenceVerified: boolean;
      createdAtMs: number;
      publishedAtMs?: number | null;
      lastValidHumanViewAtMs?: number | null;
    }
>;

export type ShareExpiryResolution =
  | Readonly<{ status: 'deadline'; expiresAtMs: number | null }>
  | Readonly<{ status: 'unavailable' }>;

export type GuestSessionExpiryResolution =
  | Readonly<{ status: 'deadline'; expiresAtMs: number }>
  | Readonly<{ status: 'expired' }>
  | Readonly<{ status: 'unavailable' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEpochMs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Number.isFinite(new Date(value).getTime())
  );
}

/** Null means no idle deadline, not authorization; callers still check scope, session and revocation. */
export function calculateShareExpiry(
  input: ShareExpiryInput,
): ShareExpiryResolution {
  if (!isRecord(input) || !isEpochMs(input.nowMs))
    return { status: 'unavailable' };

  if (input.mode === 'custom')
    return isEpochMs(input.expiresAtMs)
      ? { status: 'deadline', expiresAtMs: input.expiresAtMs }
      : { status: 'unavailable' };

  if (
    input.mode !== 'inherit_album' ||
    typeof input.cleanupAllowed !== 'boolean' ||
    !isEpochMs(input.inactiveDays) ||
    input.inactiveDays < 1 ||
    input.inactiveDays > MAX_INACTIVE_DAYS
  )
    return { status: 'unavailable' };
  if (!input.cleanupAllowed) return { status: 'deadline', expiresAtMs: null };
  if (input.activityEvidenceVerified !== true || !isEpochMs(input.createdAtMs))
    return { status: 'unavailable' };

  const activityTimes = [input.createdAtMs];
  for (const timestamp of [input.publishedAtMs, input.lastValidHumanViewAtMs]) {
    if (timestamp !== undefined && timestamp !== null) {
      if (!isEpochMs(timestamp)) return { status: 'unavailable' };
      activityTimes.push(timestamp);
    }
  }
  if (activityTimes.some((timestamp) => timestamp > input.nowMs))
    return { status: 'unavailable' };

  const expiresAtMs = Math.max(...activityTimes) + input.inactiveDays * DAY_MS;
  return isEpochMs(expiresAtMs)
    ? { status: 'deadline', expiresAtMs }
    : { status: 'unavailable' };
}

export function calculateGuestSessionExpiry(
  nowMs: number,
  resolution: ShareExpiryResolution,
): GuestSessionExpiryResolution {
  if (!isEpochMs(nowMs) || !isRecord(resolution))
    return { status: 'unavailable' };
  if (resolution.status === 'unavailable') return { status: 'unavailable' };
  if (resolution.status !== 'deadline') return { status: 'unavailable' };

  const shareExpiresAtMs = resolution.expiresAtMs;
  if (shareExpiresAtMs !== null && !isEpochMs(shareExpiresAtMs))
    return { status: 'unavailable' };
  if (shareExpiresAtMs !== null && shareExpiresAtMs <= nowMs)
    return { status: 'expired' };

  const sessionLimitMs = nowMs + DAY_MS;
  if (!isEpochMs(sessionLimitMs)) return { status: 'unavailable' };

  return {
    status: 'deadline',
    expiresAtMs:
      shareExpiresAtMs === null
        ? sessionLimitMs
        : Math.min(sessionLimitMs, shareExpiresAtMs),
  };
}
