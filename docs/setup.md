# Setting up your own LUMIÈRE

From a clone to a gallery of your own drawings, hosted, private until you decide
otherwise. Roughly half an hour, most of it waiting on other people's websites.

Nothing here needs a paid account. Nothing here asks you to paste a secret into
a file — the one key that goes into the source is *designed* to be public, and
the section on that says exactly why.

**Read this in order.** Step 3 is the one people skip, and it is the one that
decides whether strangers can see your work.

---

## What you are choosing between

| | local mode | cloud mode |
|---|---|---|
| where your images live | this browser's IndexedDB | your Supabase project |
| survives clearing site data | no | yes |
| same collection on another device | no | yes |
| shareable link | no | yes, when you publish |
| needs an account | no | free Supabase project |

You can start local and migrate later — the Curator's Office has a **Send local
works to the cloud** button that moves an existing collection up. Nothing is
lost by beginning locally the same afternoon you clone this.

---

## Step 1 — Run it

```sh
npm install
npm run dev          # esbuild watch + a static server
```

Open <http://localhost:8000>. It needs a real origin — opening the file directly
as `file://` counts as an opaque origin, where browsers block IndexedDB and
localStorage and refuse the cross-origin requests Supabase needs. The museum
itself would render; the Curator's Office would have nowhere to keep anything.
Any recent Chrome, Edge or Firefox is fine.

Press `C` for the Curator's Office. In local mode the key is `curator` on the
first visit — change it inside. Add a drawing, walk to any frame, press `H`.

If you only ever want this — your own machine, no accounts, nothing on a
network — you are finished. Skip to *Hanging your drawings well* at the bottom.

---

## Step 2 — A Supabase project (cloud mode)

1. Create a project at <https://supabase.com>. The free tier is 500 MB of
   database and 1 GB of image storage — at roughly 200 KB a drawing that is
   about five thousand works.
2. **SQL Editor → New query →** paste the whole of `supabase-setup.sql` **→
   Run.** It is idempotent; running it twice is safe.
3. **Authentication → Sign In / Up:** confirm the Email provider is enabled. It
   is by default. There are no passwords — sign-in is a six-digit code.
4. **Settings → API Keys:** copy the **publishable** (anon) key, and put it with
   your project URL into `src/config.js`:

   ```js
   export const CLOUD_URL = 'https://YOURPROJECT.supabase.co';
   export const CLOUD_KEY = 'sb_publishable_...';
   ```

> **Why it is safe to commit that key.** The publishable key only says *which*
> project you are talking to. What you are allowed to do once connected is
> decided entirely by the row-level-security policies in `supabase-setup.sql`,
> which run inside the database where the browser cannot reach them. This is the
> intended design, not a shortcut.
>
> **Never commit the `service_role` key.** That one bypasses every policy in this
> document. It belongs in a server environment variable or nowhere at all. If you
> ever paste it into a file in this repo, rotate it in the dashboard immediately —
> git history keeps it even after you delete the line.

Leaving `CLOUD_URL` and `CLOUD_KEY` empty keeps everything local and offline.
`npm run archive` builds exactly that, with the cloud layer swapped for an inert
stub.

---

## Step 3 — Prove the privacy actually applied

**Do not upload anything you would mind a stranger seeing until this passes.**

Earlier versions of `supabase-setup.sql` had a syntax error that made the whole
script abort, so *nothing* was applied — and the failure was silent, because a
gallery with no policies still works perfectly for its owner. It just also works
for everyone else. Reading the file is not evidence. Run it:

```sh
npm run verify:sql
```

That starts a throwaway PostgreSQL in Docker, applies the real
`supabase-setup.sql` to it, and asserts thirteen row-level-security behaviours —
that an anonymous session cannot read another owner's uploads, cannot list the
storage bucket, cannot write anything, and that an unpublished profile does not
resolve. It needs Docker running and touches nothing outside its container.

Then check it in the live project, which is the only thing that proves *your*
database got it:

1. Open the Curator's Office and sign in.
2. The sharing toggle must read **"private — only you can see it."**

If it does not, the SQL did not apply to that project. Re-run step 2.2.

