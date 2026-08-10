import { expect } from '@playwright/test';

/* Probe points cover every aspect ratio and several algorithms, including a
   room three halls out so the neighbourhood builder is exercised. */
/* Kept to three: each artHash runs a generator to completion synchronously,
   which is seconds apiece on the software rasteriser used in headless. */
export const WORKS = [[0, 0, 0], [1, 0, 1], [0, -3, 2]];
export const ROOMS = [[0, 0], [1, 0], [0, -3], [2, 5], [-4, 7]];

export const ENTER_MS = 90_000;   // SwiftShader builds the first wing this slowly

/** Wait for boot. DBG is installed at the end of the script, so its presence
 *  means the whole module evaluated without throwing. */
/* ?q=0 pins the cheapest tier: no MSAA, no reflections, DPR 1. Software
   rasterisation makes 4x MSAA into a float buffer cost minutes, and nothing
   here except the renderer group is testing those. */
export async function boot(page, query = '?q=0') {
  await page.goto('/' + query);
  await page.waitForFunction(() => typeof window.DBG?.stats === 'function', null, { timeout: 60_000 });
}

/** Enter the gallery. Deliberately does NOT wait for the art queue to drain:
 *  generation is budgeted at 3.5ms per rendered frame, and under SwiftShader
 *  rAF is slow enough that the queue never empties. Nothing below needs a
 *  fully hung wing — only a running render loop. */
export async function enter(page) {
  await page.locator('#enter').click({ timeout: ENTER_MS });
  await page.waitForFunction(() => document.body.classList.contains('entered'), null, { timeout: ENTER_MS });
}

/* artHash runs the generator synchronously off the render path, so it does not
   need the gallery to be entered — which keeps most of this suite fast. */
export const hashes = (page) => page.evaluate((works) => works.map(([gx, gz, i]) => {
  const r = window.DBG.artHash(gx, gz, i);
  return typeof r === 'string' ? r : r.hash;
}), WORKS);
