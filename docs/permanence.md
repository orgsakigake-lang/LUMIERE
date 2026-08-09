# Keeping LUMIÈRE online forever, for nothing

Everything described here costs **£0**. Where a service has a paid tier, this
document says exactly which line you must not cross and what happens if you do.

There is one thing I cannot do for you: **create accounts.** Every step below
that needs a login is marked *(you)*.

---

## 1. The thing most people get wrong

**IPFS is not permanent storage.** It is a distribution protocol. Content lives
exactly as long as some node *pins* it; stop paying and it is garbage-collected
like anything else. "Put it on IPFS so it lives forever" is renting hosting
again with different vocabulary.

The ground is also moving. Cloudflare sunset its public gateway in August 2024,
Fleek discontinued hosting in January 2026, Infura deprecated its IPFS API, and
Scaleway shut down pinning. The provider layer is consolidating, not growing. Do
not make it your only copy.

**Arweave is the real answer.** You pay once, up front, and an endowment funds
storage for roughly two centuries. And for a file this size, "once" is zero —
see below.

---

## 2. The 100 KiB rule, and why `npm run archive` exists

ArDrive's Turbo service uploads files **≤ 100 KiB completely free**, with no
account top-up and no tokens. That is 102,400 bytes.

The hosted build does not fit. The archive build does:

| build | command | size | what it is |
|---|---|---|---|
| dev | `npm run dev` | ~173 KB | readable, watch + server on `:8000` |
| hosted | `npm run build` | ~103 KB | minified `index.html`, what Pages serves |
| **archive** | **`npm run archive`** | **~98 KB** | **`archive/index.html`, no backend** |

The archive build swaps `src/cloud/client.js` for an inert stub
(`client.stub.js`). That is not a size trick — it is the honest artifact. A copy
meant to outlive its own infrastructure should not depend on a Supabase project
that will certainly die first.

What you keep: the entire procedural museum. Every room, every artwork, every
palette is generated locally from the world seed. Verified by test — the archive
build paints **byte-identical pixels** to the hosted one.

What you lose: cloud accounts and shared galleries. The Curator's Office falls
back to its local passphrase gate and IndexedDB, so private loans still work;
they just stay on the visitor's own machine.

### The budget is enforced

```
archive/index.html   100,523 bytes
limit                102,400 bytes
headroom              1,877 bytes
```

`test/lumiere.spec.js` fails the build if this is exceeded. **Do not silently
raise the limit** — crossing it turns free permanent storage into a paid
account, which is the whole point of the number.

If you need room, in order of preference:

1. **Strip the `DBG` surface from archive builds** — measured at 3,416 bytes.
   Costs you the in-page debug console on the archived copy only.
2. Trim intro copy or hint strings. Cheap bytes, real character; weigh it.
3. Accept the cost. Above 100 KiB you need Turbo Credits, which means an
   account and a minimum purchase (a few dollars) that would cover thousands
   of uploads. Not expensive — just no longer free.

---

## 3. What each service actually costs

| service | role | free tier | the catch |
|---|---|---|---|
| GitHub Pages | primary host | free, public repos | already in use |
| ArDrive Turbo | permanent copy | **≤ 100 KiB free** | needs a wallet *(you)*; above the limit costs credits |
| Pinata | IPFS pinning | free under 1 GB | free tier has been shrinking; not a guarantee |
| Supabase | accounts, loans | free tier | **pauses after 7 idle days** — hence `keepalive.yml` |
| Cloudflare Pages | alternative host | generous free tier | optional |

**Free tiers are not promises.** Four IPFS providers changed or withdrew terms
in the last two years. Arweave's model is different in kind: you are not renting,
so there is no renewal to miss. That is why it is the anchor and IPFS is the
mirror.

---

## 4. Doing it

### Step 1 — build the artifact

```sh
npm run archive
```

Produces `archive/index.html`. Open it through a server (`npm run dev`, then
`http://localhost:8000/archive/index.html`) and walk a few rooms. It must not
touch the network at all.

### Step 2 — Arweave, the permanent copy *(you)*

1. Go to <https://turbo.ar.io/> and connect or create a wallet.
2. Upload `archive/index.html`. Under 100 KiB it should ask for nothing.
3. Keep the transaction ID. Your gallery is now at
   `https://arweave.net/<TX_ID>`, permanently, with no renewal.

Record the ID in this file when you have it, with the date and the commit it
was built from. A permanent artifact you cannot identify later is not much use.

### Step 3 — IPFS, the mirror *(you)*

1. Create a Pinata account and upload the same file.
2. Keep the CID. It is reachable through any gateway, e.g. `https://ipfs.io/ipfs/<CID>`.

Optional: point an ENS name at the CID with a contenthash record so the address
is memorable.

### Step 4 — keep GitHub Pages as primary

Nothing to do. It stays the fast, current, cloud-enabled copy. The archive is
the thing that survives it.

---

## 5. Immutable or current — pick one per address

Content addressing means **every edit produces a new address**. That is
immutability, which is the opposite of a stable link.

- **Arweave TX / IPFS CID** — permanent, never changes, never updates. Right for
  "this exact gallery, this exact night."
- **IPNS** — a mutable pointer, but records expire in about 24 hours unless
  republished. Needs something running.
- **DNSLink / ENS** — a name you update by hand. Needs a domain or an ENS
  registration you keep.

Recommendation: treat each Arweave upload as an **edition**. Keep a dated list
below. Do not chase a single always-current permanent address; that is a
contradiction, and the version history is more interesting anyway.

### Editions

| date | commit | tx / cid | notes |
|---|---|---|---|
| _(none yet)_ | | | |

---

## 6. What breaks, and when

| if this disappears | the archived copy |
|---|---|
| Supabase | unaffected — no backend in it |
| GitHub Pages | unaffected — different host |
| Your domain | unaffected — addressed by hash |
| Pinata | unaffected if the Arweave copy exists |
| Arweave | this is the copy of last resort |

The seeded gallery has no runtime dependency on anything. That was true before
this document and is the reason any of it works: a room's geometry, its
paintings and their palettes are all derived from one integer.
