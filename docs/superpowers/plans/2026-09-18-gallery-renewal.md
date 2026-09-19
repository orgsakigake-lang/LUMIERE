# LUMIÈRE Gallery Renewal Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. This is a staged architectural roadmap; expand the selected phase into code-level steps against its approved inputs before implementing that phase. Do not implement the whole migration as one change.

**Goal:** Deliver a curated museum that looks composed, loads quickly, and stays responsive on phones and ordinary laptops, with optional endless exploration.

**Architecture:** Separate exhibition data, application navigation, room streaming, art generation/cache, GPU resource ownership, and storage. Prove one reference room and a renderer choice before expanding the new visitor experience; preserve legacy collections behind adapters.

**Tech Stack:** Existing JavaScript, esbuild, DOM/CSS, IndexedDB/cloud adapters, and Playwright; proposed TypeScript for new modules and Three.js/WebGL2 subject to the Phase 1 comparison. No new UI framework is required.

**Spec:** [Gallery renewal design](../specs/2026-09-18-gallery-renewal-design.md).

## Global constraints

- The user selected: **a curated, visually striking gallery that runs well on phones and laptops, with endless exploration optional.**
- Preserve original uploads, aspect ratios, titles, descriptions, placement identities, floor coordinates, local records, and gallery slugs.
- Use WebGL2 as the initial 3D baseline.
- Keep local/offline operation and the existing single-file archive working.
- Treat numerical budgets in the spec as proposed gates, not existing measurements.
- Production changes, dependency installation, and application code changes have not been made as part of this planning task.

## Proposed file ownership

Paths below are the target structure, created only as the associated phase needs them. Existing files remain until their callers migrate.

| Path | Responsibility |
|---|---|
| `src/app/bootstrap.ts` | Compose one runtime, adapters, and UI; startup and shutdown |
| `src/app/session.ts` | Explicit visitor mode and selection transitions |
| `src/exhibition/types.ts` | Versioned exhibition, room, artwork, and placement contracts |
| `src/exhibition/legacy.ts` | Existing seed/coordinate/placement compatibility |
| `src/exhibition/curated.ts` | Authored manifest loading and validation |
| `src/scene/runtime.ts` | Movement, collision, camera, and update lifecycle |
| `src/scene/stream.ts` | Room preparation queue, readiness, retention, eviction |
| `src/scene/visibility.ts` | Room/portal/stair visibility independent of materials |
| `src/render/renderer.ts` | Chosen renderer, explicit passes, GPU ownership |
| `src/render/quality.ts` | Independent pixel/effect budgets, hysteresis, user override |
| `src/render/metrics.ts` | CPU/GPU diagnostics and allocation accounting |
| `src/art/cache.ts` | Revision-aware image tiers and byte-based eviction |
| `src/art/jobs.ts` | Generation requests, priorities, stale-result rejection |
| `src/art/worker.js` | Reuse current generator worker, preserving its contracts |
| `src/collection/repository.ts` | Storage interface for current local and cloud data |
| `src/collection/sync.ts` | Outbox lifecycle and recoverable synchronization errors |
| `src/ui/entrance.ts`, `browser.ts`, `viewer.ts`, `curator.ts` | DOM views with narrow application commands |
| `src/ui/tokens.css` | Semantic visual tokens and motion rules |
| `assets/rooms/`, `assets/materials/`, `assets/exhibitions/` | Exported kits, shared materials, manifests |
| `tools/validate-exhibition.mjs` | Asset/manifest integrity and size checks |
| `test/performance/` | Repeatable routes and structural resource assertions |

## Phase 0 — Establish the baseline and compatibility fixtures

**Files:** extend `src/render/perf.js` or introduce `src/render/metrics.ts`; add `test/performance/gallery-route.spec.js`, `test/fixtures/legacy-gallery.json`, and `docs/performance/baseline.md`; retain existing `test/*.spec.js`.

**Consumes:** current `DBG` hooks, current seed/room/placement formats, existing test helpers. **Produces:** reproducible measurements and a compatibility fixture set that later phases must preserve.

