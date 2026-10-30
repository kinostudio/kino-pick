import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'gump-demo-preview.spec.ts',
  workers: 1,
  reporter: 'line',
  outputDir: process.env.TEMP
    ? `${process.env.TEMP}/kino-pic-gump-demo-playwright`
    : 'test-results/gump-demo',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'pnpm.cmd exec vite --config experiments/gump-demo/vite.config.js',
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
