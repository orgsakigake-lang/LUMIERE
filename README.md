# LUMIÈRE — The Endless Gallery

## Curated exhibition preview

The new **A Study in Stillness** experience is available as a local preview alongside
the original gallery. It includes a light-filled reference room, six pre-generated works,
guided viewpoints, free walking, a collection browser, and a full-size artwork
viewer. The renderer loads only when you enter and stops drawing while idle or
covered by a dialog.

Room Settings now includes the original synthesized music programmes, rain-on-the-roof
audio with overcast lighting, and volume. Sound is opt-in. Curator-specific links
opened under this preview route to the original full gallery, preserving their identity.

```sh
npm install
npm run dev:curated
# Open http://127.0.0.1:8018/curated/
```

`npm run build:curated` creates the separate `curated/` static build. It leaves
the committed legacy `index.html` and the `archive` workflow unchanged. The
curated preview is a new reference exhibition; it does not migrate or replace
existing local/cloud collections. Use **Explore endlessly** to reach the
original experience.

The generated `curated/` directory is ignored by git. Run `npm run build:site`
to produce a deployable `site/` containing both entries. CI runs both browser
suites and uploads this directory as the `gallery-site` artifact. The original
entrance links to the Light Room in this combined build. Existing branch-based
GitHub Pages hosting still serves only committed files; publish the combined
artifact to make `/curated/` available. The standalone archive omits that link.

Checks: `npm run typecheck`, `npm run test:unit`, `npm run test:curated`.
The [implementation status](docs/performance/renderer-decision.md) distinguishes
completed preview work from renderer comparison and physical-device gates.
See [sharing and ambience status](docs/sharing-and-ambience-status.md) for the
compatibility fixes and the separately proposed secret-link privacy migration.
The secret-link backend is disabled by default (`PRIVATE_SHARING = false` in
`src/config.js`) until its migration and Edge Functions have been deployed.
Existing installations continue using their original upload bucket. See
[private sharing rollout](docs/private-sharing-rollout.md) for activation steps.

## Original gallery

A first-person walk through an endless, procedurally generated art gallery.
Every painting is a unique generative artwork, painted into being the moment you
approach it — and between the seeded works, you may hang your own.

Ships as one self-contained `index.html` — raw WebGL2 + Canvas 2D + WebAudio, no
runtime dependencies and a single request. The source is modular and built with
esbuild; the built file is committed, so the repo deploys with no CI step.

Cloud mode (accounts, private loans, shareable galleries) talks to Supabase. Clear
`CLOUD_URL` / `CLOUD_KEY` in `src/config.js` for a fully local, offline gallery — or run
`npm run archive`, which builds exactly that.

**Live:** https://orgsakigake-lang.github.io/LUMIERE/

## Running it

```sh
npm install
npm run dev        # esbuild watch + a static server on localhost:8000
npm run build      # index.html, minified — what GitHub Pages serves
npm run archive    # archive/index.html — no backend, for permanent hosting
npm test           # Playwright suite over the DBG surface
```

Needs a real origin — `http://localhost:8000`, not `file://`. Any recent Chrome,
Edge, or Firefox.

## Docs

- [docs/setup.md](docs/setup.md) — **start here**: clone to a hosted gallery of your own, and how to prove the privacy actually applied
- [docs/architecture.md](docs/architecture.md) — how the source is laid out, the lighting model, private loans, and the rules that hold it together
- [docs/permanence.md](docs/permanence.md) — keeping the gallery online forever for nothing: the archive build, the 100 KiB free-upload threshold, and what breaks when

## Layout

| path | what |
|---|---|
| `index.html` | the built artifact — committed, served by GitHub Pages |
| `src/main.js` | the parts not yet extracted — GL, scheduler, controls, frame loop |
| `src/config.js`, `src/world/`, `src/art/`, `src/render/`, `src/cloud/` | the extracted modules |
| `archive/index.html` | the no-backend permanent copy (`npm run archive`) |
| `src/ui/styles.css`, `src/ui/body.html` | chrome, spliced into the template at build |
| `src/index.template.html` | the page shell |
| `build.mjs` | bundle + inline + emit |
| `test/lumiere.spec.js` | determinism, archive budget, frame timing, UI regressions |
| `tools/scope.mjs` | extraction helper — run before moving code out of `main.js` |
| `supabase-setup.sql` | schema and row-level-security policies |

## Controls

