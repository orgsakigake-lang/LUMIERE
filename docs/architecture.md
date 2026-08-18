# How LUMIÈRE is put together

One self-contained `index.html` ships. The source is modular; esbuild inlines
it back into a single file. Those are separate decisions and conflating them is
what made the original 3843-line file hard to extend.

## Builds

```sh
npm run dev        # watch + server on :8000, unminified
npm run build      # index.html, minified — what GitHub Pages serves
npm run archive    # archive/index.html, no backend — see docs/permanence.md
npm run test:fast  # boot + cloud layer, ~2 min — use this while working
npm test           # everything, 39 tests, 6-9 min — before committing
npm run verify:sql # apply supabase-setup.sql to a throwaway PostgreSQL in
                   # Docker and assert 13 row-level-security behaviours
```

**Use `test:fast` in the inner loop.** The full suite is slow because CI has no
GPU: entering the gallery costs ~12s on SwiftShader and every `artHash` runs a
generator to completion.

The suite is **split by group across spec files**, because a file is the unit
Playwright can spread across workers. That took it from 20.7 minutes to 6–9.
`inside the gallery` is two files rather than one — the entry cost is paid
twice to halve what had become most of the run — and both stay `serial`
internally, since sharing one page is what makes entering affordable at all.
Four workers, not eight: each drives its own software-rendered browser and
SwiftShader already spreads rasterisation across every core, so past about half
of them they compete instead of overlapping. `mode: 'parallel'` inside
`determinism` was tried for the same reason and made the whole run *slower*,
6.4 minutes to 8.7. Tests boot at `?q=0`, which pins the cheapest quality
tier — without that, 4× MSAA into a float buffer roughly doubles the run. The
two renderer tests opt back into full quality because that is what they are
testing.

`test:fast` catches the failure that actually happens when moving code between
modules: a `ReferenceError` at boot. Reach for the full suite at commits, and
for a single test with `-g` when fixing that one test.

`index.html` is committed, so the repo deploys with no CI and no tooling.

## Layout

```
src/
  main.js              composition root: initPrograms, controls, inspect,
                       the Curator's Office, the frame loop, DBG, boot
  config.js            dimensions, tuning constants, DEV/trace
  persist.js           localStorage visit counters
  audio.js             synthesized bells and footsteps
  world/
    seed.js            h2, mulberry32, WORLD_SEED, door hashes — pure
    rooms.js           what exists at (gx,gz): doors, specials, art, lights
    geometry.js        room record → interleaved vertex buffer
  art/
    palettes.js        12 palettes + the HSL jitter
    algos.js           the 6 generators, titles, the finishing pass
    scheduler.js       texture pools, budgeted generation, room VAOs
  render/
    gl.js              the WebGL2 context and program helpers
    state.js           player, camera matrices, viewport, room caches
    perf.js            the adaptive quality tier
    post.js            HDR scene buffer, MSAA resolve, bloom, composite
    textures.js        procedural plaster, parquet, contact shadow, sky
    mat4.js            matrices and frustum planes — pure
    shaders/            14 GLSL files, 7 .vert and 7 .frag
  cloud/
    client.js          Supabase over plain fetch
    client.stub.js     inert stand-in for archive builds
  ui/
    styles.css         spliced into the template at build
    body.html          spliced into the template at build
    hint.js            flashHint
tools/
  scope.mjs            extraction helper — see below
  verify-sql.sh        runs supabase-setup.sql against Dockerised PostgreSQL
  supabase-shim.sql    the auth/storage objects Supabase provides, so the
                       policies can be executed outside it
```

## Rules that hold this together

**Everything derives from seeds, nothing from timing.** A room, its artworks,
their palettes and titles all come from one integer through `h2`. This is why
the WebGL context-loss handler can rebuild the entire museum from nothing, and
why the archive build needs no backend.

**Dependencies point outward.** When a module needed something from `main.js`,
the dependency was inverted rather than imported back:

- `audio.js` owns `audio.active`; `main.js` calls `setAudioActive(true)` on
  entry. It does not read main's `entered`.
- `buildRoomMesh(r, daylight)` takes a boolean; it does not read the `WIN.on`
  shutter toggle. Geometry has no business knowing a UI switch exists.
- `cloud/client.js` returns plain data. It does not call `flashHint`,
  `updateHudStat` or `syncArtJobs` — `main.js` has thin adapters for that.

