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

  /* The wall is for the people a gallery is *shown* to. The curator walks an
     endless museum unless they ask otherwise — which is the whole correction
     here, because the wing is sized to hold the works and a small collection
     fits in one room, so closing the boundary by default sealed its owner
     into a single box with every door built shut and no way out of it. */
  test('a guest is walled in; the curator is not, unless they ask', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const D = window.DBG;
      const out = {};
      out.curatorDefault = D.boundary();               // endless, out of the box
      D.placeForTest('0,0:0', 'u1');
      out.stillEndless = D.boundary();                 // and a hanging does not wall them in
      out.guest = D.guestWorldForTest(true);           // the shared-link visit
      out.sealedOrigin = D.sealed(0, 0);               // every door out is shut
      out.farRoom = D.inBounds(5, 5);
      D.guestWorldForTest(false);
      /* The curator asking to see what a visitor sees. */
      out.closed = D.boundary(true);
      out.sealedAsCurator = D.sealed(0, 0);
      out.opened = D.openRoomForTest(1, 0);            // the shut door's "yes"
      out.eastNow = D.sealed(0, 0);
      out.off = D.boundary(false);                     // and back to halls without number
      return out;
    });
    expect(r.curatorDefault.rooms).toBe(null);
    expect(r.curatorDefault.on).toBe(false);
    expect(r.stillEndless.rooms).toBe(null);
    expect(r.guest.rooms).toBeGreaterThanOrEqual(1);
    expect(r.sealedOrigin).toEqual({ e: true, w: true, n: true, s: true });
    expect(r.farRoom).toBe(false);
    expect(r.sealedAsCurator).toEqual({ e: true, w: true, n: true, s: true });
    expect(r.opened).toBe(true);
    expect(r.eastNow.e).toBe(false);                   // the new room's door stands open
    expect(r.eastNow.n).toBe(true);                    // the others are still shut
    expect(r.off.rooms).toBe(null);
  });

  /* ————— floors —————
     The vertical axis is the one part of this world whose correctness is a
     claim about three dimensions at once, so it is asserted rather than
     looked at. Nothing here needs the gallery entered: the stair is world
     data and the walk is stepped by hand. */
  test('the entrance carries a stair, and it climbs a whole storey', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const D = window.DBG;
      const st = D.stair(0, 0, 0);
      const p = st.planUp;
      const at = (t) => {
        const u = p.u0 + (p.u1 - p.u0) * t;
        return D.ground(p.axis === 'x' ? u : p.across, p.axis === 'x' ? p.across : u);
      };
      return { up: st.up, down: st.down, built: st.builtUp,
               foot: at(0), mid: at(0.5), head: at(1),
               offToTheSide: D.ground(p.axis === 'x' ? 0 : p.across + 4,
                                      p.axis === 'x' ? p.across + 4 : 0) };
    });
    expect(r.up).toBe(true);
    expect(r.down).toBe(false);            // no basement under the front door
    expect(r.built).toBe(true);
    expect(r.foot).toBeCloseTo(0, 2);
    expect(r.head).toBeGreaterThan(4.2);   // a storey is a ceiling plus its slab
    expect(r.mid).toBeCloseTo(r.head / 2, 1);
    expect(r.offToTheSide).toBe(0);        // beside the flight is plain floor
  });

  test('walking up a stair arrives on the floor above, and walking down returns', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const D = window.DBG;
      const up = D.climb(true, 10);
      const landed = D.floor();
      const down = D.climb(false, 10);
      return { up, landed, down, back: D.floor() };
    });
    expect(r.up.to).toBeGreaterThan(r.up.from);        // they went up
    expect(r.landed.py).toBeCloseTo(r.landed.ground, 1);  // and are standing on something
    expect(r.down.to).toBeLessThan(r.down.from);       // and can come back
  });

  test('a frame key carries its floor, and the ground floor keeps the old shape', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      ground: window.DBG.frameKeyForTest(3, -4, 0, 2),
      upstairs: window.DBG.frameKeyForTest(3, -4, 2, 2),
      basement: window.DBG.frameKeyForTest(3, -4, -1, 2),
    }));
    /* Every placement ever stored, and a database CHECK constraint, are on
       the left-hand shape. It must not move. */
    expect(r.ground).toBe('3,-4:2');
    expect(r.upstairs).toBe('3,-4@2:2');
    expect(r.basement).toBe('3,-4@-1:2');
  });

  test('a wing can be asked to go upward instead of outward', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const flat = window.DBG.wingRoute(12, 1);
      const tall = window.DBG.wingRoute(12, 3);
      return { flatFloors: [...new Set(flat.map((c) => c[2]))],
               tallFloors: [...new Set(tall.map((c) => c[2]))],
               tallStartsEachFloorAtTheStair:
                 tall.filter((c) => c[0] === 0 && c[1] === 0).map((c) => c[2]) };
    });
    expect(r.flatFloors).toEqual([0]);
    expect(r.tallFloors).toEqual([0, 1, 2]);
    /* Each storey's walk begins in the room with the stair, which is what
       makes the three of them one gallery rather than three. */
    expect(r.tallStartsEachFloorAtTheStair).toEqual([0, 1, 2]);
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
