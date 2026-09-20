# How LUMIÈRE is put together

One self-contained `index.html` ships. The source is modular; esbuild inlines
it back into a single file. Those are separate decisions and conflating them is
what made the original 3843-line file hard to extend.

## Builds

```sh
npm run dev        # watch + server on :8000, unminified
npm run build      # index.html, minified — original gallery artifact
npm run build:site # site/, the combined GitHub Pages artifact
npm run archive    # archive/index.html, no backend — see docs/permanence.md
npm run test:fast  # boot + cloud layer, ~2 min — use this while working
npm test           # complete legacy browser suite
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
modules: a `ReferenceError` at boot. Use a single test with `-g` when fixing
that one test.

CI classifies changed paths into legacy, curated, database, Edge Function, and
site domains. Documentation-only changes finish without installing Node or a
browser. Shared, dependency, workflow, and unknown executable changes fall back
to every check. `workflow_dispatch` and the Sunday 02:17 UTC schedule always run
the full suite. Run `npm run test:ci-scope` when changing that policy.

## Graph navigation

Install the local helper with `uv tool install graphifyy`, then generate the
code-only graph with `graphify extract . --code-only`. The graph is ignored and
local to the machine; rebuilding it uses tree-sitter and no model key. Use
`graphify query`, `graphify path`, and `graphify explain` for broad navigation,
then inspect source before changing it. CI selection remains the explicit policy
in `tools/ci-scope.mjs`.

`index.html` remains committed for reproducibility and archive-style hosting.
GitHub Pages publishes the generated `site/` artifact through Actions: the curated
exhibition is the root and the self-contained original gallery is `/endless/`.

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
    touch.js           the three gestures: drag to look, the ring, tap
    plan.js            the floor plan, drawn from the seed layer alone
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
connected to the origin by BFS through open doors **and stairs**. `applyBounds`
diffs a signature so hanging a work inside the wall costs nothing.

Two rules, both learned the hard way:

**Only live placements count.** `livePlacements()` filters to rows whose upload
still exists. A row outlives its work easily — removed on another device,
IndexedDB cleared — and the wall is drawn around the hanging, so one orphan row
at the origin was a wing of one room, which is a room with all four doorways
built shut. The filter is non-destructive: the collection may simply not have
finished loading, so every load asks again rather than deleting rows.

**The wall is for guests.** `?gallery=` visits are bounded always. The
curator's switch (`lumiere_bound`, default **open**) exists so they can stand
in the same walls a visitor does. It defaulted closed and that was the bug
above with a second lock on it: the switch lived inside the signed-in half of
the office, the local passphrase gate is hidden whenever a cloud project is
configured, and the shut door's "create a room" plate was itself gated on a
session — so the only three ways out of a sealed wing all required an account
the visitor might never have made. The switch now sits outside `#cur-open`
(which halls exist is a property of the browser, not of an account) and the
plate asks anyone who is not a guest.

## Floors

`gy` is the third axis of the floating origin. Reaching the next floor's plane
re-anchors a storey upward exactly as crossing `±HS` re-anchors sideways —
which is the whole design, and why a staircase needed no second coordinate
system, no vertical special case in the six render passes, and imposes no limit
on the museum's height.

- **Keys.** `roomKey(gx,gz,gy)` returns `"gx,gz"` at `gy = 0` and `"gx,gz@gy"`
  otherwise. Non-negotiable: a frame key is `"<roomKey>:<i>"`, and that string
  is what every stored placement, every share link and a database CHECK
  constraint are written against. Only floors that did not previously exist
  carry a suffix. `parseRoomKey` reads both.
- **Determinism.** Every seed stream is offset by `floorSalt(base, gy)`, which
  is the identity at `gy = 0`. The ground floor is hash-for-hash the museum it
  was; the storeys above it are genuinely different buildings rather than
  copies.
- **The stair.** `stairUpAt(gx,gz,gy)` is a vertical edge hash owned by the
  *lower* room, so both floors agree about the opening without consulting each
  other. `stairPlan` is keyed to the lower room's coordinates for the same
  reason: the run of treads and the well cut in the floor above must be the
  same rectangle. The entrance column is forced open upward on every floor and
  closed downward at the ground, so there is one grand stairwell over the door
  and the spawn room's floor is whole.
