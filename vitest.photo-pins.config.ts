import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/worker/tests/photo-pins-api.test.ts'],
    testTimeout: 120000,
  },
});
