import { test } from 'vitest';

test('Oracle settings preserve native D1 authorization, audit and capacity guards', async () => {
  // @ts-expect-error Native Miniflare fixture is JavaScript.
  await import('../../apps/worker/tests/oracle-storage-policy-native.mjs');
}, 120000);
