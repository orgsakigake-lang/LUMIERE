import { defineConfig, devices } from '@playwright/test';

/* The determinism hashes are Canvas2D pixel hashes. They are stable across
   reloads within one origin but NOT across origins or GPU paths, so every
   baseline has to be captured and compared inside a single run on one host.
   Never hard-code a golden hash recorded elsewhere. */
export default defineConfig({
  testDir: './test',
  /* The suite is split by group across spec files, and Playwright gives each
     file its own worker. That is what makes concurrency work here: the groups
     have genuinely different shapes — determinism runs generators with no
     browser to speak of, the renderer wants full quality, the gallery pays a
     one-off cost to walk in and then shares that page.

     An earlier note here said parallel workers had been tried and did not
     help. That was measured against a single file, where there was nothing to
     run in parallel — every worker would have re-run the same serial group.
     Files are the unit Playwright can actually spread.

     Four, not eight. Every worker drives its own software-rendered browser and
     SwiftShader spreads rasterisation across all cores by itself, so past
     about half the cores they stop overlapping and start competing.

     `inside the gallery` is the long pole, so it is two files rather than one:
     the ~15s entry is paid twice to halve a group that had grown to most of
     the run. Both stay `serial` internally — they share one page, which is the
     whole reason entering is affordable. */
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  /* Headless CI runs on SwiftShader, where entering the gallery (25 room
     meshes + the first wing of artwork) costs ~12s at 720x405 and ~32s at
     720p. The viewport is small and the timeout generous for that reason —
     neither is a statement about real performance. */
  /* Raised from 150s when the suite went concurrent. Four workers each drive
     their own software-rendered browser, so the slowest tests get slower even
     as the wall clock drops — 'frame stepping' passes alone in 47s and timed
     out in a full run. The limit is there to catch a hang, not to police how
     long SwiftShader takes. */
  timeout: 240_000,
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
