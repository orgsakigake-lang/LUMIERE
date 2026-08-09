import { test, expect } from '@playwright/test';

/* Probe points cover every aspect ratio and several algorithms, including a
   room three halls out so the neighbourhood builder is exercised. */
/* Kept to three: each artHash runs a generator to completion synchronously,
   which is seconds apiece on the software rasteriser used in headless. */
const WORKS = [[0, 0, 0], [1, 0, 1], [0, -3, 2]];
const ROOMS = [[0, 0], [1, 0], [0, -3], [2, 5], [-4, 7]];

const ENTER_MS = 90_000;   // SwiftShader builds the first wing this slowly

/** Wait for boot. DBG is installed at the end of the script, so its presence
 *  means the whole module evaluated without throwing. */
/* ?q=0 pins the cheapest tier: no MSAA, no reflections, DPR 1. Software
   rasterisation makes 4x MSAA into a float buffer cost minutes, and nothing
   here except the renderer group is testing those. */
async function boot(page, query = '?q=0') {
  await page.goto('/' + query);
  await page.waitForFunction(() => typeof window.DBG?.stats === 'function', null, { timeout: 60_000 });
}

/** Enter the gallery. Deliberately does NOT wait for the art queue to drain:
 *  generation is budgeted at 3.5ms per rendered frame, and under SwiftShader
 *  rAF is slow enough that the queue never empties. Nothing below needs a
 *  fully hung wing — only a running render loop. */
async function enter(page) {
  await page.locator('#enter').click({ timeout: ENTER_MS });
  await page.waitForFunction(() => document.body.classList.contains('entered'), null, { timeout: ENTER_MS });
}

/* artHash runs the generator synchronously off the render path, so it does not
   need the gallery to be entered — which keeps most of this suite fast. */
const hashes = (page) => page.evaluate((works) => works.map(([gx, gz, i]) => {
  const r = window.DBG.artHash(gx, gz, i);
  return typeof r === 'string' ? r : r.hash;
}), WORKS);

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
});

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

test.describe('the renderer', () => {
  /* `antialias: true` was set on the context for months and did nothing,
     because the scene renders to an FBO and only the fullscreen composite
     triangle ever reached the default framebuffer. These tests exist so a
     silently-inert renderer setting cannot happen twice. */
  test('the scene buffer is HDR and multisampled when the driver allows', async ({ page }) => {
    await boot(page, '');
    await page.evaluate(() => window.DBG.frame(2, 16.7));
    const info = await page.evaluate(() => window.DBG.postInfo());
    console.log(`    scene buffer: ${info.hdr ? 'RGBA16F' : 'RGBA8'} · ${info.samples || 1}× samples`
              + ` · caps hdr=${info.caps.hdr} maxSamples=${info.caps.maxSamples}`);

    expect(info.ready).toBe(true);
    if (info.caps.hdr) expect(info.hdr).toBe(true);
    if (info.caps.maxSamples >= 2) expect(info.samples).toBeGreaterThanOrEqual(2);
  });

  test('MSAA actually changes the image', async ({ page }) => {
    await boot(page, '');
    const caps = await page.evaluate(() => window.DBG.postInfo().caps);
    test.skip(caps.maxSamples < 2, 'driver has no multisampling');

    // Oblique camera, so edges do not land on pixel boundaries where MSAA
    // would legitimately have nothing to do.
    const profile = await page.evaluate(() => {
      const c = document.getElementById('gl');
      const g = c.getContext('webgl2');
      window.DBG.pos(0.4, 1.2, 0.42, 0.02);

      /* The composite adds ±0.014 of white noise to every pixel. Averaging 64
         rows cuts that ~8× while leaving a real edge intact — without it the
         grain buries the thing being measured. */
      const sharpest = () => {
        window.DBG.frame(4, 16.7);
        const W = 200, H = 64;
        const buf = new Uint8Array(W * H * 4);
        g.readPixels(Math.round(c.width * 0.42), Math.round(c.height * 0.42), W, H,
                     g.RGBA, g.UNSIGNED_BYTE, buf);
        const col = new Float64Array(W);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          const k = (j * W + i) * 4;
          col[i] += (0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2]) / H;
        }
        let max = 0;
        for (let i = 1; i < W; i++) max = Math.max(max, Math.abs(col[i] - col[i - 1]));
        return max;
      };
      /* Hash the frame as well as measuring the edge. The hash is the real
         assertion: it proves the sample count reaches the pixels at all.
         Edge sharpness is only logged, because how much MSAA helps is a
         property of the driver — on this machine's GPU the hardest step falls
         from 92 to 61, on the software rasteriser used in CI it barely moves,
         and neither number should be able to fail the build. */
      const frameHash = () => {
        window.DBG.frame(3, 16.7);
        const buf = new Uint8Array(256 * 256 * 4);
        g.readPixels(Math.round(c.width / 2) - 128, Math.round(c.height / 2) - 128,
                     256, 256, g.RGBA, g.UNSIGNED_BYTE, buf);
        let h = 2166136261 >>> 0;
        for (let i = 0; i < buf.length; i += 7) h = Math.imul(h ^ buf[i], 16777619) >>> 0;
        return h;
      };
      window.DBG.samples(0); const off = sharpest(), hOff = frameHash();
      window.DBG.samples(4); const on = sharpest(), hOn = frameHash();
      window.DBG.samples(null);
      return { off, on, hOff, hOn };
    });

    console.log(`    hardest edge step: ${profile.off.toFixed(1)} without MSAA, `
              + `${profile.on.toFixed(1)} with  (driver-dependent)`);
    // The hash is the whole assertion. Edge sharpness is genuinely not
    // assertable here: on the software rasteriser the two numbers differ by
    // less than the film grain, and which way round they land is noise.
    expect(profile.hOn).not.toBe(profile.hOff);   // the samples reach the pixels
  });
});