- [ ] Record actual laptop and phone devices, browsers, viewport, DPR, power state, and cold/warm cache conditions.
- [ ] Define the exact 60-second route from the spec and capture current entrance, interior, inspect, curator, and phone layouts.
- [ ] Add lightweight counters for room-build work, art jobs, uploads, all-pass draws, triangles, and estimated allocations. Time CPU phases separately from frame intervals; GPU queries are optional and asynchronous.
- [ ] Capture the same route at all existing quality tiers, with reflections toggled separately. Attribute room-entry spikes separately from steady-state rendering.
- [ ] Record representative legacy fixtures: local works, mounted/full-bleed choices, missing image, cloud guest, unpublished/unavailable gallery, ground-floor and upstairs placements, and an endless seed.
- [ ] Run existing regression tests on the unchanged runtime; record failures separately from migration failures.

**Verification:** `npm run test:fast`; targeted `npx playwright test test/renderer.spec.js --workers=1`; baseline route on physical hardware. Run SQL verification only if storage policies later change.

**Exit gate:** baseline report identifies the dominant cost and contains actual measurements, not historical comment values. All existing failures are documented. Commit this independently before renderer work.

## Phase 1 — Prove the reference room and choose the renderer

**Files:** add `assets/rooms/reference/`, `assets/materials/`, a temporary `src/scene/reference.ts`, `src/render/renderer.ts`, and `docs/performance/renderer-decision.md`; extend `build.mjs` with an isolated experimental entry. Modify `package.json` only for the benchmark's chosen dependencies.

**Consumes:** Phase 0 measurements and spec budgets. **Produces:** one real room, a repeatable camera path, asset export settings, and an explicit keep/replace renderer decision.

- [ ] Author the reference room: doorway, six artworks, one bench, readable indirect light, material detail, and a visible neighboring threshold. Include low/high geometry variants only where visibly useful.
- [ ] Specify asset origins/licenses, authoring sources, export recipe, lightmap UVs, collision proxies, compressed and decoded texture sizes, and material count.
- [ ] Render a matched scene in the existing WebGL path and candidate Three.js/WebGL2 path. Match camera, output pixels, asset detail, lighting intent, and enabled effects; account for all passes.
- [ ] Measure startup, sustained frame pacing, CPU work, allocations, and transfer bytes. Use a real phone and integrated-GPU laptop; retain captures of both.
- [ ] Make the low tier attractive without real-time planar reflections or heavy bloom. Confirm art color and readability at normal viewing distance.
- [ ] Choose the candidate if it meets the spec budgets, retains required behavior, and gives a materially simpler asset/runtime workflow. If it misses, identify whether content or engine overhead is responsible; retain raw WebGL2 if the candidate adds cost without sufficient benefit.
- [ ] Remove the losing experimental runtime from the new path after recording the decision. The legacy production path remains intact during migration.

**Verification:** matched route, three cold/warm runs, ten-minute thermal run, fixed-camera desktop/mobile captures, and inspection of decoded GPU asset estimates.

**Exit gate:** user can review a real room; measured results support the renderer choice. Do not scale the exhibition before both visual and performance gates pass.

## Phase 2 — Separate state, rendering, and resource lifetimes

**Files:** add `src/app/{bootstrap,session}.ts`, `src/exhibition/{types,legacy,curated}.ts`, `src/scene/runtime.ts`; extract relevant responsibilities from `src/main.js` and `src/art/scheduler.js`; keep `src/cloud/client.js` behind an adapter.

**Consumes:** selected renderer, legacy fixtures. **Produces:** explicit exhibition records and a runtime with one owner per resource.

Proposed boundary (finalize names with the selected renderer before coding):

```ts
type VisitorMode = 'entrance' | 'touring' | 'inspect' | 'browse' | 'curate';
type RoomId = string;
type ArtworkId = string;
type PlacementId = string;
interface Placement {
  id: PlacementId;
  roomId: RoomId;
  artworkId: ArtworkId;
  position: [number, number, number];
  rotation: [number, number, number, number];
  size: [number, number];
  fit: 'mounted' | 'full-bleed';
}
interface Exhibition {
  version: 1;
  id: string;
  layout: 'legacy' | 'curated';
  entryRoom: RoomId;
  roomIds: RoomId[];
  placements: Placement[];
}
interface SceneLifecycle {
  start(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}
```

