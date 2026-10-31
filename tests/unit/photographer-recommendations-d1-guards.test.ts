import { test } from 'vitest';

test('photographer recommendation migrations and repository guards run in native Miniflare D1', async () => {
  // @ts-expect-error The native D1 harness is an executable JavaScript test module.
  await import('../../apps/worker/tests/photographer-recommendations-d1-guards.mjs');
}, 120_000);
