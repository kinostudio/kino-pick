import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/worker/tests/photo-pins-api.test.ts',
      'apps/worker/tests/manual-album-deletion-schema.test.ts',
      'apps/worker/tests/manual-album-deletion-api.test.ts',
    ],
    testTimeout: 120000,
  },
});
