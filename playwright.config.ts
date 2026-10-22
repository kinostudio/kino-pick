import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:3100' },
  webServer: {
    command:
      'pnpm --filter @kino-pic/web start --port 3100 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
