/* ═══════════════════════════════════════════════════════════════════
   Adaptive quality. One dial, read by everything that can be made
   cheaper: device pixel ratio, MSAA sample count, floor reflections.

     2  full — DPR up to 1.5, 4× MSAA, reflections on
     1  DPR 1.0,  2× MSAA, reflections on
     0  DPR 0.75, no MSAA, opaque floor

   The caps used to be 1.5 / 1.25 / 1.0, which quietly assumed every display
   asks for at least 1.5. On a 1.25 laptop panel — an extremely ordinary
   thing to own — `min(1.25, 1.25)` is `min(1.25, 1.5)`, so **dropping from
   tier 2 to tier 1 changed not one pixel**; the machine asked for less and
   was given the same frame with half the MSAA. Measured on an Intel UHD at
   1536×718 CSS: tier 2 cost 26.8 ms a frame and tier 0 cost 13.5 ms, and
   20.9 × 0.64 = 13.4 predicted it exactly — the cost is pixels, linearly,
   and nothing else. So the dial has to move pixels to mean anything.

   Tier 0 renders below the display and upscales. That is softer, and it is
   the right trade at the tier that has already given up MSAA and the floor
   reflections: a sharp slideshow is worse than a slightly soft walk.

   Bidirectional, with hysteresis and a run of agreeing half-second windows
   before either move — each change reallocates the post buffers, so the
   mechanism meant to prevent hitches must not become a source of them.

   It used to ratchet only downward, and it was trivially fooled: dt is
   clamped to 50ms, so the single long frame you get when a tab wakes reads
   as exactly 20fps and cost you the rest of the session with no way back.
   The frame loop now discards any window containing a frame over 120ms as a
   stall rather than evidence of a slow machine.
   ═══════════════════════════════════════════════════════════════════ */
import { DPR_CAP } from '../config.js';

/* ?q=0..2 pins the tier. Useful on a slow machine, and it is what keeps the
   test suite affordable: 4x MSAA into a float buffer costs minutes on a
   software rasteriser, and nothing outside the two renderer tests cares. */
const pinned = /[?&]q=([0-2])\b/.exec(location.search);

/* Where to start, before any frame has been timed. Full quality is the right
   guess for a desktop and the wrong one for a four-core laptop with an
   integrated GPU, which needs about a second of bad windows to be allowed
   down a tier — a second spent stuttering through the visitor's first
   impression of the room.

   Core count is a proxy for the GPU, not a measurement of it, so this is only
   an opening bid: the ratchet climbs as readily as it falls, and a quick
   machine that happens to have four cores is back at full quality within a
   few seconds. Guessing low costs some sharpness briefly; guessing high costs
   the first thing anyone sees. */
const startQ = (navigator.hardwareConcurrency || 8) <= 4 ? 1 : 2;

export const PERF = { q: pinned ? +pinned[1] : startQ, lastChange: 0, pinned: !!pinned };

export function dprCap(){
  return PERF.q === 2 ? DPR_CAP : PERF.q === 1 ? 1.0 : 0.75;
}
