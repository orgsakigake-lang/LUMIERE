import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

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
});
