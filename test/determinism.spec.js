import { test, expect } from '@playwright/test';
import { boot, enter, hashes, WORKS, ROOMS, ENTER_MS } from './helpers.js';

/* Left serial on purpose. These tests are independent — each takes its own
   page and works through artHash, off the render path — so `mode: 'parallel'`
   is valid here and was tried. It made the whole suite *slower*, 6.4 minutes
   to 8.7: the work is CPU-bound generator time, four workers already saturate
   the machine, and a fifth and sixth compete for the same cores rather than
   overlapping. This file being the longest single file is the price of the
   run being as short as it is. */
test.describe('determinism', () => {
  test('the same seed paints the same pixels across reloads', async ({ page }) => {
    await boot(page);
    const first = await hashes(page);
    expect(first.every((h) => typeof h === 'number')).toBe(true);

    await page.reload();
    await page.waitForFunction(() => typeof window.DBG?.artHash === 'function', null, { timeout: 60_000 });
    expect(await hashes(page)).toEqual(first);
  });

  test('world generation is a pure function of the seed', async ({ page }) => {
    await boot(page);
    const shape = () => page.evaluate((rooms) => rooms.map(([gx, gz]) => ({
      seed: window.DBG.roomSeed(gx, gz),
      doors: window.DBG.doors(gx, gz),
      art: window.DBG.art(gx, gz).map((a) => `${a.wall}${a.asp}${a.algo}/${a.pal}:${a.seed}`),
    })), ROOMS);

    const before = await shape();
    await page.reload();
    await page.waitForFunction(() => typeof window.DBG?.roomSeed === 'function', null, { timeout: 60_000 });
    expect(await shape()).toEqual(before);
  });

  test('a different world seed paints different pixels', async ({ page }) => {
    await boot(page);
    const base = await hashes(page);
    await page.evaluate(() => window.DBG.seed(12345));
    expect(await hashes(page)).not.toEqual(base);
  });

  test('findSpecial agrees with the rooms it points at', async ({ page }) => {
    await boot(page);
    // These were two independent copies of the same 1/64 thresholds; changing
    // one left the other silently lying. Both now go through classifySpecial.
    const checked = await page.evaluate(() => {
      const out = [];
      for (const type of [1, 2, 3]) {
        const hit = window.DBG.findSpecial(type, 24);
        if (!hit) continue;
        out.push({ type, found: hit.type, actual: window.DBG.room(hit.gx, hit.gz).special });
      }
      return out;
    });
    expect(checked.length).toBeGreaterThan(0);
    for (const c of checked) {
      expect(c.found).toBe(c.type);
      expect(c.actual).toBe(c.type);      // the built room agrees with the search
    }
  });

  test('acquired works are not truncated at acquire resolution', async ({ page }) => {
    await boot(page);
    /* The shared attractor accumulator was fixed at 512², exactly the largest
       pooled texture — so the wall always looked right and every *download*
       was three-quarters black. artHash renders at pool size and could never
       have caught it. Measured before the fix: bands 204, 0, 0, 0. */
    const results = await page.evaluate(() => {
      const out = [];
      outer:
      for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++)
        for (const a of window.DBG.art(gx, gz)) {
          out.push(window.DBG.acquireBands(gx, gz, a.i));
          if (out.length >= 8) break outer;
        }
      return out;
    });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const lo = Math.min(...r.bands), hi = Math.max(...r.bands);
      // No horizontal band of a finished work may be empty while another is lit.
      expect(lo, `algo ${r.algo} at ${r.w}×${r.h} — bands ${r.bands.join(', ')}`)
        .toBeGreaterThan(hi * 0.05);
    }
  });

  test('a wing is a walk, not a scatter', async ({ page }) => {
    await boot(page);
    /* A curator hangs wherever they are standing, which in an infinite museum
       can be a dozen halls apart — fine for the person who walked there, and
       hopeless for a visitor who arrives in front of one drawing with no way
       to know the rest exist. Gathering lays the collection along one route.
       The property that makes it a wing rather than a list of coordinates:
       every room must be reachable from an earlier one through a door that is
       actually open. */
    const route = await page.evaluate(() => window.DBG.wingRoute(40));
    const doors = await page.evaluate((r) =>
      r.map(([gx, gz]) => window.DBG.doors(gx, gz)), route);
    console.log(`    ${route.length} rooms: ${route.slice(0, 6).map((r) => r.join(',')).join(' → ')}`
              + (route.length > 6 ? ' → …' : ''));

    expect(route.length).toBeGreaterThan(1);
    const seen = new Set([route[0].join(',')]);
    for (let i = 1; i < route.length; i++){
      const [gx, gz] = route[i];
      /* Reachable from some room already in the wing, through an open door on
         the shared edge — checked from the neighbour's side, since doors are
         recorded per room. */
      const ok = [['e', -1, 0], ['w', 1, 0], ['n', 0, -1], ['s', 0, 1]].some(([wall, dx, dz]) => {
        const j = route.findIndex(([ax, az], k) => k < i && ax === gx + dx && az === gz + dz);
        return j >= 0 && doors[j][wall];
      });
      expect(ok, `room ${gx},${gz} is in the wing but not walkable from it`).toBe(true);
      expect(seen.has(`${gx},${gz}`), `room ${gx},${gz} appears twice`).toBe(false);
      seen.add(`${gx},${gz}`);
    }
  });

  test('no work hangs near-blank', async ({ page }) => {
    await boot(page);
    /* Roughly one work in twenty used to hang almost empty — a seed landing in
       a parameter corner where a generator draws almost nothing, and only one
       of the six checked its own output. A gate now measures coverage and
       value spread after finishing and re-rolls from a *derived* seed, so the
       museum stays a pure function of its world seed. */
    const rows = await page.evaluate(() => {
      const out = [];
      outer:
      for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++)
        for (const a of window.DBG.art(gx, gz)){
          const r = window.DBG.artHash(gx, gz, a.i);
          out.push({ algo: r.algo, attempts: r.attempts, ...r.score });
          if (out.length >= 24) break outer;
        }
      return out;
    });

    const weak = rows.filter((r) => !r.ok);
    const rerolled = rows.filter((r) => r.attempts > 1).length;
    const minCov = Math.min(...rows.map((r) => r.coverage));
    console.log(`    ${rows.length} works · ${rerolled} re-rolled · `
              + `weakest coverage ${minCov} · ${weak.length} still weak`);

    expect(rows.length).toBeGreaterThan(12);
    expect(weak).toEqual([]);                 // nothing near-blank survives
    expect(minCov).toBeGreaterThan(0.05);
  });

  test('every ink can be seen on its own paper', async ({ page }) => {
    await boot(page);
    /* Four slots sat between 1.65 and 2.15:1 against their own ground, which
       is a stroke you cannot see — and jitterHex nudges lightness both ways,
       so it could only ever make that worse. */
    const worst = await page.evaluate(() => {
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
      const L = (h) => 0.2126*lin(parseInt(h.slice(1,3),16))
                     + 0.7152*lin(parseInt(h.slice(3,5),16))
                     + 0.0722*lin(parseInt(h.slice(5,7),16));
      const cr = (a, b) => { const x = L(a), y = L(b);
        return (Math.max(x,y) + 0.05) / (Math.min(x,y) + 0.05); };
      let budget = 120;
      /* The jittered palettes, as actually painted — so this proves the
         authored contrast survives jitterHex rather than only existing in the
         table. */
      let lo = { ratio: Infinity };
      outer:
      for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++)
        for (const a of window.DBG.art(gx, gz)){
          const pal = window.DBG.palette(gx, gz, a.i);
          if (!pal) continue;
          for (const ink of pal.inks){
            const ratio = cr(pal.paper, ink);
            if (ratio < lo.ratio) lo = { ratio: +ratio.toFixed(2), pal: pal.name, ink };
          }
          if (--budget <= 0) break outer;
        }
      return lo;
    });
    console.log(`    weakest ink: ${worst.pal} ${worst.ink} at ${worst.ratio}:1`);
    expect(worst.ratio).toBeGreaterThan(2.5);
  });

  test('every algorithm and palette index stays in range', async ({ page }) => {
    await boot(page);
    const bad = await page.evaluate(() => {
      const out = [];
      for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) {
        for (const a of window.DBG.art(gx, gz)) {
          if (!Number.isInteger(a.algo) || a.algo < 0 || a.algo > 5) out.push(`algo ${a.algo}`);
          if (!Number.isInteger(a.pal) || a.pal < 0 || a.pal > 11) out.push(`pal ${a.pal}`);
        }
      }
      return out;
    });
    expect(bad).toEqual([]);
  });
});