test.describe('the archive build', () => {
  /* `npm run archive` swaps the cloud client for an inert stub and minifies,
     producing the artifact meant for permanent storage. It has to work with no
     backend at all. Size is *reported*, not enforced — see below. */
  const FREE_TIER = 102400;        // 100 KiB — ArDrive Turbo's free-upload tier
  const SANITY = 400 * 1024;       // a runaway build, not a policy threshold

  test('boots, generates art, and carries no backend', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/archive/index.html?q=0');
    await page.waitForFunction(() => typeof window.DBG?.stats === 'function', null, { timeout: 60_000 });

    expect(await page.evaluate(() => window.DBG.cloudState().on)).toBe(false);
    expect(await page.evaluate(() => window.DBG.stats().cached)).toBeGreaterThan(0);
    expect(await page.evaluate(() => typeof window.DBG.artHash(0, 0, 0).hash)).toBe('number');
    expect(errors).toEqual([]);
  });

  test('paints the same pixels as the hosted build', async ({ page }) => {
    // Stripping the backend must not change a single brushstroke.
    await page.goto('/archive/index.html?q=0');
    await page.waitForFunction(() => typeof window.DBG?.artHash === 'function', null, { timeout: 60_000 });
    const archived = await hashes(page);

    await boot(page);
    expect(await hashes(page)).toEqual(archived);
  });

  test('reports its size against the free-upload tier', async ({ page }) => {
    const bytes = await page.request.get('/archive/index.html')
      .then((r) => r.body()).then((b) => b.byteLength);
    const kib = (bytes / 1024).toFixed(1);

    /* Deliberately not a gate. 100 KiB is ArDrive's free-tier policy, not an
       engineering limit, and treating it as one meant the build started
       shaping the product: features got cut to claw back a couple of hundred
       bytes. Crossing it costs a one-time credit purchase (~$10, which covers
       thousands of uploads at this size), not a per-upload fee. Report the
       number, let a human decide. */
    if (bytes <= FREE_TIER) {
      console.log(`    archive: ${bytes} bytes (${kib} KiB) — inside the free tier, `
                + `${FREE_TIER - bytes} to spare`);
    } else {
      console.log(`    archive: ${bytes} bytes (${kib} KiB) — OVER the ${FREE_TIER / 1024} KiB `
                + `free tier by ${bytes - FREE_TIER}. Uploading now needs Turbo Credits: a `
                + `one-time purchase, not a per-upload cost. See docs/permanence.md.`);
    }
    // Only a runaway build fails here.
    expect(bytes).toBeLessThan(SANITY);
  });
});

test.describe('the cloud layer', () => {
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
test.describe.serial('inside the gallery', () => {
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
    const t = await page.evaluate(() => window.DBG.frame(120, 16.7));
    testInfo.annotations.push({ type: 'frame', description: `avg ${t.avgMs}ms max ${t.maxMs}ms` });
    console.log(`    frame: avg ${t.avgMs}ms  max ${t.maxMs}ms  (SwiftShader — not a perf number)`);
    expect(t.stepped).toBe(120);
    expect(Number.isFinite(t.avgMs)).toBe(true);
    expect(t.avgMs).toBeGreaterThan(0);
  });

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
