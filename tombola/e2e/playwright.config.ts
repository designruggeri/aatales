import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:8099' },
  webServer: {
    command: 'npx tsx e2e/test-server.ts',
    cwd: '..',
    url: 'http://127.0.0.1:8099/api/public/state',
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
