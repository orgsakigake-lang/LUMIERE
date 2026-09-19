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
      /* A real work, not a bare placement row: a placement whose upload does
         not exist is not a hanging and deliberately draws no wall. */
      D.loanForTest('u1', 'A drawing', '', '0,0:0');
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

  /* The specific shape of the trap that shipped: a placement row outliving the
     work it names — an upload removed elsewhere, IndexedDB cleared — and the
     wall being drawn around it anyway. One such row at the origin was a wing
     of one room, which is a room with all four doorways built shut. */
  test('a placement whose work is gone does not draw a wall', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const D = window.DBG;
      D.boundary(true);                                // the curator asks for walls
      D.placeForTest('0,0:0', 'a-work-that-is-gone');  // a row, and nothing behind it
      const ghost = D.boundary();
      D.loanForTest('a-work-that-is-gone', 'found again', '');   // the work turns up
      D.boundary(true);
      const real = D.boundary();
      return { ghost, real };
    });
    expect(r.ghost.rooms).toBe(null);       // nothing hangs, so nothing is sealed
    expect(r.real.rooms).toBeGreaterThanOrEqual(1);   // now it does, and now it is
  });

  /* A shared link is read-only, and "read-only" has to mean the controls are
     not there — not that they are there and refuse. It also has to mean the
     office is worth opening at all: it used to render an entirely blank panel
     for a guest, every section of it gated on a sign-in they do not have. */
  test('a guest gets the collection and none of the levers', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const D = window.DBG;
      D.loanForTest('u1', 'A drawing', '', '0,0:0');
      D.viewingForTest('somebody');
      const vis = (id) => {
        const el = document.getElementById(id);
        return !!el && !el.hidden;
      };
      document.getElementById('sw-curator').click();
      const out = {
        state: document.getElementById('cur-state').textContent,
        openPanel: vis('cur-open'),
        note: document.getElementById('cur-guest-note').textContent,
        works: document.querySelectorAll('#cur-grid .cur-item').length,
        removeButtons: document.querySelectorAll('#cur-grid .rm').length,
        canAdd: vis('cur-add-row'),
        canGather: vis('cur-gather'),
        canSize: vis('cur-wing'),
        canFloors: vis('cur-floors'),
        canBound: vis('cur-bound-row'),
        canShare: vis('cur-share'),
      };
      document.getElementById('cur-close').click();
      D.viewingForTest(null);
      return out;
    });
    expect(r.state).toContain('guest');
    expect(r.openPanel).toBe(true);           // there is something to look at
    expect(r.works).toBe(1);                  // and it is the hanging they came for
    expect(r.note).toContain('somebody');
    expect(r.removeButtons).toBe(0);          // withheld, not disabled
    expect(r.canAdd).toBe(false);
    expect(r.canGather).toBe(false);
    expect(r.canSize).toBe(false);
    expect(r.canFloors).toBe(false);
    expect(r.canBound).toBe(false);
    expect(r.canShare).toBe(false);
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

  /* The two halves of the ask, together: a share link that is read-only and
     hard-walled, over a gallery that grows upward. A guest must be able to
     climb to a work hung on the first floor and must not be able to carry on
     to a second floor nobody hung anything on. */
  test('a guest can climb to a work upstairs and no further', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const D = window.DBG;
      D.loanForTest('w1', 'Ground work', '', '0,0:0');
      D.loanForTest('w2', 'Upstairs work', '', '0,0@1:1');
      D.viewingForTest('somebody');
      const out = {
        rooms: D.boundary().rooms,
        ground: D.inBounds(0, 0, 0),
        firstFloor: D.inBounds(0, 0, 1),
        secondFloor: D.inBounds(0, 0, 2),
        nextHall: D.inBounds(1, 0, 0),
        nextHallUpstairs: D.inBounds(1, 0, 1),
        sealedGround: D.sealed(0, 0, 0),
      };
      const c = D.climb(true, 10);
      out.climbedFrom = c.from; out.climbedTo = c.to;
      out.sealedUpstairs = D.sealed(0, 0, 1);
      D.viewingForTest(null);
      return out;
    });
    expect(r.rooms).toBe(2);                 // exactly the two rooms that hold work
    expect(r.ground).toBe(true);
    expect(r.firstFloor).toBe(true);         // the stair is part of the gallery
    expect(r.secondFloor).toBe(false);       // and stops where the hanging does
    expect(r.nextHall).toBe(false);
    expect(r.nextHallUpstairs).toBe(false);
    expect(r.sealedGround).toEqual({ e: true, w: true, n: true, s: true });
    expect(r.climbedTo).toBe(r.climbedFrom + 1);      // they got up there
    expect(r.sealedUpstairs).toEqual({ e: true, w: true, n: true, s: true });
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

