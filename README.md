# LUMIÈRE — The Endless Gallery

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
| drag / pointer-lock mouse | look — works while walking |
| `Space` | jump · press again quickly mid-air for the double jump |
| `F` or right-click | inspect the work you face (glides the camera up to it) |
| `E` | acquire — re-renders the work at 1024² and offers it as a PNG |
| `L` | the lamps — on/off (also a wall switch, bottom right) |
| `O` | the shutters — open them and sunlight pours through the windows |
| `T` | cycle the gallery theme |
| `C` | the Curator's Office |
| `M` | sound on/off |

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
- The grid shows the collection — click to select, the cross to remove.
- Walk to *any* frame in the infinite gallery and press **H** to hang the
  selected work there. It is **mounted, not cropped**: the sheet keeps its own
  proportions on a cream rag mount with a bevelled window, however the frame is
  shaped, and it is lit by its own fixture — neutral and dim, the way a museum
  lights works on paper — beside the warm tungsten on the paintings. A *private
  loan* placard hangs with it. **U** takes it down and the seeded work returns.

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
hanging read-only.

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

- Floating origin (jitter-free at Wing ±100000) · budgeted generator scheduling
  (3.5 ms/frame, one texture upload/frame, pooled textures) · bright-pass bloom,
  ACES tonemap, vignette, grain · WebGL context loss rebuilds everything from
  seeds · storage and pointer lock degrade gracefully in sandboxed embeds.
- Debug hooks on `window.DBG` (`tp`, `seed`, `autopilot`, `post`, `stats`,
  `artHash`, `luma`, `frame`, `findSpecial`).
