import { test, expect } from '@playwright/test';
import { boot, enter, hashes, WORKS, ROOMS, ENTER_MS } from './helpers.js';

test.describe('the cloud layer', () => {
  test('the archive stub answers every call the real client does', async () => {
    /* The archive build swaps cloud/client.js for an inert stub of the same
       shape. esbuild only notices a missing export at build time, so adding a
       function to the client and forgetting the stub breaks `npm run archive`
       and nothing else — which is exactly what happened when password sign-in
       landed. CI caught it; this catches it a step earlier and says why. */
    const fs = await import('node:fs/promises');
    const names = (src) => new Set(
      [...src.matchAll(/export (?:async function|function|const) (\w+)/g)].map((m) => m[1]));
    const real = names(await fs.readFile('src/cloud/client.js', 'utf8'));
    const stub = names(await fs.readFile('src/cloud/client.stub.js', 'utf8'));
    const missing = [...real].filter((n) => !stub.has(n));
    expect(missing, `client.stub.js is missing: ${missing.join(', ')}`).toEqual([]);
  });

  /* The point of decoupling it: the read calls return plain data and touch
     neither the DOM nor the render scheduler, so they can be driven against a
     stubbed transport with no Supabase project in the loop. */
  test('reads return data against a stubbed transport', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(async () => {
      const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      const seen = [];
      window.DBG.cloudFetch((url) => {
        seen.push(String(url).replace(/^https?:\/\/[^/]+/, ''));
        if (url.includes('/profiles?slug=')) return json([{ id: 'owner-1' }]);
        if (url.includes('/uploads?owner=')) return json([{ id: 'u1', name: 'Study', path: 'owner-1/u1.jpg' }]);
        if (url.includes('/placements?owner=')) return json([{ k: '0,0:2', upload_id: 'u1' }]);
        return json([]);
      });
      const data = await window.DBG.cloudLoadGallery('somebody');
      window.DBG.cloudFetch(null);
      return { data, seen };
    });

    expect(result.data.slug).toBe('somebody');
    expect(result.data.owner).toBe('owner-1');
    expect(result.data.uploads).toHaveLength(1);
    expect(result.data.uploads[0].name).toBe('Study');
    expect(result.data.uploads[0].url).toContain('/storage/v1/object/public/loans/owner-1/u1.jpg');
    expect(result.data.placements).toEqual([['0,0:2', 'u1']]);
    expect(result.seen.some((u) => u.includes('/rest/v1/profiles?slug=eq.somebody'))).toBe(true);
  });

  test('a failed write is kept and sent when the cloud comes back', async ({ page }) => {
    await boot(page);
    /* Writes used to be fire-and-forget: the local change had already happened,
       so one that did not land left the gallery and the cloud disagreeing until
       the next reload — where the cloud won and the visitor's hanging vanished
       with no explanation. Losing an evening's arranging to a dropped
       connection is not an acceptable failure mode. */
    const r = await page.evaluate(async () => {
      window.DBG.outbox('clear');
      window.DBG.cloudSessForTest(true);
      let allow = false, sent = 0;
      window.DBG.cloudFetch((url, opt) => {
        if (!allow) return Promise.reject(new Error('offline'));
        sent++;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      });

      /* Three hangings while the network is down. */
      window.DBG.placeForTest('0,0:0', 'u1');
      window.DBG.outbox('clear');
      for (const k of ['0,0:0', '0,0:1', '0,0:2']) window.DBG.enqueueForTest(k, 'u1');
      await new Promise((res) => setTimeout(res, 400));
      const offline = window.DBG.outbox();

      /* The same frame written again must replace, not stack. */
      window.DBG.enqueueForTest('0,0:1', 'u2');
      const coalesced = window.DBG.outbox();

      allow = true;
      window.DBG.outbox('flush');
      for (let i = 0; i < 40 && window.DBG.outbox().pending > 0; i++)
        await new Promise((res) => setTimeout(res, 100));
      const after = window.DBG.outbox();

      window.DBG.cloudFetch(null);
      window.DBG.cloudSessForTest(false);
      window.DBG.outbox('clear');
      return { offline, coalesced, after, sent };
    });

    console.log(`    held ${r.offline.pending} while offline · `
              + `${r.coalesced.pending} after rewriting one · ${r.after.pending} left after reconnect`);
    expect(r.offline.pending).toBe(3);        // nothing was thrown away
    expect(r.coalesced.pending).toBe(3);      // rewriting a frame replaced it
    expect(r.after.pending).toBe(0);          // and the backlog drained
    expect(r.sent).toBeGreaterThan(0);
  });

  test('a guest is put in front of the work, not at the origin', async ({ page }) => {
    await boot(page);
    /* The failure this guards: works hang wherever the curator walked, so a
       visitor dropped at (0,0) sees generated art, assumes that is all there
       is, and leaves without finding the collection at all. */
    const out = await page.evaluate(() => {
      window.DBG.tp(0, 0);
      const hung = ['7,-4:1', '-2,9:0', '3,3:2'];      // scattered, none at origin
      hung.forEach((k, n) => window.DBG.placeForTest(k, 'u' + n));
      const at = window.DBG.collectionSpawn();
      return { at, origin: [0, 0] };
    });

    expect(out.at).not.toBeNull();
    // nearest by rooms-walked: 3,3 (ring 3) beats 7,-4 (7) and -2,9 (9)
    expect([out.at.gx, out.at.gz]).toEqual([3, 3]);
    expect([out.at.gx, out.at.gz]).not.toEqual(out.origin);
    expect(Number.isFinite(out.at.yaw)).toBe(true);
  });

  test('an unknown gallery name resolves to null, not an exception', async ({ page }) => {
    await boot(page);
    const data = await page.evaluate(async () => {
      window.DBG.cloudFetch(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }));
      const out = await window.DBG.cloudLoadGallery('nobody');
      window.DBG.cloudFetch(null);
      return out;
    });
    expect(data).toBeNull();
  });

  test('the seeded gallery is unaffected when the cloud is unreachable', async ({ page }) => {
    await boot(page);
    // The archival case: no backend at all. Every seeded work is generated
    // locally, so the museum itself must not depend on the network.
    const out = await page.evaluate(async () => {
      const before = window.DBG.artHash(0, 0, 0).hash;
      window.DBG.cloudFetch(() => Promise.reject(new Error('offline')));
      let threw = null;
      try { await window.DBG.cloudLoadGallery('anything'); } catch (e) { threw = String(e.message); }
      const after = window.DBG.artHash(0, 0, 0).hash;
      window.DBG.cloudFetch(null);
      return { before, after, threw, rooms: window.DBG.stats().cached, doors: window.DBG.doors(1, 0) };
    });
    expect(out.after).toBe(out.before);      // the art is untouched by the outage
    expect(out.rooms).toBeGreaterThan(0);
    expect(out.doors).toHaveProperty('e');
  });
});

/* One shared page: entering costs ~12s under SwiftShader, so paying it once
   for the whole group keeps the suite tractable. */
