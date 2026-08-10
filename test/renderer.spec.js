import { test, expect } from '@playwright/test';
import { boot, enter, hashes, WORKS, ROOMS, ENTER_MS } from './helpers.js';

test.describe('the renderer', () => {
  /* `antialias: true` was set on the context for months and did nothing,
     because the scene renders to an FBO and only the fullscreen composite
     triangle ever reached the default framebuffer. These tests exist so a
     silently-inert renderer setting cannot happen twice. */
  test('the scene buffer is HDR and multisampled when the driver allows', async ({ page }) => {
    await boot(page, '');
    await page.evaluate(() => window.DBG.frame(2, 16.7));
    const info = await page.evaluate(() => window.DBG.postInfo());
    console.log(`    scene buffer: ${info.hdr ? 'RGBA16F' : 'RGBA8'} · ${info.samples || 1}× samples`
              + ` · caps hdr=${info.caps.hdr} maxSamples=${info.caps.maxSamples}`);

    expect(info.ready).toBe(true);
    if (info.caps.hdr) expect(info.hdr).toBe(true);
    if (info.caps.maxSamples >= 2) expect(info.samples).toBeGreaterThanOrEqual(2);
  });

  test('MSAA actually changes the image', async ({ page }) => {
    await boot(page, '');
    const caps = await page.evaluate(() => window.DBG.postInfo().caps);
    test.skip(caps.maxSamples < 2, 'driver has no multisampling');

    // Oblique camera, so edges do not land on pixel boundaries where MSAA
    // would legitimately have nothing to do.
    const profile = await page.evaluate(() => {
      const c = document.getElementById('gl');
      const g = c.getContext('webgl2');
      window.DBG.pos(0.4, 1.2, 0.42, 0.02);

      /* The composite adds ±0.014 of white noise to every pixel. Averaging 64
         rows cuts that ~8× while leaving a real edge intact — without it the
         grain buries the thing being measured. */
      const sharpest = () => {
        window.DBG.frame(4, 16.7);
        const W = 200, H = 64;
        const buf = new Uint8Array(W * H * 4);
        g.readPixels(Math.round(c.width * 0.42), Math.round(c.height * 0.42), W, H,
                     g.RGBA, g.UNSIGNED_BYTE, buf);
        const col = new Float64Array(W);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          const k = (j * W + i) * 4;
          col[i] += (0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2]) / H;
        }
        let max = 0;
        for (let i = 1; i < W; i++) max = Math.max(max, Math.abs(col[i] - col[i - 1]));
        return max;
      };
      /* Hash the frame as well as measuring the edge. The hash is the real
         assertion: it proves the sample count reaches the pixels at all.
         Edge sharpness is only logged, because how much MSAA helps is a
         property of the driver — on this machine's GPU the hardest step falls
         from 92 to 61, on the software rasteriser used in CI it barely moves,
         and neither number should be able to fail the build. */
      const frameHash = () => {
        window.DBG.frame(3, 16.7);
        const buf = new Uint8Array(256 * 256 * 4);
        g.readPixels(Math.round(c.width / 2) - 128, Math.round(c.height / 2) - 128,
                     256, 256, g.RGBA, g.UNSIGNED_BYTE, buf);
        let h = 2166136261 >>> 0;
        for (let i = 0; i < buf.length; i += 7) h = Math.imul(h ^ buf[i], 16777619) >>> 0;
        return h;
      };
      window.DBG.samples(0); const off = sharpest(), hOff = frameHash();
      window.DBG.samples(4); const on = sharpest(), hOn = frameHash();
      window.DBG.samples(null);
      return { off, on, hOff, hOn };
    });

    console.log(`    hardest edge step: ${profile.off.toFixed(1)} without MSAA, `
              + `${profile.on.toFixed(1)} with  (driver-dependent)`);
    // The hash is the whole assertion. Edge sharpness is genuinely not
    // assertable here: on the software rasteriser the two numbers differ by
    // less than the film grain, and which way round they land is noise.
    expect(profile.hOn).not.toBe(profile.hOff);   // the samples reach the pixels
  });
});

test.describe('the archive build', () => {
  /* `npm run archive` swaps the cloud client for an inert stub and minifies,
     producing the artifact meant for permanent storage. It has to work with no
     backend at all. Size is *reported*, not enforced — see below. */
  const FREE_TIER = 102400;        // 100 KiB — ArDrive Turbo's free-upload tier
  const SANITY = 400 * 1024;       // a runaway build, not a policy threshold

  test('boots, generates art, and carries no backend', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/archive/index.html?q=0');
    await page.waitForFunction(() => typeof window.DBG?.stats === 'function', null, { timeout: 60_000 });

    expect(await page.evaluate(() => window.DBG.cloudState().on)).toBe(false);
    expect(await page.evaluate(() => window.DBG.stats().cached)).toBeGreaterThan(0);
    expect(await page.evaluate(() => typeof window.DBG.artHash(0, 0, 0).hash)).toBe('number');
    expect(errors).toEqual([]);
  });

  test('paints the same pixels as the hosted build', async ({ page }) => {
    // Stripping the backend must not change a single brushstroke.
    await page.goto('/archive/index.html?q=0');
    await page.waitForFunction(() => typeof window.DBG?.artHash === 'function', null, { timeout: 60_000 });
    const archived = await hashes(page);

    await boot(page);
    expect(await hashes(page)).toEqual(archived);
  });

  test('reports its size against the free-upload tier', async ({ page }) => {
    const bytes = await page.request.get('/archive/index.html')
      .then((r) => r.body()).then((b) => b.byteLength);
    const kib = (bytes / 1024).toFixed(1);

    /* Deliberately not a gate. 100 KiB is ArDrive's free-tier policy, not an
       engineering limit, and treating it as one meant the build started
       shaping the product: features got cut to claw back a couple of hundred
       bytes. Crossing it costs a one-time credit purchase (~$10, which covers
       thousands of uploads at this size), not a per-upload fee. Report the
       number, let a human decide. */
    if (bytes <= FREE_TIER) {
      console.log(`    archive: ${bytes} bytes (${kib} KiB) — inside the free tier, `
                + `${FREE_TIER - bytes} to spare`);
    } else {
      console.log(`    archive: ${bytes} bytes (${kib} KiB) — OVER the ${FREE_TIER / 1024} KiB `
                + `free tier by ${bytes - FREE_TIER}. Uploading now needs Turbo Credits: a `
                + `one-time purchase, not a per-upload cost. See docs/permanence.md.`);
    }
    // Only a runaway build fails here.
    expect(bytes).toBeLessThan(SANITY);
  });
});