/* ═══════════════════════════════════════════════════════════════════
   The gallery plan, and the card at the door.
   ═══════════════════════════════════════════════════════════════════ */
test.describe('the gallery plan', () => {
  const open = async (page) => {
    await page.locator('#plan-btn').click();
    await expect(page.locator('#plan')).toBeVisible();
  };
  /* How much of the drawing is drawn on. A canvas that silently produced
     nothing is the failure this whole feature is one bad coordinate away from,
     and it is invisible to every assertion about counts and captions. */
  const inked = (page) => page.evaluate(() => {
    const cv = document.getElementById('plan-cv');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let on = 0, n = 0;
    for (let i = 3; i < d.length; i += 4 * 7){ n++; if (d[i] > 8) on++; }
    return on / n;
  });

  test('draws the museum, and builds not one room to do it', async ({ page }) => {
    /* The claim the module is built on: every line comes from the seed layer,
       which is pure. If opening the plan — or flicking up two storeys and back
       — meshes anything, the room cache grows, the evictor inherits halls
       nobody stood in, and a plan of the fourth floor costs what walking to it
       costs. */
    await boot(page, '?q=0');
    const before = await page.evaluate(() => window.DBG.stats().cached);
    await open(page);
    expect(await inked(page), 'the plan drew nothing at all').toBeGreaterThan(0.02);

    await page.locator('#plan-up').click();
    await page.locator('#plan-up').click();
    await page.locator('#plan-down').click();
    const after = await page.evaluate(() => window.DBG.stats().cached);
    console.log(`    rooms cached: ${before} before the plan, ${after} after three storeys of it`);
    expect(after, 'opening the plan built rooms').toBe(before);
    expect(await inked(page), 'the storey above drew nothing').toBeGreaterThan(0.01);
  });

  test('looking at another storey does not take you to it', async ({ page }) => {
    await boot(page, '?q=0');
    const where = () => page.evaluate(() => window.DBG.stats().room.concat(window.DBG.stats().py));
    await open(page);
    const start = await where();
    await page.locator('#plan-up').click();
    expect(await page.locator('#plan-where').textContent()).toContain('above you');
    expect(await where(), 'peeking at a storey moved the visitor').toEqual(start);
    /* And stepping out puts the plan back on the floor you are standing on. */
    await page.locator('#plan-close').click();
    await open(page);
    expect(await page.locator('#plan-where').textContent()).toContain('you are here');
  });

  test('a bounded gallery is framed whole, with its far walls shut', async ({ page }) => {
    /* What a guest is handed at the door: not a window onto part of a
       collection but the shape of all of it. */
    await boot(page, '?q=0');
    await page.evaluate(() => {
      const D = window.DBG;
      for (const [k, id] of [['0,0:0','a'], ['0,0:3','b'], ['1,0:1','c'], ['0,1:2','d']]){
        D.loanForTest(id, 'Work ' + id, '');
        D.hangForTest(k, id);
      }
      D.boundary(true);
    });
    await open(page);
    const note = await page.locator('#plan-note').textContent();
    console.log(`    ${note}`);
    expect(note).toContain('4 works hanging');
    /* Every hall of the gallery is inside the drawing — that is what "framed
       whole" means, and it is the one property a fixed window cannot promise. */
    const framed = await page.evaluate(() => {
      const b = window.DBG.boundary();
      return b.rooms;
    });
    expect(framed, 'the boundary did not close around the hanging').toBeGreaterThan(0);
    expect(note).toContain(`${framed} hall`);
    await page.evaluate(() => window.DBG.boundary(false));
  });
});

