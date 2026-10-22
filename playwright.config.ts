import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100' },
  webServer: [
    {
      command: 'node tests/fixtures/supabase-server.mjs',
      url: 'http://127.0.0.1:54329/health',
      reuseExistingServer: false,
    },
    {
      command:
        'pnpm --filter @kino-pic/web start --port 3100 --hostname 127.0.0.1',
      url: 'http://127.0.0.1:3100/api/health',
      reuseExistingServer: false,
      env: {
        APP_ENV: 'test',
        APP_URL: 'http://127.0.0.1:3100',
        AUTH_DRIVER: 'supabase',
        SUPABASE_URL: 'http://127.0.0.1:54329',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_not_real',
      },
    },
    {
      command:
        'pnpm --filter @kino-pic/web start --port 3101 --hostname 127.0.0.1',
      url: 'http://127.0.0.1:3101/api/health',
      reuseExistingServer: false,
      env: {
        APP_ENV: 'test',
        APP_URL: 'http://127.0.0.1:3101',
        AUTH_DRIVER: 'disabled',
        SUPABASE_URL: '',
        SUPABASE_PUBLISHABLE_KEY: '',
      },
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
