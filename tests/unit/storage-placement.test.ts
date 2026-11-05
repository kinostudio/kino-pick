import { describe, expect, it } from 'vitest';
import {
  planStoragePlacement,
  type StoragePlacementInput,
} from '../../packages/domain/src/storage-placement';

function input(overrides: Partial<StoragePlacementInput> = {}) {
  return {
    expectedUploadBytes: 600,
    expectedProcessingBytes: 100,
    existingSessionNodeId: null,
    r2: {
      nodeId: 'primary',
      quotaBytes: 1_000,
      usedBytes: 200,
      reservedBytes: 100,
    },
    vm: {
      nodeId: 'oracle-vm',
      quotaBytes: 5_000,
      usedBytes: 0,
      reservedBytes: 0,
      mounted: true,
      healthy: true,
      metricsFresh: true,
      freeBytes: 2_000,
      floorBytes: 100,
    },
    ...overrides,
  } satisfies StoragePlacementInput;
}

describe('storage placement', () => {
  it('keeps the original on R2 when upload plus processing capacity fits exactly', () => {
    expect(planStoragePlacement(input())).toEqual({
      status: 'selected',
      storageNodeId: 'primary',
      reason: 'r2_capacity',
    });
  });

  it('spills to the VM only when R2 quota cannot hold the upload and processing reserve', () => {
    const result = planStoragePlacement(
      input({
        r2: {
          nodeId: 'primary',
          quotaBytes: 1_000,
          usedBytes: 200,
          reservedBytes: 201,
        },
      }),
    );
    expect(result).toEqual({
      status: 'selected',
      storageNodeId: 'oracle-vm',
      reason: 'vm_spillover',
    });
  });

  it('fails closed when R2 capacity is unknown instead of treating it as full', () => {
    expect(
      planStoragePlacement(
        input({
          r2: {
            nodeId: 'primary',
            quotaBytes: 1_000,
            usedBytes: null,
            reservedBytes: 0,
          },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'r2_capacity_unknown' });
  });

  it('requires VM quota and free space above the floor after existing reservations', () => {
    const fullR2 = {
      nodeId: 'primary',
      quotaBytes: 1_000,
      usedBytes: 500,
      reservedBytes: 0,
    };
    expect(
      planStoragePlacement(
        input({
          r2: fullR2,
          vm: {
            ...input().vm,
            freeBytes: 1_000,
            floorBytes: 100,
            reservedBytes: 201,
          },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'capacity_exhausted' });
    expect(
      planStoragePlacement(
        input({
          r2: fullR2,
          vm: { ...input().vm, quotaBytes: 699 },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'capacity_exhausted' });
  });

  it('keeps an existing session on its recorded node without capacity fallback', () => {
    expect(
      planStoragePlacement(
        input({
          existingSessionNodeId: 'primary',
          r2: {
            nodeId: 'primary',
            quotaBytes: 1_000,
            usedBytes: null,
            reservedBytes: null,
          },
        }),
      ),
    ).toEqual({
      status: 'selected',
      storageNodeId: 'primary',
      reason: 'existing_session',
    });
    expect(
      planStoragePlacement(input({ existingSessionNodeId: 'unknown-node' })),
    ).toEqual({ status: 'denied', reason: 'unknown_session_node' });
  });

  it('rejects invalid sizes and unavailable VM metrics', () => {
    expect(
      planStoragePlacement(input({ expectedUploadBytes: Number.NaN })),
    ).toEqual({ status: 'denied', reason: 'invalid_request' });
    expect(
      planStoragePlacement(
        input({
          r2: {
            nodeId: 'primary',
            quotaBytes: 1_000,
            usedBytes: 500,
            reservedBytes: 0,
          },
          vm: { ...input().vm, mounted: null },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'vm_unavailable' });
    expect(
      planStoragePlacement(
        input({
          r2: {
            nodeId: 'primary',
            quotaBytes: 1_000,
            usedBytes: 500,
            reservedBytes: 0,
          },
          vm: { ...input().vm, freeBytes: null },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'vm_capacity_unknown' });
    expect(
      planStoragePlacement(
        input({
          r2: {
            nodeId: 'primary',
            quotaBytes: 1_000,
            usedBytes: 500,
            reservedBytes: 0,
          },
          vm: { ...input().vm, metricsFresh: false },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'vm_capacity_unknown' });
  });
});
