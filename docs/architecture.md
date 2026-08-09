# How LUMIÈRE is put together

One self-contained `index.html` ships. The source is modular; esbuild inlines
it back into a single file. Those are separate decisions and conflating them is
what made the original 3843-line file hard to extend.

## Builds

```sh
npm run dev        # watch + server on :8000, unminified
npm run build      # index.html, minified — what GitHub Pages serves
npm run archive    # archive/index.html, no backend, under 100 KiB
npm run test:fast  # boot + cloud layer only, ~55s — use this while working
npm test           # everything, ~3.5 min — use this before committing
```

**Use `test:fast` in the inner loop.** The full suite is slow for one reason:
software rendering. Entering the gallery costs ~12s and each `artHash` runs a
generator to completion. Parallel workers barely help — the in-gallery group is
`describe.serial` and four software-rendered browsers starve each other on the
same cores. `test:fast` catches the failure that actually happens during
extraction, which is a `ReferenceError` at boot.

`index.html` is committed, so the repo deploys with no CI and no tooling.

## Layout

```
src/
  main.js              the parts not yet extracted (see below)
  config.js            dimensions, tuning constants, DEV/trace
  world/
    seed.js            h2, mulberry32, WORLD_SEED, door hashes — pure
    rooms.js           what exists at (gx,gz): doors, specials, art, lights
    geometry.js        room record → interleaved vertex buffer
  art/
    palettes.js        12 palettes + the HSL jitter
    algos.js           the 6 generators, titles, the finishing pass
  render/
    mat4.js            matrices and frustum planes — pure
    shaders/*.vert     14 GLSL files
  cloud/
    client.js          Supabase over plain fetch
    client.stub.js     inert stand-in for archive builds
  ui/
    styles.css         spliced into the template at build
    body.html          spliced into the template at build
    hint.js            flashHint
  audio.js             synthesized bells and footsteps
  persist.js           localStorage visit counters
tools/scope.mjs        extraction helper — see below
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

`main.js` still holds GL setup, the art scheduler and texture pools, the post
stack, controls and collision, inspect/acquire, the Curator's Office, and the
frame loop.

These are the coupled core. The inspect block alone reaches for 23 names. They
will not come apart by moving lines, because the frame loop has no pass
abstraction — there is no seam to cut along. Build that first, as part of the
renderer work, and the modules fall out as a consequence.

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

**Headless is slow.** CI runs on SwiftShader, where entering the gallery costs
about 12 seconds at 720×405 and 32 at 720p. Hence the small viewport, the 150s
timeout, and one shared page for the in-gallery group. Nothing waits for the art
queue to drain — the 3.5 ms/frame generation budget never empties it under
software rendering.
