/* ═══════════════════════════════════════════════════════════════════
   Adaptive quality. One dial, read by everything that can be made
   cheaper: device pixel ratio, MSAA sample count, floor reflections.

     2  full — DPR up to 1.5, 4× MSAA, reflections on
     1  DPR 1.25, 2× MSAA, reflections on
     0  DPR 1.0, no MSAA, opaque floor

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

export const PERF = { q: pinned ? +pinned[1] : 2, lastChange: 0, pinned: !!pinned };

export function dprCap(){
  return PERF.q === 2 ? DPR_CAP : PERF.q === 1 ? 1.25 : 1.0;
}