test.describe('the card at the door', () => {
  test('a panel opened at the door hands the cursor back, not the gallery',
    async ({ page }) => {
    /* Every plate calls tryPointerLock on the way out, and all of them can be
       opened from the entrance card. Closing one there used to capture the
       pointer into a museum nobody had entered — the cursor vanished, the card
       stopped answering clicks, and the only way out was an Esc nothing had
       mentioned. Asserted on the guide *and* the plan, because the bug was
       written once and inherited twice. */
    await boot(page, '?q=0');
    for (const [open, close] of [['#help-btn', '#help-close'], ['#plan-btn', '#plan-close']]){
      await page.locator(open).click();
      await page.locator(close).click();
      expect(await page.evaluate(() => !!document.pointerLockElement),
             `${close} locked the pointer before the visitor had entered`).toBe(false);
    }
    /* And the card is still a card: the button it was covering answers. */
    await expect(page.locator('#enter')).toBeEnabled();
  });

  const card = (page) => page.evaluate(() => ({
    sub: document.getElementById('intro-sub').textContent,
    hook: document.getElementById('intro-hook').textContent,
    enter: document.getElementById('enter').textContent,
    title: document.title,
  }));

  test('names the collection a shared link leads to', async ({ page }) => {
    /* The defect: the entrance card is written for the endless museum, and a
       guest at somebody's link got the same one — LUMIÈRE, The Endless
       Gallery, and the promise that *no one else will ever see these works*,
       printed to the one visitor who is looking at works somebody else chose
       and sent them the key to. */
    await boot(page, '?q=0');
    expect((await card(page)).hook).toContain('No one else will ever see');

    await page.evaluate(() => window.DBG.introForTest(
      { mode: 'guest', slug: 'marguerite', works: 12, halls: 4 }));
    const guest = await card(page);
    console.log(`    ${guest.sub} — ${guest.title}`);
    expect(guest.sub).toBe('The Collection of marguerite');
    expect(guest.hook).toContain('12 works across 4 halls');
    expect(guest.hook).not.toContain('No one else will ever see');
    expect(guest.enter).toBe('Enter the collection');
    expect(guest.title).toContain('marguerite');

    /* A failed shared link must never offer entry into an unrelated museum. */
    await page.evaluate(() => window.DBG.introForTest({ mode: 'missing', slug: 'nobody' }));
    const gone = await card(page);
    expect(gone.sub).toBe('No such collection');
    expect(gone.hook).toContain('nobody');
    expect(gone.enter).toBe('Collection unavailable');
    await expect(page.locator('#enter')).toBeDisabled();
  });

  test('will not print a name that could not be a gallery', async ({ page }) => {
    /* The slug arrives in a URL somebody else composed and is written straight
       onto the first thing a visitor reads. textContent makes it inert; this
       makes sure it is not even shown — a card reading "The Collection of
       <img src=x onerror=...>" is not an attack, but it is not a museum
       either. */
    await boot(page, '?q=0');
    await page.evaluate(() => window.DBG.introForTest(
      { mode: 'guest', slug: '<img src=x onerror=alert(1)>', works: 1, halls: 1 }));
    const c = await card(page);
    expect(c.sub).not.toContain('<img');
    expect(c.hook).not.toContain('<img');
    expect(c.sub).toBe('The Collection of that name');
    expect(await page.evaluate(() => document.querySelectorAll('#intro img').length)).toBe(0);
  });
});
