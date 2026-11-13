import { describe, expect, it } from 'vitest';
import {
  humanViewCapabilitiesSchema,
  humanViewRequestSchema,
  humanViewResultSchema,
} from '../../packages/contracts/src/human-views';
import {
  configuration,
  humanViewsCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import {
  OWNER_HISTORY_PROJECTED_ACTIONS,
  projectOwnerHistoryDetails,
} from '../../apps/worker/src/owner-history-projection';

const id = () => crypto.randomUUID();

function env(mode: 'local' | 'staging' | 'production'): WorkerEnv {
  return {
    APP_ENV: mode,
    APP_URL:
      mode === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  } as WorkerEnv;
}

function request() {
  return {
    photoId: id(),
    versionId: id(),
    expectedActorId: id(),
    visibleForMs: 1_000,
  };
}

describe('Human-view contracts', () => {
  it('strictly accepts the exact heartbeat request shape', () => {
    const valid = request();
    expect(humanViewRequestSchema.parse(valid)).toEqual(valid);
    expect(
      humanViewRequestSchema.safeParse({ ...valid, extra: 'ignored?' }).success,
    ).toBe(false);
    expect(
      humanViewRequestSchema.safeParse({ ...valid, photoId: 'not-a-uuid' })
        .success,
    ).toBe(false);
  });

  it('bounds visible duration to whole milliseconds from 1 to 60 seconds', () => {
    for (const visibleForMs of [1_000, 60_000]) {
      expect(
        humanViewRequestSchema.safeParse({ ...request(), visibleForMs })
          .success,
      ).toBe(true);
    }
    for (const visibleForMs of [999, 60_001, 1_000.5]) {
      expect(
        humanViewRequestSchema.safeParse({ ...request(), visibleForMs })
          .success,
      ).toBe(false);
    }
  });

  it('requires a strict UTC result and exact fixed capability values', () => {
    const result = {
      recorded: false,
      nextAllowedAt: '2026-10-29T12:05:00.000Z',
    };
    expect(humanViewResultSchema.safeParse(result).success).toBe(true);
    expect(
      humanViewResultSchema.safeParse({
        ...result,
        nextAllowedAt: '2026-10-29T12:05:00+08:00',
      }).success,
    ).toBe(false);
    expect(
      humanViewResultSchema.safeParse({ ...result, internal: 'secret' })
        .success,
    ).toBe(false);

    expect(
      humanViewCapabilitiesSchema.safeParse({
        enabled: true,
        minVisibleMs: 1_000,
        dedupeMs: 300_000,
      }).success,
    ).toBe(true);
    expect(
      humanViewCapabilitiesSchema.safeParse({
        enabled: true,
        minVisibleMs: 999,
        dedupeMs: 300_000,
      }).success,
    ).toBe(false);
    expect(
      humanViewCapabilitiesSchema.safeParse({
        enabled: true,
        minVisibleMs: 1_000,
        dedupeMs: 300_000,
        actorId: id(),
      }).success,
    ).toBe(false);
  });
});

describe('Human-view feature gate', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (mode) => {
      expect(configuration(env(mode)).HUMAN_VIEW_TRACKING_ENABLED).toBe(
        'false',
      );
      expect(humanViewsCapability(env(mode))).toBe(false);
    },
  );

  it('enables only from its own local flag', () => {
    expect(
      humanViewsCapability({
        ...env('local'),
        HUMAN_VIEW_TRACKING_ENABLED: 'true',
      }),
    ).toBe(true);
    expect(
      humanViewsCapability({
        ...env('local'),
        HUMAN_VIEW_TRACKING_ENABLED: 'true',
        GUEST_SELECTION_ENABLED: 'false',
        OWNER_HISTORY_ENABLED: 'false',
      }),
    ).toBe(true);
  });

  it.each(['staging', 'production'] as const)(
    'rejects enabling in %s outside the exact production tuple',
    (mode) => {
      expect(() =>
        configuration({
          ...env(mode),
          HUMAN_VIEW_TRACKING_ENABLED: 'true',
        }),
      ).toThrow('HUMAN_VIEW_TRACKING_LOCAL_ONLY');
    },
  );

  it('rejects malformed flag values', () => {
    expect(() =>
      configuration({
        ...env('local'),
        HUMAN_VIEW_TRACKING_ENABLED: 'TRUE',
      }),
    ).toThrow();
  });
});

describe('Human-view Owner history projection', () => {
  it('allowlists only visible-photo source and duration', () => {
    expect(OWNER_HISTORY_PROJECTED_ACTIONS).toContain('gallery.viewed');
    expect(
      projectOwnerHistoryDetails(
        'gallery.viewed',
        null,
        JSON.stringify({
          source: 'visible_photo',
          visibleForMs: 2_500,
          guestSessionSecret: 'must-not-leak',
        }),
      ),
    ).toEqual({
      status: 'available',
      before: null,
      after: { source: 'visible_photo', visibleForMs: 2_500 },
    });
  });
});
