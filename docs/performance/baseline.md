# Legacy renderer baseline

Run a repeatable local baseline against a running legacy build:

```sh
node tools/benchmark.mjs --url http://127.0.0.1:8000/ --duration 60 > baseline.json
```

The benchmark opens a clean Chromium context at 1280×720, blocks Supabase
requests, enters the gallery, and dwells through a fixed four-room loop. It
enables `DBG.metrics(true)` before entry unless the URL already has `?metrics`;
that query starts collection at module boot and is deliberately not reset, so
initial room construction remains in the result. Normal visits do not retain
timing history. The JSON includes cold navigation and entry times, frame-
interval and CPU-loop percentiles, room-build measurements, viewport, quality
tier, renderer identity, and current art queue/pool state.

GPU frame timing and GPU memory are deliberately `null`: this renderer does
not collect asynchronous GPU timer queries, and WebGL has no portable GPU
memory accounting API. The output labels known software renderers (including
SwiftShader) so they are not mistaken for physical-device results.

## 2026-09-18 software baseline

The first recorded run is in
[`legacy-software-baseline.json`](legacy-software-baseline.json). It used
Chromium at 1280×720 against `?q=0&metrics`, which produced a 960×540 drawing
buffer with tier 0 pinned and reflections off. The unmasked renderer was
ANGLE/Vulkan SwiftShader, so this is a software-rendering fixture only.

The 16-second clean-context four-room route recorded 55 frame intervals:
median 399.9 ms, p95 648.34 ms, p99 706.3 ms. CPU render-loop cost was much
smaller (median 1.1 ms, p95 2.55 ms); this gap is expected under headless
software rendering and is not a physical GPU result. The `?metrics` run
retained 63 room builds from boot and route changes, totalling 89.3 ms
(median 1 ms, p95 3.85 ms). Cold navigation took 1185.94 ms and entry
completion took 5169.73 ms in that environment.

The runner uses a clean browser context and blocks Supabase. It does not
represent laptop, phone, thermal, power-state, or hardware-GPU performance.
GPU frame timing and GPU memory remain unavailable as described above. The
existing `test:fast` run separately returned 31 passing tests and one boot
failure caused by `net::ERR_NAME_NOT_RESOLVED` for a configured backend; it
occurred before these metrics edits were loaded and is recorded as an
environment/backend-resolution issue, not a baseline result.
