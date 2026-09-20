# Curator and Endless Gallery repair design

Status: product direction approved on 2026-09-20. This document is the design
checkpoint before implementation planning.

## Purpose

LUMIERE currently contains most of the mechanics needed to curate a collection
and render a detailed endless museum, but the deployed experience hides or
understates them. A signed-out curator cannot reach the local collection UI when
cloud support is configured. The first endless rooms are dark and deliberately
sparse, so the deployed material, shadow, decoration, and culling work is hard
to perceive. The synthesized soundtrack reinforces that impression with low
drones, slow minor phrases, and a long stone-hall tail.

This repair will make the curator usable without an account, present manual and
automatic placement as two clear paths, and make the first minute of the Endless
Gallery warm, detailed, and unmistakably changed. It will reuse the existing
IndexedDB, cloud, room-generation, texture, and portal-culling systems rather
than create a second curator or renderer.

Success means:

- a new visitor can add several works without creating an account;
- every accepted work reports when it has actually been saved;
- one action arranges all unplaced works into suitable frames;
- manual placement remains straightforward on mouse, touch, and keyboard;
- signing in adds sync and sharing without erasing local work;
- the entrance and first doorway visibly demonstrate the material and decor
  upgrade on desktop and phone;
- the default soundtrack feels warm and inviting and remembers the visitor's
  choice;
- the visual changes stay inside measured geometry, draw-call, and frame-time
  budgets.

## Evidence and root causes

The live deployment and current `main` branch were inspected before this design.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Cloud configuration gates the whole curator workspace | `curatorRefresh()` in `src/main.js` opens `#cur-open` only when `cloud.sess` exists whenever `cloud.on` is true | Production enables cloud support, so a signed-out visitor sees authentication but cannot use the initialized local collection |
| Local curation is already available underneath the gate | `curatorBoot()` opens IndexedDB and loads local works before cloud boot | Authentication does not need to be a prerequisite for adding work |
| Multiple upload and automatic placement already exist | `curatorAddFiles()` accepts a file list; `gatherIntoWing()` places unplaced works | The repair can expose and refine existing behavior instead of creating a new subsystem |
| Local writes can appear successful before persistence settles | IndexedDB requests and transaction completion are not consistently awaited and surfaced per file | A storage failure can be reduced to a generic message or become effectively silent |
| The boundary control is visible while the actual curator tools are hidden | the boundary row sits outside `#cur-open` in `src/ui/body.html` | “Open as curator” appears to be the curator entry point but only changes walking bounds |
| Visual upgrades are deployed | live diagnostics reported HDR, 4x samples, shadows and reflections enabled; procedural plaster/parquet normals, contact shadows, plants, sculpture, and portal culling are present in source | The issue is composition and readability rather than a missing deployment |
| The entrance suppresses major decor | entrance-room generation intentionally avoids a bench, pedestal, or statue; remaining decor is probabilistic | A visitor can walk through the first room without seeing a clear decorative focal point |
| The staging is very dark | material relief and off-axis decor were difficult to read in live screenshots | Texture and detail need light, contrast, and sightline changes |
| Music is randomized from four subdued programs | `src/audio.js` uses low pads down to 32.7 Hz, long note gaps, minor pentatonic modes, bowed/reed voices, and a long convolution tail | The intended calm museum atmosphere often reads as sad or funereal |

The live render also demonstrated that portal culling is working: one observed
view reduced 26 nearby rooms to 6 portal-visible rooms. The current room was
about 1,938 triangles. These are useful baselines to preserve while changing the
first-room composition.

## Approaches considered

### Local-first curator inside the existing gallery

Always expose the collection workspace, use IndexedDB when signed out, and make
cloud sign-in an optional sync-and-share action. Refine the existing upload,
manual hanging, and `gatherIntoWing()` code. Compose deterministic entrance
details in the current room generator.

This is the selected approach. It fixes the deployed failure at its source,
keeps offline use, preserves current links and collections, and limits the
change to systems already in the application.

### Cloud-first curator with simpler authentication

Keep authentication mandatory but put a more direct account form before the
tools. This would leave the reported blocker in place for anyone who wants to
curate locally or is offline. It is rejected.

### Separate curator application

Create a dedicated `/curate/` workspace with its own upload, arrangement, and
preview screens. This could support a future professional editorial workflow,
but it duplicates storage and placement behavior while the existing office is
already close to usable. It is deferred until real curator usage demonstrates
that the in-gallery workspace cannot scale.

## Curator experience

Opening the Curator's Office always reveals the workspace. Its top line states
where work is saved:

