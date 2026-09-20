import { test, expect } from '@playwright/test';
import { boot, enter, ENTER_MS } from './helpers.js';

/* ═══════════════════════════════════════════════════════════════════
   A phone.

   The defect these exist for: a gallery whose whole premise is a link
   you send somebody had no touch input at all. Entering worked — the
   button is a button — and then nothing did. A finger drag reached a
   `mousemove` handler that never fires for a thumb, there is no pointer
   to lock and no W to hold, so a shared collection opened on a phone
   was a still photograph of one wall with no way to turn around.
   Measured on an emulated Pixel 5 before the fix: after a full swipe
   across the glass, yaw 0.00.

   So the first test here is the whole feature, and the rest are the
   things that being unable to move had been hiding.

   ————— on measuring —————
   These assert velocity and the ring's own vector, never distance
   travelled. DBG.frame steps the loop synchronously, but the real rAF
   loop keeps running between the round trips a scripted test is made
   of, so "how far did they get" counts frames nobody controls — it read
   2.87 m for one second of a 2.0 m/s walk. How fast they are going, and
   what the thumb is asking for, are both independent of that.

   ————— on sharing a page —————
   Serial, one page, entered once, exactly like the two gallery groups.
   Entering costs ~15 s under SwiftShader and this file would otherwise
   pay it five times; that is a fifth of the whole suite's wall clock
   spent walking through the same door. The tests are ordered so the one
   that resizes the viewport runs last.
   ═══════════════════════════════════════════════════════════════════ */

/* A Pixel 5, spelled out rather than taken from `devices` — that export
   carries `defaultBrowserType`, which Playwright refuses inside a describe
   because it would force a whole new worker. These are the fields that
   actually matter here. */
const PHONE = { viewport: { width: 393, height: 727 }, deviceScaleFactor: 2.75,
                isMobile: true, hasTouch: true };

