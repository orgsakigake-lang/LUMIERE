import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, enter } from './helpers.js';

const image = readFileSync(new URL('../preview.jpg', import.meta.url));

test.describe('the local-first curator', () => {
  test('cloud configuration does not hide the signed-out local workspace', async ({ page }) => {
    await page.addInitScript(() => {
      window.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
    });
    await boot(page);
    await page.evaluate(() => window.DBG.cloudReady());
    await page.evaluate(() => document.getElementById('sw-curator').click());

    await expect(page.locator('#cur-open')).toBeVisible();
    await expect(page.locator('label[for="cur-file"]')).toBeVisible();
    await expect(page.locator('#cur-gather')).toBeVisible();
    await expect(page.locator('#cur-state')).toContainText(/On this device|This visit only/);
    await expect(page.locator('#cur-sync')).toBeVisible();
    await expect(page.locator('#cur-cloud-lock')).toBeHidden();

    await page.locator('#cur-sync summary').click();
    await expect(page.locator('#cur-cloud-lock')).toBeVisible();
  });

  test('a signed-out batch persists valid works and isolates a corrupt file', async ({ page }) => {
    await page.addInitScript(() => {
      window.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
    });
    await boot(page);
    await page.evaluate(() => document.getElementById('sw-curator').click());
    await page.locator('#cur-file').setInputFiles([
      { name: 'sunrise.jpg', mimeType: 'image/jpeg', buffer: image },
      { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') },
    ]);

    await expect(page.locator('#cur-upload-list [data-state="saved"]')).toHaveCount(1);
    await expect(page.locator('#cur-upload-list [data-state="error"]')).toHaveCount(1);
    await expect(page.locator('#cur-upload-list [data-state="error"] button')).toHaveText('Retry');
    await expect(page.locator('#cur-grid .cur-item')).toHaveCount(1);

    await page.reload();
    await page.waitForFunction(() => typeof window.DBG?.stats === 'function');
    await page.evaluate(() => document.getElementById('sw-curator').click());
    await expect(page.locator('#cur-grid .cur-item')).toHaveCount(1);
    await expect(page.locator('#cur-grid .cur-item .nm')).toHaveText('sunrise');
  });

  test('automatic arrangement preserves manual work and undo restores the exact map', async ({ page }) => {
    await boot(page);
    const original = await page.evaluate(() => {
      const [gx, gz, gy] = window.DBG.wingRoute(4)[0];
      const frame = window.DBG.frameKeyForTest(gx, gz, gy, 0);
      window.DBG.loanForTest('manual', 'Kept by hand', '', frame, 'portrait');
      window.DBG.loanForTest('wide', 'Wide horizon', '', null, 'landscape');
      window.DBG.loanForTest('square', 'Square study', '', null, 'square');
      window.DBG.loanForTest('portrait', 'Tall figure', '', null, 'portrait');
      return window.DBG.placementsForTest();
    });
    await page.evaluate(() => document.getElementById('sw-curator').click());

    await expect(page.locator('#cur-gather')).toHaveText('Arrange automatically');
    await page.evaluate(() => document.getElementById('cur-gather').click());
    const arranged = await page.evaluate(() => window.DBG.placementsForTest());

    expect(arranged).toContainEqual(original[0]);
    expect(new Set(arranged.map(([, id]) => id)).size).toBe(4);
    expect(arranged).toHaveLength(4);

    await page.evaluate(() => document.getElementById('sw-curator').click());
    await expect(page.locator('#cur-arrange-undo')).toBeVisible();
    await page.locator('#cur-arrange-undo').click();
    expect(await page.evaluate(() => window.DBG.placementsForTest())).toEqual(original);
  });

  test('manual placement names the selected work and Escape cancels without moving it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.DBG.loanForTest('next', 'Summer Window', '', null, 'landscape');
      window.DBG.selectForTest('next');
    });
    await enter(page);
    await page.evaluate(() => document.getElementById('sw-curator').click());
    const before = await page.evaluate(() => window.DBG.placementsForTest());

    await page.locator('#cur-place').click();
    await expect(page.locator('#curator')).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/placing/);
    await page.evaluate(() => {
      const A = window.DBG.art(0, 0)[0];
      const IN = 7 - 0.24 - 2;
      const p = { e: [ IN, A.u,  Math.PI/2], w: [-IN, A.u, -Math.PI/2],
                  n: [ A.u,  IN, Math.PI  ], s: [ A.u, -IN, 0        ] }[A.wall];
      window.DBG.pos(p[0], p[1], p[2], 0);
      window.DBG.frame(8, 16.7);
    });
    await expect(page.locator('#hang-btn')).toBeVisible();
    await expect(page.locator('#hang-btn')).toHaveAttribute('aria-label', /Hang Summer Window here/);

    await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })));
    await expect(page.locator('body')).not.toHaveClass(/placing/);
    expect(await page.evaluate(() => window.DBG.placementsForTest())).toEqual(before);
  });
});
