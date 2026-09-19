# Gallery design and reliability completion

**Goal:** Finish the existing gallery redesign, repair reproducible visitor and
collection bugs, verify the complete repository, and push the current feature branch.

**Design:** Continue the existing gallery-renewal design: warm paper, olive accents,
editorial serif headings, generous spacing, and artwork as the visual focus. Make
navigation available on phones, keep artwork controls visible in short viewports,
and use clear loading and error states. Preserve the original museum and collections.

**Architecture:** Keep the plain DOM shell, typed exhibition/session records, and
lazy Three.js scene. Centralize runtime eligibility in the application, share guest
URL parsing across both entries and the cloud layer, and preserve storage bucket
identity throughout upload/edit/delete. No new runtime framework is needed.

**References:** `../specs/2026-09-18-gallery-renewal-design.md` and
`../specs/2026-09-18-private-gallery-design.md`.

## Execution

- [x] Reproduce mobile navigation, modal lifecycle, private-link routing, guest
  isolation, and storage failures in browser/unit regressions.
- [x] Fix shared URL parsing and cloud storage operations; verify malformed links,
  backend errors, and old public objects without migrating remote user data.
- [x] Finish responsive exhibition navigation, viewer controls, and loading states;
  reconcile scene lifecycle in one place and separate artwork DOM construction.
- [x] Package the curated preview reproducibly and include its checks in CI; expose
  it from the original museum without replacing its collection/renderer entry.
- [x] Verify units, TypeScript, both browser suites, builds, SQL where available,
  desktop/mobile screenshots, accessibility, and the final diff.
- Commit the completed work and push `feat/curated-gallery` without force as the
  final release action; verify the remote branch matches the local commit.

Final local results and deployment boundaries are recorded in
[`docs/design/verification.md`](../../design/verification.md).

## Review focus

Invalid/duplicate private links must never fall through to an owner visit. Public
collection image lists must retain valid URLs beyond the first item. Private
images must never be moved to public storage by editing. A browser resume must
not restart a scene behind a modal. Phone visitors must be able to leave every
view without reloading. Remote backend deployment and physical-device performance
remain distinct from local verification.
