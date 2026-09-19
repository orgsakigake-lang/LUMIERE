# LUMIÈRE renewal: curated architecture within a browser budget

Status: direction approved for implementation. The separate curated reference build is implemented; see the execution ledger and performance reports for completed work and outstanding acceptance gates. The full migration is not complete.

## Product decision

The user selected: **a curated, visually striking gallery that runs well on phones and laptops, with endless exploration optional.**

Build a museum whose first room is worth visiting. The default experience is a finite, composed exhibition with a clear route and immediate access to its art. Endless generation remains a separate destination. Preserve LUMIÈRE's identity, existing collections, and working share links.

This is a staged replacement of the visitor experience and runtime architecture. A framework migration alone is not the objective. This document and its companion plan are the requested planning deliverable; implementation has not started.

## Evidence from this repository

Inspected source, build configuration, tests, and the existing local development artifact in an isolated Chromium session. Captured the entrance and first room. The existing development artifact was not rebuilt, so screenshots are illustrative, while source findings refer to the current checkout. No hardware performance baseline or complete test run was performed for this planning task. Timing claims in existing comments are historical measurements, not newly reproduced results.

| Finding | Evidence | Consequence |
|---|---|---|
| The composition root has become a subsystem container | `src/main.js`, 4,805 lines; rendering, navigation, uploads, auth UI, sync outbox, themes, and debug hooks | Changes cross unrelated responsibilities; resource lifetime is hard to reason about |
| Room preparation is synchronous and neighborhood-sized | `src/main.js:726`, `ensureBuilt()`; `src/config.js:96`, `BUILD_R = 2`; `src/art/scheduler.js:634`, `makeRoomVAO()` | Up to 25 same-floor rooms plus stair neighbors can require mesh construction, buffer upload, and shadow baking during entry; actual work depends on cache and bounds |
| Visibility already exists | `src/main.js:3247`, portal/frustum culling, plus separate mirrored visibility | Keep it; avoid presenting basic culling as a missing optimization. Visibility currently does not eliminate all preparation cost |
| Art already runs off-thread | `src/art/worker.js`, painter pool in `src/art/scheduler.js:263` | Improve scheduling, caching, cancellation, and contention rather than simply adding workers |
| Reflections redraw scene content | `src/main.js:3609`, reflection pass enabled at tiers 1 and 2 | Additional detail is paid for in more than the primary view |
| Quality changes several costly features together | `src/render/perf.js`, `src/render/post.js` | DPR, reflection, and MSAA costs are difficult to tune independently; high tier uses up to 4× MSAA with HDR when supported |
| Theme changes discard the world | `src/main.js:2009`, `rebuildWorld()` | A visual setting triggers regeneration and resource churn instead of a narrow update |
| Geometry assumptions reach into shaders | `src/render/shaders/arch.frag`, hardcoded room dimensions in ambient occlusion | New room proportions can invalidate shading assumptions |
| Art scheduling also owns GPU room resources | `src/art/scheduler.js` imports world, cloud, persistence, player state, and GL | Resource ownership and art production are coupled |
| Initial UI asks visitors to learn many controls | `src/ui/body.html`, entrance and HUD; captured desktop presentation | Walking, inspecting, acquiring, jumps, themes, weather, sound, and curation compete with viewing art |
| Text is often tiny and heavily tracked | `src/ui/styles.css`, HUD and supporting text around `.66rem`–`.72rem` | Weak readability, especially over textured scenery |
| Distribution is optimized around one inline document | `build.mjs`, README, archive workflow | Useful for preservation, but normal hosting cannot independently cache and defer major features |

These observations identify likely scaling constraints. Profiling must determine their relative cost before optimization claims are made. Existing strengths include deterministic generation, floating origin, room eviction, art pools, context recovery, cloud/local adapters, touch controls, and regression tests.

## Approaches considered