- **On this device** while using IndexedDB;
- **Synced** with the account identity when cloud sync is active;
- **Saving** or **Needs attention** when an operation is pending or failed.

The cloud controls move into a secondary **Sync & share** section. Signing in is
never required to add, edit, arrange, preview, or remove local work. The walking
boundary control is labeled and grouped with layout controls so it cannot be
mistaken for an authentication or curator-mode switch.

The primary flow has three visible stages:

1. **Add works.** A large drop target and file-picker button accept one or many
   supported images. Each file gets a row with thumbnail, title, processing
   state, and a specific error with retry or remove. The panel remains usable
   while a batch processes.
2. **Arrange.** After at least one unplaced work exists, the curator sees
   **Arrange automatically** as the primary action and **Place manually** as the
   secondary action.
3. **Review and share.** A collection grid shows placed/unplaced state and opens
   metadata, crop/fill, rotation, replace, and remove controls. Preview returns
   the curator to the same selection. Publishing and link controls appear after
   sign-in.

On narrow screens these stages form one scrollable panel with a sticky status
and close control. Primary controls have 44 CSS pixel touch targets, visible
focus, useful accessible names, and status text announced through a restrained
live region. The upload input remains a native file input behind the styled
drop target.

## Upload and persistence behavior

Image processing keeps the current line-art detection and size policy. Work is
bounded so a large batch cannot decode every full-resolution source at once.
The implementation may process sequentially or with a very small concurrency
limit after measurement.

An image reaches **Saved** only after its storage transaction completes. Decode,
format, quota, IndexedDB, network, and authorization failures receive distinct
messages. One failed item does not roll back successful siblings. Retrying an
item reuses its prepared result where safe and cannot create duplicate records.

Signed-out uploads are stored in IndexedDB. Signed-in behavior continues to use
the owner's cloud collection, with progress and errors exposed through the same
item model. If a visitor signs in while local works exist, the UI offers to add
those works to the account and states the count before starting. It keeps the
local originals until every selected work and placement has been confirmed in
the cloud. Cancelling or failing migration leaves the local collection intact.
No automatic merge may overwrite a cloud record or silently discard a local
placement.

Reloading after a successful local upload must restore the work, title, editing
state, and placement. Storage unavailable or quota exhausted produces a durable
panel warning rather than a transient toast.

## Automatic and manual placement

**Arrange automatically** is the user-facing replacement for **Gather into a
wing**. It applies to unplaced works by default and preserves every manual or
previous placement. A separate, explicit rearrange command can include placed
works after showing how many placements will change.

The arranger will:

- use existing valid artwork slots and avoid occupied frames;
- match portrait, landscape, square, and wide works to compatible frames;
- place larger or designated cover works on strong doorway sightlines first;
- distribute works across the minimum connected set of rooms with a balanced
  visual density;
- extend the bounded wing or add a floor only when current capacity is
  insufficient;
- produce the same result from the same collection and starting layout;
- report placed, preserved, and unplaced counts; and
- expose one-step undo for the completed automatic arrangement.

If every work cannot fit, successful placements remain and the result explains
what is left. It does not silently replace existing work or create inaccessible
rooms.

**Place manually** selects a work and closes or minimizes the office into a
persistent placement state. Facing an eligible frame reveals a clear **Hang
here** action. Clicking/tapping it is the primary interaction; `H` remains a
shortcut. The selected work, cancellation action, and placement result stay
visible. Occupied frames offer a deliberate replace/swap decision. Manual
placement works with pointer lock declined and with touch controls.

## Endless Gallery visual direction

The first thirty seconds must communicate warmth, material quality, and authored
composition without obstructing movement or competing with art.

The entrance becomes a deterministic composition rather than relying on room
decoration probabilities:

- lift the readable wall and floor exposure while preserving a dark-gallery
  identity and artwork contrast;
- add restrained cornice/wainscot or pilaster detail using the existing room
  mesh path;
- place paired plants or a small sculptural accent outside collision and touch
  control paths;
- add one floor element, such as a narrow runner or inlaid border, that helps
  the parquet relief and reflection read; and
- guarantee a focal sculpture, bench vignette, or architectural feature in the
  first adjacent room, aligned with the initial doorway sightline.

Ordinary rooms retain procedural variety, but the entrance ring receives
minimum decoration rules so an unlucky seed cannot produce several bare rooms
in succession. Decoration remains restrained around artwork walls. Texture
contrast, normal strength, and fill light are tuned together at real phone and
laptop sizes; stronger normals alone are not accepted if they shimmer or make
plaster look wet.

The interface will identify the two experiences clearly: the curated exhibition
at the public root and **The Endless Gallery** at `/endless/`. Navigation between
them uses explicit labels so visitors do not mistake the finite exhibition for
the procedural halls.

