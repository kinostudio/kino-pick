import { describe, expect, it } from 'vitest';
import {
  defaultRetentionPolicy,
  planRetention,
  type RetentionAlbumEvidence,
  type RetentionPlanInput,
  type RetentionPolicy,
} from '../../packages/domain/src/retention';
import {
  calculateGuestSessionExpiry,
  calculateShareExpiry,
} from '../../packages/domain/src/share-expiry';

const DAY = 86_400_000;
const NOW = '2026-10-29T12:00:00.000Z';
const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IDs = [
  '00000001-0000-4000-8000-000000000001',
  '00000002-0000-4000-8000-000000000002',
  '00000003-0000-4000-8000-000000000003',
  '00000004-0000-4000-8000-000000000004',
] as const;

function ago(days: number, milliseconds = 0): string {
  return new Date(Date.parse(NOW) - days * DAY - milliseconds).toISOString();
}
function idFor(n: number): string {
  const hex = n.toString(16);
  return hex.padStart(8, '0') + '-0000-4000-8000-' + hex.padStart(12, '0');
}
function album(
  albumId: string = IDs[0],
  overrides: Partial<RetentionAlbumEvidence> = {},
): RetentionAlbumEvidence {
  return {
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    albumId,
    createdAt: ago(60),
    publishedAt: null,
    lastValidViewedAt: null,
    activityCoverageStartedAt: ago(120),
    possibleActivityThroughAt: null,
    lastStateChangedAt: null,
    inactiveDays: null,
    latestActiveCustomShareExpiresAt: null,
    shareEvidenceVerified: true,
    bytes: 100,
    assetCount: 2,
    versionCount: 2,
    cleanupAllowed: true,
    pinned: false,
    legalHold: false,
    projectProtected: false,
    retentionExcluded: false,
    preservationRequested: false,
    activeUpload: false,
    activeProcessing: false,
    activeDelivery: false,
    workflowBusy: false,
    hasBlockingReferences: false,
    referencesVerified: true,
    activityEvidenceVerified: true,
    state: 'archived',
    ...overrides,
  };
}
function policy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    ...defaultRetentionPolicy,
    enabled: true,
    mode: 'retention_only',
    inactiveDays: 30,
    ...overrides,
  };
}
function metrics(
  overrides: Partial<RetentionPlanInput['metrics']> = {},
): RetentionPlanInput['metrics'] {
  return {
    confirmedBytes: 1_000,
    reservedBytes: 0,
    quotaBytes: 10_000,
    healthy: true,
    observedAt: ago(0, 60 * 60_000),
    ...overrides,
  };
}
function input(
  overrides: Partial<RetentionPlanInput> = {},
): RetentionPlanInput {
  return {
    workspaceId: WORKSPACE,
    now: NOW,
    policy: policy(),
    metrics: metrics(),
    albums: [album()],
    inventoryComplete: true,
    ...overrides,
  };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('pure retention planner', () => {
  it('defers cleanup without reviving an expired inherited share', () => {
    const nowMs = Date.parse(NOW);
    const inherited = calculateShareExpiry({
      mode: 'inherit_album',
      nowMs,
      cleanupAllowed: true,
      inactiveDays: 90,
      activityEvidenceVerified: true,
      createdAtMs: Date.parse(ago(100)),
    });
    const plan = planRetention(
      input({
        policy: policy({ mode: 'retention_only', inactiveDays: 90 }),
        albums: [
          album(IDs[0], {
            createdAt: ago(100),
            inactiveDays: 90,
            latestActiveCustomShareExpiresAt: new Date(
              nowMs + DAY,
            ).toISOString(),
          }),
        ],
      }),
    );
    expect(plan.candidateAlbumIds).toEqual([]);
    expect(plan.excluded[0]?.reasons).toContain('active_custom_share');
    expect(inherited).toEqual({
      status: 'deadline',
      expiresAtMs: nowMs - 10 * DAY,
    });
    expect(calculateGuestSessionExpiry(nowMs, inherited)).toEqual({
      status: 'expired',
    });
  });
  it('defaults OFF and returns a dry-run without candidates', () => {
    expect(defaultRetentionPolicy).toEqual({
      enabled: false,
      mode: 'both',
      inactiveDays: 90,
      minAlbumAgeDays: 7,
      triggerBasisPoints: 8000,
      targetBasisPoints: 6500,
      sort: 'oldest',
      maxAlbumsPerRun: 100,
      maxDeleteBytesPerRun: Number.MAX_SAFE_INTEGER,
    });
    expect(Object.isFrozen(defaultRetentionPolicy)).toBe(true);
    const plan = planRetention(input({ policy: defaultRetentionPolicy }));
    expect(plan.dryRun).toBe(true);
    expect(plan.candidateAlbumIds).toEqual([]);
    expect(plan.blockedReasons).toContain('policy_disabled');
    expect(plan.pressureTriggered).toBe(false);
  });

  it('uses the exact 30-day inactivity boundary and rejects 29 days', () => {
    const result = planRetention(
      input({
        policy: policy({ inactiveDays: 30, minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], { lastValidViewedAt: ago(30) }),
          album(IDs[1], { lastValidViewedAt: ago(29) }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([IDs[0]]);
    expect(
      result.excluded.find((item) => item.albumId === IDs[1])?.reasons,
    ).toContain('inactive_period_not_met');
  });

  it('starts idle coverage at cutover instead of treating an old album as idle', () => {
    const result = planRetention(
      input({
        policy: policy({ inactiveDays: 90, minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], {
            createdAt: ago(200),
            lastValidViewedAt: ago(150),
            activityCoverageStartedAt: ago(30),
          }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([]);
    expect(result.excluded[0]?.reasons).toContain('inactive_period_not_met');
  });

  it.each(['pressure_only', 'retention_only'] as const)(
    'blocks %s cleanup while possible activity is inside the 15-minute window',
    (mode) => {
      const result = planRetention(
        input({
          policy: policy({
            mode,
            inactiveDays: 0,
            minAlbumAgeDays: 0,
            triggerBasisPoints: 8000,
            targetBasisPoints: 6500,
          }),
          metrics: metrics({ confirmedBytes: 900, quotaBytes: 1_000 }),
          albums: [
            album(IDs[0], {
              bytes: 100,
              lastValidViewedAt: ago(90),
              possibleActivityThroughAt: ago(0, 14 * 60_000),
            }),
          ],
        }),
      );
      expect(result.candidateAlbumIds).toEqual([]);
      expect(result.excluded[0]?.reasons).toContain('possible_activity');
      if (mode === 'pressure_only') expect(result.pressureTriggered).toBe(true);
    },
  );

  it('lets recent coverage and uncertainty expire at the exact 15-minute boundary', () => {
    const evidence = album(IDs[0], {
      activityCoverageStartedAt: ago(0, 14 * 60_000),
      lastValidViewedAt: ago(60),
    });
    const policyInput = {
      policy: policy({
        mode: 'pressure_only' as const,
        inactiveDays: 0,
        minAlbumAgeDays: 0,
        triggerBasisPoints: 8000,
        targetBasisPoints: 6500,
      }),
      metrics: metrics({ confirmedBytes: 900, quotaBytes: 1_000 }),
      albums: [evidence],
    };
    const recent = planRetention(input(policyInput));
    expect(recent.pressureTriggered).toBe(true);
    expect(recent.candidateAlbumIds).toEqual([]);
    expect(recent.excluded[0]?.reasons).toContain('activity_coverage_recent');

    const expired = planRetention(
      input({
        ...policyInput,
        now: new Date(Date.parse(NOW) + 60_000).toISOString(),
        albums: [
          {
            ...evidence,
            possibleActivityThroughAt: ago(0, 14 * 60_000),
          },
        ],
      }),
    );
    expect(expired.candidateAlbumIds).toEqual([IDs[0]]);
    expect(expired.excluded).toEqual([]);
  });

  it('accepts future possible-activity evidence as uncertainty and keeps human timestamps separate', () => {
    const evidence = deepFreeze(
      album(IDs[0], {
        createdAt: ago(120),
        publishedAt: ago(100),
        lastValidViewedAt: ago(90),
        activityCoverageStartedAt: ago(80),
        possibleActivityThroughAt: new Date(
          Date.parse(NOW) + DAY,
        ).toISOString(),
      }),
    );
    const result = planRetention(
      input({
        policy: policy({ mode: 'pressure_only', minAlbumAgeDays: 0 }),
        metrics: metrics({ confirmedBytes: 900, quotaBytes: 1_000 }),
        albums: [evidence],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([]);
    expect(result.excluded[0]?.reasons).toContain('possible_activity');
    expect(result.candidates).toEqual([]);
    expect(evidence).toMatchObject({
      publishedAt: ago(100),
      lastValidViewedAt: ago(90),
      activityCoverageStartedAt: ago(80),
    });
  });

  it('uses coverage markers for ordering without changing human activity fields', () => {
    const evidence = deepFreeze(
      album(IDs[0], {
        createdAt: ago(120),
        publishedAt: ago(100),
        lastValidViewedAt: ago(90),
        activityCoverageStartedAt: ago(80),
        possibleActivityThroughAt: ago(70),
      }),
    );
    const result = planRetention(
      input({
        policy: policy({ mode: 'pressure_only', minAlbumAgeDays: 0 }),
        metrics: metrics({ confirmedBytes: 900, quotaBytes: 1_000 }),
        albums: [evidence],
      }),
    );
    expect(result.candidates[0]?.lastRelevantActivityAt).toBe(ago(70));
    expect(evidence.publishedAt).toBe(ago(100));
    expect(evidence.lastValidViewedAt).toBe(ago(90));
  });

  it('uses album inactivity overrides and inherits workspace days for null', () => {
    const result = planRetention(
      input({
        policy: policy({ inactiveDays: 30, minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], { inactiveDays: 10, lastValidViewedAt: ago(10) }),
          album(IDs[1], {
            inactiveDays: 10,
            lastValidViewedAt: ago(9, 23 * 60 * 60_000),
          }),
          album(IDs[2], { inactiveDays: null, lastValidViewedAt: ago(30) }),
          album(IDs[3], { inactiveDays: null, lastValidViewedAt: ago(29) }),
          album(idFor(105), {
            inactiveDays: 1,
            lastValidViewedAt: ago(1),
          }),
          album(idFor(104), {
            createdAt: ago(60),
            lastValidViewedAt: ago(60),
            inactiveDays: 36_500,
          }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([IDs[0], IDs[2], idFor(105)]);
    expect(
      result.excluded.find((item) => item.albumId === IDs[1])?.reasons,
    ).toContain('inactive_period_not_met');
    expect(
      result.excluded.find((item) => item.albumId === IDs[3])?.reasons,
    ).toContain('inactive_period_not_met');
    expect(
      result.excluded.find((item) => item.albumId === idFor(104))?.reasons,
    ).toContain('inactive_period_not_met');
  });

  it.each(['retention_only', 'pressure_only', 'both'] as const)(
    'excludes a future custom-share expiry in %s mode',
    (mode) => {
      const result = planRetention(
        input({
          policy: policy({
            mode,
            inactiveDays: 0,
            minAlbumAgeDays: 0,
            triggerBasisPoints: 8000,
            targetBasisPoints: 6500,
          }),
          metrics: metrics({ confirmedBytes: 900, quotaBytes: 1_000 }),
          albums: [
            album(IDs[0], {
              bytes: 100,
              createdAt: ago(60),
              lastValidViewedAt: ago(30),
              latestActiveCustomShareExpiresAt: new Date(
                Date.parse(NOW) + 1,
              ).toISOString(),
            }),
          ],
        }),
      );
      expect(result.candidateAlbumIds).toEqual([]);
      expect(result.excluded[0]?.reasons).toContain('active_custom_share');
      if (mode !== 'retention_only')
        expect(result.pressureTriggered).toBe(true);
    },
  );

  it('allows an exactly expired, past, or null custom-share expiry without treating it as activity', () => {
    const result = planRetention(
      input({
        policy: policy({ inactiveDays: 30, minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], {
            lastValidViewedAt: ago(30),
            latestActiveCustomShareExpiresAt: NOW,
          }),
          album(IDs[1], {
            lastValidViewedAt: ago(30),
            latestActiveCustomShareExpiresAt: ago(5),
          }),
          album(IDs[2], {
            lastValidViewedAt: ago(30),
            latestActiveCustomShareExpiresAt: null,
          }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([IDs[0], IDs[1], IDs[2]]);
    expect(result.candidates[1]?.lastRelevantActivityAt).toBe(ago(30));
    expect(result.excluded).toEqual([]);
  });

  it.each(['retention_only', 'pressure_only', 'both'] as const)(
    'excludes albums with unverified share evidence in %s mode',
    (mode) => {
      const result = planRetention(
        input({
          policy: policy({
            mode,
            inactiveDays: 0,
            minAlbumAgeDays: 0,
            triggerBasisPoints: 8000,
            targetBasisPoints: 6500,
          }),
          metrics: metrics({ confirmedBytes: 900, quotaBytes: 1_000 }),
          albums: [
            album(IDs[0], {
              bytes: 100,
              lastValidViewedAt: ago(30),
              shareEvidenceVerified: false,
              latestActiveCustomShareExpiresAt: new Date(
                Date.parse(NOW) + 60_000,
              ).toISOString(),
            }),
          ],
        }),
      );
      expect(result.candidateAlbumIds).toEqual([]);
      expect(result.excluded[0]?.reasons).toContain('shares_unverified');
      expect(result.excluded[0]?.reasons).not.toContain('active_custom_share');
      if (mode !== 'retention_only')
        expect(result.pressureTriggered).toBe(true);
    },
  );

  it('does not let pressure relief select a still-active custom share', () => {
    const result = planRetention(
      input({
        policy: policy({
          mode: 'both',
          inactiveDays: 0,
          minAlbumAgeDays: 0,
          triggerBasisPoints: 8000,
          targetBasisPoints: 6500,
        }),
        metrics: metrics({ confirmedBytes: 900, quotaBytes: 1_000 }),
        albums: [
          album(IDs[0], {
            bytes: 100,
            lastValidViewedAt: ago(30),
            latestActiveCustomShareExpiresAt: new Date(
              Date.parse(NOW) + 60_000,
            ).toISOString(),
          }),
        ],
      }),
    );
    expect(result.pressureTriggered).toBe(true);
    expect(result.candidateAlbumIds).toEqual([]);
    expect(result.excluded[0]?.reasons).toContain('active_custom_share');
  });

  it('uses 90 days when the default policy is explicitly enabled', () => {
    const result = planRetention(
      input({
        policy: {
          ...defaultRetentionPolicy,
          enabled: true,
          mode: 'retention_only',
        },
        albums: [
          album(IDs[0], { createdAt: ago(120), lastValidViewedAt: ago(90) }),
          album(IDs[1], { createdAt: ago(120), lastValidViewedAt: ago(89) }),
        ],
      }),
    );
    expect(result.dryRun).toBe(true);
    expect(result.candidateAlbumIds).toEqual([IDs[0]]);
    expect(
      result.excluded.find((item) => item.albumId === IDs[1])?.reasons,
    ).toContain('inactive_period_not_met');
  });

  it('uses creation as the no-view baseline and a later publication as activity', () => {
    const result = planRetention(
      input({
        policy: policy({ inactiveDays: 30, minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], { createdAt: ago(40) }),
          album(IDs[1], { createdAt: ago(60), publishedAt: ago(20) }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([IDs[0]]);
    expect(
      result.excluded.find((item) => item.albumId === IDs[1])?.reasons,
    ).toContain('inactive_period_not_met');
  });

  it('treats cleanupAllowed as opt-in and preservationRequested as a protection', () => {
    const result = planRetention(
      input({
        policy: policy({ minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], { preservationRequested: true }),
          album(IDs[1], { preservationRequested: false }),
          album(IDs[2], { cleanupAllowed: false }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([IDs[1]]);
    expect(
      result.excluded.find((item) => item.albumId === IDs[0])?.reasons,
    ).toContain('preservation_requested');
    expect(
      result.excluded.find((item) => item.albumId === IDs[2])?.reasons,
    ).toContain('cleanup_not_allowed');
  });

  it('excludes every protective, active-work, reference, and terminal signal', () => {
    const cases: Array<[string, Partial<RetentionAlbumEvidence>, string]> = [
      ['pinned', { pinned: true }, 'pinned'],
      ['legal-hold', { legalHold: true }, 'legal_hold'],
      ['project-protected', { projectProtected: true }, 'project_protected'],
      ['excluded', { retentionExcluded: true }, 'retention_excluded'],
      ['upload', { activeUpload: true }, 'active_upload'],
      ['processing', { activeProcessing: true }, 'active_processing'],
      ['delivery', { activeDelivery: true }, 'active_delivery'],
      ['workflow', { workflowBusy: true }, 'workflow_busy'],
      [
        'blocking-reference',
        { hasBlockingReferences: true },
        'blocking_references',
      ],
      [
        'unverified-reference',
        { referencesVerified: false },
        'references_unverified',
      ],
      [
        'legacy-activity-gap',
        { activityEvidenceVerified: false },
        'activity_unverified',
      ],
      ['deleting', { state: 'deleting' }, 'album_deleting'],
      ['deleted', { state: 'deleted' }, 'album_deleted'],
      ['empty', { bytes: 0 }, 'no_reclaimable_bytes'],
    ];
    const albums = cases.map(([, overrides], index) =>
      album(idFor(100 + index), overrides),
    );
    const result = planRetention(
      input({
        policy: policy({ minAlbumAgeDays: 0 }),
        metrics: metrics({ confirmedBytes: 2_000 }),
        albums,
      }),
    );
    expect(result.candidateAlbumIds).toEqual([]);
    cases.forEach(([, , reason], index) => {
      expect(result.excluded[index]?.reasons).toContain(reason);
    });
  });

  it('excludes recent activity/state changes but accepts the exact 15-minute boundary', () => {
    const result = planRetention(
      input({
        policy: policy({ inactiveDays: 0, minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], { lastValidViewedAt: ago(0, 14 * 60_000) }),
          album(IDs[1], { lastStateChangedAt: ago(0, 5 * 60_000) }),
          album(IDs[2], { lastValidViewedAt: ago(0, 15 * 60_000) }),
          album(IDs[3], { publishedAt: ago(0, 5 * 60_000) }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([IDs[2]]);
    expect(
      result.excluded.find((item) => item.albumId === IDs[0])?.reasons,
    ).toContain('recent_activity');
    expect(
      result.excluded.find((item) => item.albumId === IDs[1])?.reasons,
    ).toContain('recent_state_change');
    expect(
      result.excluded.find((item) => item.albumId === IDs[3])?.reasons,
    ).toContain('recent_activity');

    const young = planRetention(
      input({
        policy: policy({ inactiveDays: 0, minAlbumAgeDays: 7 }),
        albums: [album(IDs[0], { createdAt: ago(3) })],
      }),
    );
    expect(young.excluded[0]?.reasons).toContain('minimum_album_age_not_met');
  });

  it('triggers at 80 percent including reservations, then estimates down to 65 percent', () => {
    const selected = planRetention(
      input({
        policy: policy({ mode: 'pressure_only', targetBasisPoints: 6500 }),
        metrics: metrics({
          confirmedBytes: 750,
          reservedBytes: 50,
          quotaBytes: 1_000,
        }),
        albums: [album(IDs[0], { bytes: 150 })],
      }),
    );
    expect(selected.pressureTriggered).toBe(true);
    expect(selected.estimatedOccupancyAfter).toEqual({
      confirmedBytes: 600,
      reservedBytes: 50,
      occupiedBytes: 650,
      quotaBytes: 1_000,
    });
    expect(selected.estimatedTargetReached).toBe(true);

    const below = planRetention(
      input({
        policy: policy({ mode: 'pressure_only' }),
        metrics: metrics({
          confirmedBytes: 749,
          reservedBytes: 50,
          quotaBytes: 1_000,
        }),
        albums: [album(IDs[0], { bytes: 150 })],
      }),
    );
    expect(below.pressureTriggered).toBe(false);
    expect(below.candidateAlbumIds).toEqual([]);
    expect(below.excluded[0]?.reasons).toContain('pressure_not_triggered');
  });

  it('keeps global oldest-first order while both mode retains inactive albums', () => {
    const priority = planRetention(
      input({
        policy: policy({
          mode: 'both',
          maxAlbumsPerRun: 1,
          targetBasisPoints: 6500,
        }),
        metrics: metrics({
          confirmedBytes: 750,
          reservedBytes: 50,
          quotaBytes: 1_000,
        }),
        albums: [
          album(IDs[0], {
            bytes: 150,
            createdAt: ago(70),
            lastValidViewedAt: ago(20),
          }),
          album(IDs[1], {
            bytes: 150,
            createdAt: ago(50),
            lastValidViewedAt: ago(30),
          }),
        ],
      }),
    );
    expect(priority.candidateAlbumIds).toEqual([IDs[0]]);
    expect(priority.candidates[0]?.reasons).toEqual(['pressure_relief']);
    expect(
      priority.excluded.find((item) => item.albumId === IDs[1])?.reasons,
    ).toContain('album_run_limit_reached');

    const retained = planRetention(
      input({
        policy: policy({ mode: 'both', targetBasisPoints: 6500 }),
        metrics: metrics({
          confirmedBytes: 750,
          reservedBytes: 50,
          quotaBytes: 1_000,
        }),
        albums: [album(IDs[1], { bytes: 150, lastValidViewedAt: ago(30) })],
      }),
    );
    expect(retained.candidateAlbumIds).toEqual([IDs[1]]);
    expect(retained.candidates[0]?.reasons).toEqual([
      'inactive_period_met',
      'pressure_relief',
    ]);
    expect(new Set(retained.candidates[0]?.reasons).size).toBe(
      retained.candidates[0]?.reasons.length,
    );
  });

  it('uses deterministic sort keys and UUID tie-breaks', () => {
    const albums = [
      album(IDs[2], { createdAt: ago(50), lastValidViewedAt: ago(45) }),
      album(IDs[0], { createdAt: ago(50), lastValidViewedAt: ago(50) }),
      album(IDs[1], { createdAt: ago(60), lastValidViewedAt: ago(40) }),
    ];
    const oldest = planRetention(
      input({ policy: policy({ minAlbumAgeDays: 0 }), albums }),
    );
    expect(oldest.candidateAlbumIds).toEqual([IDs[1], IDs[0], IDs[2]]);
    const leastViewed = planRetention(
      input({
        policy: policy({ minAlbumAgeDays: 0, sort: 'least_recently_viewed' }),
        albums,
      }),
    );
    expect(leastViewed.candidateAlbumIds).toEqual([IDs[0], IDs[2], IDs[1]]);

    const tiedView = planRetention(
      input({
        policy: policy({ minAlbumAgeDays: 0, sort: 'least_recently_viewed' }),
        albums: [
          album(IDs[2], { createdAt: ago(60), lastValidViewedAt: ago(40) }),
          album(IDs[0], { createdAt: ago(50), lastValidViewedAt: ago(40) }),
        ],
      }),
    );
    expect(tiedView.candidateAlbumIds).toEqual([IDs[0], IDs[2]]);
  });

  it('honors whole-album byte and album caps while continuing past an oversized album', () => {
    const result = planRetention(
      input({
        policy: policy({
          minAlbumAgeDays: 0,
          maxAlbumsPerRun: 2,
          maxDeleteBytesPerRun: 100,
        }),
        albums: [
          album(IDs[0], { bytes: 60, createdAt: ago(70) }),
          album(IDs[1], { bytes: 60, createdAt: ago(60) }),
          album(IDs[2], { bytes: 40, createdAt: ago(50) }),
          album(IDs[3], { bytes: 1, createdAt: ago(40) }),
        ],
      }),
    );
    expect(result.candidateAlbumIds).toEqual([IDs[0], IDs[2]]);
    expect(result.estimatedBytes).toBe(100);
    expect(
      result.excluded.find((item) => item.albumId === IDs[1])?.reasons,
    ).toContain('delete_byte_limit_reached');
    expect(
      result.excluded.find((item) => item.albumId === IDs[3])?.reasons,
    ).toContain('album_run_limit_reached');
  });

  it('rejects invalid scope, duplicate IDs, future dates, and unsafe inventory totals', () => {
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              workspaceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            }),
          ],
        }),
      ),
    ).toThrow('scope mismatch');
    expect(() =>
      planRetention(input({ albums: [album(IDs[0]), album(IDs[0])] })),
    ).toThrow('duplicate album');
    expect(() =>
      planRetention(
        input({
          albums: [album(IDs[0], { createdAt: '2026-10-30T00:00:00.000Z' })],
        }),
      ),
    ).toThrow('future');
    expect(() =>
      planRetention(
        input({
          albums: [album(IDs[0], { createdAt: '2026-02-30T00:00:00.000Z' })],
        }),
      ),
    ).toThrow('valid UTC');
    expect(() =>
      planRetention(input({ albums: [album(IDs[0], { bytes: 1_001 })] })),
    ).toThrow('exceeds confirmed');
    expect(() =>
      planRetention(
        input({
          metrics: metrics({
            confirmedBytes: Number.MAX_SAFE_INTEGER,
            reservedBytes: 1,
          }),
        }),
      ),
    ).toThrow('safe integer');
  });

  it('requires typed inactivity and verified UTC custom-share evidence fields', () => {
    expect(() =>
      planRetention(input({ albums: [album(IDs[0], { inactiveDays: 0 })] })),
    ).toThrow('album.inactiveDays is outside its safe integer bounds');
    expect(() =>
      planRetention(
        input({
          albums: [album(IDs[0], { inactiveDays: '30' as unknown as number })],
        }),
      ),
    ).toThrow('album.inactiveDays is outside its safe integer bounds');
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              inactiveDays: 36_501,
            }),
          ],
        }),
      ),
    ).toThrow('album.inactiveDays is outside its safe integer bounds');
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              latestActiveCustomShareExpiresAt: '2026-10-29T12:00:00+00:00',
            }),
          ],
        }),
      ),
    ).toThrow('album.latestActiveCustomShareExpiresAt must be a UTC datetime');
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              latestActiveCustomShareExpiresAt: '2026-02-30T12:00:00.000Z',
            }),
          ],
        }),
      ),
    ).toThrow(
      'album.latestActiveCustomShareExpiresAt is not a valid UTC datetime',
    );
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              latestActiveCustomShareExpiresAt: 1 as unknown as string,
            }),
          ],
        }),
      ),
    ).toThrow('album.latestActiveCustomShareExpiresAt must be a UTC datetime');
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              shareEvidenceVerified: 'true' as unknown as boolean,
            }),
          ],
        }),
      ),
    ).toThrow('album.shareEvidenceVerified must be boolean');

    expect(() =>
      planRetention(
        input({
          albums: [album(IDs[0], { activityCoverageStartedAt: null })],
        }),
      ),
    ).toThrow(
      'album.activityCoverageStartedAt is required when activity evidence is verified',
    );
    const unknownCoverage = planRetention(
      input({
        policy: policy({ minAlbumAgeDays: 0 }),
        albums: [
          album(IDs[0], {
            activityEvidenceVerified: false,
            activityCoverageStartedAt: null,
          }),
        ],
      }),
    );
    expect(unknownCoverage.candidateAlbumIds).toEqual([]);
    expect(unknownCoverage.excluded[0]?.reasons).toContain(
      'activity_unverified',
    );
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              activityCoverageStartedAt: '2026-10-29T12:00:00+00:00',
            }),
          ],
        }),
      ),
    ).toThrow('album.activityCoverageStartedAt must be a UTC datetime');
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              activityCoverageStartedAt: '2026-10-30T00:00:00.000Z',
            }),
          ],
        }),
      ),
    ).toThrow('album creation or activity cannot be in the future');
    expect(() =>
      planRetention(
        input({
          albums: [
            album(IDs[0], {
              possibleActivityThroughAt: '2026-02-30T12:00:00.000Z',
            }),
          ],
        }),
      ),
    ).toThrow('album.possibleActivityThroughAt is not a valid UTC datetime');

    for (const missingKey of [
      'inactiveDays',
      'latestActiveCustomShareExpiresAt',
      'shareEvidenceVerified',
      'activityCoverageStartedAt',
      'possibleActivityThroughAt',
    ]) {
      const missing = { ...album(IDs[0]) } as Record<string, unknown>;
      delete missing[missingKey];
      expect(() =>
        planRetention(
          input({
            albums: [missing as unknown as RetentionAlbumEvidence],
          }),
        ),
      ).toThrow('albums[0] has missing or unknown fields');
    }
  });

  it('blocks unhealthy, stale, and incomplete evidence without candidates', () => {
    const cases = [
      {
        metrics: metrics({ healthy: false }),
        inventoryComplete: true,
        expected: 'metrics_unhealthy' as const,
      },
      {
        metrics: metrics({ observedAt: ago(1, 24 * 60 * 60_000 + 1) }),
        inventoryComplete: true,
        expected: 'metrics_stale' as const,
      },
      {
        metrics: metrics(),
        inventoryComplete: false,
        expected: 'inventory_incomplete' as const,
      },
    ];
    for (const testCase of cases) {
      const result = planRetention(
        input({
          metrics: testCase.metrics,
          inventoryComplete: testCase.inventoryComplete,
        }),
      );
      expect(result.candidateAlbumIds).toEqual([]);
      expect(result.blockedReasons).toContain(testCase.expected);
      expect(result.excluded[0]?.reasons).toContain(testCase.expected);
    }
    const exactlyFresh = planRetention(
      input({
        policy: policy({ minAlbumAgeDays: 0 }),
        metrics: metrics({ observedAt: ago(0, 24 * 60 * 60_000) }),
      }),
    );
    expect(exactlyFresh.blockedReasons).not.toContain('metrics_stale');
    expect(exactlyFresh.candidateAlbumIds).toEqual([IDs[0]]);
  });

  it('does not mutate deeply frozen input evidence', () => {
    const frozen = deepFreeze(
      input({
        policy: policy({ minAlbumAgeDays: 0 }),
        albums: [album(IDs[0])],
      }),
    );
    expect(() => planRetention(frozen)).not.toThrow();
    expect(frozen.albums[0]?.albumId).toBe(IDs[0]);
    expect(frozen.policy.enabled).toBe(true);
  });
});
