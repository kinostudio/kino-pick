import { test } from 'vitest';

test('R2-priority Oracle admission is guarded by native D1 capacity and health', async () => {
  const fixture =
    // @ts-expect-error Native Miniflare fixture is JavaScript.
    await import('../../apps/worker/tests/oracle-storage-admission-native.mjs');
  await fixture.runOracleStorageAdmissionNative();
}, 180000);
