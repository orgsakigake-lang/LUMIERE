/* ═══════════════════════════════════════════════════════════════════
   Dimensions, tuning constants, and build-time switches.
   Everything here is a leaf: this module imports nothing.
   ═══════════════════════════════════════════════════════════════════ */

/* ————— the room, in metres —————
   Every room in the infinite museum is this same box; only the door mask,
   the special flag, and the contents vary. FS_ARCH bakes HS-WT and H into
   its ambient-occlusion term, so changing these means changing that too. */
export const S  = 14;      // room size
export const HS = S / 2;   // half room
export const H  = 4.2;     // ceiling height
export const WT = 0.24;    // wall slab thickness (per room side)
export const DOORW = 1.8;  // doorway width
export const DOORH = 2.9;  // doorway height
export const EYE = 1.65;   // eye height
export const PR  = 0.35;   // player radius

/* Door probability per shared edge. Above the percolation threshold, so the
   museum is one connected component rather than pockets of sealed rooms. */
export const DOOR_P = 0.6;

/* Extinction per metre. At the original 0.15 a surface 10 m off was 78% fog and
   22% light: zeroing the fog colour dropped the frame median from 19 to 4, and
   tripling the chandelier moved it by two code values. The lighting model was
   real but invisible — everything past arm's reach was a flat wash of the fog
   constant, which is what made the light pools read as painted gradients.
   Lowered until the museum is lit by its lamps and fogged only by distance. */
export let FOG_SIGMA = 0.038;
export let DAY_SIGMA = 0.030;
export function setSigma(night, day){
  if (night != null) FOG_SIGMA = night;
  if (day   != null) DAY_SIGMA = day;
}
/* Fog is the floor of the image — every distant surface is mixed toward it, so
   this constant, not ambient, is what sets the black point. It was ~3.3x higher
   while the pipeline had no sRGB encode, where it displayed as roughly 1/255.
   With the encode correct that same value showed as 64/255 and the museum lost
   its blacks entirely. Re-tuned by measurement: the lit night frame now runs
   7..232 with a mean of 29, against 1..212 with a mean of 14 and 85% of pixels
   crushed into the bottom sixteenth. */
export const FOG = [0.0129, 0.0117, 0.0093];

export const BUILD_R = 2, EVICT_R = 3;      // build 5×5, evict beyond 7×7
export const DPR_CAP = 1.5;

export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Per-room and per-artwork diagnostics are useful while building and are pure
   noise in a shipped gallery — 25 lines land in the console before the visitor
   has taken a step. On for local development, and on demand with ?debug.
   Warnings and errors are never routed through this; they always speak. */
export const DEV = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
                || /[?&]debug\b/.test(location.search);
export const trace = DEV ? console.log.bind(console) : () => {};

/* ————— cloud configuration (optional) —————
   Paste your Supabase project URL and anon public key here to enable
   accounts, cloud collections, and shareable galleries — then run
   supabase-setup.sql once in that project. Leave both empty for
   fully-local mode (nothing else changes). The anon key is safe to
   publish; security lives in the row-level-security policies. */
export const CLOUD_URL = 'https://ntkvsaiuwijcbyphwfnb.supabase.co';
export const CLOUD_KEY = 'sb_publishable_FrAh2j2iX19fP0m2nnzJrg_fnhJdQCq';
