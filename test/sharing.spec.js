import { test, expect } from '@playwright/test';

const json = body => ({ contentType: 'application/json', body: JSON.stringify(body) });
async function backend(page, profileStatus = 200) {
  await page.route('**/auth/v1/**', route => route.fulfill(json({})));
  await page.route('**/rest/v1/**', route => {
    const url = route.request().url();
    if (url.includes('/profiles?')) return route.fulfill({ ...json([{ id: 'alice', slug: 'alice', theme: 'graphite' }]), status: profileStatus });
    if (url.includes('/uploads?')) return route.fulfill(json([{ id: 'a1', owner: 'alice', name: 'Alice only', path: 'alice/a1.jpg' }]));
    return route.fulfill(json([{ k: '0,0:0', upload_id: 'a1' }]));
  });
  await page.route('**/storage/v1/**', route => route.abort());
}

test('shared entry waits for the named collection', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await backend(page);
  await page.route('**/profiles?*', async route => { await gate; await route.fulfill(json([{ id: 'alice', slug: 'alice' }])); });
  await page.goto('/?q=0&gallery=alice');
  try { await expect(page.locator('#enter')).toBeDisabled(); }
  finally { release(); }
  await expect(page.locator('#enter')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#intro-hook')).toContainText('1 work');
});

test('an unavailable shared link cannot enter unrelated art and can retry', async ({ page }) => {
  await backend(page, 503);
  await page.goto('/?q=0&gallery=alice');
  await page.evaluate(() => window.DBG.cloudReady());
  await expect(page.locator('#enter')).toBeDisabled();
  await expect(page.locator('#intro-sub')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Retry collection' })).toBeVisible();
  await backend(page);
  await page.getByRole('button', { name: 'Retry collection' }).click();
  await expect(page.locator('#enter')).toBeEnabled();
  await expect(page.locator('#intro-sub')).toContainText('alice');
});

test('a shared visit leaves local images parked outside the guest collection', async ({ page }) => {
  await backend(page);
  await page.goto('/?q=0');
  await page.evaluate(async () => {
    await window.DBG.cloudReady();
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('lumiere', 1);
      open.onsuccess = () => {
        const tx = open.result.transaction('images', 'readwrite');
        tx.objectStore('images').put({ id: 'local-secret', name: 'Private local work', blob: new Blob(['image']) });
        tx.oncomplete = () => { open.result.close(); resolve(); }; tx.onerror = reject;
      };
      open.onerror = reject;
    });
  });
  await page.goto('/?q=0&gallery=alice');
  await page.evaluate(() => window.DBG.cloudReady());
  await expect(page.locator('#cur-grid')).toContainText('Alice only');
  await expect(page.locator('#cur-grid')).not.toContainText('Private local work');
});

test('private links gate entry until the manifest arrives and keep local storage isolated', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.addInitScript(() => {
    window.databaseOpens = 0;
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { window.databaseOpens++; return open(...args); };
  });
  await page.route('**/functions/v1/share-gallery', async route => {
    await gate;
    await route.fulfill(json({ gallery: { slug: 'alice', uploads: [], placements: [] } }));
  });
  await page.goto('/?q=0#share=' + 'A'.repeat(43));
  try { await expect(page.locator('#enter')).toBeDisabled(); }
  finally { release(); }
  await expect(page.locator('#enter')).toBeEnabled({ timeout: 60000 });
  expect(await page.evaluate(() => window.databaseOpens)).toBe(0);
  await expect(page).not.toHaveURL(/#share=/);
  await page.evaluate(() => document.getElementById('sw-curator').click());
  await expect(page.locator('#cur-state')).toContainText('guest');
});

test('invalid private links stay unavailable instead of becoming an owner visit', async ({ page }) => {
  await page.goto('/?q=0#share=invalid');
  await page.evaluate(() => window.DBG.cloudReady());
  await expect(page.locator('#enter')).toBeDisabled();
  await expect(page.locator('#intro-sub')).toContainText('No such collection');
});
