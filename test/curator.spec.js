import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot } from './helpers.js';

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
});
