# Private sharing rollout

The repository contains the private-link backend, but does not deploy or activate
it automatically. `PRIVATE_SHARING` in `src/config.js` defaults to `false`, so
existing installations keep uploading to `loans` without requiring a new schema.
Private controls remain hidden until deployment is explicitly completed.

## Deploy and activate

1. Apply `supabase-setup.sql`, then `supabase-secret-links.sql` to the intended
   Supabase project. If reapplying setup later, reapply the private migration last:
   it strengthens the read/update policies and installs atomic link rotation.
2. Deploy `share-gallery` with gateway JWT verification disabled. It authenticates
   its own bearer link in the JSON body. Deploy `manage-share-link` likewise; it
   independently validates the signed-in user's Authorization token with Auth.
   The functions use the Supabase-provided URL, service role key, and anon key.
   Never put the service role key in browser configuration.
3. Verify create, guest entry, rotation, revocation, denied cross-owner reads,
   and a visit lasting longer than 60 seconds against that deployment.
4. Set `PRIVATE_SHARING = true`, run the builds/tests, and publish the static site.

New uploads then use `private_loans`. Existing `loans` objects are not migrated
or deleted. A legacy public link includes only public works; a private link
includes the owner's collection. The office explains this distinction.

Guest asset URLs last 60 seconds and renew on demand through the bearer-link
boundary. Already downloaded pixels cannot be revoked. Owner URLs last one hour
and renew through the authenticated Storage endpoint. Raw share tokens are not
stored in localStorage; the guest URL fragment is removed after resolution, and
the token remains only in memory. The office can rotate/revoke links after reload
without storing a recoverable copy of the original token.

`npm run verify:sql` exercises the setup and private migration against disposable
local PostgreSQL, including cross-owner metadata isolation, signing-path ownership,
and rollback on failed rotation. It does not prove a live project's HTTP policies
or function configuration. No live database or storage objects were changed by
this implementation.
