import { test } from 'vitest';

test('workspace management migration and CAS lifecycle run in native D1', async () => {
  // @ts-expect-error Native Miniflare fixture is an executable JavaScript module.
  await import('../../apps/worker/tests/workspace-management-native.mjs');
}, 120_000);