test.describe.serial('in one hand', () => {
  /** @type {import('@playwright/test').Page} */
  let page, t, ring;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage(PHONE);
    await boot(page, '?q=0');
    /* Playwright's touchscreen taps but does not drag, and a drag is the
       entire input model here. CDP dispatches the raw sequence. */
    const cdp = await page.context().newCDPSession(page);
    const at = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    t = {
      down: (x, y) => at('touchStart', [{ x, y }]),
      to:   (x, y) => at('touchMove',  [{ x, y }]),
      up:   ()     => at('touchEnd',   []),
      async drag(x0, y0, x1, y1, steps = 12){
        await at('touchStart', [{ x: x0, y: y0 }]);
        for (let i = 1; i <= steps; i++)
          await at('touchMove', [{ x: x0 + (x1-x0)*i/steps, y: y0 + (y1-y0)*i/steps }]);
      },
    };
  });
  test.afterAll(async () => { await page?.close(); });

  const look = () => page.evaluate(() => window.DBG.stats().yaw);
  const vel  = () => page.evaluate(() => window.DBG.stats().vel);
  const asked = () => page.evaluate(() => window.DBG.ring());
  const step = (n) => page.evaluate((k) => window.DBG.frame(k, 16.7), n);

  test('a visitor with no keyboard can look around and walk', async () => {
    /* The instructions have to be right before anything is tried: a phone
       visitor reading about W A S D is a phone visitor who concludes the
       gallery is broken. Checked at the door, before entering. */
    expect(await page.evaluate(() => document.body.classList.contains('touch'))).toBe(true);
    expect(await page.locator('#hud-legend .by-touch').isVisible()).toBe(true);
    expect(await page.locator('#hud-legend .by-key').isVisible()).toBe(false);

    await page.locator('#enter').tap({ timeout: ENTER_MS });
    await page.waitForFunction(() => document.body.classList.contains('entered'),
                               null, { timeout: ENTER_MS });
    /* Headless Chromium grants pointer lock even on a touch context, and a
       phone has no such thing — leaving it engaged sends every later click to
       the canvas rather than to what was clicked. */
    await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());

    const b = await page.locator('#stick').boundingBox();
    ring = { cx: b.x + b.width/2, cy: b.y + b.height/2, r: b.width/2 };

    // ——— look: a swipe across the glass turns the head
    const before = await look();
    await t.drag(300, 380, 140, 380);
    await t.up();
    const after = await look();
    console.log(`    a 160px swipe turned ${(after - before).toFixed(2)} rad`);
    expect(Math.abs(after - before), 'a swipe did not turn the view').toBeGreaterThan(0.5);

    // ——— walk: the ring, leaned forward, moves the visitor
    await page.evaluate(() => window.DBG.pos(0, 0, 0, 0));
    await t.down(ring.cx, ring.cy);
    await t.to(ring.cx, ring.cy - ring.r);
    await step(40);
    const walking = await vel();
    console.log(`    a full lean on the ring walks at ${walking.toFixed(2)} m/s`);
    expect(walking, 'the ring did not walk anybody anywhere').toBeGreaterThan(1.8);
    expect(walking, 'the ring walked faster than the museum does').toBeLessThan(2.1);

    // ——— and letting go stops (bar the glide the walk deliberately has)
    await t.up();
    expect((await asked()).on, 'the ring stayed engaged after the finger left').toBe(false);
    await step(40);
    const stopped = await vel();
    console.log(`    two thirds of a second after letting go: ${stopped.toFixed(2)} m/s`);
    expect(stopped, 'letting go of the ring did not stop the walk').toBeLessThan(0.05);
  });

  test('the ring is analogue — a half lean is a slower walk', async () => {
    /* Not a nicety. A thumb has no Shift key, so the only pace control on a
       phone is how far the ring is leaned; as a boolean the museum would be
       walked at exactly one speed, and with no dead zone a thumb resting on
       the glass would be a slow permanent drift.

       Asserted on the ring's own vector, which is exactly computable: at a
       full lean the magnitude is 1, and at a fraction f past the 0.14 dead
       zone it is (f − 0.14) / 0.86. */
    const leanTo = async (frac) => {
      await page.evaluate(() => window.DBG.pos(0, 0, 0, 0));
      await t.down(ring.cx, ring.cy);
      await t.to(ring.cx, ring.cy - ring.r * frac);
      const want = await asked();
      await step(40);
      const pace = await vel();
      await t.up();
      await step(20);
      return { want, pace };
    };

    const full = await leanTo(1.0);
    const half = await leanTo(0.5);
    const idle = await leanTo(0.05);          // a thumb sitting on the glass
    console.log(`    full ${full.want.mag} → ${full.pace.toFixed(2)} m/s`
              + ` · half ${half.want.mag} → ${half.pace.toFixed(2)}`
              + ` · resting ${idle.want.mag} → ${idle.pace.toFixed(2)}`);

    expect(full.want.mag, 'a full lean must ask for the full pace').toBeCloseTo(1, 2);
    expect(half.want.mag, 'the dead zone must be rescaled away, not merely cut out')
      .toBeCloseTo((0.5 - 0.14) / 0.86, 2);
    expect(idle.want.on, 'a thumb inside the dead zone must not be a walk').toBe(false);

    expect(full.pace).toBeGreaterThan(1.8);
    expect(half.pace, 'a half lean must be slower than a full one').toBeLessThan(full.pace - 0.5);
    expect(half.pace, 'a half lean must still be walking').toBeGreaterThan(0.3);
    expect(idle.pace, 'a resting thumb must not drift').toBeLessThan(0.05);
  });

  test('a tap opens the work in front of you', async () => {
    /* Stand two metres in front of a real frame and face it. Not a spin from
       the middle of the room: a work reaches the reticle only within 7.5 m,
       and the entrance hall's works hang on the flanks of its four doorways,
       every one of them just past 7.9 m from the centre. Then wait for the
       reticle to agree — it consults the same facedArtwork() the tap will act
       on, so this cannot pass by aiming somewhere the tap would miss. */
    const aimed = await page.evaluate(() => {
      const A = window.DBG.art(0, 0)[0];
      if (!A) return null;
      const IN = 7 - 0.24 - 2;                    // half a room, less the wall, less two metres
      const at = { e: [ IN, A.u,  Math.PI/2], w: [-IN, A.u, -Math.PI/2],
                   n: [ A.u,  IN, Math.PI  ], s: [ A.u, -IN, 0        ] }[A.wall];
      window.DBG.pos(at[0], at[1], at[2], 0);
      window.DBG.frame(8, 16.7);
      return { wall: A.wall, u: A.u, live: document.getElementById('aim').classList.contains('live') };
    });
    expect(aimed, 'the entrance hall hung nothing at all').not.toBeNull();
    console.log(`    standing before the work on the ${aimed.wall} wall at u=${aimed.u}`);
    expect(aimed.live, 'the reticle did not answer to a work two metres away').toBe(true);

    /* Hold the loop still for the gesture itself. A tap is judged partly on
       how long the finger was down, and under a software rasteriser a frame
       costs hundreds of milliseconds — two CDP dispatches back to back landed
       667 ms apart, so the tap arrived as a long press and nothing opened.
       That is the harness, not the museum: paused, the same two events are
       4 ms apart, which is what a thumb actually does. */
    await page.evaluate(() => window.DBG.pause(true));
    await t.down(200, 300);          // a tap: down, no travel, up
    await t.up();
    await page.evaluate(() => window.DBG.pause(false));
    await expect(page.locator('#modal')).toBeVisible({ timeout: 30_000 });
    console.log('    a tap on a hung work opened the enlarged view');

    // and a tap closes it again, rather than walking on behind it
    await page.locator('#modal').tap();
    await expect(page.locator('#modal')).toBeHidden();
  });

  test('a curator with no keyboard can still hang a work', async () => {
    /* The dead end this closes: a phone visitor can unlock the office, add
       works to a collection from the photo picker, and then find there is no
       H key to hang any of them with. The pill is that key — same gate, same
       function, same refusals. It is also, deliberately, invisible to everyone
       the office is shut to, which is nearly every visitor. */
    const toast = () => page.locator('#hud-toast').textContent();
    const pill = page.locator('#hang-btn');
    /* Tapped with the same CDP finger as everything else here, and not with
       Playwright's `tap()`. That refuses: its hit-target check reports the
       canvas as the interceptor for a point which `document.elementFromPoint`
       gives to the pill and which the browser itself delivers to the pill —
       verified by listening for the events, which arrive as
       pointerdown/touchstart/mousedown/click on #hang-btn and produce the
       right refusal. So the check is asserted here directly instead, which is
       the part that was ever worth asserting. */
    const tapPill = async () => {
      const b = await pill.boundingBox();
      const cx = b.x + b.width/2, cy = b.y + b.height/2;
      expect(await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) || {}).id, [cx, cy]),
             'something else is over the pill').toBe('hang-btn');
      await t.down(cx, cy);
      await t.up();
    };

    /* This test is also useful on its own via -g. The serial suite normally
       enters in its first test, but a focused run should verify the same flow
       instead of silently depending on an excluded sibling. */
    if (!await page.evaluate(() => document.body.classList.contains('entered'))){
      await page.locator('#enter').tap({ timeout: ENTER_MS });
      await page.waitForFunction(() => document.body.classList.contains('entered'),
                                 null, { timeout: ENTER_MS });
      await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());
    }

    // Local curation needs no account: face a frame and the touch action exists.
    const at = await page.evaluate(() => {
      const A = window.DBG.art(0, 0)[0];
      const IN = 7 - 0.24 - 2;
      const p = { e: [ IN, A.u,  Math.PI/2], w: [-IN, A.u, -Math.PI/2],
                  n: [ A.u,  IN, Math.PI  ], s: [ A.u, -IN, 0        ] }[A.wall];
      window.DBG.pos(p[0], p[1], p[2], 0);
      window.DBG.frame(8, 16.7);
      return p;
    });
    await expect(pill).toBeVisible();
    expect((await pill.textContent()).trim()).toBe('hang here');

    // With nothing chosen it refuses, in words, exactly as H does.
    await tapPill();
    await expect.poll(toast, { timeout: 10_000 }).toContain('choose a work');

    // Sign in only to prove the same local action is also queued for sync.
    await page.evaluate(() => {
      // A synthetic login needs a synthetic transport too. A real network
      // failure otherwise replaces the hanging confirmation with an outbox
      // warning; cloud.spec.js covers that offline path separately.
      window.__touchPlacements = [];
      window.DBG.cloudFetch(async (url, options) => {
        if (url.endsWith('/rest/v1/placements') && options.method === 'POST')
          window.__touchPlacements.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => [] };
      });
      window.DBG.cloudSessForTest(true);
    });
    await step(8);
    await expect(pill).toBeVisible();
    expect((await pill.textContent()).trim()).toBe('hang here');
    /* And it must *stay*. The pill is re-decided every eighth frame from
       whatever the reticle is on, so a jitter in that answer would make it
       blink — which reads as a fault and, for anything with a thumb heading
       towards it, is one. */
    const steady = await page.evaluate(async () => {
      const el = document.getElementById('hang-btn'), seen = [];
      for (let i = 0; i < 12; i++){
        seen.push(el.hidden ? 'H' : 'v');
        await new Promise((r) => setTimeout(r, 80));
      }
      return seen.join('');
    });
    console.log(`    the pill over a second of standing still: ${steady}`);
    expect(steady, 'the pill blinked while the visitor stood still').not.toContain('H');

    // choose one, and the same pill hangs it
    await page.evaluate(() => {
      window.DBG.loanForTest('touch-1', 'Study of a Hand', 'graphite');
      window.DBG.selectForTest('touch-1');
    });
    await tapPill();
    await expect.poll(toast, { timeout: 10_000 }).toContain('hung');
    await expect.poll(() => page.evaluate(() => window.__touchPlacements))
      .toEqual([{ owner: 'test', k: expect.any(String), upload_id: 'touch-1' }]);
    console.log(`    hung from a thumb, standing at ${at.map((n) => n.toFixed ? +n.toFixed(1) : n)}`);

    // and put the gallery back the way the rest of the file expects it
    await page.evaluate(() => {
      window.DBG.cloudFetch(null);
      delete window.__touchPlacements;
      window.DBG.cloudSessForTest(false);
      window.DBG.selectForTest(null);
    });
    await step(8);
  });

  test('nothing on the head-up display runs off the glass', async () => {
    /* Before this the corner layout printed "Wing 0 · Hall 0" straight through
       "1 room · 6 works", and the five wall switches ran off *both* edges at
       once — "GHTS" past the left, "CURATOR" past the right. A museum that has
       just grown an upstairs needs to be able to say which floor you are on.

       Last in the file: it resizes the viewport, which would move the ring out
       from under every measurement above. */
    const overflowing = () => page.evaluate(() => {
      const bad = [];
      for (const sel of ['#hud-loc', '#hud-stat', '#switches', '#hud-legend', '#stick', '#corner-nav']){
        const e = document.querySelector(sel);
        if (!e) { bad.push(sel + ' missing'); continue; }
        const r = e.getBoundingClientRect();
        if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight)
          bad.push(`${sel} ${Math.round(r.left)},${Math.round(r.top)} → `
                 + `${Math.round(r.right)},${Math.round(r.bottom)} in ${innerWidth}x${innerHeight}`);
      }
      /* And the two corner readouts must not print through each other. */
      const a = document.querySelector('#hud-loc').getBoundingClientRect();
      const b = document.querySelector('#hud-stat').getBoundingClientRect();
      if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top)
        bad.push('#hud-loc overlaps #hud-stat');
      return bad;
    });

    expect(await overflowing(), 'portrait').toEqual([]);
    await page.setViewportSize({ width: 851, height: 393 });
    await step(2);
    expect(await overflowing(), 'landscape').toEqual([]);
    console.log('    portrait 393x727 and landscape 851x393 both fit');
  });
});

