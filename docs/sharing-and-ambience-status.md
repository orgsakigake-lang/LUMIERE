# Sharing and ambience compatibility pass

## Inspected

- `src/cloud/client.js`: Supabase auth, slug lookup, uploads, placements, publishing.
- `src/main.js`: IndexedDB startup, guest installation, outbox, curator office,
  entrance card, music/rain switches, weather lighting.
- `src/audio.js`: four locally synthesized music programmes, room tone, footsteps,
  rain, drops, thunder, and audio visibility handling.
- `supabase-setup.sql` and `docs/setup.md`: row-level security and the explicitly
  public image bucket. The current URL is a published slug, not a secret key.

## Implemented locally

- Reject unsuccessful or malformed collection reads instead of calling them empty.
- Install guest identity and publishing state only after successful reads.
- Reject empty, duplicate, and malformed `gallery` parameters rather than loading
  the signed-in owner's collection; preserve the database's valid slug shape.
- Published guest reads use anonymous credentials, so an unrelated expired owner
  login cannot prevent a shared visit or be refreshed/signed out by it. Reads have
  a deadline rather than an unbounded loading state.
- Require a returned changed profile row before publication is reported saved.
- A guest visit skips local IndexedDB and the local outbox entirely.
- Block shared entry while loading and after failure. Offer retry and a separate,
  explicit navigation to the endless museum; never silently substitute that museum.
- Curator query links opened at the curated root route to `/endless/` with the
  same query. The reference exhibition is not their collection.
- New-room Settings offers Silence, Nocturne, Glass, Rainfall, Vespers, and Rain
  on the roof, plus volume. Rain replaces music and softens/cools the room lighting.
  Existing note/reverb tails and the rain fade are retained during switching;
  this is a transition between programmes, not an instantaneous acoustic cutoff.
- Audio starts on choice, stops on exit, and does not retain scheduler intervals
  while suspended. Visual rain streaks/particles are not implemented in the new room.

## Privacy work still pending

The user selected a **revocable secret link with no visitor sign-in**. Its proposed
[security/migration design](superpowers/specs/2026-09-18-private-gallery-design.md)
uses a private asset boundary rather than renaming the existing public toggle.
The local implementation now includes `supabase/functions/manage-share-link/index.ts`
for authenticated create/rotate/revoke, the browser `#share=` manifest loader, and
curator copy/rotate/revoke controls. New uploads carry an explicit bucket and use
the private `private_loans` bucket; legacy `loans` rows remain public until an
intentional migration. Live Supabase deployment, setting Edge Function secrets,
and object-by-object conversion of legacy rows remain operational steps rather than
code work.

## Verification

Latest checks: 26 unit tests, 12 curated browser tests, and 3 focused sharing
browser tests passed. The broader legacy suite had 33 passes and one known backend
DNS clean-boot failure. Typecheck and main/curated/archive builds passed. The phone
settings accessibility audit found zero violations and incomplete checks.

The new cloud unit regressions passed after reproducing six failures. The existing
SQL policy suite passed against disposable local PostgreSQL; the temporary test
container was removed by the verifier. This does not verify a deployed project or
public Storage HTTP access. Browser and final suite results are recorded in the
renewal execution ledger after verification completes.

## September 19 completion pass

The private backend now includes browser CORS, explicit backend/signing errors,
owner-scoped canonical asset validation, and atomic rotation. The SQL verifier
applies the additive migration twice and tests private metadata, cross-owner
paths, link visibility, and rollback. The browser client retains private guest
identity through retries, renews expired asset URLs on demand, preserves storage
buckets on edits/deletes, and never falls back to public URLs for private images.

Activation is deliberately gated by `PRIVATE_SHARING = false` until live backend
provisioning. Existing upload behavior remains compatible. Follow
[the rollout guide](private-sharing-rollout.md) before enabling it. No live
Supabase project was changed. Curated deployment packaging is now available via
`npm run build:site`; CI checks and exports both experiences.
