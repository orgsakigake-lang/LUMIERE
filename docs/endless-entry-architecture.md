# Endless entry and collection ownership

Opening `/endless/` is an entrance, not a request for a collection. A saved
sign-in identifies an account but must not select an activity for the visitor.

## Activities

| Activity | Local collection | Account collection | Editing / sync |
| --- | --- | --- | --- |
| Entrance | Not opened | Not fetched | Inactive |
| Explore | Not opened | Not fetched | Inactive |
| Curate | Loaded on explicit choice | Loaded when signed in | Owner workspace |
| Shared visit | Not opened | Only the named/shared collection | Read only |

The activity lives in memory and is not remembered across generic visits.
The Curator button/shortcut is also an explicit choice to open the workspace.
Signed-out curators can work locally; signing in adds account synchronization.
Local browser storage is a convenience workspace, not an authentication vault.

## Boundaries

- `src/cloud/gallery-link.js` parses public names and private link tokens.
  A malformed shared link remains a failed shared visit; it never becomes an
  owner visit or explorer fallback.
- `src/cloud/client.js` owns authentication and network access. `cloudBoot()`
  restores authentication without fetching owner data. Owner loading requires
  the explicit `loadOwner: true` option. Shared routes take precedence.
- `src/main.js` owns the active visit and the rendering adapters.
  `openCuratorWorkspace()` is the single initialization path for local images,
  placements, the outbox and owner fetches. Concurrent calls share one promise.
  Collection editing and outbox sending require the curator activity.
- `src/ui/body.html` exposes all three activities at the entrance, regardless
  of sign-in. Shared destinations are validated and reconstructed locally;
  pasted external URLs or authentication fragments are never forwarded.
- Returning from an owner workspace creates a fresh document at the entrance.
  This drops pending requests, GPU textures and editor state, keeping late
  owner responses out of subsequent explorer/shared visits. Saved work remains
  in its existing storage.

No database schema change is required. Server-side permissions and publication
settings still govern shared collection access; the entrance is not a substitute
for those permissions.

## Regression coverage

`test/entry.spec.js` checks remembered sign-in, zero collection reads at the
entrance and during exploration, explicit local/account restoration, returning
to the entrance, shared-link validation and phone layout. Existing sharing and
curator suites cover failed links, read-only guest isolation, uploading,
editing, arrangement and migration. Unit tests enforce opt-in owner loading.