- **Collision is one constant.** The flight has no colliders — it is walkable
  surface. `STEP_UP` (0.46 m) refuses any rise taller than a stride, which is
  simultaneously what lets the bottom tread be stepped onto and what stops
  anyone strolling through the side of the stringer. Getting this wrong is
  cheap to spot and expensive to debug: the first version gathered the *floor
  above's* balustrade into the collider set and every climb stopped dead at
  1.4 m against a bannister on another storey.
- **The landing is load-bearing, not decorative.** Without it the top of the
  rise and the end of the run arrive in the same substep, the ground under the
  climber drops from a full storey to nothing, and they fall the height they
  just climbed — every time. `stairHeight` returns `STOREY` for a stretch past
  the top tread, and the well is cut to include it, so the landing *is* the
  floor above seen from below.
- **`STOREY = H + FLOOR_SLAB`, not `H`.** Stacked flush, a ceiling and the
  floor over it are the same plane; both draw, both win the depth test in
  patches, and the entrance hall fills with the shimmering fan that coplanar
  surfaces always make. Six centimetres of slab removes the class of problem by
  construction. A fascia closes the slab's edge around the well.
- **Rendering.** `refreshNear` adds at most two entries with `oy = ±STOREY` —
  the rooms the visitor's own stair joins — and every pass takes `oy` through
  `mulT` and `packLights`. The portal flood cannot reach them (its clip
  rectangles describe apertures in *walls*), so they are marked visible by a
  frustum test against their own box a storey up.

## The plan

`ui/plan.js` draws a storey. The one property everything else follows from:
**it builds nothing.** Doors come from `edgeOpenX/Z`, stairs from `stairUpAt`
and `stairPlan`, a hall's character from `specialAt`, its walls from
`sealedAt` — all of them pure functions of the seed and the boundary. So the
plan can draw halls nobody has walked, and a whole storey nobody is standing
on, without meshing geometry, baking a shadow map, or putting a record in the
room cache for the evictor to inherit. A test asserts it: `DBG.stats().cached`
is identical before opening the plan and after flicking through three storeys
of it.

- **Sealing had to become answerable from coordinates.** `sealedWall(r, wall)`
  needs a built room record; the plan has none, and needs the same answer.
  `sealedAt(gx, gz, gy, wall)` is now the one implementation and `sealedWall`
  delegates to it — rather than the plan carrying a second copy of the rule
  that drifts the first time the boundary changes.
- **Walls are filled rectangles, not strokes.** A wall between two halls is
  0.48 m of a 14 m bay — 3.4% — so at plan scale it genuinely has thickness. It
  is also what makes the plan legible: a doorway is 13% of a wall, and a 13%
  break in a hairline is not a break anyone sees. Kept even and on integer
  coordinates so edges land on whole pixels.
- **What it withholds.** A hall's `specialAt` tint is painted only once the hall
  is in `visited`. The shape of the building is what a plan is for; what is
  hanging in the dark room is not.
- **Bounded galleries are framed whole.** `planFrame` reads the extent of
  `BOUNDS` on the storey and sizes the drawing to it. A guest is handed the
  shape of the entire collection; the endless museum gets a travelling window
  and a caption saying it carries on past every edge.
- The compass and the scale bar are in the HTML caption, not the canvas. The
  grid is sized to fill the page, so a compass rose inside it lands on
  somebody's hall.

## Arrival

The entrance card is written for the endless museum, and a guest at a shared
link used to get the same one — including *"no one else will ever see these
works"*, printed to the one visitor looking at works somebody else chose and
sent them the key to. `introVoice()` rewrites it.

- It fires **twice**: once synchronously at boot from the slug in the URL, so
  the door is labelled before the network has answered, and again when the
  collection lands, with the counts.
- The slug is somebody else's text. Everything goes through `textContent`, and
  the name is additionally checked against `SLUG_SHAPE` at the display boundary
  — not only at the URL, because a name also arrives in the backend's answer.
  A name that could not be a gallery is printed as "that name".
- `arrivalAnswered`, not `cloud.viewing`: a link naming a gallery that does not
  exist has been answered too, and would otherwise sit for ever under a card
  saying it was still fetching.

