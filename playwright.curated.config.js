import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: 'curated.spec.js',
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:8018', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  webServer: { command: 'node tools/build-curated.mjs --serve', url: 'http://127.0.0.1:8018/curated/', reuseExistingServer: false },
});