| key | action |
|---|---|
| `W A S D` | walk (`Shift` — stroll faster) |
| mouse | look — the cursor locks on entry, so moving the mouse looks while you walk, run and jump; `Esc` frees it, a click takes it back, and drag-look works whenever the cursor is free |
| `Space` | jump · press again quickly mid-air for the double jump |
| stairs | no key — walk up them. Roughly one room in seven has a flight; the entrance hall always does, on every floor |
| `P` | the gallery plan — where you are, where you have walked, and where the stairs are |
| `F` or right-click | inspect the work you face (glides the camera up to it, and prints its title and description) |
| `V` or `E` | view larger — re-renders the work at 1024² beside its title and description, with an opt-in PNG |
| `L` | the lamps — on/off (also a wall switch, bottom right) |
| `O` | the shutters — open them and sunlight pours through the windows |
| `T` | cycle the gallery theme |
| `?` | the visitor's guide — every key and switch, also behind the `? help` button top-centre |
| `Esc` | leave inspect |
| `C` | the Curator's Office |
| `H` / `U` | hang the chosen work on the frame you face / take it down (one wall per work) |
| `M` | sound on/off |
| `N` | the music — four programmes and silence |

The wall switches at the lower right — lights, shutters, music, rain, curator —
answer to touch as well as keys.

## The gallery plan (`P`)

An endless museum with storeys and no plan is a maze. `P` draws one: the halls
around you to scale, the walls with their doorways as gaps, the shut doors of a
bounded gallery boarded in red, every stair in its true footprint with an arrow
up the run, a brass dot for each work hanging, and you — a wedge, pointing where
you are looking. Halls you have walked are drawn in the darker line; the ones
you have not are faint but there, because a plan shows the building.

`↑` and `↓` look at the storey above or below **without climbing to it**, which
is the fastest way to find out whether the way up is worth taking.

Two things it deliberately will not do. It never says what a hall *is* — a
vermilion room, the archive, the dark room — until you have stood in it: the
shape of the building is public, what is in it is not. And it never builds
anything: every line comes from the seed layer, which is pure, so the plan of a
floor you have never visited costs one Canvas2D pass and no GL at all.

A bounded gallery is framed **whole** rather than windowed — a guest at a shared
link is handed the shape of the entire collection at the door. The endless
museum gets a window that travels with you and says so.

## Arriving on somebody's link

A shared link is somebody else's front door, and the museum now says so at it:
the card names *The Collection of <curator>*, counts the works and the halls,
and the button reads **Enter the collection**. The browser tab and the link
preview (Open Graph / Twitter card, with a rendered still of a hall) follow.

### On a phone

A shared gallery is a link somebody sends you, and a link gets opened on a
phone. There is no cursor to lock and no `W` to hold, so the museum answers to
three gestures and no more:

| gesture | action |
|---|---|
| drag anywhere | look around |
| the ring, lower left | walk — analogue, so a half lean is a stroll and a full one the ordinary pace |
| tap | see the work you face, larger |
| tap the ring | jump |

Everything else on a phone is a switch you can already press. When the office
is unlocked, a **hang here** pill appears under the reticle whenever you face a
frame — the `H` and `U` keys, for a hand that has neither.

The layout follows: the corner readouts stack under the nav, the wall switches
become a column at the right, and the notices lift clear of the ring. The
quality dial also opens a tier lower on a touch device — a phone reports eight
cores and has the GPU of a phone, so core count argues for full quality on
exactly the hardware least able to hold it. It climbs back within seconds on a
tablet that can take it.

## Themes

A theme is not a colour swap — it is the whole room agreeing to serve one kind
of work. Light is never neutral by accident: a 2700 K tungsten lamp is
1 : 0.80 : 0.55, and everything it falls on is told that story. Walls matter for
the same reason, since light bounces off them onto the work — a warm wall is a
warm lamp you cannot switch off. So a theme sets the temperature and level of
every fixture, the schemes the walls and floors are cut from, how far the air
carries, where the grade puts its contrast, and what the mounts are made of.

| theme | for | what changes |
|---|---|---|
| **Salon** | painted work — oil, pastel, gouache | 2700 K tungsten, deep warm walls, the film split-tone of old halls |
| **Graphite** | monochrome work on paper — pencil, charcoal, ink | near-neutral lamps, low-chroma grey walls, split-tone flattened to almost nothing, cool-white rag mounts |
| **Studio** | digital and contemporary work | the white cube: 60% albedo walls, ~5200 K daylight, air that barely carries, almost no vignette |

**Graphite is `solo`:** it generates nothing. The only lit frames are the ones
holding your work — empty frames keep their moulding, because you need
something to aim at in order to hang, but their lamps stay off and unlit frames
disappear into a dark room. You see what you hung, and nothing else.

Measured, mean chroma across the frame: **salon 14.0 · graphite 2.9.** That
number is the whole point — it catches a colour cast whether it came from the
lamp, from a wall, or from the grade.

Switch with `T`, or in the Curator's Office. The choice is remembered.

## The two switches

