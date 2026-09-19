# Gallery renewal execution ledger

Plan: 2026-09-18-gallery-renewal.md

## Decisions

- Work on `feat/curated-gallery` in the shared checkout; preserve the existing gallery and introduce a separate curated entry. Branch isolation keeps changes reviewable in the user's workspace.
- Physical phones are unavailable in this environment. Browser and structural measurements can be completed here; physical-device and thermal gates remain explicit before production cutover.
- Begin with baseline diagnostics and a functional reference exhibition. Do not replace the default entry until the acceptance gates have evidence.
- Retain esbuild and plain DOM. Reuse existing deterministic art algorithms. New runtime rendering uses the Three.js candidate; the current renderer remains the measured baseline pending comparison.

## Coordination

| Work | Owns | Dependencies / conflict resolution |
|---|---|---|
| Baseline instrumentation | legacy main/scheduler hooks, metrics, benchmark tool | Does not change build/package or curated source |
| Reference exhibition | curated scene, shell, assets, build integration | Uses art algorithms read-only; independent of legacy hooks |
| Verification | focused node/browser tests, captures, measured report | Browser suites run sequentially to avoid port contention |

## Progress

- Baseline instrumentation: implemented and unit-tested; a reproducible SwiftShader baseline is recorded in `docs/performance/legacy-software-baseline.json`.
- Reference exhibition: implemented at `/curated/`, including the real room, pre-generated art tiers, on-demand rendering, collection browser, guided/free movement, viewer, quality settings, cancellation, and context recovery.
- New browser checks: 9 passed; unit checks: 11 passed; TypeScript and curated/archive builds pass.
- Legacy renderer/archive regression suite: 8 passed after the implementation.
- Automated accessibility: desktop cover, mobile collection, and mobile artwork dialog have zero reported violations; desktop cover contrast items still require manual review.
- Review fixes: scoped build ignore; canceled entry during art inspection; bench-safe camera paths; startup and dialog context loss; prompt resource cleanup on canceled loads; single animation scheduler through quality changes.
- Legacy initial test run: 31 passed, 1 boot failure from configured backend DNS resolution. This predates new scene work and is recorded separately.
- Matched renderer comparison: pending.
- Physical phone and integrated-GPU acceptance: pending; cannot be inferred from software-rendered tests.
- Production cutover and legacy migration: pending acceptance.

## Sharing and ambience follow-up

- Inspected the existing full-gallery curator, URL, storage, outbox, music, and rain paths.
- Implemented strict/atomic cloud reads, confirmed publication writes, anonymous
  guest transport, guest/local isolation, entry gating, retry states, and read deadlines.
- Connected the original synthesized soundscapes and volume to the reference room;
  rain also changes lighting. Audio schedulers suspend on exit/hidden tabs.
- Shared curator URLs at `/curated/` retain identity by opening the full gallery.
  The curated build remains local-only; deployment packaging is not complete.
- Latest verification: 24 unit tests, 12 curated browser tests, and 5 focused
  sharing/cloud browser regressions passed. Typecheck, main/curated/archive builds,
  and `git diff --check` passed. Mobile settings axe audit: zero violations/incomplete checks.
- Broader legacy boot/cloud/sharing run: 33 passed; one clean-boot assertion still
  fails on the configured backend's `net::ERR_NAME_NOT_RESOLVED` (same baseline issue).
- Existing SQL policy suite passed against a disposable local PostgreSQL container;
  the verifier removed it. No deployed policies or user data were changed.
- Independent review: no remaining blocker for the stated local-preview scope.
  Original bounded audio transition tails are intentional, not instantaneous cutoff.
- User selected revocable secret links without visitor sign-in. Proposed separate
  security design: `../specs/2026-09-18-private-gallery-design.md`. Backend implementation,
  private asset conversion, live deployment, and modern curator-layout migration remain pending.

## September 19 completion pass

See `2026-09-19-gallery-completion.md` for the follow-up scope. Mobile navigation,
collection captions, sticky viewer controls, shared URL routing, and scene
lifecycle are fixed. The collection presentation has a separate module and all
runtime resume decisions pass through one application function. The curator
workspace has readable labels and larger controls.

The offline archive export mismatch and unnecessary cloud-auth request on boot
are repaired. Combined static packaging and CI checks now include the curated
preview; standalone gallery/archive builds omit links to absent assets.
Private sharing is implemented behind a deployment flag, with a separate
rollout guide. Production cutover and physical-device performance remain outside
these locally verified changes.
