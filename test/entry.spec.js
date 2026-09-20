import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.databaseOpens = 0;
    window.ownerReads = [];
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { window.databaseOpens++; return open(...args); };
    window.fetch = async url => {
      if (String(url).includes('/rest/v1/')) window.ownerReads.push(String(url));
      if (String(url).includes('/functions/v1/share-gallery')) return {
        ok: true, status: 200, json: async () => ({ gallery: { slug: 'alice', uploads: [], placements: [] } }),
      };
      return { ok: true, status: 200, json: async () => [] };
    };
  });
});

test('a remembered sign-in still asks and exploration never loads the owner collection', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lumiere_sess', JSON.stringify({
    uid: 'owner', access_token: 'test', expires_at: Date.now() + 3600000,
  })));
  await boot(page);
  await page.evaluate(() => window.DBG.cloudReady());
  await expect(page.locator('#entry-account')).toContainText('You’re signed in');
  await expect(page.getByRole('button', { name: 'Curate my collection' })).toBeVisible();
  expect(await page.evaluate(() => [window.databaseOpens, window.ownerReads.length])).toEqual([0, 0]);
  await enter(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(await page.evaluate(() => window.DBG.collectionForTest())).toEqual([]);
  expect(await page.evaluate(() => [window.databaseOpens, window.ownerReads.length])).toEqual([0, 0]);
});

test('local works load only after choosing Curate and stay out of the next visit', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('lumiere', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
      request.onerror = reject;
      request.onsuccess = () => {
        const tx = request.result.transaction('images', 'readwrite');
        tx.objectStore('images').put({ id: 'private-local', name: 'My private study', blob: new Blob(['image']) });
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onerror = reject;
      };
    });
    localStorage.setItem('lumiere_placements', JSON.stringify([['0,0:0', 'private-local']]));
  });
  await page.reload();
  await page.waitForFunction(() => window.DBG?.cloudReady);
  await page.evaluate(() => window.DBG.cloudReady());
  expect(await page.evaluate(() => window.databaseOpens)).toBe(0);
  expect(await page.evaluate(() => window.DBG.placementsForTest())).toEqual([]);
  await page.locator('#entry-curate').click();
  await expect(page.locator('#curator')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#cur-grid')).toContainText('My private study');
  expect(await page.evaluate(() => window.DBG.placementsForTest())).toEqual([['0,0:0', 'private-local']]);
  await page.locator('#cur-close').click();
  await page.evaluate(() => document.exitPointerLock?.());
  await page.locator('#back-btn').click();
  await expect(page.locator('#entry-curate')).toBeVisible();
  await page.waitForFunction(() => window.DBG?.cloudReady);
  expect(await page.evaluate(() => window.DBG.collectionForTest())).toEqual([]);
  expect(await page.evaluate(() => window.databaseOpens)).toBe(0);
});

test('choosing Curate while signed in loads the account once', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lumiere_sess', JSON.stringify({
    uid: 'owner', access_token: 'test', expires_at: Date.now() + 3600000,
  })));
  await boot(page);
  await page.locator('#entry-curate').click();
  await expect(page.locator('#curator')).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => window.databaseOpens)).toBe(1);
  expect(await page.evaluate(() => window.ownerReads.filter(url => url.includes('/uploads?')).length)).toBe(1);
  await page.locator('#cur-close').click();
  await page.evaluate(() => document.getElementById('sw-curator').click());
  await expect(page.locator('#curator')).toBeVisible();
  expect(await page.evaluate(() => window.databaseOpens)).toBe(1);
});

test('the visit form rejects unrelated links and navigates to a named collection', async ({ page }) => {
  await boot(page);
  await page.locator('#entry-visit summary').click();
  await page.locator('#entry-gallery').fill('https://example.com/?gallery=alice');
  await page.getByRole('button', { name: 'Visit', exact: true }).click();
  await expect(page.locator('#entry-link-error')).toContainText('share link for this gallery');
  await page.locator('#entry-gallery').fill('Alice');
  await page.getByRole('button', { name: 'Visit', exact: true }).click();
  await expect(page).toHaveURL(/\?gallery=alice$/);
  await expect(page.locator('#entry-choices')).toBeHidden();
});

test('the entrance fits a phone without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect(page.locator('#entry-curate')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/lumiere-entry-mobile.png' });
});

test('pasting a private fragment link starts a fresh shared visit', async ({ page }) => {
  // No query: this catches accidental same-document hash navigation.
  await boot(page);
  await page.evaluate(() => history.replaceState(null, '', location.pathname));
  const url = await page.evaluate(() => location.origin + location.pathname + '#share=' + 'A'.repeat(43));
  await page.locator('#entry-visit summary').click();
  await page.locator('#entry-gallery').fill(url);
  await page.getByRole('button', { name: 'Visit', exact: true }).click();
  await expect(page.locator('#intro-sub')).toHaveText('The Collection of alice', { timeout: 60000 });
  await expect(page.locator('#entry-choices')).toBeHidden();
  expect(await page.evaluate(() => window.databaseOpens)).toBe(0);
});
