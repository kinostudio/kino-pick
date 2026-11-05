import { test } from 'vitest';
import { resolve } from 'node:path';

test('populated recipe upgrade and current upload/gallery run in native D1/R2', async () => {
  const previous = process.cwd();
  process.chdir(resolve('apps/worker'));
  try {
    // @ts-expect-error Executable native integration harness has no declaration file.
    await import('../../apps/worker/tests/processing-recipes.mjs');
  } finally {
    process.chdir(previous);
  }
}, 180000);