**Lights** puts out the picture lights, the way a gallery closes for the night.
The candles on the chandeliers keep burning — dimmer, and much warmer than the
electric fixtures they replace — so the halls stay walkable by their light, and
the moon shafts remain in the rare rooms. The paintings go dark with everything
else; they are lit, not luminous.
**Shutters** turn night into day: windows appear in the free stretches of wall,
warm sky glass, mullions and sills, and sunlight falls into the halls. All four
combinations are valid moods. Both switches are remembered between visits.

## The Curator's Office (`C`)

The gallery accepts *private loans* — your own images:

- **Local mode (default):** enter the curator's key (first visit: `curator` —
  change it inside). Images live in this browser's IndexedDB; placements
  survive reloads; nothing ever leaves your machine.
- **Add works…** — upload images. Drawings are kept lossless at 2048 px, since
  JPEG ringing gathers around exactly the hard strokes a pencil or pen makes;
  photographs, which gain nothing from that and would cost tens of megabytes,
  keep a JPEG at the same resolution.
- **A review sheet appears after each batch**, asking how the new works should
  meet their frames — **mounted** (the sheet whole at its own proportions on rag
  board, never cropped) or **full bleed** (edge to edge, cropping what will not
  fit). Every row arrives with an answer already filled in, so forty uploads are
  not forty decisions: a drawing is always mounted, and a photograph fills the
  frame when the nearest frame shape is close enough that filling costs it
  almost nothing. Change any row, or set the whole batch at once. The choice is
  remembered and applies wherever the work hangs.
- **The same sheet asks what each work is called and what it says.** The title
  starts as the filename, because that is the only thing known about the work —
  not because `IMG_4471` is a good title, and it is what the placard will print
  otherwise. The description is optional and free text; it appears under the
  work on the wall and in full in the enlarged view. Both are editable later,
  and a title changed in the office redraws the placard already hanging.
- The grid shows the collection — click to select, the cross to remove.
- Walk to *any* frame in the infinite gallery and press **H** to hang the
  selected work there. It is **mounted, not cropped**: the sheet keeps its own
  proportions on a cream rag mount with a bevelled window, however the frame is
  shaped, and it is lit by its own fixture — neutral and dim, the way a museum
  lights works on paper — beside the warm tungsten on the paintings. A *private
  loan* placard hangs with it. **U** takes it down and the seeded work returns.

### The boundary

A museum without end is the point — for you. **Guests are always walled in:** a
shared link opens onto exactly the rooms the curator hung, doorways that would
lead into unwritten halls are built shut as closed double doors, nothing beyond
them is generated, meshed or lit, and the visit cannot drift off into seeded
halls that were never part of the show.

**The curator is not**, and that is a correction. A wing is sized to hold the
works and a room holds six frames, so a collection of three works makes a wing
of exactly one room — and closing the boundary around one room builds all four
of its doorways shut. Defaulting it closed sealed the gallery's owner inside a
box with five empty frames in it, on every visit after the first, with the
switch that reopens it hidden behind a sign-in they may never have used. So the
boundary is **open unless you ask for it**. Close it in the office to walk the
gallery exactly as a visitor at your link does; a shut door then asks — on a
plate, with a real question — whether a new room should exist there, and saying
yes adds exactly that room and nothing else.

A placement whose work no longer exists is not a hanging and draws no wall.

### Floors

Halls run outward; **stairs run up.** A flight of stone treads on a solid
stringer climbs through a well cut in the ceiling to a landing on the floor
above, with a rail around the opening. Roughly one room in seven has one, and
the entrance hall always does — on every storey, so there is one grand
stairwell rising the full height of the museum directly above the door. Walk
up; there is no key for it.

Vertically the world works exactly as it does horizontally. `gy` joins the
floating origin: reaching the next floor's plane re-anchors a storey upward the
same way walking past a wall re-anchors sideways, so a stair needs no second
coordinate system and the building has no height limit. The HUD names the
storey once you have left the ground.

In the Curator's Office, **The floors · − N +** lays your collection across
several storeys instead of one, shared out evenly and joined by the stair, so
three floors is three floors of gallery rather than two full ones and an attic
with a single drawing in it.

> Works hung above the ground floor need the schema re-run: their frame keys
> carry a floor (`3,-4@2:2`) and the database's CHECK constraint has to be
> widened to accept it. **Re-run `supabase-setup.sql`.** Ground-floor keys are
> unchanged, so nothing already hung is affected either way.

> **Galleries are private until you publish them.** In local mode nothing leaves
> the machine. In cloud mode your collection is visible only to you until you
> claim a name *and* turn on sharing — row-level security hides the rows, an
> unpublished slug does not resolve, and the storage bucket cannot be listed by
> anyone but its owner.
>
> The remaining caveat, stated precisely: object paths are UUIDs and the bucket
> serves them without auth, so anyone holding an *exact* path can still fetch
> that image. Paths can no longer be discovered — only shared. That is
> unguessability, not access control. Genuinely private images need a private
> bucket and an Edge Function to sign URLs for guests.
>
> **Re-run `supabase-setup.sql` to get this**, then `npm run verify:sql` to
> prove it applied. Earlier versions of that file did not parse at all.

