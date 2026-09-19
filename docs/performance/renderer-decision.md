# Curated reference implementation — provisional renderer decision

The checks below describe the initial milestone. See the
[release verification report](../design/verification.md) for subsequent fixes,
current test results, and deployment boundaries.

## What is available

Run `npm run dev:curated` and open `http://127.0.0.1:8018/curated/`.

The first coding milestone provides a real authored reference room, an editorial
exhibition cover, six canonical artworks with pre-generated image tiers, a
collection browser that works without WebGL, an accessible native-dialog viewer,
seven guided viewpoints, drag look and keyboard walking, and display settings.
The room has a skylight, a bench, a connected vestibule, shared surface materials,
merged static geometry, and one cached directional shadow map. It is a working
reference kit, not a claim of completed photorealistic architecture.

The code is separated into exhibition data (`exhibition.ts`), pure session and
navigation constraints (`session.ts`), DOM/application coordination (`app.ts`),
and the resource-owning room runtime (`scene.ts`). None of the new runtime imports
cloud or persistence code. The original gallery still owns existing collections.

Entry is asynchronous and cancelable. Failed or canceled startup releases the
canvas and its resources. Context loss returns to the cover and permits a fresh
entry. Opening the viewer or settings pauses the room. Idle scenes schedule no
continuous rendering; movement, camera transitions, resize, and resumed views
request the frames they need. Procedural artwork is generated during authoring,
not on visitors' CPUs. Previews and full images come from one canonical painting.

## Renderer status

Three.js 0.186.0 with WebGL2 is implemented as the candidate. The existing raw
WebGL renderer remains intact. **No matched-scene engine comparison has been
completed, and no hardware performance claim is made.** The two recorded routes
have different scene content, quality settings, and navigation, so their timing
numbers must not be divided into an engine speedup claim.

The initial room uses static cached direct shadows and ambient fill. The proposed
offline lightmap/global-illumination asset workflow, expanded room kit, room
streaming across a larger exhibition, curator migration, and shared-link migration
are still later work. This reference build does not require them to demonstrate
the visual direction or the ownership/loading boundaries.

## Reproduction

```sh
npm run build:curated
python3 -m http.server 8019 --bind 127.0.0.1
# In another terminal:
node tools/benchmark-curated.mjs 'http://127.0.0.1:8019/curated/?debug' docs/performance/curated-software-baseline.json
```

The JSON records its browser, renderer, viewport, entry timing, guided-route
samples, draw calls, triangles, estimated owned resource bytes, and compressed
bundle sizes. GPU bytes are estimates of known allocations, including image
mips, geometry, the shadow map, and a framebuffer allowance; they are not total
driver/browser process memory. CPU time is the last submitted frame's CPU work,
not a GPU duration. Frame intervals are retained only during active movement or
transitions because idle frames deliberately do not exist.

This environment uses SwiftShader software rendering. Local-server timings do
not validate the spec's throttled-network loading targets. Physical laptop and
phone measurements, cold/warm repeat runs, and a ten-minute thermal/resource
route are still required before selecting the production renderer or switching
the default experience.

## Checks performed

- Nine browser regressions: deferred renderer loading; collection/viewer flow;
  render/pause/re-entry; phone layout and focus restoration; unavailable WebGL;
  cancel entry before import finishes; context loss during loading; cancel stalled
  images and release the canvas; context loss inside inspection; and single-loop
  adaptive scheduling (related assertions share tests).
- Eleven unit tests across legacy metrics and new session, pixel budgets,
  collision, and interruptible camera paths.
- TypeScript check, curated build, and original archive build.
- Eight existing renderer/archive browser regressions passed after implementation.
- Desktop and 375 px phone screenshots inspected. The desktop cover's automated
  axe audit found zero violations, with two image/overlay-related contrast items
  requiring visual review. Full manual assistive-technology testing remains open.
- The mobile collection and artwork dialog automated audits found zero violations and zero
  incomplete checks.
- The initial legacy fast suite had 31 passes and one boot assertion failed on
  `net::ERR_NAME_NOT_RESOLVED` from the configured backend. This is recorded as a
  baseline environment failure, not hidden or reclassified as a passing suite.

## Preservation and rollout

Normal `npm run dev`, the root artifact, existing URLs, IndexedDB data, cloud
configuration, and the legacy archive are preserved. The curated build is an
explicit preview and its output is ignored by git; its authored source and art
assets are tracked normally. The default production entry should change only
after the reference room is visually accepted and hardware/compatibility gates
have evidence. No user collection has been rewritten, published, or uploaded.
