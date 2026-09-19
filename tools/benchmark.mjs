import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const url = option('--url', 'http://127.0.0.1:8000/');
const durationSeconds = Number(option('--duration', '60'));

if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  console.error('--duration must be a positive number of seconds');
  process.exitCode = 2;
} else {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.route(/supabase(?:\.co|\.in)?/i, (route) => route.abort());
    const page = await context.newPage();
    const coldStartedAt = performance.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.DBG?.metrics === 'function', null, { timeout: 60_000 });
    const coldEntryMs = +(performance.now() - coldStartedAt).toFixed(2);
    await page.evaluate(() => {
      /* `?metrics` starts at module boot, before the initial rooms exist.
         Do not reset that run or the requested cold-build measurements vanish. */
      if (new URLSearchParams(location.search).has('metrics')) return window.DBG.metrics();
      return window.DBG.metrics(true);
    });

    const enterStartedAt = performance.now();
    await page.locator('#enter').click();
    await page.waitForFunction(() => document.body.classList.contains('entered'), null, { timeout: 60_000 });
    const enterMs = +(performance.now() - enterStartedAt).toFixed(2);

    const stages = [
      { room: [0, 0], yaw: 0, description: 'entrance hall' },
      { room: [1, 0], yaw: Math.PI / 2, description: 'east doorway' },
      { room: [1, -1], yaw: Math.PI, description: 'north gallery' },
      { room: [0, -1], yaw: -Math.PI / 2, description: 'return hall' },
    ];
    const stageMs = Math.max(250, Math.round(durationSeconds * 1000 / stages.length));
    for (const stage of stages) {
      await page.evaluate(({ room, yaw }) => window.DBG.tp(room[0], room[1], yaw), stage);
      await page.waitForTimeout(stageMs);
    }

    const metrics = await page.evaluate(() => window.DBG.metrics());
    const rendererText = `${metrics.renderer.vendor} ${metrics.renderer.name}`;
    const software = /swiftshader|software|llvmpipe|mesa offscreen/i.test(rendererText);
    process.stdout.write(JSON.stringify({
      protocol: 'legacy-renderer-baseline-v1',
      url,
      durationSeconds,
      environment: {
        browser: 'chromium',
        viewport: { width: 1280, height: 720 },
        renderer: metrics.renderer,
        rendering: software ? 'software' : 'hardware-or-unknown',
      },
      coldEntryMs,
      enterMs,
      route: {
        description: 'Enter the legacy gallery, then dwell in a four-room clockwise loop using DBG.tp.',
        stages,
      },
      frame: metrics.frames,
      diagnostics: metrics,
    }, null, 2) + '\n');
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}
