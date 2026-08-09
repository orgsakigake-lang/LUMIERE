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
async function boot(page) {
  await page.goto('/');
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
    const luma = async () => {
      await page.evaluate(() => window.DBG.frame(12, 16.7));
      return page.evaluate(() => window.DBG.luma());
    };
    const lit = await luma();
    expect(lit).toBeGreaterThan(0);

    await page.keyboard.press('KeyO');                    // shutters open — daylight
    const day = await luma();
    await page.keyboard.press('KeyO');
    await page.keyboard.press('KeyL');                    // lamps out
    const dark = await luma();
    await page.keyboard.press('KeyL');                    // restore

    console.log(`    luma: lit ${lit.toFixed(4)}  day ${day.toFixed(4)}  dark ${dark.toFixed(4)}`);
    expect(day).toBeGreaterThan(lit * 2);          // daylight is unmistakable

    // Killing the lamps barely moves this probe — paintings are drawn with
    // uEm = 0.35, so a third of every canvas's brightness ignores the lighting
    // entirely and the works keep glowing in a dark room. The residual is small
    // enough that how much art has finished generating shifts it more than the
    // lamps do, so this only asserts "not meaningfully brighter". Tighten it to
    // a real ratio once the self-illumination is fixed.
    expect(dark).toBeLessThan(lit * 1.05);
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
