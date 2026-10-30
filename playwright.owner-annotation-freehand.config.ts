import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'owner-annotation-editor-freehand.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3116',
    browserName: 'chromium',
    viewport: { width: 1100, height: 900 },
  },
  webServer: {
    command:
      'pnpm --filter @kino-pic/web exec vite --config vite.target.config.ts --host 127.0.0.1 --port 3116 --strictPort',
    url: 'http://127.0.0.1:3116/owner-annotation-editor-freehand-test.html',
    reuseExistingServer: false,
  },
});