test.describe('walking in', () => {
  test('the entrance card goes deaf as it fades, and hears again once you step out',
    async ({ page }) => {
    /* It fades over 1.1 s and only then goes `hidden`, so for that second it
       was a full-screen, invisible click target sitting over the gallery. On a
       desktop that ate the first drag-look; on a phone, where entering and
       reaching for the glass is one continuous motion, it ate the first
       gesture every time. Making it deaf is one line — and forgetting to give
       it its hearing back is how the entrance button stops working on the
       second visit, which is why both halves are asserted here. */
    await boot(page, '?q=0');
    await enter(page);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('intro')).pointerEvents))
      .toBe('none');

    /* Headless Chromium grants pointer lock, and a locked pointer routes every
       mouse event to the canvas no matter where it was aimed. */
    await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());
    await page.locator('#back-btn').click();
    await expect(page.locator('#intro')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('intro')).pointerEvents))
      .not.toBe('none');
    /* The real assertion: the button answers a second time. */
    await page.locator('#enter').click({ timeout: 30_000 });
    await page.waitForFunction(() => document.body.classList.contains('entered'), null, { timeout: 30_000 });
  });

  test('the pointer lock does not spin the view as it engages', async ({ page }) => {
    /* Locking the pointer warps the cursor to the middle of the screen, and the
       browser reports that warp as one ordinary mousemove carrying the whole
       distance. Traced entering from the centred entrance button:

         [ 359,  231, locked:false]   the cursor travelling to the button
         [-359, -231, locked:true ]   the warp back
         ["LOCK", true]               and only now pointerlockchange

       In that ordering `locked` is still false when the warp lands and the
       handler ignores it. Under load the last two swap, the warp is treated as
       a look, and 359 px at 0.0022 rad/px is 45° of yaw — which is how a test
       about *daylight* came to fail, with the museum quietly facing a different
       wall than it had the run before. */
    await boot(page, '?q=0');
    await enter(page);

    /* The guard is armed by pointerlockchange and disarmed by the very next
       mousemove — so re-locking for real and *then* sending a warp tests
       nothing: the browser's own warp has already spent it. Which ordering the
       browser picks is the whole point and cannot be dictated from here, so the
       contract is driven directly instead: arm it, then send the two events.
       The lock is genuinely engaged throughout, because `locked` is read from
       `document.pointerLockElement` and not from a flag a test could set. */
    await page.waitForFunction(() => window.DBG.stats().locked, null, { timeout: 15_000 });

    const yaw = () => page.evaluate(() => window.DBG.stats().yaw);
    /* Both dispatches in one evaluate, back to back. A locked pointer emits a
       continuous stream of zero-delta moves, and across two round trips one of
       those lands in between — which is exactly the case the guard has to
       survive, and exactly what made an earlier version of it useless. */
    await page.evaluate(() => {
      window.DBG.pos(0, 0, 0, 0);
      document.dispatchEvent(new Event('pointerlockchange'));      // the lock engages
      dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 0 }));
      dispatchEvent(new MouseEvent('mousemove', { movementX: -359, movementY: -231 }));
    });
    expect(await yaw(), 'the warp to centre was applied as a look').toBe(0);

    /* And it must cost exactly that one event, not disable looking. */
    await page.evaluate(() => dispatchEvent(new MouseEvent('mousemove', { movementX: -100 })));
    const turned = await yaw();
    console.log(`    the warp turned nothing; the mouse after it turned ${turned.toFixed(2)} rad`);
    expect(turned, 'the mouse stopped working after the warp guard').toBeCloseTo(-0.22, 2);

    /* A small first move is a person, not a warp, and must reach the camera. */
    await page.evaluate(() => {
      window.DBG.pos(0, 0, 0, 0);
      document.dispatchEvent(new Event('pointerlockchange'));
      dispatchEvent(new MouseEvent('mousemove', { movementX: -20 }));
    });
    // stats() rounds yaw to two places, so -20 x 0.0022 = -0.044 reads as -0.04
    expect(await yaw(), 'the guard ate an ordinary movement').toBeCloseTo(-0.04, 2);
  });
});
