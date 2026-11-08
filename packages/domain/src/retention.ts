import type { RetentionPlan } from './index';

const DAY_MS = 86_400_000;
const RECENT_MS = 15 * 60_000;
const METRICS_MAX_AGE_MS = 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,3}))?Z$/;

export type RetentionMode = 'retention_only' | 'pressure_only' | 'both';
export type RetentionSort = 'oldest' | 'least_recently_viewed';
export type RetentionPolicy = Readonly<{
  enabled: boolean;
  mode: RetentionMode;
  inactiveDays: number;
  minAlbumAgeDays: number;
  triggerBasisPoints: number;
  targetBasisPoints: number;
  sort: RetentionSort;
  maxAlbumsPerRun: number;
  maxDeleteBytesPerRun: number;
}>;

export const defaultRetentionPolicy: RetentionPolicy = Object.freeze({
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

export type RetentionMetrics = Readonly<{
  confirmedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
  healthy: boolean;
  observedAt: string;
}>;

export type RetentionAlbumEvidence = Readonly<{
  workspaceId: string;
  projectId: string;
  albumId: string;
  createdAt: string;
  publishedAt: string | null;
  lastValidViewedAt: string | null;
  lastStateChangedAt: string | null;
  inactiveDays: number | null;
  latestActiveCustomShareExpiresAt: string | null;
  shareEvidenceVerified: boolean;
  bytes: number;
  assetCount: number;
  versionCount: number;
  cleanupAllowed: boolean;
  pinned: boolean;
  legalHold: boolean;
  projectProtected: boolean;
  retentionExcluded: boolean;
  preservationRequested: boolean;
  activeUpload: boolean;
  activeProcessing: boolean;
  activeDelivery: boolean;
  workflowBusy: boolean;
  hasBlockingReferences: boolean;
  referencesVerified: boolean;
  activityEvidenceVerified: boolean;
  state: 'draft' | 'active' | 'archived' | 'deleting' | 'deleted';
}>;

export type RetentionPlanReason =
  | 'policy_disabled'
  | 'inventory_incomplete'
  | 'metrics_unhealthy'
  | 'metrics_stale'
  | 'cleanup_not_allowed'
  | 'retention_excluded'
  | 'preservation_requested'
  | 'pinned'
  | 'legal_hold'
  | 'project_protected'
  | 'active_upload'
  | 'active_processing'
  | 'active_delivery'
  | 'workflow_busy'
  | 'blocking_references'
  | 'references_unverified'
  | 'activity_unverified'
  | 'shares_unverified'
  | 'active_custom_share'
  | 'album_deleting'
  | 'album_deleted'
  | 'no_reclaimable_bytes'
  | 'minimum_album_age_not_met'
  | 'recent_activity'
  | 'recent_state_change'
  | 'inactive_period_not_met'
  | 'pressure_not_triggered'
  | 'pressure_target_reached'
  | 'album_run_limit_reached'
  | 'delete_byte_limit_reached'
  | 'inactive_period_met'
  | 'pressure_relief';

export type RetentionCandidate = Readonly<{
  albumId: string;
  projectId: string;
  bytes: number;
  assetCount: number;
  versionCount: number;
  createdAt: string;
  lastRelevantActivityAt: string;
  reasons: readonly RetentionPlanReason[];
}>;

export type RetentionExclusion = RetentionPlan['excluded'][number] &
  Readonly<{
    projectId: string;
    reasons: readonly RetentionPlanReason[];
  }>;

export type RetentionOccupancyEstimate = Readonly<{
  confirmedBytes: number;
  reservedBytes: number;
  occupiedBytes: number;
  quotaBytes: number;
}>;

export interface DetailedRetentionPlan extends RetentionPlan {
  readonly mode: RetentionMode;
  readonly blockedReasons: readonly RetentionPlanReason[];
  readonly inventoryComplete: boolean;
  readonly candidates: readonly RetentionCandidate[];
  readonly excluded: readonly RetentionExclusion[];
  readonly pressureTriggered: boolean;
  readonly estimatedOccupancyAfter: RetentionOccupancyEstimate | null;
  readonly estimatedTargetReached: boolean | null;
}

export type RetentionPlanInput = Readonly<{
  workspaceId: string;
  now: string;
  policy: RetentionPolicy;
  metrics: RetentionMetrics;
  albums: readonly RetentionAlbumEvidence[];
  inventoryComplete: boolean;
}>;

type ParsedAlbum = Readonly<{
  value: RetentionAlbumEvidence;
  created: number;
  published: number | null;
  viewed: number | null;
  stateChanged: number | null;
  inactiveDays: number | null;
  latestActiveCustomShareExpiresAt: number | null;
  lastRelevantActivity: number;
}>;

const INPUT_KEYS = [
  'workspaceId',
  'now',
  'policy',
  'metrics',
  'albums',
  'inventoryComplete',
];
const POLICY_KEYS = [
  'enabled',
  'mode',
  'inactiveDays',
  'minAlbumAgeDays',
  'triggerBasisPoints',
  'targetBasisPoints',
  'sort',
  'maxAlbumsPerRun',
  'maxDeleteBytesPerRun',
];
const METRIC_KEYS = [
  'confirmedBytes',
  'reservedBytes',
  'quotaBytes',
  'healthy',
  'observedAt',
];
const ALBUM_KEYS = [
  'workspaceId',
  'projectId',
  'albumId',
  'createdAt',
  'publishedAt',
  'lastValidViewedAt',
  'lastStateChangedAt',
  'inactiveDays',
  'latestActiveCustomShareExpiresAt',
  'shareEvidenceVerified',
  'bytes',
  'assetCount',
  'versionCount',
  'cleanupAllowed',
  'pinned',
  'legalHold',
  'projectProtected',
  'retentionExcluded',
  'preservationRequested',
  'activeUpload',
  'activeProcessing',
  'activeDelivery',
  'workflowBusy',
  'hasBlockingReferences',
  'referencesVerified',
  'activityEvidenceVerified',
  'state',
];

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(label + ' must be an object');
  return value as Record<string, unknown>;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, i) => key !== expected[i])
  )
    throw new TypeError(label + ' has missing or unknown fields');
}
function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new TypeError(label + ' must be a UUID');
  return value.toLowerCase();
}
function integer(
  value: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new RangeError(label + ' is outside its safe integer bounds');
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean')
    throw new TypeError(label + ' must be boolean');
  return value;
}
function utc(value: unknown, label: string): number {
  if (typeof value !== 'string')
    throw new TypeError(label + ' must be a UTC datetime');
  const m = UTC.exec(value);
  if (!m) throw new TypeError(label + ' must be a UTC datetime');
  const parts = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  ] as const;
  const ms = Number((m[7] ?? '').padEnd(3, '0') || '0');
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  date.setUTCHours(parts[3], parts[4], parts[5], ms);
  const time = date.getTime();
  if (
    !Number.isSafeInteger(time) ||
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2] ||
    date.getUTCHours() !== parts[3] ||
    date.getUTCMinutes() !== parts[4] ||
    date.getUTCSeconds() !== parts[5] ||
    date.getUTCMilliseconds() !== ms
  )
    throw new TypeError(label + ' is not a valid UTC datetime');
  return time;
}
function nullableUtc(value: unknown, label: string): number | null {
  return value === null ? null : utc(value, label);
}
function validatePolicy(input: unknown): RetentionPolicy {
  const v = object(input, 'policy');
  exactKeys(v, POLICY_KEYS, 'policy');
  const mode = v.mode;
  const sort = v.sort;
  if (mode !== 'retention_only' && mode !== 'pressure_only' && mode !== 'both')
    throw new TypeError('policy.mode is invalid');
  if (sort !== 'oldest' && sort !== 'least_recently_viewed')
    throw new TypeError('policy.sort is invalid');
  const trigger = integer(
    v.triggerBasisPoints,
    'policy.triggerBasisPoints',
    0,
    10_000,
  );
  const target = integer(
    v.targetBasisPoints,
    'policy.targetBasisPoints',
    0,
    10_000,
  );
  if (target > trigger)
    throw new RangeError('policy target cannot exceed trigger');
  return {
    enabled: bool(v.enabled, 'policy.enabled'),
    mode,
    inactiveDays: integer(v.inactiveDays, 'policy.inactiveDays', 0, 36_500),
    minAlbumAgeDays: integer(
      v.minAlbumAgeDays,
      'policy.minAlbumAgeDays',
      0,
      36_500,
    ),
    triggerBasisPoints: trigger,
    targetBasisPoints: target,
    sort,
    maxAlbumsPerRun: integer(
      v.maxAlbumsPerRun,
      'policy.maxAlbumsPerRun',
      0,
      100_000,
    ),
    maxDeleteBytesPerRun: integer(
      v.maxDeleteBytesPerRun,
      'policy.maxDeleteBytesPerRun',
    ),
  };
}
function validateMetrics(input: unknown, now: number): RetentionMetrics {
  const v = object(input, 'metrics');
  exactKeys(v, METRIC_KEYS, 'metrics');
  const confirmedBytes = integer(v.confirmedBytes, 'metrics.confirmedBytes');
  const reservedBytes = integer(v.reservedBytes, 'metrics.reservedBytes');
  const quotaBytes = integer(v.quotaBytes, 'metrics.quotaBytes', 1);
  if (!Number.isSafeInteger(confirmedBytes + reservedBytes))
    throw new RangeError('metrics occupancy exceeds safe integer range');
  const observedAt = v.observedAt as string;
  const observed = utc(observedAt, 'metrics.observedAt');
  if (observed > now)
    throw new TypeError('metrics.observedAt cannot be in the future');
  return {
    confirmedBytes,
    reservedBytes,
    quotaBytes,
    healthy: bool(v.healthy, 'metrics.healthy'),
    observedAt,
  };
}
function validateAlbum(
  input: unknown,
  workspaceId: string,
  now: number,
  index: number,
): ParsedAlbum {
  const v = object(input, `albums[${index}]`);
  exactKeys(v, ALBUM_KEYS, `albums[${index}]`);
  const albumWorkspace = uuid(v.workspaceId, 'album.workspaceId');
  if (albumWorkspace !== workspaceId)
    throw new TypeError('album workspace scope mismatch');
  const projectId = uuid(v.projectId, 'album.projectId');
  const albumId = uuid(v.albumId, 'album.albumId');
  const created = utc(v.createdAt, 'album.createdAt');
  const published = nullableUtc(v.publishedAt, 'album.publishedAt');
  const viewed = nullableUtc(v.lastValidViewedAt, 'album.lastValidViewedAt');
  const stateChanged = nullableUtc(
    v.lastStateChangedAt,
    'album.lastStateChangedAt',
  );
  const inactiveDays =
    v.inactiveDays === null
      ? null
      : integer(v.inactiveDays, 'album.inactiveDays', 1, 36_500);
  const latestActiveCustomShareExpiresAt = nullableUtc(
    v.latestActiveCustomShareExpiresAt,
    'album.latestActiveCustomShareExpiresAt',
  );
  const shareEvidenceVerified = bool(
    v.shareEvidenceVerified,
    'album.shareEvidenceVerified',
  );
  if (
    created > now ||
    (published !== null && published > now) ||
    (viewed !== null && viewed > now) ||
    (stateChanged !== null && stateChanged > now)
  )
    throw new TypeError('album creation or activity cannot be in the future');
  const bytes = integer(v.bytes, 'album.bytes');
  const assetCount = integer(v.assetCount, 'album.assetCount');
  const versionCount = integer(v.versionCount, 'album.versionCount');
  const flags = [
    'cleanupAllowed',
    'pinned',
    'legalHold',
    'projectProtected',
    'retentionExcluded',
    'preservationRequested',
    'activeUpload',
    'activeProcessing',
    'activeDelivery',
    'workflowBusy',
    'hasBlockingReferences',
    'referencesVerified',
    'activityEvidenceVerified',
  ] as const;
  const parsedFlags = Object.fromEntries(
    flags.map((key) => [key, bool(v[key], `album.${key}`)]),
  ) as Record<(typeof flags)[number], boolean>;
  if (
    v.state !== 'draft' &&
    v.state !== 'active' &&
    v.state !== 'archived' &&
    v.state !== 'deleting' &&
    v.state !== 'deleted'
  )
    throw new TypeError('album.state is invalid');
  const baseline = Math.max(created, published ?? created, viewed ?? created);
  const value: RetentionAlbumEvidence = {
    workspaceId: albumWorkspace,
    projectId,
    albumId,
    createdAt: v.createdAt as string,
    publishedAt: v.publishedAt as string | null,
    lastValidViewedAt: v.lastValidViewedAt as string | null,
    lastStateChangedAt: v.lastStateChangedAt as string | null,
    inactiveDays,
    latestActiveCustomShareExpiresAt: v.latestActiveCustomShareExpiresAt as
      string | null,
    shareEvidenceVerified,
    bytes,
    assetCount,
    versionCount,
    ...parsedFlags,
    state: v.state,
  } as RetentionAlbumEvidence;
  return {
    value,
    created,
    published,
    viewed,
    stateChanged,
    inactiveDays,
    latestActiveCustomShareExpiresAt,
    lastRelevantActivity: baseline,
  };
}
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function atLeast(occupied: number, quota: number, bp: number): boolean {
  return BigInt(occupied) * 10_000n >= BigInt(quota) * BigInt(bp);
}
function atMost(occupied: number, quota: number, bp: number): boolean {
  return BigInt(occupied) * 10_000n <= BigInt(quota) * BigInt(bp);
}
function addReason(
  map: Map<string, RetentionPlanReason[]>,
  id: string,
  reason: RetentionPlanReason,
): void {
  const reasons = map.get(id) ?? [];
  if (!reasons.includes(reason)) reasons.push(reason);
  map.set(id, reasons);
}

