import { test, expect } from '@playwright/test';
import { boot, enter, hashes, WORKS, ROOMS, ENTER_MS } from './helpers.js';

test.describe.serial('inside the gallery — light and loans', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 720, height: 405 } });
    await boot(page);
    await enter(page);
  });
  test.afterAll(async () => { await page?.close(); });

  test('lamps, daylight and darkness each change the exposure', async () => {
    /* DBG.luma reads a 32x32 patch at the reticle, so what it reports depends
       on what the camera happens to be pointed at. Whole-frame statistics are
       what tell you the lamps did something, so the darkness check uses those
       and luma is left to carry the daylight comparison. */
    const luma = async () => {
      await page.evaluate(() => window.DBG.frame(12, 16.7));
      return page.evaluate(() => window.DBG.luma());
    };
    const frame = async () => page.evaluate(() => window.DBG.histogram(12));

    const lit = await luma(), litH = await frame();
    expect(lit).toBeGreaterThan(0);

    await page.keyboard.press('KeyO');                    // shutters open — daylight
    const day = await luma();
    await page.keyboard.press('KeyO');
    await page.keyboard.press('KeyL');                    // lamps out
    const dark = await luma(), darkH = await frame();
    await page.keyboard.press('KeyL');                    // restore

    console.log(`    luma: lit ${lit.toFixed(2)}  day ${day.toFixed(2)}  dark ${dark.toFixed(2)}`);
    console.log(`    frame mean: lit ${litH.mean}  dark ${darkH.mean}`);
    expect(day).toBeGreaterThan(lit * 2);          // daylight is unmistakable

    /* This used to assert only "not meaningfully brighter" (dark < lit * 1.05).
       Paintings and placards were drawn with a flat uEm that ignored the lamp
       switch, so the works kept glowing in a dark room and the frame hardly
       moved. They now take the same ambient the walls take, and the switch
       leaves only the room fill burning at a candle's share, so killing the
       lamps is a real, measurable change to the whole image. */
    expect(darkH.mean).toBeLessThan(litH.mean * 0.75);
    expect(darkH.mean).toBeGreaterThan(1);         // still navigable, not a black screen
  });

  test('the music is generated, and every programme plays', async () => {
    /* Nothing is sampled, which is the point: generated music carries no
       licence, cannot be taken down, adds no bytes to a single-file page, and
       never loops. This checks each programme actually starts a graph rather
       than silently doing nothing — the failure mode for synthesis is silence,
       which looks identical to working. */
    const r = await page.evaluate(async () => {
      const out = [];
      const all = window.DBG.music().all;
      for (const name of all){
        window.DBG.music(name);
        await new Promise((res) => setTimeout(res, 60));
        out.push({ name, now: window.DBG.music().now,
                   voices: window.DBG.audioVoices() });
      }
      window.DBG.music('Nocturne');
      return { all, out };
    });
    console.log('    ' + r.out.map((o) => `${o.name}:${o.voices}`).join(' · '));

    expect(r.all.length).toBeGreaterThanOrEqual(4);
    expect(r.all[0]).toBe('silence');
    for (const o of r.out) expect(o.now).toBe(o.name);        // the switch took
    expect(r.out[0].voices).toBe(0);                          // silence is silent
    for (const o of r.out.slice(1))
      expect(o.voices, `${o.name} started no voices`).toBeGreaterThan(0);
  });

  test('other visitors are heard, and stay far away', async () => {
    /* Distant speech is not voices — plaster and air take the consonants
       first, so what survives is the rhythm with the meaning filtered out.
       This checks the talkers exist and, more usefully, that the murmur sits
       far under the footsteps: ambience that competes with what you are doing
       is not ambience. */
    const m = await page.evaluate(() => window.DBG.murmur());
    console.log(`    ${m.talkers} talkers at ${m.level}`);
    expect(m.talkers).toBeGreaterThan(1);
    expect(m.level).toBeGreaterThan(0);
    expect(m.level).toBeLessThan(0.06);      // a footstep peaks near 0.22
  });

  test('a footstep does not touch the walk loop’s stride accumulator', async () => {
    /* The bug this exists for: `audio.stride` is the walk loop's distance
       accumulator, drained in `while (stride > 0.78) { stride -= 0.78;
       footstep(spd) }`. footstep() also used `audio.stride`, as a left/right
       flag — `(stride + 1) & 1` — which pinned it at exactly 1, forever above
       the threshold. The loop never exited. The gallery hung on the visitor's
       first step and filled the audio graph until the tab died.

       Two modules sharing a name is invisible in review and fatal at runtime,
       so the invariant is asserted rather than remembered. */
    const s = await page.evaluate(() => window.DBG.strideProbe());
    console.log(`    stride ${s.before} → ${s.after} · footstep ran: ${s.ran}`);
    expect(s.ok, 'no audio context — the probe proved nothing').toBe(true);
    expect(s.muted, 'muted footsteps return early and skip the path').toBe(false);
    expect(s.ran, 'footstep did not actually run').toBe(true);
    expect(s.after, 'footstep wrote to the walk loop’s accumulator').toBe(s.before);
  });

  test('walking terminates, however fast the visitor moves', async () => {
    /* The other half of the same failure: a frame loop whose exit depends on a
       variable it hands to another module should degrade, not hang. This drives
       an absurd amount of travel through the step loop and asserts the frame
       still returns — and that it did not emit a step per centimetre. */
    const r = await page.evaluate(() => {
      const key = (type) => dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w' }));
      key('keydown');
      const t0 = performance.now();
      /* 200 ms of travel per step: far more ground than a real frame covers,
         so the accumulator is genuinely owing several footsteps each time. */
      const f = window.DBG.frame(30, 200);
      const ms = performance.now() - t0;
      key('keyup');
      window.DBG.frame(2, 16.7);
      return { ms, maxMs: f.maxMs };
    });
    console.log(`    30 long walking frames in ${r.ms.toFixed(0)} ms · worst ${r.maxMs} ms`);
    expect(r.ms).toBeLessThan(15000);
  });

  test('a loaned sheet is mounted, never cropped', async () => {
    /* The defect this replaces: uploads were cover-cropped to the frame's
       aspect, so a portrait drawing hung in a landscape frame silently lost
       its top and bottom. A mount cannot crop — the sheet is contained, at its
       own proportions, and rag board fills the rest. The worst case is the one
       worth asserting, so each source aspect is checked against every frame. */
    const cases = await page.evaluate(() => {
      const out = [];
      for (const [sw, sh] of [[1500, 2000], [2000, 1500], [1000, 1000], [2400, 900]])
        for (const asp of ['L', 'P', 'S', 'W'])
          out.push({ sw, sh, asp, r: window.DBG.mount(sw, sh, asp) });
      return out;
    });

    for (const { sw, sh, asp, r } of cases){
      // the sheet keeps its own proportions
      expect(Math.abs((r.dw / r.dh) / (sw / sh) - 1)).toBeLessThan(0.02);
      // and sits wholly inside the frame, with a margin on every side
      expect(r.dx).toBeGreaterThanOrEqual(r.m - 1);
      expect(r.dy).toBeGreaterThanOrEqual(r.m - 1);
      expect(r.dx + r.dw).toBeLessThanOrEqual(r.tw - r.m + 1);
      expect(r.dy + r.dh).toBeLessThanOrEqual(r.th - r.mb + 1);
      // and it is still large: filling one axis to the margin
      const fills = Math.max(r.dw / (r.tw - 2*r.m), r.dh / (r.th - r.m - r.mb));
      expect(fills).toBeGreaterThan(0.98);
    }

    // the bottom margin is the wider one — optical, not mathematical, centring
    const one = cases[0].r;
    expect(one.mb).toBeGreaterThan(one.m);
  });

  test('line art is stored lossless, photographs are not', async () => {
    /* original → 1280px JPEG q0.88 → cover-crop → 512px texture put three lossy
       steps under a pencil drawing, and JPEG ringing clusters exactly around
       hard strokes on white. Drawings now go to PNG; photographs would cost
       tens of megabytes for nothing, so they still get a JPEG. */
    const kinds = await page.evaluate(() => {
      const mk = (paint) => {
        const c = document.createElement('canvas'); c.width = 220; c.height = 300;
        paint(c.getContext('2d'), c.width, c.height);
        return c;
      };
      const drawing = mk((g, w, h) => {
        g.fillStyle = '#FAF8F3'; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(30,28,26,0.8)'; g.lineWidth = 2;
        for (let i = 0; i < 40; i++){
          g.beginPath(); g.moveTo(10, 10 + i*7); g.lineTo(w - 10, 30 + i*6); g.stroke();
        }
      });
      const photo = mk((g, w, h) => {
        for (let y = 0; y < h; y += 4)
          for (let x = 0; x < w; x += 4){
            g.fillStyle = `rgb(${(x*7)%256},${(y*11)%256},${(x*y)%256})`;
            g.fillRect(x, y, 4, 4);
          }
      });
      return { drawing: window.DBG.uploadKind(drawing), photo: window.DBG.uploadKind(photo) };
    });
    expect(kinds.drawing).toBe('png');
    expect(kinds.photo).toBe('jpeg');
  });

  test('a theme changes the colour of the whole room, not just the walls', async () => {
    /* The point of a theme is that a monochrome drawing meets no colour on its
       way to the eye — not from the lamp, not bounced off a wall, not added by
       the grade's split-tone. Mean chroma over the frame is the one number that
       catches all three at once, so it is what this asserts. */
    const measure = async () => page.evaluate(() => {
      const c = document.getElementById('gl'), g = c.getContext('webgl2');
      window.DBG.frame(6, 16.7);
      const w = c.width, h = c.height, b = new Uint8Array(w*h*4);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, b);
      let n = 0, chroma = 0;
      for (let y = 0; y < h; y += 6)
        for (let x = 0; x < w; x += 6){
          const o = ((h-1-y)*w + x)*4;
          chroma += Math.max(b[o],b[o+1],b[o+2]) - Math.min(b[o],b[o+1],b[o+2]);
          n++;
        }
      return chroma / n;
    });
    /* Deliberately no art drain. Chroma here comes from the walls, the floor,
       the lamps and the grade — none of which need a generated painting, and
       draining 54 works under SwiftShader kills the renderer outright. */
    const settle = async (name) => {
      await page.evaluate((t) => {
        window.DBG.theme(t);
        window.DBG.tp(0, 0, 0);
        if (!window.DBG.stats().lights) dispatchEvent(new KeyboardEvent('keydown', { code:'KeyL', bubbles:true }));
        if (window.DBG.stats().shutters) dispatchEvent(new KeyboardEvent('keydown', { code:'KeyO', bubbles:true }));
      }, name);
      return measure();
    };

    const salon = await settle('salon');
    const graphite = await settle('graphite');
    console.log(`    mean chroma: salon ${salon.toFixed(1)}  graphite ${graphite.toFixed(1)}`);

    expect(salon).toBeGreaterThan(6);            // the warm hall is meant to be warm
    expect(graphite).toBeLessThan(salon * 0.45); // and the monochrome hall is not
    await page.evaluate(() => window.DBG.theme('salon'));
  });

  test('a solo theme hangs only what its curator hung', async () => {
    /* Graphite is `solo`: it generates nothing, so an empty frame stays empty
       and its lamp stays off. Getting the lamp wrong is the visible failure —
       a room of brightly lit blank rectangles. */
    /* Asserted on what is scheduled rather than what finished painting: the
       claim is that solo never queues the work at all, and waiting for 54
       generators under software GL is what kills this suite. */
    const state = await page.evaluate(() => {
      const out = {};
      window.DBG.theme('graphite');
      window.DBG.tp(0, 0, 0);
      window.DBG.frame(4, 16.7);
      out.soloQueued = window.DBG.stats().queued;
      out.soloLights = window.DBG.lightsInfo().packed;

      window.DBG.theme('salon');
      window.DBG.tp(0, 0, 0);
      window.DBG.frame(4, 16.7);
      out.salonQueued = window.DBG.stats().queued;
      out.salonLights = window.DBG.lightsInfo().packed;
      return out;
    });
    console.log(`    solo: ${state.soloQueued} queued / ${state.soloLights} lights · `
              + `salon: ${state.salonQueued} queued / ${state.salonLights} lights`);

    expect(state.soloQueued).toBe(0);              // solo schedules no seeded work
    expect(state.salonQueued).toBeGreaterThan(0);  // the ordinary hall still does
    // every unhung frame's lamp is off, so solo keeps strictly fewer lights lit
    expect(state.soloLights).toBeLessThan(state.salonLights);
    await page.evaluate(() => window.DBG.theme('salon'));
  });

  test('the painters run off the main thread, or say why not', async () => {
    /* Generation moved into workers. The contract is that this is invisible:
       same pixels, and a fallback that still works where OffscreenCanvas or
       Worker is missing. ?nw pins that fallback so it stays exercisable. */
    const on = await page.evaluate(() => window.DBG.stats().painters);
    console.log(`    painters: ${on}`);
    expect(on).not.toBeNull();
    // Chromium has both, so the pool must have come up here.
    expect(on).toBeGreaterThan(0);
  });

  test('the upload review pre-fills how each work meets its frame', async () => {
    /* Forty uploads should not be forty decisions, so the prompt arrives with
       an answer already in it. A sheet of paper is a whole object and is always
       mounted — cropping one damages it. Anything else fills the frame when the
       nearest frame shape is close enough that filling crops almost nothing,
       and is mounted when it would cut in deep. */
    const cases = await page.evaluate(() => [
      { what: 'portrait drawing',   r: window.DBG.presentation(1500, 2000, true) },
      { what: 'landscape drawing',  r: window.DBG.presentation(2200, 1400, true) },
      { what: '3:2 photograph',     r: window.DBG.presentation(3000, 2000, false) },
      { what: 'square photograph',  r: window.DBG.presentation(2000, 2000, false) },
      { what: 'panorama',           r: window.DBG.presentation(6000, 1200, false) },
    ]);
    const by = Object.fromEntries(cases.map((c) => [c.what, c.r]));
    console.log('    ' + cases.map((c) => `${c.what}: ${c.r.orientation}/${c.r.fill}`).join(' · '));

    expect(by['portrait drawing']).toEqual({ orientation: 'portrait', fill: 'mount' });
    expect(by['landscape drawing']).toEqual({ orientation: 'landscape', fill: 'mount' });
    // a drawing is mounted whatever its shape; a photograph is judged on fit
    expect(by['3:2 photograph'].fill).toBe('bleed');
    expect(by['square photograph'].fill).toBe('bleed');   // S frames are square
    expect(by['panorama'].fill).toBe('mount');            // 5:1 would lose half of it
    expect(by['panorama'].orientation).toBe('landscape');
  });

  test('the image uses its tonal range instead of crushing into black', async () => {
    /* The colour pipeline had no sRGB encode and no sRGB decode, so everything
       was displayed at L^2.2 and the whole museum lived in about 70 of the 255
       code values. Measured on this scene before the fix: mean 14, darkest
       pixel 1, and 85% of pixels inside the bottom sixteenth. Colour has to be
       judged by eye, but the crush is a number and this is it. */
    await page.evaluate(() => {
      window.DBG.tp(0, 0, 0);
      if (!window.DBG.stats().lights) dispatchEvent(new KeyboardEvent('keydown', { code:'KeyL', bubbles:true }));
      if (window.DBG.stats().shutters) dispatchEvent(new KeyboardEvent('keydown', { code:'KeyO', bubbles:true }));
    });
    /* One call: stepping and reading must not be split across turns, or the
       browser composites in between and readPixels returns zeros. The art
       queue is deliberately not drained — the tonal range of the room is set
       by walls, floor and lighting. */
    const h = await page.evaluate(() => window.DBG.histogram(10));
    console.log(`    lit: mean ${h.mean}  range ${h.lo}–${h.hi}  bottom-16th ${h.bottom16th}%`);

    expect(h.bottom16th).toBeLessThan(55);     // was 85.1
    expect(h.hi).toBeGreaterThan(150);         // highlights survive
    expect(h.lo).toBeLessThan(40);             // and so do the blacks
  });

  test('the office opens with the visible field focused', async () => {
    await page.keyboard.press('KeyC');
    await expect(page.locator('#curator')).toBeVisible();
    // Regression: focus went to #cur-pass, which lives inside #cur-lock —
    // permanently hidden whenever cloud mode is on — so nothing was focused.
    await expect(page.locator('#cur-email')).toBeFocused();
  });

  test('the sign-in field is themed, not a stock browser box', async () => {
    const bg = await page.locator('#cur-email').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 255)');
    expect(bg).toBe('rgb(12, 10, 8)');
  });

  test('the OTP row stays hidden until a code is requested', async () => {
    // Regression: .row{display:flex} outranked the UA [hidden] rule, so the
    // six-digit field showed before any code had been sent.
    await expect(page.locator('#cur-code-row')).toBeHidden();
  });

  test('Esc closes the office even with a field focused', async () => {
    // Self-sufficient rather than leaning on a previous test in this group.
    if (await page.locator('#curator').isHidden()) await page.keyboard.press('KeyC');
    await expect(page.locator('#curator')).toBeVisible();
    await expect(page.locator('#cur-email')).toBeFocused();
    // The fields stopPropagation so WASD cannot leak into the world, which
    // also stops C reaching the window handler — Esc is the way out.
    await page.keyboard.press('Escape');
    await expect(page.locator('#curator')).toBeHidden();
  });
});