| Approach | Benefit | Cost / limitation |
|---|---|---|
| Refactor and redesign on raw WebGL2 | Smallest runtime; retains current renderer and shaders | Continued ownership of asset handling, lighting tooling, and rendering infrastructure |
| Curated scene system on Three.js with WebGL2, isolated behind a renderer boundary | Established scene/material/asset tools; easier authored geometry and lighting workflow | More runtime bytes; migration and disposal discipline required; not inherently faster |
| Pre-rendered room panoramas with artwork hotspots | Very inexpensive scene display; high static image quality | Restricted movement, weak parallax, and less flexible hanging |

**Recommended direction:** a hybrid authored/procedural museum, with Three.js/WebGL2 as the candidate renderer for the new visitor path. Compare it with the current renderer using one matched room before committing the rest of the migration. Keep plain DOM/CSS for the interface and esbuild for delivery. TypeScript is proposed for new domain/runtime modules to make ownership and data contracts explicit; do not bulk-convert legacy code.

Use WebGL2 as the initial 3D baseline. WebGPU can be evaluated later for a measured need; its presence is not a performance result. Three.js documents a WebGL2 fallback for its WebGPU renderer, but that does not remove material migration or validation work. [Three.js renderer documentation](https://threejs.org/docs/pages/WebGPURenderer.html).

## Visual direction: a contemporary museum with warmth

The defining qualities are proportion, light, material restraint, and space around art.

- Arrival: an editorial exhibition cover, one strong image, title, curator, short introduction, **Enter exhibition**, and a secondary **Browse artworks** action. Put endless exploration on a separate secondary link. Do not start a live museum behind an opaque entrance card.
- Architecture: begin with one reference room; extend to three reusable types—arrival hall, long gallery, intimate cabinet. Compose a compact initial exhibition from these, with sightlines and a legible route. Retain existing floor/stair content through compatibility handling.
- Materials: warm mineral plaster, pale stone, restrained oak, dark frame edges, occasional brushed metal. Make small relief a material detail; reserve geometry for edges that change the silhouette.
- Light: broad soft illumination, readable indirect light, neutral artwork lighting, and one focal contrast per room. Artwork should remain legible at the lowest tier. Curated room kits use authored/baked light and occlusion. Material/light presets replace costly continuously variable lighting in the initial curated release.
- Floor: moderately rough, with restrained environmental highlights. Full planar reflections are optional high-quality effects, not the default visual foundation.
- Typography: an editorial serif for exhibition titles, a neutral sans-serif for controls and descriptions. Body text starts at 16 CSS px; supporting labels at 14 CSS px. Use natural tracking for anything visitors must read. Prefer system stacks initially; self-host selected fonts only after measuring their cost.
- Palette proposal: chalk `#F4F1EA`, ink `#202320`, stone `#D7D0C4`, muted green `#48584E`. Verify composed contrast before implementation; these are art-direction candidates, not certified accessible pairs.
- UI: semantic tokens for surfaces, text, spacing, focus, and motion. A compact persistent navigation area; secondary environment controls inside settings. Reserve brass for small accents rather than every label and outline.
- Motion: short, interruptible UI transitions; guided camera movement only following a visitor action; reduced-motion mode uses immediate viewpoint changes. No idle camera drift or compulsory camera bob.

The UI skill's search produced generic storytelling templates rather than a suitable spatial-gallery layout. Those templates were not adopted. Its readability, contrast, progressive disclosure, and motion guidance informs the interface requirements above.

## Visitor and curator experience

Visitor flow: exhibition cover → first room → inspect art → next work or next room. A guided sequence is available on both phone and desktop. Free walking is optional, with existing keyboard controls retained for experienced visitors. Pointer lock requires explicit intent. Mobile offers tap-to-move/viewpoint buttons as well as optional joystick movement.

Inspecting opens a responsive art viewer with correct proportions, title, description, next/previous, and a close action that returns to the previous position. Load the larger image only when requested. The covered 3D scene pauses; returning resumes without rebuilding it.

The collection browser is a first-class HTML view. It works without WebGL and provides keyboard and screen-reader access to artwork metadata and navigation. Loading, empty, unavailable-gallery, offline, and retry states must remain usable without a functioning renderer.

Curation becomes a separate workspace: collection grid → artwork metadata → placement/room preview → publish status. Keep local and cloud storage, current share-link behavior, and privacy semantics. Do not require walking through the museum to perform bulk edits. Changes to publishing or storage policies are outside this visual/runtime migration and require their own design if needed.

Use semantic controls, visible focus, focus containment/restoration for dialogs, labeled inputs, non-color state cues, and 44 CSS px primary touch targets. Default controls must fit 375 px portrait and short landscape viewports without covering art or trapping scroll.

## System boundaries

```text
HTML exhibition shell / collection browser / curator workspace
                         |
                application commands
                         |
          collection + exhibition domain records
                 /                     \
       storage adapters             scene runtime
       IndexedDB / cloud          /      |       \
                            room stream  art cache  renderer
                                          |
                                    generation worker
```

- Domain records contain IDs, artwork metadata, placement transforms, room topology, and version information. They contain no DOM nodes or GPU handles.
- Application commands coordinate selection, navigation, loading, and publishing. One explicit mode state covers entrance, touring, inspecting, browsing, and curating; transitions release input ownership predictably.
- Renderer owns GPU buffers, textures, materials, frame targets, and their disposal. It consumes scene descriptions. UI and cloud code never call GL.
- Room streaming decides what to prepare, activate, retain, and evict. Collision/topology data is available before detailed visuals. The current room and visible next doorway have priority; arbitrary distant neighborhood generation does not block movement.
- Art generation owns deterministic pixels and job results. Art caching owns tiers and residency. GPU upload remains a renderer responsibility with a per-frame budget.
- Storage adapters preserve existing records and report explicit errors. The application owns the sync outbox; it does not belong inside a rendering subsystem.
- Debug instrumentation is optional and reads subsystem diagnostics. Production UI does not depend on `window.DBG`.

Keep boundaries small and concrete. No general ECS, plugin system, global event bus, or custom rendering framework is needed for this project.

## How more detail fits the same budget

1. **Prepare static detail outside the visitor's frame.** Author reusable room kits with collision shapes, lightmap UVs, material assignments, and precomputed lighting. Export validated assets. New assets require a source/export recipe, not just an opaque binary.
2. **Keep worlds large but residency small.** Stream current/visible-next rooms, prefetch likely routes, and evict by estimated bytes as well as distance. Preserve portal/frustum visibility, including stair openings. Add LOD only for assets whose projected size justifies it.
3. **Batch repetition locally.** Share frame/bench/lamp geometry and materials; instance repeated objects within room-sized culling groups. Do not merge the entire museum into one always-visible mesh.
4. **Separate identity from display resolution.** Existing procedural generators change their output with canvas size. Preserve legacy canonical rendering and downsample it for previews. Any future resolution-independent generator gets a new version. Cache keys include generator version, seed, palette, canonical dimensions, and content revision.
5. **Bound expensive image work.** Use thumbnail, room, and inspect tiers; prioritize the work being viewed; cap pending decoded bitmaps and upload bytes; close stale bitmaps. Workers carry job IDs and world-generation tokens so results from an evicted or changed world cannot resurrect resources.
6. **Spend pixels deliberately.** Cap total render pixels, tune render scale separately from effects, and reduce post-processing before sacrificing artwork readability. Only allocate HDR or MSAA when the selected path benefits and the device supports it.
7. **Make quality stable.** Start conservatively, use measured rolling frame windows, reduce quickly and recover slowly. Separate UI responsiveness, CPU work, and optional GPU timing; handle unavailable/disjoint GPU queries. Core count is a hint, not a GPU benchmark.
8. **Stop work when it is not useful.** Suspend rendering and optional generation while hidden, pause behind opaque viewers/editor screens, and use on-demand rendering while still if no visible animation needs continuous frames. Input and newly ready assets invalidate the frame immediately.

These choices follow the general WebGL recommendations to batch work, budget GPU resources, avoid blocking calls, and account for pixel cost. The particular thresholds below are project proposals. [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).

## Initial budgets and measurement protocol

These are acceptance targets, not promises or measured current values. Phase 0 records exact device, OS, browser, viewport, DPR, render scale, and network settings; adjust targets explicitly if evidence requires it.

| Metric | Ordinary integrated-GPU laptop | Mid-range phone |
|---|---|---|
| Touring frame pacing after warm-up | 60 fps target; p95 frame interval ≤20 ms | Stable 30 fps minimum; p95 interval ≤36 ms; 60 fps where sustainable |
| Main-thread frame work | p95 ≤6 ms | p95 ≤8 ms |
| App-attributable main-thread stalls while touring | No tasks >50 ms on the benchmark route | Same |
| GPU-owned allocations, estimated | ≤192 MiB | ≤96 MiB |
| Estimated total render pixels | ≤2 million by default | ≤1 million by default |
| Draw calls across all enabled passes | Starting cap 150 | Starting cap 80 |
| Submitted triangles across enabled passes | Starting cap 250,000 | Starting cap 120,000 |
| Entry shell transfer, compressed | ≤200 KiB, excluding images | Same |
| First room cumulative transfer, compressed | ≤3 MiB, including code and required assets | Same |
| Meaningful cover / interactive first room | ≤1.5 s / ≤5 s at 10 Mbps, 100 ms RTT, cold cache | Same network target; measured on actual device |

Track p50/p95/p99 frame intervals, CPU timings, draw calls, triangles, resident rooms, pending jobs, texture/buffer/render-target estimates, first visible art, and first controllable frame. An allocation estimate is not total browser or driver memory. Also inspect available process/heap metrics and resource counts.

Measure three cold and three warm runs, then a ten-minute repeated route to expose thermal degradation and leaks. Include a 60-second repeatable route through a doorway, a room with many artworks, a stair, inspect open/close, and return. Hidden/covered states must stop scene draws and new background jobs. Ignore no slow frames silently: classify startup, navigation, and steady state separately.

Software-rendered CI verifies behavior and structural budgets. It cannot prove hardware frame rate, battery life, or phone thermals. Desktop touch emulation cannot replace Safari on a physical iPhone or Chrome on an Android phone.

## Migration and preservation

- Introduce the new experience on a separate local build/route while the current gallery remains usable. Select exactly one runtime per page; do not render both engines concurrently.
- Preserve original uploads, aspect ratios, titles, descriptions, placement identities, floor coordinates, local records, and gallery slugs. Add a versioned manifest and a legacy adapter; never infer a new wall assignment from an old coordinate silently.
- Legacy links initially open their compatible layout. Migration to an authored arrangement is previewable and reversible, with the prior manifest retained. The new default exhibition may use new layout IDs without changing old links.
- Keep generated artwork identity stable across rendering quality changes. Cross-browser Canvas pixel equality is not promised; compare deterministic outputs within a controlled browser path and test descriptors separately.
- Retain local/offline operation. The normal web build may use cacheable chunks and assets. Keep the existing single-file archive working; initially it remains the legacy renderer. A new self-contained curated export is a separate measured deliverable, not an implied free consequence of asset splitting.
- Change production entry only after visual, compatibility, and performance gates pass. Remove superseded code after the replacement is exercised; avoid maintaining two permanent implementations of each feature.

## Scope of the first release

Ship the cover, HTML collection browser, one polished room expanded into a small exhibition, inspection, guided/free navigation, adaptive rendering, safe streaming, and compatibility adapters. Port curation and endless mode after the shared runtime boundaries are stable.

Weather, elaborate audio programs, jump mechanics, numerous lighting themes, high-cost reflections, and ornamental effects can remain in the legacy/optional endless experience during migration. They should not delay the curated visitor release.

The initial visual gate is a real rendered reference room on both target device classes. The performance gate is the measured route above. Neither screenshots alone nor a passing unit suite is sufficient.