The `<head>` carries Open Graph and Twitter-card tags and an inline SVG favicon.
`preview.jpg` is a real frame of the museum, rendered at 1200x630 by the same
headless pipeline the tests use and committed at the repo root. It is the one
asset the page does not inline — an unfurler cannot read a data URI, and the
page itself never fetches it, so `index.html` is still one request.

## Touch

`ui/touch.js` is the whole of it. Three gestures — drag to look, an analogue
ring in the lower left to walk, tap to open the work you face — and no fourth.

- **It installs unconditionally.** A laptop with a touchscreen is an ordinary
  machine, so asking `(pointer: coarse)` at boot and deciding once for the
  session would have been wrong for it. The listeners always exist; `body.touch`
  is added the moment a finger actually lands (and at boot when the pointer is
  coarse, so a phone reads the right instructions rather than discovering the
  wrong ones do not work). Nothing here runs on a machine nobody touches:
  `touchWalk.on` is false and the walk reads zeroes.
- **The walk joins the keyboard path rather than forking it.** `step()` adds the
  ring's screen-space vector through the same basis `W A S D` use, then scales
  by `min(1, |m|)`. A key always measures at least 1, so the keyboard path is
  arithmetically what it was; the ring, at magnitude ≤ 1, is analogue for free.
  The dead zone is rescaled away rather than merely cut out, so the first
  millimetre of travel is a first step and not a lurch to a fifth of pace.
- **Touches are dispatched by identifier**, with move and end on the window. A
  touch belongs to whatever it started on for as long as it lasts, which is what
  makes walking with one thumb while looking with the other the ordinary case.
- **`touch-action: none` is on the canvas and nowhere else** — enough to stop
  double-tap zoom, pinch and pull-to-refresh from firing on top of a walk, and
  narrow enough to leave the guide and the office scrollable, which on a phone
  they have to be.
- **Curating needs a key a phone has not got.** Hanging is `H` and taking down
  is `U`, so a phone visitor could unlock the office, add works from the photo
  picker, and then find no way to place any of them — an invitation into a dead
  end. `#hang-btn` is that key: a pill under the reticle, calling the same two
  functions through the same gate, shown only on touch and only to someone the
  office is actually open to. It re-decides itself from `facedArtwork()` every
  eighth frame, alongside the reticle, and caches its own state so it touches
  the DOM only when the answer changes.
- **Testing it needs `DBG.pause`.** Under a software rasteriser a frame costs
  hundreds of milliseconds, so two CDP input events dispatched back to back land
  667 ms apart and a *tap* registers as a long press. Stopping the rAF chain puts
  them 4 ms apart. For the same reason `test/touch.spec.js` asserts velocity and
  `DBG.ring()`, never distance walked: distance counts frames the script did not
  ask for, and read 2.87 m for one second of a 2.0 m/s walk.

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

`test/` drives the app through `window.DBG`, which exposes a
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

**And it is slow enough to change what an input event means.** A frame under the
software rasteriser costs hundreds of milliseconds, so two CDP input events
dispatched back to back arrive 667 ms apart in page time — long enough that a
*tap* is judged a long press and nothing opens. `DBG.pause(true)` stops the rAF
chain, and the same two events then land 4 ms apart. For the same reason nothing
in `touch.spec.js` measures distance walked: the loop keeps running between the
round trips a scripted test is made of, and it read 2.87 m for one second of a
2.0 m/s walk. Velocity (`DBG.stats().vel`) and the ring's own vector
(`DBG.ring()`) are both independent of how many frames went by.

**The worker count is derived, not chosen.** A quarter of `os.cpus().length`,
capped at four — that is half the physical cores on anything hyperthreaded.
Four was a constant that had been right on a bigger machine and survived because
five spec files never quite filled it; a sixth turned it into three timeouts on
a four-core laptop, all of which passed one-at-a-time.

**Playwright's `tap()` is not always the way to tap.** Its hit-target check
reports the canvas as the interceptor for the touch pill, at a point that
`document.elementFromPoint` gives to the pill and that the browser itself
delivers to the pill — verified by listening: `pointerdown`, `touchstart`,
`mousedown` and `click` all arrive on `#hang-btn`, and the gallery answers
correctly. `touch.spec.js` dispatches touches over CDP and asserts what is under
the finger itself, which is the part that was ever worth asserting anyway.
