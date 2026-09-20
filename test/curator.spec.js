import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bootCurator as boot, enter } from './helpers.js';

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
    await expect(page.locator('#cur-sync')).toHaveAttribute('open', '');
    await expect(page.locator('#cur-cloud-lock')).toBeVisible();
    await expect(page.locator('#cur-cloud-lock')).toContainText('claim a gallery name');
  });


  test('a signed-in curator sees claim name without opening another drawer', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.DBG.cloudReady());
    await page.evaluate(() => {
      window.DBG.cloudSessForTest(true);
      document.getElementById('sw-curator').click();
    });

    await expect(page.locator('#cur-sync')).toHaveAttribute('open', '');
    await expect(page.locator('#cur-share')).toBeVisible();
    await expect(page.locator('#cur-slug')).toBeVisible();
    await expect(page.locator('#cur-slug-save')).toBeVisible();
    await expect(page.locator('#cur-share-link')).toContainText('claim a name');
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

    /* Image decode and resize run on the same software renderer as the gallery
       in CI. Under a loaded worker the valid file can remain in Preparing for
       several seconds even though the transaction is progressing normally. */
    await expect(page.locator('#cur-upload-list [data-state="saved"]')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator('#cur-upload-list [data-state="error"]')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator('#cur-upload-list [data-state="error"] button')).toHaveText('Retry');
    await expect(page.locator('#cur-grid .cur-item')).toHaveCount(1);

    await page.reload();
    await page.waitForFunction(() => typeof window.DBG?.stats === 'function');
    await page.evaluate(() => document.getElementById('sw-curator').click());
    await expect(page.locator('#cur-grid .cur-item')).toHaveCount(1);
    await expect(page.locator('#cur-grid .cur-item .nm')).toHaveText('sunrise');
  });

  test('a signed-in cloud outage still keeps a new upload locally', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.DBG.cloudSessForTest(true);
      window.DBG.cloudFetch(() => Promise.reject(new TypeError('Failed to fetch')));
      document.getElementById('sw-curator').click();
    });
    await page.locator('#cur-file').setInputFiles([
      { name: 'offline.jpg', mimeType: 'image/jpeg', buffer: image },
    ]);

    await expect(page.locator('#cur-upload-list [data-state="saved"]')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator('#cur-grid .cur-item')).toHaveCount(1);
    await expect(page.locator('#cur-storage-label')).toHaveText('Needs attention');
    const state = await page.evaluate(async () => ({
      works: window.DBG.collectionForTest(),
      local: await window.DBG.localRecordsForTest(),
    }));
    expect(state.works).toHaveLength(1);
    expect(state.works[0].cloudRec).toBe(false);
    expect(state.works[0].hasBlob).toBe(true);
    expect(state.local).toEqual([state.works[0].id]);
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

  test('failed migration leaves every local work and placement intact', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      window.__migration = { cleanup: [] };
      const reply = (ok = true) => Promise.resolve({
        ok, status: ok ? 200 : 503, json: () => Promise.resolve([]),
      });
      window.DBG.cloudSessForTest(true);
      await window.DBG.localWorkForTest('local-a', 'First local work', '0,0:0');
      await window.DBG.localWorkForTest('local-b', 'Second local work');
      window.DBG.cloudFetch((url, options = {}) => {
        if (options.method === 'POST' && url.includes('/rest/v1/placements')) return reply(false);
        if (options.method === 'DELETE') window.__migration.cleanup.push(url);
        return reply(true);
      });
      document.getElementById('sw-curator').click();
      document.getElementById('cur-migrate').click();
    });

    await expect(page.locator('#cur-migrate-status')).toContainText('Every local work remains');
    const state = await page.evaluate(() => ({
      works: window.DBG.collectionForTest(),
      placements: window.DBG.placementsForTest(),
      cleanup: window.__migration.cleanup,
    }));
    expect(state.works.map((work) => work.id)).toEqual(['local-a', 'local-b']);
    expect(state.works.every((work) => work.hasBlob && !work.cloudRec)).toBe(true);
    expect(state.placements).toEqual([['0,0:0', 'local-a']]);
    expect(state.cleanup.filter((url) => url.includes('/storage/v1/object/'))).toHaveLength(2);
    expect(state.cleanup.filter((url) => url.includes('/rest/v1/uploads'))).toHaveLength(2);
  });

  test('successful migration switches IDs only after uploads and placements finish', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      window.__migration = { remoteIds: [], placementIds: [] };
      const reply = (body = []) => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve(body),
      });
      window.DBG.cloudSessForTest(true, { persist: true });
      await window.DBG.localWorkForTest('local-a', 'First local work', '0,0:0', 'landscape', 'bleed');
      await window.DBG.localWorkForTest('local-b', 'Second local work');
      window.DBG.cloudFetch((url, options = {}) => {
        if (options.method === 'POST' && url.includes('/rest/v1/uploads'))
          window.__migration.remoteIds.push(JSON.parse(options.body).id);
        if (options.method === 'POST' && url.includes('/rest/v1/placements'))
          window.__migration.placementIds.push(JSON.parse(options.body).upload_id);
        return reply();
      });
      document.getElementById('sw-curator').click();
      document.getElementById('cur-migrate').click();
    });

    await expect(page.locator('#cur-migrate-status')).toContainText('2 works synced');
    const state = await page.evaluate(() => ({
      works: window.DBG.collectionForTest(),
      placements: window.DBG.placementsForTest(),
      fills: window.__migration.remoteIds.map((id) => window.DBG.fillForTest(id)),
      ...window.__migration,
    }));
    expect(state.works.map((work) => work.id)).toEqual(state.remoteIds);
    expect(state.works.every((work) => work.hasBlob && work.cloudRec)).toBe(true);
    expect(state.placements).toEqual([['0,0:0', state.remoteIds[0]]]);
    expect(state.placementIds).toEqual([state.remoteIds[0]]);
    expect(state.fills).toEqual(['bleed', 'mount']);
    expect(await page.evaluate(() => window.DBG.localRecordsForTest())).toEqual(['local-a', 'local-b']);

    await page.addInitScript(({ remoteIds }) => {
      window.fetch = async (url) => {
        let body = [];
        if (url.includes('/rest/v1/uploads?')) body = remoteIds.map((id, i) => ({
          id, name: i ? 'Second local work' : 'First local work',
          path: `test/${id}.jpg`, bucket: 'loans',
        }));
        else if (url.includes('/rest/v1/placements?'))
          body = [{ k: '0,0:0', upload_id: remoteIds[0] }];
        return { ok: true, status: 200, json: async () => body };
      };
    }, { remoteIds: state.remoteIds });
    await page.reload();
    await page.waitForFunction(() => typeof window.DBG?.cloudReady === 'function');
    await page.evaluate(() => window.DBG.openWorkspaceForTest());
    const recovered = await page.evaluate(async () => ({
      works: window.DBG.collectionForTest(),
      placements: window.DBG.placementsForTest(),
      local: await window.DBG.localRecordsForTest(),
    }));
    expect(recovered.works.map((work) => work.id)).toEqual(state.remoteIds);
    expect(recovered.works.every((work) => work.cloudRec && work.hasBlob)).toBe(true);
    expect(recovered.placements).toEqual([['0,0:0', state.remoteIds[0]]]);
    expect(recovered.local).toEqual(['local-a', 'local-b']);
  });

  test('migration refuses a frame conflict without uploading or hiding the local wall', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      window.__migrationPosts = 0;
      window.DBG.cloudSessForTest(true);
      await window.DBG.localWorkForTest('local-a', 'Local wall', '0,0:0');
      window.DBG.cloudWorkForTest('cloud-a', 'Cloud wall');
      window.DBG.cloudPlacementsForTest([['0,0:0', 'cloud-a']], true);
      window.DBG.cloudFetch((url, options = {}) => {
        if (options.method === 'POST') window.__migrationPosts++;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      });
      document.getElementById('sw-curator').click();
      document.getElementById('cur-migrate').click();
    });

    await expect(page.locator('#cur-migrate-status')).toContainText('share a frame with a synced work');
    expect(await page.evaluate(() => window.__migrationPosts)).toBe(0);
    expect(await page.evaluate(() => window.DBG.placementsForTest())).toEqual([['0,0:0', 'local-a']]);
    await expect(page.locator('#cur-storage-label')).toHaveText('Needs attention');
  });

  test('failed cloud cleanup is kept in the durable retry queue', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      const reply = (ok = true) => Promise.resolve({
        ok, status: ok ? 200 : 503, json: () => Promise.resolve([]),
      });
      window.DBG.cloudSessForTest(true);
      await window.DBG.localWorkForTest('local-a', 'Cleanup study', '0,0:0');
      window.DBG.cloudFetch((url, options = {}) => {
        if (options.method === 'POST' && url.includes('/rest/v1/placements')) return reply(false);
        if (options.method === 'DELETE') return reply(false);
        return reply(true);
      });
      document.getElementById('sw-curator').click();
      document.getElementById('cur-migrate').click();
    });

    await expect(page.locator('#cur-migrate-status')).toContainText('cleanup needs attention');
    await expect.poll(() => page.evaluate(() => window.DBG.outbox().pending)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.DBG.placementsForTest())).toEqual([['0,0:0', 'local-a']]);
  });

  test('migration can be cancelled while the collection stays locked and local', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      const reply = (ok = true) => ({ ok, status: ok ? 200 : 503, json: () => Promise.resolve([]) });
      window.DBG.cloudSessForTest(true);
      await window.DBG.localWorkForTest('local-a', 'Slow local work', '0,0:0');
      window.DBG.cloudFetch((url, options = {}) => {
        if (options.method === 'POST' && url.includes('/storage/v1/object/'))
          return new Promise((resolve) => { window.__finishMigrationUpload = () => resolve(reply(true)); });
        return Promise.resolve(reply(true));
      });
      document.getElementById('sw-curator').click();
      document.getElementById('cur-migrate').click();
    });

    await expect(page.locator('#cur-migrate')).toHaveText('Cancel sync');
    await expect(page.locator('#cur-gather')).toBeDisabled();
    await page.locator('#cur-migrate').click();
    await page.evaluate(() => window.__finishMigrationUpload());
    await expect(page.locator('#cur-migrate-status')).toContainText('Sync cancelled');
    expect(await page.evaluate(() => window.DBG.placementsForTest())).toEqual([['0,0:0', 'local-a']]);
    expect((await page.evaluate(() => window.DBG.collectionForTest())).map((work) => work.id))
      .toEqual(['local-a']);
  });
});