> **The one caveat, stated precisely.** Storage object paths are UUIDs and the
> bucket serves them without authentication, so anyone holding an *exact* path
> can still fetch that image. After this SQL, paths can no longer be discovered —
> the bucket cannot be listed, and the rows that record the paths are owner-only.
> That is unguessability, not access control. It is the same property as an
> unlisted link. Genuinely secret images need a private bucket and an Edge
> Function signing URLs for guests, which this project does not yet do.

---

## Step 4 — Publish it, when you want to

Sharing is off until you do two separate things: claim a name, *and* turn
sharing on. Until both, an unpublished slug does not resolve for anyone.

In the Curator's Office: claim a gallery name, then enable sharing. Your link is
`https://your-site/?gallery=your-name`, and it is read-only — a guest walks your
hanging and is dropped in front of a work rather than at the origin.

To take it back down, turn sharing off. The link stops resolving.

---

## Step 5 — Host it

`index.html` is committed, so there is no build step on the server and no CI to
configure. Run `npm run build` after changing anything in `src/`, and commit the
result.

- **Cloudflare Pages** — unlimited static bandwidth:

  ```sh
  npx wrangler login
  npx wrangler pages deploy . --project-name lumiere
  ```

- **GitHub Pages** — push to a public repo, then Settings → Pages → deploy from
  branch. The included `.github/workflows/keepalive.yml` pings Supabase twice a
  week so a free project never pauses for inactivity; add `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` as repository secrets to arm it.

Free-tier arithmetic: about 5,000 works in 1 GB, and 5 GB/month of egress serves
roughly 25,000 image views.

For keeping a copy alive permanently and independently of any of this, see
[permanence.md](permanence.md).

---

## Hanging your drawings well

The gallery is built for works on paper, and a few of its habits are worth
knowing.

**Nothing is cropped, ever.** Hang a portrait drawing in a landscape frame and
it is *mounted*, not cut: the sheet keeps its own proportions on cream rag board
and the mount fills the rest. A matched aspect gets a slim mount; a mismatched
one gets generous margins on two sides. So hang whatever you like wherever you
like — but a frame roughly the shape of your sheet gives it the most wall.

**Scans beat photographs.** Line art is stored lossless at 2048 px, because JPEG
ringing gathers exactly around the hard strokes a pencil or pen makes.
Photographs are detected and kept as JPEG, since lossless would cost tens of
megabytes for nothing. A flat, evenly lit scan of a drawing is what this path is
tuned for.

**They are lit as works on paper.** Drawings get a near-neutral fixture at
roughly a third of the intensity the paintings get, because paper hangs at about
50 lux in a real museum — light is what fades it. Yours will look dimmer and
cooler than the generated paintings beside it. That is the intended reading, not
a fault.

**Pick the theme that matches your work.** Press `T`, or choose in the Curator's
Office. If you are showing pencil, charcoal or ink, choose **Graphite**: the
lamps go near-neutral, the walls drop to a low-chroma grey, and the grade's
split-tone flattens to almost nothing — all of it so that no colour reaches a
monochrome sheet from the lamp, from a bounced wall, or from the grade. Measured
across the frame, mean chroma falls from 14.0 in the Salon to 2.9.

Graphite also shows **only your work**: it generates no paintings of its own,
and a frame with nothing in it keeps its moulding but not its lamp, so it
recedes into the dark. Expect a mostly empty gallery until you have uploaded a
lot — that is the trade. **Salon** and **Studio** both keep the generated
collection, so switch to one of those if you want the museum full again.

**Press `E` to take one home.** It re-renders at 1024² — mounted, the way it
hangs — and offers a PNG. Saving is a separate click; nothing writes to your
disk on a keypress.

---

## When something is wrong

| symptom | cause |
|---|---|
| black page, "closed tonight" | no WebGL2 — check hardware acceleration is on |
| works fine locally, blank when hosted | opened over `file://`, or `index.html` not rebuilt after a `src/` change |
| signed in, but writes silently do nothing | the SQL did not apply — run `npm run verify:sql`, then re-run it in the dashboard |
| sharing toggle says "public" unexpectedly | same cause |
| no sign-in code arrives | Email provider disabled in Authentication → Sign In / Up |
| project stopped responding after a week | free Supabase pauses on inactivity — arm the keepalive workflow |
| empty frames three rooms away | expected today; art is generated for the 3×3 around you, architecture for 5×5 |

Nothing in this file is secret. The only value you should never put in the repo
is the `service_role` key.
