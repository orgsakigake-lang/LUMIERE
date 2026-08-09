import { defineConfig, devices } from '@playwright/test';

/* The determinism hashes are Canvas2D pixel hashes. They are stable across
   reloads within one origin but NOT across origins or GPU paths, so every
   baseline has to be captured and compared inside a single run on one host.
   Never hard-code a golden hash recorded elsewhere. */
export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  /* Headless CI runs on SwiftShader, where entering the gallery (25 room
     meshes + the first wing of artwork) costs ~12s at 720x405 and ~32s at
     720p. The viewport is small and the timeout generous for that reason —
     neither is a statement about real performance. */
  timeout: 150_000,
  use: {
    baseURL: 'http://localhost:8000',
    viewport: { width: 720, height: 405 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    /* --minify, for two reasons. It exercises the artifact that actually
       ships rather than a readable variant of it. And without it the watch
       server rewrites the committed index.html unminified on every test run,
       which is how a 173 KB build once got committed in place of a 103 KB one. */
    command: 'node build.mjs --minify --watch',
    url: 'http://localhost:8000',
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