- [ ] Test session transitions: opening inspect releases walking input; closing restores position; leaving stops input/audio ownership; lost focus clears held keys.
- [ ] Separate metadata and topology from renderer handles. Adapt legacy coordinates without rewriting stored placements.
- [ ] Move GPU room allocation out of the art scheduler; make renderer ownership/disposal explicit for room, shared asset, and whole-runtime lifetimes.
- [ ] Give asynchronous loads and generation results an epoch/revision. Discard and dispose results that arrive after teardown or content replacement.
- [ ] Extract collection and sync adapters while retaining current persistence formats and error behavior.
- [ ] Keep `main.js` as the legacy path until the new entry is functional. Add focused adapters rather than broad mechanical extraction in one commit.

**Verification:** focused session, stale-load, and disposal tests; legacy seed/placement fixtures; existing boot/cloud tests; context-loss recovery against the selected renderer.

**Exit gate:** no UI or cloud imports in the renderer; no GPU handles in exhibition records; repeated enter/leave does not grow owned resource counts.

## Phase 3 — Bound scene preparation, image work, and quality

**Files:** add `src/scene/{stream,visibility}.ts`, `src/art/{cache,jobs}.ts`, `src/render/quality.ts`; adapt `src/art/worker.js`; add `test/performance/residency.spec.js` and focused scheduler tests.

**Consumes:** exhibition topology, selected renderer, resource diagnostics. **Produces:** bounded queues/caches and stable quality behavior.

- [ ] Replace synchronous 5×5 preparation with prioritized stages: metadata/collision → visible geometry → essential art → optional detail. Prepare neighboring rooms early enough that crossing never reveals a void.
- [ ] Bound preparation and upload work by time and bytes; begin with at most one GPU upload per frame and 2 ms of discretionary main-thread work, then calibrate against baseline evidence.
- [ ] Keep room-sized culling groups and handle both horizontal portals and stairs. Test visibility correctness before measuring savings.
- [ ] Add art tiers keyed by content revision and generator identity. Produce procedural previews from canonical pixels rather than changing the generator's canvas size.
- [ ] Limit pending worker results and decoded images. On rapid traversal, cancel queued work and reject stale active results; release their ImageBitmaps and GPU resources.
- [ ] Add byte-based residency caps including mipmaps, shadow maps, render targets, and pooled but unused textures. On allocation pressure, evict optional detail before the current room.
- [ ] Separate render scale, reflection, AA, and effects controls. Add hysteresis and cooldown; user quality settings override automatic recovery predictably.
- [ ] Pause rendering and optional jobs when hidden or fully covered. Idle scenes redraw only when camera, art, lighting, resize, or visible animation changes.

**Verification:** rapid room changes; stale completion after theme/gallery switch; 100-room traversal with memory plateau; unavailable worker fallback; unsupported HDR/MSAA; context loss; scripted quality hysteresis; full benchmark route.

**Exit gate:** resident bytes and pending jobs remain bounded; no app-attributable >50 ms main-thread task during the warmed benchmark route; quality changes preserve artwork identity and do not oscillate.

## Phase 4 — Ship the curated visitor experience

**Files:** add `src/ui/{entrance,browser,viewer}.ts`, `src/ui/tokens.css`, `assets/exhibitions/default.json`; adapt `src/ui/body.html`, `src/ui/styles.css`, and `src/ui/touch.js`; add visitor-flow and accessibility tests.

**Consumes:** reference room kit, session commands, runtime lifecycle, collection metadata. **Produces:** a complete visitor journey independent of curation.

- [ ] Build the exhibition cover and HTML collection browser before initializing 3D. Show real loading/retry states and preserve direct links.
- [ ] Implement guided next-work/next-room navigation, free walking, map access, and clear exit. Keep controls legible and reserve overlay space at small sizes.
- [ ] Implement the art viewer with correct fit, full descriptions, next/previous, high-resolution on demand, and position-preserving close.
- [ ] Add non-WebGL browsing and reduced-motion navigation. Use semantic dialogs and focus restoration; test keyboard operation through the complete visit.
- [ ] Extend the reference kit into arrival hall, long gallery, and intimate cabinet. Reuse materials/geometry and validate each room against the same budget.
- [ ] Place environmental controls in settings. Show curation only in its appropriate workspace; expose endless exploration as an optional destination.