**The frame loop touches no DOM.** Verified across all 400+ lines of it. HUD
updates are pushed from state transitions, never polled per frame.

**One source of truth for generated values.** `ALGOS.length` and
`PALETTES.length`, not `6` and `12`. `classifySpecial` in one place, not the
1/64 thresholds written out twice. Both of these were real bugs waiting: adding
a seventh algorithm used to silently do nothing.

## Themes

`world/themes.js` is a leaf holding three whole-room presets. A theme owns every
lever that can put colour on a work: the rig's temperature and level, the wall
and floor schemes, fog colour and extinction, the grade's exposure, grain,
split-tone and vignette, and the mount stock. `main.js` owns applying it —
`applyThemeConstants()` overwrites the live structures, `applyTheme()` adds
persistence, a rebuild and the UI.

Two rules keep it honest:

- **Themes mutate, they do not shadow.** Every structure a theme touches was
  already mutable, so nothing downstream needed a new read path. The cost is
  that the live values drift from the source defaults, which is why
  `SCHEMES_BASE` exists — the specials are re-derived from the originals on
  every switch rather than desaturated again on top of themselves.
- **Specials are pulled toward grey, not replaced.** `chroma` takes the
  Vermilion Cabinet a fraction of the way to its own luminance, so in a
  monochrome hall it goes quiet rather than becoming another grey room. Frame
  mouldings take the same treatment — a gilt frame is a warm light source once
  a lamp hits it.

`solo` means the theme generates nothing: `syncArtJobs` returns early, and
`genLights` marks each artwork's lamp `off` until `applyPlacement` turns it on.
An empty frame keeps its moulding — you need something to aim at to hang — but
without a lamp it recedes, and its canvas placeholder is the wall a shade darker
rather than the usual dark warm rectangle, which in a mostly-empty room reads as
a museum that failed to load.

**Any theme change requires the full teardown**, so `rebuildWorld()` is shared
by `applyTheme`, `DBG.relight` and `DBG.seed`. See the warning under the
lighting model: half-doing this teardown is how the art pools got starved.

Judge a theme with mean chroma over the frame — it catches a cast from the lamp,
from a bounced wall, or from the grade, all at once. Salon measures 14.0 and
graphite 2.9, and a test holds the ratio.

## What gets drawn

Visibility is computed once per frame, for all seven passes, in
`computeVisibility()`. Two facts, both required:

- **Portal reachability.** The world is a portal graph stored in `r.doors`. A
  flood from the visitor's room intersects a clip-space rectangle at every open
  doorway and stops when it closes. This cut rooms drawn from 13 to 2–5.
- **The view frustum**, unchanged. These are independent — the first version of
  the portal flood *replaced* the frustum test and ended up keeping seventeen
  rooms where frustum culling kept thirteen, because a doorway behind the camera
  has all four corners behind the near plane and the conservative fallback let
  everything past it through. `portalRect` now distinguishes "straddles the near
  plane" (keep the parent rect) from "faces away entirely" (not a way in).

**The reflection pass uses `visR`, not `vis`,** and must keep doing so. A
doorway bounds where a room can be seen *directly*; its mirror image lands in
the floor at your feet, which the aperture says nothing about. `visR` is a
frustum test against the room box mirrored below the floor.

### Proving a rendering change is invisible

`DBG.freeze(t)` pins animation time — flames, moon shafts, motes, and the grain,
which runs through a time hook on the post stack. Without it no two frames are
identical and a pixel comparison silently measures noise: the first portal-cull
A/B reported a difference at every viewpoint and there was none.

Two more things a comparison needs: run it in a **solo theme**, so a painting
finishing mid-comparison is not mistaken for a room going missing, and use
`DBG.culling(mode)` to force each strategy in turn.

## The lighting model

Read this before changing any light. It is the part of the codebase that has
misled people most, and one constant dominates everything else.

**Fog is not atmosphere, it is a mixing weight.** Every fragment ends as
`mix(lit, uFog, 1 - exp(-uSigma * distance))`. At the original `FOG_SIGMA` of
0.15/metre a surface 10 m away was **78% fog and 22% light** — so the lighting
model was real, correct and invisible, and every intensity in the rig had been
hand-tuned to a value that made no physical sense. Two measurements find this
instantly:

```js
DBG.fog([0, 0, 0])     // frame median fell 19 → 4: four fifths of the image was fog
DBG.sigma(0.038)       // then every other control starts responding
```

