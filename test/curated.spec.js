import { test, expect } from '@playwright/test';

test('curated cover and collection work before loading the renderer', async ({ page }) => {
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.goto('/curated/');
  await expect(page.getByRole('heading', { name: 'The art of slowing down.' })).toBeVisible();
  expect(requests.some(url => /scene-.*\.js/.test(url))).toBe(false);
  await page.getByRole('button', { name: 'Browse the works' }).click();
  await expect(page.getByRole('heading', { name: 'Six ways of seeing' })).toBeVisible();
  await page.getByRole('button', { name: 'View Quiet Current' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Quiet Current' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(requests.some(url => /scene-.*\.js/.test(url))).toBe(false);
});

test('reference room renders, pauses in the viewer, and survives re-entry', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/curated/?debug');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  await expect.poll(() => page.evaluate(() => window.LUMIERE?.stats().frames || 0)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'View artwork', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const frames = await page.evaluate(() => window.LUMIERE.stats().frames);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.LUMIERE.stats().frames)).toBe(frames);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to exhibition cover' }).click();
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  const stats = await page.evaluate(() => window.LUMIERE.stats());
  expect(stats.drawCalls).toBeLessThanOrEqual(150);
  expect(stats.triangles).toBeLessThanOrEqual(250000);
  expect(errors).toEqual([]);
});

test('phone collection has no horizontal overflow and restores viewer focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/curated/');
  await page.getByRole('button', { name: 'Browse the works' }).click();
  const work = page.getByRole('button', { name: 'View Quiet Current' });
  await work.click();
  await page.getByRole('button', { name: 'Close artwork' }).click();
  await expect(work).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unavailable WebGL leaves an actionable collection fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind === 'webgl2' || kind === 'webgl') return null;
      return original.call(this, kind, ...args);
    };
  });
  await page.goto('/curated/');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.getByRole('status')).toContainText('Browse the works');
  await page.getByRole('button', { name: 'Browse the works' }).click();
  await expect(page.getByRole('heading', { name: 'Six ways of seeing' })).toBeVisible();
});

test('opening art while entry loads cancels entry and keeps the cover active', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/scene-*.js', async route => { await gate; await route.continue(); });
  await page.goto('/curated/?debug');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await page.getByRole('button', { name: 'Preview Quiet Current' }).click();
  release();
  await expect(page.getByRole('button', { name: 'Enter the exhibition' })).toBeEnabled();
  expect(await page.evaluate(() => window.LUMIERE.stats().frames)).toBe(0);
  await page.getByRole('button', { name: 'Close artwork' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'entrance');
});

