# LUMIÈRE — The Endless Gallery

A first-person walk through an endless, procedurally generated art gallery.
Every painting is a unique generative artwork, painted into being the moment you
approach it — and between the seeded works, you may hang your own.

One self-contained `index.html`. Raw WebGL2 + Canvas 2D + WebAudio. Zero dependencies,
zero network requests.

**Live copy:** https://claude.ai/code/artifact/bf8a657b-3ff5-48c5-bd5c-ac890f733f85

## Running it

Open `index.html` in any recent Chrome, Edge, or Firefox — straight from `file://`
works. Or serve it (`python3 -m http.server`) and browse to `localhost:8000`.

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
| `C` | the Curator's Office |
| `M` | sound on/off |

## The two switches

**Lights** puts out every lamp and chandelier — after dark only the faint
self-glow of the paintings (and the moon shafts in the rare rooms) remains.
**Shutters** turn night into day: windows appear in the free stretches of wall,
warm sky glass, mullions and sills, and sunlight falls into the halls. All four
combinations are valid moods. Both switches are remembered between visits.

## The Curator's Office (`C`)

The gallery accepts *private loans* — your own images:

- **Local mode (default):** enter the curator's key (first visit: `curator` —
  change it inside). Images live in this browser's IndexedDB; placements
  survive reloads; nothing ever leaves your machine.
- **Add works…** — upload images (downscaled to ~1280 px JPEG on import).
- The grid shows the collection — click to select, **×** to remove.
- Walk to *any* frame in the infinite gallery and press **H** to hang the
  selected work there (cover-cropped, with a *private loan* placard).
  **U** takes it down and the seeded work returns.

## Cloud mode — accounts, sync, shareable galleries

With a free [Supabase](https://supabase.com) project behind it, the Curator's
Office grows up: email sign-in (six-digit code, no passwords), a collection
that follows you across devices, and a **share link** so anyone can walk your
hanging read-only.

Setup, once (~10 minutes):

1. Create a Supabase project (free tier is plenty: 500 MB DB + 1 GB images).
2. In the dashboard: **SQL Editor → paste `supabase-setup.sql` → Run.**
   That creates the tables, the storage bucket, and every row-level-security
   policy (reads are public — galleries are meant to be walked; writes are
   strictly owner-only).
3. **Authentication → Sign In / Up:** make sure the Email provider is enabled
   (it is by default).
4. In `index.html`, near the top of the script, fill in:
   ```js
   const CLOUD_URL = 'https://YOURPROJECT.supabase.co';
   const CLOUD_KEY = 'sb_publishable_...';   // Settings → API Keys → anon public
   ```
   The anon key is *designed* to be public — the SQL policies are the lock,
   not the key. Never paste the `service_role` key anywhere.
5. Deploy (below). Open the Curator's Office → sign in with your email →
   **Send local works to the cloud** migrates an existing local collection →
   claim a gallery name → share `…?gallery=your-name`.

Leave `CLOUD_URL`/`CLOUD_KEY` empty and everything stays exactly as before —
fully local, no network.

## Deploying free

Any static host works; two good ones:

- **Cloudflare Pages** (recommended — unlimited static bandwidth):
  ```sh
  npx wrangler login          # one-time browser sign-in
  npx wrangler pages deploy . --project-name lumiere
  ```
  Your gallery appears at `https://lumiere.pages.dev`.
- **GitHub Pages:** push this folder to a public repo → Settings → Pages →
  deploy from branch. Bonus: the included workflow
  `.github/workflows/keepalive.yml` pings Supabase twice a week so the free
  project never pauses — add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as
  repository secrets to arm it.

Free-tier arithmetic: images are ~200 KB after import, so 1 GB of storage
holds ≈ 5,000 works, and 5 GB/month of egress serves ≈ 25k image views.

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
