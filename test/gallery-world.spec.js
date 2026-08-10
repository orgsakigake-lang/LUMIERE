import { test, expect } from '@playwright/test';
import { boot, enter, hashes, WORKS, ROOMS, ENTER_MS } from './helpers.js';

test.describe.serial('inside the gallery — world and renderer', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 720, height: 405 } });
    await boot(page);
    await enter(page);
  });
  test.afterAll(async () => { await page?.close(); });

  test('frame stepping is synchronous and finite', async ({}, testInfo) => {
    await page.evaluate(() => window.DBG.frame(20, 16.7));            // warm up
    const t = await page.evaluate(() => window.DBG.frame(60, 16.7));
    testInfo.annotations.push({ type: 'frame', description: `avg ${t.avgMs}ms max ${t.maxMs}ms` });
    console.log(`    frame: avg ${t.avgMs}ms  max ${t.maxMs}ms  (SwiftShader — not a perf number)`);
    expect(t.stepped).toBe(60);   // sixty proves 'synchronous and finite' as well as a hundred and twenty
    expect(Number.isFinite(t.avgMs)).toBe(true);
    expect(t.avgMs).toBeGreaterThan(0);
  });

  test('portal culling draws fewer rooms and changes no pixels', async () => {
    /* The museum is a portal graph and had stored it in r.doors since the world
       generator was written, without using it: frustum culling alone kept every
       room of the 5x5 neighbourhood inside the view cone, including ones sealed
       behind a solid wall. Culling is only ever allowed to change how many
       rooms are asked to produce the image, never the image — so this compares
       the two strategies pixel for pixel.

       Two things have to hold still for that to mean anything. Animation time
       is pinned, because flames, moon shafts, motes and the grain all run off
       the wall clock and an unfrozen comparison silently measures noise instead
       of geometry. And the theme is switched to a solo one, because it
       generates nothing: otherwise a painting finishes between the two reads
       and the diff is art arriving, not a room going missing. Both of those
       were live failures before they were guards. */
    const rows = await page.evaluate(() => {
      const c = document.getElementById('gl'), g = c.getContext('webgl2');
      const hash = () => {
        window.DBG.frame(4, 16.7);
        const w = c.width, h = c.height, b = new Uint8Array(w*h*4);
        g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, b);
        let x = 2166136261;
        for (let i = 0; i < b.length; i += 29){ x ^= b[i]; x = Math.imul(x, 16777619); }
        return x >>> 0;
      };
      window.DBG.freeze(12.5);
      window.DBG.theme('graphite');          // solo: nothing generates mid-comparison
      const out = [];
      for (const [gx, gz, yaw] of [[0,0,0], [0,0,Math.PI/2], [1,0,0], [-2,3,0.7], [4,-1,Math.PI]]){
        window.DBG.tp(gx, gz, yaw);
        window.DBG.frame(6, 16.7);
        window.DBG.culling('portal');  const hp = hash(), cp = window.DBG.culling().portal;
        window.DBG.culling('frustum'); const hf = hash(), cf = window.DBG.culling().frustum;
        out.push({ at: `${gx},${gz}`, identical: hp === hf, portal: cp, frustum: cf });
      }
      window.DBG.culling('portal');
      window.DBG.freeze(null);
      window.DBG.theme('salon');
      return out;
    });

    const drawn = rows.reduce((s, r) => s + r.portal, 0);
    const before = rows.reduce((s, r) => s + r.frustum, 0);
    console.log(`    rooms drawn across ${rows.length} views: ${drawn} portal vs ${before} frustum`);

    for (const r of rows)
      expect(r.identical, `view ${r.at} differs between culling strategies`).toBe(true);
    expect(drawn).toBeLessThan(before * 0.6);   // and it is a real saving
  });

  test('walls stop the visitor', async () => {
    /* Collision had no coverage at all, and it is the one system where a
       regression is unrecoverable from inside the museum: walk through a wall
       in an infinite procedural world and there is no way back. */
    /* Walked at *closed* walls only. Room (0,0) has all four doors open, and a
       visitor who walks through a doorway is carried into the next room by the
       floating origin — which looks exactly like passing through a wall if you
       only read the coordinate. The first version of this test asserted
       nothing for that reason. */
    const out = await page.evaluate(() => {
      const IN = 6.76, YAW = { e: Math.PI/2, w: -Math.PI/2, n: Math.PI, s: 0 };
      const res = [];
      for (let gx = 0; gx < 8 && res.length < 2; gx++)
        for (let gz = 0; gz < 8 && res.length < 2; gz++){
          const doors = window.DBG.doors(gx, gz);
          const shut = ['e','w','n','s'].find((k) => !doors[k]);
          if (!shut) continue;
          const yaw = YAW[shut];
          window.DBG.tp(gx, gz, yaw);
          window.DBG.pos(0, 0, yaw, 0);
          const room0 = window.DBG.stats().room.join(',');
          /* Deliberately smaller than half the wall slab (0.24 m): a step that
             can jump the collider in one frame tests tunnelling, not walls, and
             this is asserting that walls stop people. Kept short because the
             walk renders a frame per step and the suite shares one page. */
          for (let i = 0; i < 70; i++){
            const s = window.DBG.stats();
            window.DBG.pos(s.pos[0] + Math.sin(yaw)*0.11,
                           s.pos[1] - Math.cos(yaw)*0.11, yaw, 0);
            window.DBG.frame(1, 16.7);
          }
          const s = window.DBG.stats();
          res.push({ at: `${gx},${gz}`, wall: shut,
                     x: +s.pos[0].toFixed(2), z: +s.pos[1].toFixed(2),
                     held: s.room.join(',') === room0
                           && Math.abs(s.pos[0]) < IN + 0.05
                           && Math.abs(s.pos[1]) < IN + 0.05 });
        }
      return res;
    });
    console.log('    ' + out.map((r) => `${r.at} ${r.wall}-wall → (${r.x}, ${r.z})`).join(' · '));
    expect(out.length).toBeGreaterThan(0);
    for (const r of out)
      expect(r.held, `walked through the ${r.wall} wall of room ${r.at} to (${r.x}, ${r.z})`).toBe(true);
  });

  test('a lost GL context rebuilds the museum', async () => {
    /* Everything derives from seeds, which is what makes recovery possible at
       all — but nothing checked that the handler actually reaches the other
       side. A browser drops the context on driver updates and on memory
       pressure, and a museum that dies there dies silently. */
    const before = await page.evaluate(() => window.DBG.stats().cached);
    const restored = await page.evaluate(async () => {
      const c = document.getElementById('gl');
      const ext = c.getContext('webgl2').getExtension('WEBGL_lose_context');
      if (!ext) return 'no extension';
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 60));
      ext.restoreContext();
      for (let i = 0; i < 40; i++){
        await new Promise((r) => setTimeout(r, 50));
        if (!c.getContext('webgl2').isContextLost()) break;
      }
      return c.getContext('webgl2').isContextLost() ? 'still lost' : 'restored';
    });
    if (restored === 'no extension') test.skip();
    expect(restored).toBe('restored');

    /* And it has to keep working, not merely stop throwing. */
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
      window.DBG.tp(0, 0, 0);
      window.DBG.frame(6, 16.7);
      return { cached: window.DBG.stats().cached, hist: window.DBG.histogram(4) };
    });
    console.log(`    rooms ${before} → ${after.cached} · frame mean ${after.hist.mean}`);
    expect(after.cached).toBeGreaterThan(0);
    expect(after.hist.mean).toBeGreaterThan(1);      // it is drawing something
    expect(after.hist.hi).toBeGreaterThan(60);       // and it is lit
  });

  test('the art pools survive being asked for more than they hold', async () => {
    /* Pool exhaustion used to become permanent starvation rather than delay:
       slots stayed held by discarded rooms and startJob re-queues rather than
       failing, so the queue sat at "ready 0" for the rest of the session. */
    const out = await page.evaluate(async () => {
      /* Rebuild the world repeatedly with no time to finish, which is what a
         visitor sprinting through the halls does to the scheduler. */
      for (let i = 0; i < 6; i++){
        window.DBG.seed(1000 + i);
        window.DBG.frame(2, 16.7);
        await new Promise((r) => setTimeout(r, 0));
      }
      window.DBG.seed(20260803);
      window.DBG.tp(0, 0, 0);
      for (let i = 0; i < 400 && window.DBG.stats().queued > 0; i++){
        window.DBG.frame(1, 16.7);
        await new Promise((r) => setTimeout(r, 0));
      }
      return { queued: window.DBG.stats().queued,
               ready: window.DBG.art(0, 0).filter((a) => a.ready).length };
    });
    console.log(`    after six teardowns: ${out.ready} works hung, ${out.queued} still queued`);
    expect(out.ready).toBeGreaterThan(0);            // the pools recovered
  });
});