## Sound direction

The Endless Gallery will open with a warm, restrained program instead of drawing
randomly from the current subdued set. The default uses a brighter register,
major-pentatonic or Lydian harmony, soft mallet/piano-like attacks, shorter
decays, and less reverb send. It avoids a continuous sub-110 Hz drone. The
starting volume is low enough to sit behind the art and footsteps.

The music control exposes program name, volume, and silence. A visitor's exact
program and volume are remembered instead of replacing the selected program
with another random one on the next visit. Silence remains persistent. Existing
programs may remain as explicit choices after their levels are normalized, but
Vespers, Glass, or Rainfall will never be the surprise default. Rain remains a
separate deliberate soundscape and does not mix with music.

Audio still starts only after a visitor action, suspends when the page is hidden
or the visitor exits, and tears down transient nodes. Reduced motion has no
automatic audio implication; sound preference is controlled independently.

## Performance constraints

The visual repair must retain the current streaming and quality controls:

- entrance and decor geometry are generated once and batched into the room VAO;
- new static details do not add one draw call per object;
- textures and normal maps are reused rather than generated per room;
- portal/frustum culling remains active and decorative geometry follows room
  visibility and eviction;
- no new per-frame allocations or DOM reads enter the render loop;
- adaptive quality removes secondary reflection/normal/decor effects before it
  compromises artwork readability or navigation; and
- hidden, covered, and exited states continue to suspend unnecessary work.

Initial acceptance budgets use the measured entrance as a baseline. The revised
entrance should stay below 3,000 room triangles before multipass submission and
should not add more than one batched material draw to the ordinary room path.
The existing automated structural budgets remain authoritative if they are
stricter. A warm run through the entrance and first adjacent room must preserve
the existing quality tier on the same browser/device used for the before
measurement. Software-rendered CI can enforce counts and behavior; it cannot
prove hardware frame rate or battery use.

## State and failure handling

Curator state separates four concerns: selected files, persisted works,
placements, and sync state. UI visibility derives from workspace availability,
not cloud availability. Cloud session loss changes sync status and leaves local
editing available.

Closing the curator during processing asks for confirmation only when abandoning
unsaved decoded work; already saved items remain. Navigation, reload, network
loss, duplicate filenames, corrupted files, storage quota, expired sessions,
partial cloud migration, and automatic-placement capacity are explicit test
cases. Errors remain attached to the affected item or operation until resolved
or dismissed.

Visual and audio enhancements fail softly. Unsupported normal maps or HDR fall
back to the existing material path. Unsupported WebAudio leaves the visit
silent. No cosmetic feature blocks entering, viewing art, or opening the
curator.

## Verification and acceptance

Focused unit and browser tests will prove the repaired paths before broader
checks selected by the repository's change-aware CI rules.

Curator acceptance includes:

- cloud configured plus signed out still opens a usable local workspace;
- multi-file upload reports independent progress and persists after reload;
- an IndexedDB transaction failure never reports **Saved**;
- automatic arrangement places representative portrait, landscape, square, and
  wide collections while preserving manual placements;
- arrangement capacity, partial result, and undo are correct;
- manual placement works with mouse, touch, and keyboard and handles occupied
  frames deliberately;
- signing in with local work preserves the local collection through successful,
  cancelled, and failed migration; and
- signed-in upload, edit, publish, and share behavior remains compatible.

Visitor acceptance includes:

- deterministic screenshots of the entrance and first sightline at desktop and
  phone viewports;
- readable materials and a visible focal detail without obstructing the route;
- room triangle, draw-call, visible-room, and quality-tier diagnostics within
  budget;
- the warm program is the first-visit default and the exact sound choice and
  volume survive reload;
- silence, rain, tab suspension, exit/resume, and unsupported-audio behavior;
  and
- explicit root-to-endless and endless-to-root navigation.

The final gate is the deployed GitHub Pages site, checked from a clean browser
profile. It must add a work locally, reload it, automatically arrange a small
batch, manually hang one work, enter the first two endless rooms, and verify the
sound controls. Deployment is incomplete until the public artifact and commit
match and browser console/network checks are clean.

## Scope limits

This repair does not replace the renderer, introduce a new UI framework, build a
separate curator application, redesign cloud privacy, or migrate the curated
Three.js exhibition back into the procedural renderer. It does not promise that
software-rendered CI establishes real-device performance. A dedicated curator
route, collaborative accounts, arbitrary room authoring, and automatic semantic
sequencing of artwork can be considered after the repaired workflow has real
usage evidence.
