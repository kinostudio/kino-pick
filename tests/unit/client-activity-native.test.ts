import { test } from 'vitest';

test('client activity repository, guards, and 0063 run in native Miniflare D1', async () => {
  // @ts-expect-error The native D1 harness is an executable JavaScript test module.
  await import('../../apps/worker/tests/client-activity-native.mjs');
}, 120_000);
