import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'guest-annotations-freehand.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3116',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command:
      'pnpm --filter @kino-pic/web exec vite --config vite.target.config.ts --host 127.0.0.1 --port 3116 --strictPort',
    url: 'http://127.0.0.1:3116/guest-annotation-freehand-test.html',
    reuseExistingServer: false,
  },
});