/** Deterministic dry-run only. It never deletes data or treats estimates as released bytes. */
export function planRetention(
  input: RetentionPlanInput,
): DetailedRetentionPlan {
  const root = object(input, 'input');
  exactKeys(root, INPUT_KEYS, 'input');
  const workspaceId = uuid(root.workspaceId, 'workspaceId');
  const now = utc(root.now, 'now');
  const policy = validatePolicy(root.policy);
  const metrics = validateMetrics(root.metrics, now);
  const inventoryComplete = bool(root.inventoryComplete, 'inventoryComplete');
  if (!Array.isArray(root.albums))
    throw new TypeError('albums must be an array');
  const albums = root.albums.map((a, i) =>
    validateAlbum(a, workspaceId, now, i),
  );
  const albumIds = new Set<string>();
  let inventoryBytes = 0n;
  for (const album of albums) {
    if (albumIds.has(album.value.albumId))
      throw new TypeError('duplicate album ID');
    albumIds.add(album.value.albumId);
    inventoryBytes += BigInt(album.value.bytes);
  }
  if (inventoryBytes > BigInt(metrics.confirmedBytes))
    throw new RangeError('album inventory exceeds confirmed bytes');
  if (inventoryBytes > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('album inventory exceeds safe integer range');

  const observed = utc(metrics.observedAt, 'metrics.observedAt');
  const fresh = now - observed <= METRICS_MAX_AGE_MS;
  const metricsTrusted = metrics.healthy && fresh;
  const blocked: RetentionPlanReason[] = [];
  if (!policy.enabled) blocked.push('policy_disabled');
  if (!inventoryComplete) blocked.push('inventory_incomplete');
  if (!metrics.healthy) blocked.push('metrics_unhealthy');
  if (!fresh) blocked.push('metrics_stale');
  const occupied = metrics.confirmedBytes + metrics.reservedBytes;
  const globallyEligible = blocked.length === 0;
  const pressureTriggered =
    globallyEligible &&
    policy.mode !== 'retention_only' &&
    atLeast(occupied, metrics.quotaBytes, policy.triggerBasisPoints);
  const ordered = [...albums].sort((a, b) => {
    const aPrimary =
      policy.sort === 'oldest' ? a.created : a.lastRelevantActivity;
    const bPrimary =
      policy.sort === 'oldest' ? b.created : b.lastRelevantActivity;
    return aPrimary - bPrimary || cmp(a.value.albumId, b.value.albumId);
  });
  const exclusions = new Map<string, RetentionPlanReason[]>();
  if (!globallyEligible) {
    for (const album of ordered)
      for (const reason of blocked)
        addReason(exclusions, album.value.albumId, reason);
  }
  const eligible: ParsedAlbum[] = [];
  if (globallyEligible) {
    const cutoff = now - RECENT_MS;
    for (const album of ordered) {
      const a = album.value;
      const reasons: RetentionPlanReason[] = [];
      const push = (reason: RetentionPlanReason) => {
        if (!reasons.includes(reason)) reasons.push(reason);
      };
      if (!a.cleanupAllowed) push('cleanup_not_allowed');
      if (a.retentionExcluded) push('retention_excluded');
      if (a.preservationRequested) push('preservation_requested');
      if (a.pinned) push('pinned');
      if (a.legalHold) push('legal_hold');
      if (a.projectProtected) push('project_protected');
      if (a.activeUpload) push('active_upload');
      if (a.activeProcessing) push('active_processing');
      if (a.activeDelivery) push('active_delivery');
      if (a.workflowBusy) push('workflow_busy');
      if (a.hasBlockingReferences) push('blocking_references');
      if (!a.referencesVerified) push('references_unverified');
      if (!a.activityEvidenceVerified) push('activity_unverified');
      if (!a.shareEvidenceVerified) push('shares_unverified');
      else if (
        album.latestActiveCustomShareExpiresAt !== null &&
        album.latestActiveCustomShareExpiresAt > now
      )
        push('active_custom_share');
      if (a.state === 'deleting') push('album_deleting');
      if (a.state === 'deleted') push('album_deleted');
      if (a.bytes === 0) push('no_reclaimable_bytes');
      if (
        BigInt(now - album.created) <
        BigInt(policy.minAlbumAgeDays) * BigInt(DAY_MS)
      )
        push('minimum_album_age_not_met');
      if (
        (album.viewed !== null && album.viewed > cutoff) ||
        (album.published !== null && album.published > cutoff)
      )
        push('recent_activity');
      if (album.stateChanged !== null && album.stateChanged > cutoff)
        push('recent_state_change');
      if (reasons.length)
        for (const reason of reasons) addReason(exclusions, a.albumId, reason);
      else eligible.push(album);
    }
  }
  const inactive = (album: ParsedAlbum) =>
    BigInt(now - album.lastRelevantActivity) >=
    BigInt(album.inactiveDays ?? policy.inactiveDays) * BigInt(DAY_MS);
  const inactiveSet = new Set(
    eligible.filter(inactive).map((a) => a.value.albumId),
  );
  if (globallyEligible) {
    for (const album of eligible) {
      if (policy.mode === 'pressure_only' && !pressureTriggered)
        addReason(exclusions, album.value.albumId, 'pressure_not_triggered');
      else if (
        policy.mode !== 'pressure_only' &&
        !inactiveSet.has(album.value.albumId) &&
        !(policy.mode === 'both' && pressureTriggered)
      )
        addReason(exclusions, album.value.albumId, 'inactive_period_not_met');
    }
  }

  const selectedReasons = new Map<string, RetentionPlanReason[]>();
  let estimatedBytes = 0;
  const select = (
    album: ParsedAlbum,
    reasons: readonly RetentionPlanReason[],
  ) => {
    const id = album.value.albumId;
    if (selectedReasons.has(id)) return;
    if (selectedReasons.size >= policy.maxAlbumsPerRun) {
      addReason(exclusions, id, 'album_run_limit_reached');
      return;
    }
    if (
      BigInt(estimatedBytes) + BigInt(album.value.bytes) >
      BigInt(policy.maxDeleteBytesPerRun)
    ) {
      addReason(exclusions, id, 'delete_byte_limit_reached');
      return;
    }
    estimatedBytes += album.value.bytes;
    selectedReasons.set(id, [...new Set(reasons)]);
  };
  const hitTarget = () =>
    atMost(
      occupied - estimatedBytes,
      metrics.quotaBytes,
      policy.targetBasisPoints,
    );
  const markTargetRemainder = (
    items: readonly ParsedAlbum[],
    start: number,
  ) => {
    for (const album of items.slice(start))
      if (!selectedReasons.has(album.value.albumId))
        addReason(exclusions, album.value.albumId, 'pressure_target_reached');
  };
  if (globallyEligible && policy.mode === 'retention_only') {
    for (const album of eligible.filter(inactive))
      select(album, ['inactive_period_met']);
  } else if (
    globallyEligible &&
    policy.mode === 'pressure_only' &&
    pressureTriggered
  ) {
    for (const [index, album] of eligible.entries()) {
      if (hitTarget()) {
        markTargetRemainder(eligible, index);
        break;
      }
      select(album, ['pressure_relief']);
    }
  } else if (globallyEligible && policy.mode === 'both') {
    for (const album of eligible) {
      const isInactive = inactiveSet.has(album.value.albumId);
      const needsPressure = pressureTriggered && !hitTarget();
      if (!isInactive && !needsPressure) {
        if (pressureTriggered)
          addReason(exclusions, album.value.albumId, 'pressure_target_reached');
        continue;
      }
      const reasons: RetentionPlanReason[] = [];
      if (isInactive) reasons.push('inactive_period_met');
      if (needsPressure) reasons.push('pressure_relief');
      select(album, reasons);
    }
  }

  const candidates = ordered
    .filter((a) => selectedReasons.has(a.value.albumId))
    .map((a): RetentionCandidate => ({
      albumId: a.value.albumId,
      projectId: a.value.projectId,
      bytes: a.value.bytes,
      assetCount: a.value.assetCount,
      versionCount: a.value.versionCount,
      createdAt: a.value.createdAt,
      lastRelevantActivityAt: new Date(a.lastRelevantActivity).toISOString(),
      reasons: selectedReasons.get(a.value.albumId) ?? [],
    }));
  const excluded: RetentionExclusion[] = ordered
    .filter((a) => !selectedReasons.has(a.value.albumId))
    .map((a) => {
      const reasons = exclusions.get(a.value.albumId) ?? [
        'pressure_target_reached',
      ];
      const reason = reasons[0];
      if (reason === undefined)
        throw new Error('Retention exclusion requires a reason');
      return {
        albumId: a.value.albumId,
        projectId: a.value.projectId,
        reason,
        reasons,
      };
    });
  const afterConfirmed = metrics.confirmedBytes - estimatedBytes;
  const afterOccupied = afterConfirmed + metrics.reservedBytes;
  const estimatedOccupancyAfter = metricsTrusted
    ? {
        confirmedBytes: afterConfirmed,
        reservedBytes: metrics.reservedBytes,
        occupiedBytes: afterOccupied,
        quotaBytes: metrics.quotaBytes,
      }
    : null;
  const estimatedTargetReached =
    estimatedOccupancyAfter && policy.mode !== 'retention_only'
      ? atMost(afterOccupied, metrics.quotaBytes, policy.targetBasisPoints)
      : null;
  return {
    workspaceId,
    dryRun: true,
    mode: policy.mode,
    candidateAlbumIds: candidates.map((a) => a.albumId),
    estimatedBytes,
    blockedReasons: blocked,
    inventoryComplete,
    candidates,
    excluded,
    pressureTriggered,
    estimatedOccupancyAfter,
    estimatedTargetReached,
  };
}
