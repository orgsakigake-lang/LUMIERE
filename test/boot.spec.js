import { test, expect } from '@playwright/test';
import { boot, enter, hashes, WORKS, ROOMS, ENTER_MS } from './helpers.js';

test.describe('boot', () => {
  test('loads clean, in standards mode, with the debug surface installed', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await boot(page);
    expect(await page.evaluate(() => document.compatMode)).toBe('CSS1Compat');
    expect(await page.evaluate(() => window.DBG.stats().cached)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('WebGL2 came up — the closed-tonight notice stays hidden', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#nogl')).toBeHidden();
    await expect(page.locator('#intro')).toBeVisible();
  });

  test('every id in the document is unique', async ({ page }) => {
    await boot(page);
    // Regression: id="cur-note" was used twice in the curator panel.
    const dupes = await page.evaluate(() => {
      const seen = new Map();
      for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) || 0) + 1);
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    expect(dupes).toEqual([]);
  });

  test('the visitor’s guide opens from its button and closes again', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#help')).toBeHidden();
    await page.evaluate(() => document.getElementById('help-btn').click());
    await expect(page.locator('#help')).toBeVisible();
    await page.evaluate(() => document.getElementById('help-close').click());
    await expect(page.locator('#help')).toBeHidden();
  });

  test('Esc with a free cursor steps out to the entrance, and entering resumes', async ({ page }) => {
    await boot(page);
    await enter(page);
    /* Headless Chromium grants pointer lock, and a locked Esc belongs to the
       browser — free the cursor first, exactly as a visitor's first press
       does, then send the second. */
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement);
    await page.keyboard.press('Escape');
    await expect(page.locator('#intro')).toBeVisible();
    expect(await page.evaluate(() => document.body.classList.contains('entered'))).toBe(false);
    await enter(page);
    await expect(page.locator('#intro')).toBeHidden();
  });

  test('a work hangs on one wall at a time', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const out = {};
      window.DBG.placeForTest('0,0:0', 'u1');
      out.second = window.DBG.hangForTest('0,0:1', 'u1');   // refused: u1 already hangs
      out.other  = window.DBG.hangForTest('0,0:1', 'u2');   // a different work is fine
      out.rehang = window.DBG.hangForTest('0,0:0', 'u1');   // its own frame is a rehang
      return out;
    });
    expect(r.second).toEqual({ blocked: '0,0:0' });
    expect(r.other).toEqual({ placed: '0,0:1' });
    expect(r.rehang).toEqual({ placed: '0,0:0' });
  });

  test('the wing sizer clamps and the route grows by whole rooms', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      neg: window.DBG.wingSizeForTest(-3),
      big: window.DBG.wingSizeForTest(99),
      base: window.DBG.wingRoute(12).length,
      grown: (window.DBG.wingSizeForTest(2), window.DBG.wingRouteSized(12).length),
      reset: window.DBG.wingSizeForTest(0),
    }));
    expect(r.neg).toBe(0);
    expect(r.big).toBe(39);
    expect(r.grown).toBeGreaterThan(r.base);
    expect(r.reset).toBe(0);
  });
});
