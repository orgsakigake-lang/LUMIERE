/* ═══════════════════════════════════════════════════════════════════
   Adaptive quality. One dial, read by everything that can be made
   cheaper: device pixel ratio, MSAA sample count, floor reflections.

     2  full — DPR up to 1.5, 4× MSAA, reflections on
     1  DPR 1.25, 2× MSAA, reflections on
     0  DPR 1.0, no MSAA, opaque floor

   Known limitation: it only ever ratchets down. One transient hitch —
   a browser tab waking, a background tab stealing the GPU — degrades the
   rest of the session with no way back. Making it bidirectional with
   hysteresis is queued renderer work.
   ═══════════════════════════════════════════════════════════════════ */
import { DPR_CAP } from '../config.js';

/* ?q=0..2 pins the tier. Useful on a slow machine, and it is what keeps the
   test suite affordable: 4x MSAA into a float buffer costs minutes on a
   software rasteriser, and nothing outside the two renderer tests cares. */
const pinned = /[?&]q=([0-2])\b/.exec(location.search);

export const PERF = { q: pinned ? +pinned[1] : 2, lastDrop: 0, pinned: !!pinned };

export function dprCap(){
  return PERF.q === 2 ? DPR_CAP : PERF.q === 1 ? 1.25 : 1.0;
}
