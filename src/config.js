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

/* ————— the vertical dimension —————
   How often a room holds a stair to the floor above. Deliberately much rarer
   than a doorway: a stair is an event, and a museum where every room has one
   is a car park. At 0.14 a visitor meets one every few halls, which is often
   enough to feel like a building with upper floors and seldom enough that
   finding one is a small discovery. The entrance hall always has its own.

   STAIR_RUN is measured along the floor and STAIR_W across it; the rise is
   always H, because a stair that does not arrive at the next floor is not a
   stair. 6.6 m of run for 4.2 m of rise is about 32°, which is steep for a
   building and correct for a walk — a code-compliant 7 m of run at this
   ceiling height reads as a ramp from eye level. The well cut through the
   ceiling is the footprint plus a landing at the top. */
export const STAIR_P = 0.14;
export const STAIR_RUN = 6.6, STAIR_W = 1.9;
export const STAIR_STEPS = 21;              // 0.2 m rise, ~0.314 m going
/* The landing at the head of the flight, level with the floor it serves.
   Not decoration — it is what makes arriving possible. Without it the top
   tread is the last walkable point, and a walk reaches the top of the rise
   and the end of the run in the same instant: one substep later the ground
   under the visitor falls from 4.2 m to nothing and they drop the height of
   the storey they just climbed, every time, for ever. The landing gives the
   height a flat stretch to be *reached on*, which is where the floor above
   takes over. */
export const STAIR_LANDING = 1.25;

/* ————— the thickness of a floor —————
   Storeys stack at H + FLOOR_SLAB rather than at H, and that is not a detail.
   Stacked at H exactly, a room's ceiling and the floor of the room above it
   are the *same plane*: both get drawn, both win the depth test in patches,
   and the ceiling of the entrance hall fills with the fan of shimmering
   stripes that coplanar surfaces always produce. A building has a slab
   between its floors; giving it one costs six centimetres of head height and
   removes the whole class of problem by construction. The ceiling still sits
   at H and the floor still at 0, so a single storey is unchanged — only the
   distance between two of them moves. */
export const FLOOR_SLAB = 0.06;
export const STOREY = H + FLOOR_SLAB;
/* Where along the run the ceiling has to open. A climber's eyes are 1.65 m
   above the tread, so at 40% of the rise their head is at 3.33 m under a
   4.2 m ceiling — two thirds of a metre of clearance at the moment the well
   swallows them, which is enough that the opening reads as arriving rather
   than as a hole to duck through. The well is cut through the floor above
   over exactly this stretch, so the steps come up where the hole is. */
export const STAIR_WELL_FRAC = 0.40;
export const STAIR_WELL_PAD = 0.16;         // well cut slightly wider than the treads
/* The tallest rise a walk will take in its stride. Comfortably over one
   0.2 m tread so a flight is climbed without noticing, and far under the
   height of a stringer so its side is a wall rather than a ramp. This one
   constant is the whole of the stair's collision. */
export const STEP_UP = 0.46;

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

/* Guarded because config.js reaches the art worker through seed.js, and a
   worker has no matchMedia — an unguarded call here killed both painters at
   construction, and the only symptom was art quietly never arriving. */
export const REDUCED = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
export const CLOUD_URL = 'https://forflzkfuiacglhwehmd.supabase.co';
// Enable only after deploying supabase-secret-links.sql and both Edge Functions.
export const PRIVATE_SHARING = false;
export const CLOUD_KEY = 'sb_publishable_FHgh198QYe6iPX5NbLM1ZA_RfC6bCIR';
