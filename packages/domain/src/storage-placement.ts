export type StoragePlacementCapacity = Readonly<{
  nodeId: string;
  quotaBytes: number | null;
  usedBytes: number | null;
  reservedBytes: number | null;
}>;

export type StoragePlacementInput = Readonly<{
  expectedUploadBytes: number;
  expectedProcessingBytes: number;
  existingSessionNodeId: string | null;
  r2: StoragePlacementCapacity;
  vm: StoragePlacementCapacity &
    Readonly<{
      mounted: boolean | null;
      healthy: boolean | null;
      metricsFresh: boolean | null;
      /** Physical free bytes before accounting for D1 reservations. */
      freeBytes: number | null;
      floorBytes: number | null;
    }>;
}>;

export type StoragePlacementDenial =
  | 'invalid_request'
  | 'unknown_session_node'
  | 'r2_capacity_unknown'
  | 'vm_unavailable'
  | 'vm_capacity_unknown'
  | 'capacity_exhausted';

export type StoragePlacementResult =
  | Readonly<{
      status: 'selected';
      storageNodeId: string;
      reason: 'existing_session' | 'r2_capacity' | 'vm_spillover';
    }>
  | Readonly<{ status: 'denied'; reason: StoragePlacementDenial }>;

type CapacityFit = true | false | 'unknown';

function validNodeId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value === value.trim()
  );
}

function safeInteger(value: unknown, allowZero: boolean): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (allowZero ? value >= 0 : value > 0)
  );
}

function quotaFit(
  capacity: StoragePlacementCapacity,
  requiredBytes: number,
): CapacityFit {
  if (
    !safeInteger(capacity.quotaBytes, false) ||
    !safeInteger(capacity.usedBytes, true) ||
    !safeInteger(capacity.reservedBytes, true)
  )
    return 'unknown';
  const occupiedBytes = capacity.usedBytes + capacity.reservedBytes;
  if (!safeInteger(occupiedBytes, true) || occupiedBytes > capacity.quotaBytes)
    return 'unknown';
  return requiredBytes <= capacity.quotaBytes - occupiedBytes;
}

export function planStoragePlacement(
  input: StoragePlacementInput,
): StoragePlacementResult {
  const { expectedUploadBytes, expectedProcessingBytes, r2, vm } = input;
  if (
    !safeInteger(expectedUploadBytes, false) ||
    !safeInteger(expectedProcessingBytes, true) ||
    !validNodeId(r2.nodeId) ||
    !validNodeId(vm.nodeId) ||
    r2.nodeId === vm.nodeId
  )
    return { status: 'denied', reason: 'invalid_request' };

  if (input.existingSessionNodeId !== null) {
    // A replay keeps its committed target; capacity changes never move an in-flight write.
    if (input.existingSessionNodeId === r2.nodeId)
      return {
        status: 'selected',
        storageNodeId: r2.nodeId,
        reason: 'existing_session',
      };
    if (input.existingSessionNodeId === vm.nodeId)
      return {
        status: 'selected',
        storageNodeId: vm.nodeId,
        reason: 'existing_session',
      };
    return { status: 'denied', reason: 'unknown_session_node' };
  }

  const requiredBytes = expectedUploadBytes + expectedProcessingBytes;
  if (!safeInteger(requiredBytes, false))
    return { status: 'denied', reason: 'invalid_request' };
  const r2Fits = quotaFit(r2, requiredBytes);
  if (r2Fits === 'unknown')
    return { status: 'denied', reason: 'r2_capacity_unknown' };
  if (r2Fits)
    return {
      status: 'selected',
      storageNodeId: r2.nodeId,
      reason: 'r2_capacity',
    };

  if (vm.mounted !== true || vm.healthy !== true)
    return { status: 'denied', reason: 'vm_unavailable' };
  if (vm.metricsFresh !== true)
    return { status: 'denied', reason: 'vm_capacity_unknown' };
  const vmFits = quotaFit(vm, requiredBytes);
  if (
    vmFits === 'unknown' ||
    !safeInteger(vm.freeBytes, true) ||
    !safeInteger(vm.floorBytes, true) ||
    !safeInteger(vm.reservedBytes, true)
  )
    return { status: 'denied', reason: 'vm_capacity_unknown' };
  if (
    !vmFits ||
    vm.freeBytes < vm.floorBytes ||
    vm.reservedBytes > vm.freeBytes - vm.floorBytes ||
    requiredBytes > vm.freeBytes - vm.floorBytes - vm.reservedBytes
  )
    return { status: 'denied', reason: 'capacity_exhausted' };
  return {
    status: 'selected',
    storageNodeId: vm.nodeId,
    reason: 'vm_spillover',
  };
}