**If a light control seems inert, suspect sigma before you touch intensities.**
Ambient had the same problem — scaling it to 12% moved the frame mean by one
code value — which is why `AMB_BASE` had been tuned down to nothing.

The rig lives in one place, `RIG` in `world/rooms.js`, and `DBG.relight({...})`
patches it and rebuilds every room. Two things about that hook are load-bearing
and were bugs first: rooms are cached and `genLights` runs once inside
`getRoom`, so the cache must be cleared or the patch appears to do nothing; and
clearing it without `freeAllArtSlots()` starves the art pools *permanently*,
because slots stay keyed to discarded rooms and `startJob` re-queues rather than
failing.

Other invariants:

- **Falloff is windowed inverse-square**, reaching exactly zero at the light's
  range. It replaced `1/(1 + d²/R²)`, which varies 2.15:1 across a room where
  physics varies 16:1 and never reaches zero, so every light lit every fragment
  at a near-constant level and the pools read as painted gradients.
- **Occlusion belongs to the ambient term only.** `acc = uAmb * alb * ao`, not
  `acc *= ao` after the loop — light does not stop arriving because a wall is
  nearby.
- **`MAX_LIGHTS` is 10** and must match the loop bound in `arch.frag` and
  `paint.frag` and the `LPOS`/`LDIR`/`LCOL` array sizes. `assembleLights` fills
  it by priority, not array order: sun, then `fill`-marked lights, then artwork
  spots, then neighbour spill through open doors. At the old cap of 8 a six-work
  room filled the budget with its own spots and dropped the chandelier entirely,
  while its candle flames carried on burning.
- **Paintings are not emitters.** They take the same ambient the walls take, via
  `uEm`. A flat `uEm` ignored the lamp switch and left the works glowing in a
  dark room like cutouts in a void. Windows keep a real `uEm`: the sky emits.
- **Lamps off is not lights out.** The switch drops the picture lights and
  leaves `fill` lights burning at `CANDLE`, a warm-shifted fraction. Killing
  everything left 95% of the frame under 9/255, and uniform ambient cannot
  rescue that — it has no direction and makes no highlights.

Judge changes with `DBG.histogram()`, which covers the whole frame. `DBG.luma()`
reads a 32×32 patch at the reticle, so it reports whatever the camera happens to
face — lamps on to off moved luma 26.5 → 20.1 while the frame mean went
32.9 → 13.4. Hand-picked sample boxes are worse: a box on the wall above a
painting sits outside both the beam and the chandelier cone *by design*.

## Private loans

A visitor's own image overrides a seeded work on a frame. The path is
`curatorAddFiles` → `encodeUpload` → IndexedDB or Supabase Storage →
`applyPlacement` → its own GL texture.

- **Nothing is ever cropped.** `mountRect` contains the sheet at its true
  proportions and cream rag board fills the rest; margins are a minimum, not a
  fixed border. Cover-cropping was the original behaviour and it silently ate
  the top and bottom of any portrait drawing hung in a landscape frame. The
  acquire path had the same bug independently — both call `mountWork` now, so
  they cannot drift.
- **Line art is stored lossless.** JPEG ringing gathers exactly around hard dark
  strokes on white. `looksLikeLineArt` decides on a downsample; photographs keep
  a JPEG, since PNG would cost tens of megabytes for nothing.
- **Loans have their own fixture.** Lights carry a `forArt` index so hanging a
  drawing swaps one fixture — `RIG.paper`, near-neutral and dimmer, because
  works on paper hang at about 50 lux against 150–200 for a painting — without
  disturbing the paintings beside it. Taking it down restores the tungsten.
- Loans allocate their own textures at `LOAN_SIZES` (twice the linear resolution
  of a pool slot) and are freed by `releaseOutside` beyond one room.

`rebuildRooms` keeps room objects and only re-derives `r.lights` from
`r.ownLights`, so a runtime fixture swap survives a shutter toggle. Room
eviction does discard it, but the loan is re-applied on return.

## The boundary

`rooms.js` owns a single `BOUNDS` set (`null` = endless). The one rule that
keeps placements portable: **sealing happens at build time, never at
generation time.** `r.doors`, artwork segments and every `"gx,gz:i"` key are
derived with the doors open, so a bounded world hangs the same work on the
same wall as the endless one — a sealed doorway is the same doorway with a
closed double-door slab and a full-width collider dropped in at
`buildRoomMesh`, and `r.sealed` records which. Everything downstream consults
it: portal flood, `assembleLights` spill, autopilot, `syncArtJobs`, and
`ensureBuilt`/`refreshNear` simply skip out-of-bounds rooms (the visitor's own
room is always built, so a debug teleport degrades to an island, not a void).