test('context loss during artwork loading returns to a usable cover', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.goto('/curated/?debug');
  await page.route('**/art/*-room.webp', async route => { await gate; await route.continue(); });
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await page.waitForFunction(() => document.querySelector('#scene-host canvas'));
  await page.evaluate(() => document.querySelector('#scene-host canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect(page.getByRole('status')).toContainText('Browse the works');
  release();
  await expect(page.locator('#scene-host canvas')).toHaveCount(0);
});

test('leaving during stalled image loading promptly cancels and releases the canvas', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.goto('/curated/?debug');
  await page.route('**/art/*-room.webp', async route => { await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await page.waitForFunction(() => document.querySelector('#scene-host canvas'));
  await page.getByRole('button', { name: 'Browse the works' }).click();
  await expect(page.locator('#scene-host canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'The exhibition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter the exhibition' })).toBeEnabled();
  release();
});

test('context loss inside inspection reconciles dialogs and resets the restored view', async ({ page }) => {
  await page.goto('/curated/?debug');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  await page.getByRole('button', { name: 'Next viewpoint' }).click();
  await page.getByRole('button', { name: 'View artwork', exact: true }).click();
  await page.evaluate(() => document.querySelector('#scene-host canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'entrance');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  await expect(page.locator('#view-name')).toHaveText('The main gallery');
  expect(await page.evaluate(() => window.LUMIERE.stats().position)).toEqual([5.7, 2.3, 7.5]);
});

test('adaptive quality retains a single animation loop while walking', async ({ page }) => {
  await page.addInitScript(() => {
    const schedule = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set();
    let clock = 0;
    window.rafMaximum = 0;
    window.requestAnimationFrame = callback => {
      const id = schedule(() => { pending.delete(id); clock += 50; callback(clock); });
      pending.add(id); window.rafMaximum = Math.max(window.rafMaximum, pending.size); return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  });
  await page.goto('/curated/?debug');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => window.LUMIERE.stats().frames), { timeout: 20000 }).toBeGreaterThan(25);
  await page.keyboard.up('w');
  expect(await page.evaluate(() => window.rafMaximum)).toBe(1);
});

test('music and rain are visitor-controlled and stop outside the visit', async ({ page }) => {
  await page.addInitScript(() => {
    const start = window.setInterval.bind(window), stop = window.clearInterval.bind(window);
    const timers = new Set();
    window.audioTimerCount = () => timers.size;
    window.setInterval = (fn, ms, ...args) => {
      const id = start(fn, ms, ...args);
      if ([120, 150, 250].includes(ms)) timers.add(id);
      return id;
    };
    window.clearInterval = id => { timers.delete(id); stop(id); };
  });
  await page.goto('/curated/?debug');
  expect(await page.evaluate(() => window.LUMIERE.ambience().context)).toBe('not-started');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Soundscape').selectOption('Glass');
  await expect.poll(() => page.evaluate(() => window.LUMIERE.ambience().context)).toBe('running');
  expect(await page.evaluate(() => window.LUMIERE.ambience().music)).toBe('Glass');
  await page.getByLabel('Soundscape').selectOption('rain');
  expect(await page.evaluate(() => window.LUMIERE.ambience().music)).toBe('silence');
  expect(await page.evaluate(() => window.LUMIERE.ambience().rain)).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.evaluate(() => window.LUMIERE.ambience().context)).toBe('suspended');
  expect(await page.evaluate(() => window.audioTimerCount())).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.evaluate(() => window.LUMIERE.ambience().context)).toBe('running');
  await page.getByRole('button', { name: 'Close settings' }).click();
  expect(await page.evaluate(() => window.LUMIERE.stats().weather)).toBe('rain');
  await page.evaluate(() => document.querySelector('#scene-host canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'entrance');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  expect(await page.evaluate(() => window.LUMIERE.stats().weather)).toBe('rain');
  await page.getByRole('button', { name: 'Back to exhibition cover' }).click();
  await expect.poll(() => page.evaluate(() => window.LUMIERE.ambience().context)).toBe('suspended');
  expect(await page.evaluate(() => window.audioTimerCount())).toBe(0);
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect.poll(() => page.evaluate(() => window.LUMIERE.ambience().context)).toBe('running');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Soundscape').selectOption('silence');
  await expect.poll(() => page.evaluate(() => window.LUMIERE.ambience().context)).toBe('suspended');
  expect(await page.evaluate(() => window.LUMIERE.ambience().rain)).toBe(false);
});

test('curator links open the full gallery with their identity intact, never the demo', async ({ page }) => {
  const scenes = [];
  page.on('request', request => { if (/scene-.*\.js/.test(request.url())) scenes.push(request.url()); });
  await page.route('**/index.html?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Full gallery entry</h1>' }));
  await page.goto('/curated/?gallery=alice&q=0');
  await expect(page).toHaveURL(/\/index\.html\?gallery=alice&q=0$/);
  expect(scenes).toEqual([]);
});

test('production build serves the curated exhibition from its public root', async ({ page }) => {
  await page.goto('/site/');
  await expect(page).toHaveTitle('A Study in Stillness — LUMIÈRE');
  await expect(page.getByRole('heading', { name: 'The art of slowing down.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Explore endlessly/ })).toHaveAttribute('href', './endless/');
});

test('old curated URLs redirect to the public root without losing their state', async ({ page }) => {
  await page.goto('/site/curated/?debug#collection');
  await expect(page).toHaveURL(/\/site\/\?debug#collection$/);
  await expect(page).toHaveTitle('A Study in Stillness — LUMIÈRE');
});

test('curator links from the production root open the endless gallery with their identity intact', async ({ page }) => {
  await page.route('**/site/endless/*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Full gallery entry</h1>' }));
  await page.goto('/site/?gallery=alice&q=0');
  await expect(page).toHaveURL(/\/site\/endless\/\?gallery=alice&q=0$/);
});

test('unavailable audio leaves a usable, silent gallery', async ({ page }) => {
  await page.addInitScript(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined; });
  await page.goto('/curated/?debug');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Soundscape').selectOption('Glass');
  await expect(page.locator('#sound-note')).toContainText('unavailable');
  expect(await page.evaluate(() => window.LUMIERE.ambience().context)).toBe('not-started');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'touring');
});

test('phone navigation provides a way back from the collection', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/curated/');
  await page.getByRole('button', { name: 'Browse the works' }).click();
  await page.getByRole('button', { name: 'The exhibition', exact: true }).click({ timeout: 2500 });
  await expect(page.getByRole('button', { name: 'Enter the exhibition' })).toBeVisible();
});

test('private curator links retain the fragment and bypass the reference exhibition', async ({ page }) => {
  await page.route('**/index.html*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Private collection entry</h1>' }));
  const token = 'A'.repeat(43);
  await page.goto('/curated/?q=0#share=' + token);
  await expect(page).toHaveURL(new RegExp('/index.html\\?q=0#share=' + token + '$'));
});

test('page restoration does not resume a scene covered by settings', async ({ page }) => {
  await page.goto('/curated/?debug');
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  expect(await page.evaluate(() => window.LUMIERE.stats().paused)).toBe(true);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect.poll(() => page.evaluate(() => window.LUMIERE.stats().paused)).toBe(false);
});
