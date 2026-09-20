# Release verification — 20 September 2026

This report supersedes the earlier implementation milestone counts in the
renderer and sharing status documents. Checks ran locally before pushing the
completed gallery branch.

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run test:unit` | Passed: 40 tests grouped into five test files |
| `npm run test:curated` | 15 browser tests passed |
| `npm test -- --workers=2` | 87 passed, one failed, one skipped; see touch correction below |
| `npx playwright test test/touch.spec.js --workers=1` | Final rerun: all 7 passed |
| `npm run verify:sql` | 44 checks passed against disposable local PostgreSQL |
| Hosted, curated, archive, and combined site builds | Passed |
| Committed hosted build reproducibility | Byte-identical after rebuild |
| Desktop/phone visual and accessibility checks | See [design verification](README.md) |
| Final diff whitespace and credential checks | Passed |

The full legacy browser run exposed a test harness dependency: the touch test
used a fake signed-in session with a real cloud transport. The hanging action
saved its placement, then a backend failure replaced its confirmation with an
offline warning before the test could observe it. The test now supplies a
successful cloud response and also checks that exactly one placement for the
selected artwork is sent with the expected owner and artwork ID. Offline retry
behavior has separate cloud tests. An intermediate rerun exposed an incorrect
new test assertion against local storage; signed-in placements are cloud-owned,
so that assertion was corrected to inspect the actual cloud write request.

The complete touch suite passed after this test-only correction, including the
previously skipped HUD check. Across the full run and final touch rerun, all 89
legacy cases have passing coverage. The whole legacy suite was not rerun after
the test-only correction; application code was unchanged by it.

## Deployment boundaries

- GitHub Pages publishes the combined `site/` artifact through Actions. The
  curated exhibition owns `/`, the original gallery is under `/endless/`, and
  old `/curated/` links redirect to the root while preserving URL state.
- Private uploads/link management remain disabled until the migration and Edge
  Functions are deployed and verified. No live database/storage migration ran.
  See [rollout instructions](../private-sharing-rollout.md).
- Browser tests use Chromium/SwiftShader and phone emulation. Physical-device
  performance and full assistive-technology testing remain outstanding.
- The archive builds and passes its browser checks, but currently measures
  231,935 bytes (226.5 KiB). It exceeds the 100 KiB threshold discussed in the
  historical permanence guide; this release makes no free-upload claim.
- [Jev's review](jev-review.md) evaluated an approved written summary. Its
  probabilities are advisory, separate from code and browser verification.