main.js computes the set in `refreshBounds`: placement rooms ∪ wing route ∪
`boundExtra` (rooms the curator opened door-by-door via the confirm plate),
connected to the origin by BFS through open doors. `applyBounds` diffs a
signature so hanging a work inside the wall costs nothing. Guests
(`?gallery=`) are always bounded; the curator's switch is `lumiere_bound` in
localStorage, default closed once anything hangs.

## Extracting more from main.js

Run the scope tool first, always:

```sh
node tools/scope.mjs <firstLine> <lastLine>
```

It reports what the range declares, what the rest of `main.js` still needs from
it (your exports), and every name it reaches for with the module each comes
from (your imports). It matches on word boundaries, so comments and property
names show up too — check each one rather than trusting the list.

Then: move the lines, add `export` to the names in the first list, add imports
for the second, and run `npm test`. The suite has caught every extraction
mistake so far, usually on the boot test.

### What is left, and why it is left

`main.js` is about 2050 lines, down from 3843 — it grew back a little as the
renderer, lighting and loan work landed, most of it comment. What remains is the
composition root: program creation, controls and collision, inspect/acquire, the
Curator's Office, the frame loop, DBG and boot.

Those are not waiting on tidying; they are mutually recursive. The scheduler
needs to know whether a loan hangs on a frame, the curator needs the artwork
the visitor is facing, input needs the camera, and the frame loop drives all of
it. Two of those knots are already untied by inversion rather than by moving
lines — the scheduler asks a registered loan provider instead of reaching into
the curator, and it takes a frame budget rather than reading `entered` — and
the same trick would work for the rest. What it needs first is a render-pass
abstraction, so the 400-line frame loop stops being the only place a draw call
can live. Do that as part of the renderer work, not as a refactor for its own
sake.

The pattern that unblocked everything so far: **state can be a leaf,
orchestration cannot.** `render/state.js` holds the player and the camera and
imports nothing; the functions that maintain them stayed in `main.js` because
they call the scheduler and the HUD. Splitting on that line turns a cycle into
a tree.

## Testing

`test/lumiere.spec.js` drives the app through `window.DBG`, which exposes a
deliberate test surface: `DBG.frame(n, dtMs)` steps frames synchronously with an
injectable delta and works in hidden tabs where rAF is paused, and
`DBG.artHash(gx,gz,i)` runs a generator to completion and hashes the pixels.

**The determinism trap:** `artHash` is stable across reloads *within an origin*
but **differs between origins** — byte-identical code produces different hashes
on `github.io` and on `localhost`, because Canvas2D rasterisation is not
bit-exact across page contexts. Always capture and compare a baseline inside a
single run on one host. Never hard-code a golden hash recorded elsewhere.

**Painted size is a contract, not a quality setting.** Generated works are
painted at `TEX_SIZES` — 384-wide, 0.75 of the original 512 — and *that number
is the same on every machine on purpose*. A generator draws at its dimensions,
so the same seed at a different size is a different picture: not merely softer,
a different image. Rendering both confirms it, and the flow-field works diverge
visibly while the Voronoi ones barely move.

So scaling this by the visitor's hardware — the obvious way to make slow
machines faster, and worth 35% of the generation cost — would quietly falsify
two stated promises: that revisiting a room hangs the same paintings, and that
the algorithm and seed on the placard identify the work. A test asserts the
size does not move with `hardwareConcurrency`. `?art=<scale>` pins it for
measurement; `DBG.artPNG(gx,gz,i)` returns the image rather than its hash,
which is the only way to answer "does the cheaper size still look like the
painting" — a hash can only say that two renderings differ, never whether the
difference matters.

Loans are unaffected: a visitor's own drawing comes from their file at
`LOAN_SIZES` (1024-wide) and is never generated.

**Headless is slow.** CI runs on SwiftShader, where entering the gallery costs
about 12 seconds at 720×405 and 32 at 720p. Hence the small viewport, the 150s
timeout, and one shared page for the in-gallery group. Nothing waits for the art
queue to drain — the 3.5 ms/frame generation budget never empties it under
software rendering.
