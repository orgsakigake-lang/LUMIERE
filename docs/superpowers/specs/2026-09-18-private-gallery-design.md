# Private curator galleries — revocable link design

Status: access model selected by the user; backend boundary scaffolded locally.
The schema/function are not deployed, and the curator UI is not yet wired to them.

## Product contract

The curator signs in to manage their gallery. Visitors do not sign in: possession
of an opaque, revocable link grants read-only access to that specific exhibition.
The exhibition carries its curator identity, artwork metadata, placement/layout,
and presentation defaults. The visitor may choose silence, music, or rain.
No local browser collection, generated substitute exhibition, or other curator's
work may appear in a shared visit.

## Existing implementation and immediate repairs

The current model is a published profile slug (`?gallery=name`), owner-filtered
upload/placement reads, and a public `loans` image bucket. Publishing makes the
profile and collection metadata anonymously readable under the SQL policies.
The local curator password is only a courtesy lock. Neither mechanism provides
secret-link image authorization.

The compatibility pass fixes HTTP errors being mistaken for empty collections,
successful-looking no-op publication changes, guest/local image mixing, and
entry into an unrelated museum when the named collection cannot load. It also
connects the existing music/rain synthesis to the new reference room. These
repairs do not change deployed database permissions.

## Approaches considered

1. Keep published slugs and hide the URL in the interface: smallest change, but
   does not deliver the requested privacy or meaningful image revocation.
2. **Opaque bearer links + private assets + an authorization endpoint:** selected
   approach. No visitor account; the server checks access before issuing asset
   access. Adds one explicit backend boundary.
3. Invited visitor accounts: stronger identity-based controls, but contradicts
   the selected no-sign-in experience and introduces unnecessary visitor friction.

## Proposed security boundary

- Generate 32 random bytes with the platform cryptographic generator. Encode as
  base64url; store only a SHA-256 token digest plus gallery ID, creation time,
  revocation time, and optional expiration. Never use the curator slug as a secret.
- The curator gets one active link initially; replacing it atomically revokes the
  previous link. Only the authenticated owner can create, rotate, or revoke it.
- Put the bearer token in the URL fragment (`#share=…`), not the query string.
  Read it into page memory; do not put it in analytics, logs, persistent storage,
  errors, or generated outbound links. Use a no-referrer policy. A fragment reduces
  server/referrer exposure; it cannot stop a recipient from copying the link.
- A narrowly scoped Edge Function receives the token in a POST body, looks up its
  digest, checks revocation/expiry, and resolves the gallery owner server-side.
  It does not trust caller-supplied owner IDs, bucket names, or storage paths.
- Gallery metadata is returned only after authorization. Asset access requests
  accept bounded lists of artwork IDs, verify membership, then issue signed URLs
  for the visible room or selected artwork. Responses use `Cache-Control: no-store`.
- Keep privileged storage credentials in the function's environment, never in
  the static browser build. Owner management calls validate the real Auth user;
  visitor calls authenticate the bearer token, not a fabricated visitor account.
- Invalid, expired, and revoked tokens return the same unavailable-gallery state.
  Network failures get a retry state. Neither path loads an owner's local data.
- Rate-limit token resolution and asset signing; validate request shape and size.
  Do not deploy an anonymous unrestricted signing endpoint.

Supabase supports server-issued time-limited URLs for private buckets. Already
issued URLs remain usable until expiry; Auth-key rotation does not invalidate
them. Proposed asset URL lifetime: 60 seconds, with authorization checked again
before renewal. This means revocation blocks new grants immediately after the
revocation write commits, with a short remaining window for previously issued
URLs. It cannot recall downloaded images. [Storage access documentation](https://supabase.com/docs/guides/storage/serving/downloads)

Privileged keys bypass row-level security, so server-side gallery/path checks are
mandatory, not optional defense in depth. [Function secret documentation](https://supabase.com/docs/guides/functions/secrets)

## Data and renderer contract

Use a versioned exhibition manifest containing gallery ID, curator/title,
artwork IDs and dimensions, descriptions, layout and presentation defaults.
Asset URLs are renewable capabilities, not artwork identity. Keep them outside
the persisted manifest and refresh them without remounting the exhibition.

Separate owner collection state, guest manifest state, and local collection
state. Each async request belongs to a visit ID and is canceled on navigation;
late responses cannot overwrite a newer gallery. Owner outbox entries must be
bound to the owner account, not replayed under whichever account signs in next.

The new renderer must consume real manifest content before it can replace the
legacy shared experience. Do not remap existing wall/floor coordinates silently.
Preserve an original-layout route until a curator explicitly accepts conversion
to the new room kit. A reference room with six works is not a complete migration.

## Migration without accidental publication or data loss

1. Add link metadata and private asset storage alongside the existing system.
   Do not flip the existing public bucket or rewrite every profile as part of
   a routine setup script.
2. New private exhibitions use private storage from their first upload. Existing
   published slug galleries remain explicitly legacy/public until converted.
3. For an owner-approved conversion, copy assets to new private paths and verify
   every object and manifest reference before changing the gallery's read path.
   Preserve artwork IDs, titles, notes, dimensions, and placements.
4. Old public copies are a separate exposure: private status cannot be claimed
   while public copies remain accessible. Report them, obtain explicit removal
   approval, and account for CDN/cache retention. Never imply that deleting a link
   removes copies already saved by its recipients.
5. Test owner and anonymous access against the actual staging project. Only then
   deploy and enable secret-link creation for that gallery. No live migration is
   authorized or performed by this design document.

## Acceptance checks

- Curator A cannot manage B's gallery or sign B's images.
- A's visitor token cannot fetch B's manifest, unlisted assets, or owner metadata.
- No token, malformed token, expired token, and revoked token grant no access.
- Rotate/revoke races and stale asset renewals cannot resurrect an old link.
- Private storage public URLs and anonymous listing fail; legitimate owner reads
  and uploads still work. Test these through Storage HTTP, not SQL alone.
- A signed-in curator following another curator's link remains a read-only guest;
  local IndexedDB contents and outbox writes do not enter the visit.
- Broken networks, slow images, page restoration, hidden tabs, and mobile layout
  retain clear error/retry states. Music/rain never start without visitor choice.
- Verify bounded image decoding/upload, GPU cleanup across gallery changes, and
  real-device performance with a collection larger than a single room.

## Delivery order

First ship and verify the existing-flow compatibility repairs. Next implement
and test the server authorization/private-storage boundary in isolation. Then
connect curator link management and manifest loading to the full visitor gallery.
Finally migrate accepted layouts into the modern renderer and perform the
owner-approved live data migration. Security and visual rollout are separate gates.