**Verification:** 375/768/1440 px layouts and phone landscape; physical touch devices; keyboard and screen-reader smoke checks; reduced motion; WebGL unavailable; failed image load; desktop/mobile rendered captures; benchmark with final UI visible.

**Exit gate:** a first-time visitor can enter, inspect, find the next work, and leave without reading a keyboard manual. Low quality meets the same visual hierarchy and art-readability requirements.

## Phase 5 — Preserve collections and rebuild the curator workspace

**Files:** add `src/collection/{repository,sync}.ts` and `src/ui/curator.ts`; adapt existing IndexedDB and cloud integration from `src/main.js`; extend `test/cloud.spec.js` and add migration tests.

**Consumes:** unchanged stored records, legacy adapter, new exhibition schema. **Produces:** curation outside the scene and reversible layout migration.

- [ ] Provide collection grid, metadata editor, batch upload review, placement preview, and existing publish status without requiring first-person movement.
- [ ] Keep original files and metadata. Decode/resize large imports outside the UI thread where supported; report item-level errors and allow retry.
- [ ] Preserve one-work/one-wall rules, aspect-ratio options, upstairs placements, guest permissions, and local-only storage behavior.
- [ ] Offer a preview of mapping legacy placements to an authored layout. Write a new versioned manifest only on explicit migration; retain the old one for rollback.
- [ ] Keep old gallery slugs resolving to the compatible layout until migrated. Handle orphaned placements and unavailable uploads without deleting user content.
- [ ] Verify outbox retry, reload during pending sync, offline edits, and sign-out/account-switch isolation using local fixtures or mocked services.

**Verification:** local database round-trip; migration/rollback fixtures; mocked cloud guest/owner tests; upload/placement tests. Do not modify a live collection to test migration.

**Exit gate:** old links and collections still work; curator actions do not force unrelated world teardown; failed sync is visible and recoverable.

## Phase 6 — Delivery, optional endless mode, and cutover

**Files:** update `build.mjs`, `package.json`, `README.md`, `docs/architecture.md`, and `docs/permanence.md`; add asset validation and production-route smoke checks.

**Consumes:** validated curated runtime and compatibility adapters. **Produces:** deployable static assets, documented rollback, and a supported optional endless entry.

- [ ] Split the normal build into an entry shell, deferred scene runtime, deferred curator code, worker, and versioned assets; retain esbuild unless a concrete limitation requires a change.
- [ ] Validate relative asset paths on GitHub Pages subpaths, correct MIME types, compression assumptions, worker startup, and cached manifest/asset compatibility.
- [ ] Keep the existing archive command and its current contract passing. Document that it initially exports the legacy museum; do not promise the new asset-rich gallery fits the historical single-file size limit.
- [ ] Route endless exploration to the compatible procedural experience first. Port it onto shared runtime services only after determinism, floating origin, stairs, and bounded residency pass; retire duplicate code after parity.
- [ ] Run the full existing suite plus new visitor/migration tests and physical-device benchmarks. Update tests that assert the old effect stack to test intended behavior and budgets instead.
- [ ] Switch the default entry only after acceptance; retain the previous artifact and routing switch for rollback. Remove experimental code and update docs to the actual final architecture.

**Verification:** `npm test`, production static-host smoke test, archive/offline smoke test, relative-path deployment test, complete device matrix, and ten-minute resource/thermal runs.

**Exit gate:** visual and computational goals pass together, old content survives, hosted and archive paths are accurately documented, and rollback is practical.

## Recommended first implementation unit

Execute Phase 0 and Phase 1 first. The reviewable result is a measured baseline, one polished room on phone and laptop, and a renderer decision backed by a matched comparison. This prevents spending the full rewrite budget before proving the experience can look better at the intended cost.

Subsequent phases depend on that decision and should receive their own short implementation plans with concrete test cases and final API signatures. Phase boundaries above are review/commit boundaries; they are not an instruction to pause routine authorized work after every checkbox.