## Cloud mode — accounts, sync, shareable galleries

With a free [Supabase](https://supabase.com) project behind it, the Curator's
Office grows up: email sign-in (six-digit code, no passwords), a collection
that follows you across devices, and a **share link** so anyone can walk your
hanging read-only. The gallery **theme travels with the account** too, so a
guest stands in the same light the works were curated under — that column is
new; **re-run `supabase-setup.sql` once** in the project's SQL editor to gain
it (the client tolerates its absence in the meantime).

**[docs/setup.md](docs/setup.md) walks the whole thing** — project, schema,
config, publishing, hosting, and how to *prove* the privacy applied rather than
assume it. Roughly half an hour, no paid account.

The short version: create a free project, run `supabase-setup.sql` in its SQL
editor, put the project URL and the **publishable** key into `src/config.js`,
then run `npm run verify:sql` before uploading anything you care about. That key
is designed to be public — the row-level-security policies are the lock, not the
key. The `service_role` key is the one that must never enter this repo.

Leave `CLOUD_URL`/`CLOUD_KEY` empty and everything stays exactly as before —
fully local, no network. `npm run archive` does the same thing at build time.

## Deploying free

Any static host works, since `index.html` is committed and there is no build
step on the server. Cloudflare Pages (`npx wrangler pages deploy .`) or GitHub
Pages both take a couple of minutes; [docs/setup.md](docs/setup.md#step-5--host-it)
has the commands and the free-tier arithmetic.

## How the seeds work

Everything else derives from one world seed (default `20260803`) hashed with
room coordinates — never from timing. Layout, doors, artwork placement,
algorithm, palette, and title flow from `murmur3(x, z, salt)` streams: revisit
room (1000, −2000) and the same paintings hang on the same walls. Placards print
each work's algorithm and seed — that pair *is* the artwork. Open with
`?seed=12345` to visit a different gallery. Doors open with p = 0.6 per shared
wall — above the percolation threshold, so the open wing is infinite.

## The collection

Six algorithm families, twelve curated palettes (HSL-jittered per hanging):
**Ink Current** (flow-field ink), **Strange Attractor** (Clifford density),
**Truchet Tiling**, **Fractured Glass** (relaxed Voronoi), **Composition**
(Bauhaus collage), **Ridgeline** (dithered landscapes).

Roughly one room in sixty-four is special: the crimson **Vermilion Cabinet**,
the salon-hung **Archive** of miniatures, or the **Dark Room** — one lit
painting in blackness. Chandeliers burn beneath ceiling rosettes; benches
appear where the walking is long; the occasional empty pedestal reads
*Untitled (stolen)*.

## Engineering notes

- **Floating origin in three axes** (jitter-free at Wing ±100000, and at any
  storey): climbing past a ceiling re-anchors upward exactly as walking past a
  wall re-anchors sideways, which is why a staircase needed no second
  coordinate system and the museum has no height limit. Storeys stack at the
  ceiling height *plus a slab* — stacked flush, a ceiling and the floor above
  it are the same plane and the room fills with the shimmer that coplanar
  surfaces always make.
- Budgeted generator scheduling
  (3.5 ms/frame, one texture upload/frame, pooled textures) · the paint queue is
  ordered by what you are *facing*, not merely by which room it is in, because
  the wait that reads as "slow loading" is the wait for the piece in front of
  you rather than for all of the art · bright-pass bloom,
  ACES tonemap, vignette, grain · WebGL context loss rebuilds everything from
  seeds · storage and pointer lock degrade gracefully in sandboxed embeds.
- **Adaptive where it is safe to be, fixed where it is not.** Painter count,
  quality tier and per-room light budget all follow the machine; the *painted
  size of a work* deliberately does not. A generator draws at its dimensions,
  so the same seed at a different size is a different picture — making that
  depend on a visitor's CPU would mean two people at the same coordinates
  seeing different paintings. Everyone paints at 384; `?art=` pins it.
- The quality dial has a memory. A tier abandoned for being too slow goes on
  probation that doubles each time it disappoints, because a ratchet with a
  dead band will otherwise climb into a tier the machine cannot hold and stay
  there — measured, a laptop parked at 46 fps for an entire session.
- Debug hooks on `window.DBG` (`tp`, `seed`, `autopilot`, `post`, `stats`,
  `artHash`, `artPNG`, `luma`, `frame`, `perf`, `reflections`, `maxLights`,
  `caption`, `findSpecial`).
