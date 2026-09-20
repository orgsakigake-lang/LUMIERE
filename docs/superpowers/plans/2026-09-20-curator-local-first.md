# Local-first Curator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production Curator's Office usable without an account, persist multi-file uploads reliably, and present automatic and manual placement as clear, safe workflows.

**Architecture:** Keep the existing Curator's Office, collection maps, IndexedDB database, Supabase adapter, and room generator. Extract only transaction completion and deterministic placement planning into focused modules; `src/main.js` remains the coordinator. Local ownership is always available, while cloud authentication becomes an optional sync-and-share section.

**Tech Stack:** JavaScript ES modules, IndexedDB, Supabase REST client, raw DOM/CSS, WebGL2, Node 24 test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-curator-and-endless-gallery-repair-design.md`

**Scope split:** This plan ships the curator repair independently. The approved
entrance-composition and warm-audio work will use separate plans after this
blocker is live, so renderer and sound changes cannot delay adding artwork.

## Global Constraints

- A new visitor can add several works without creating an account.
- An image reaches **Saved** only after its storage transaction completes.
- One failed item does not roll back successful siblings.
- Automatic placement preserves every manual or previous placement by default.
- Signing in never erases local work; migration retains local originals until the cloud copy and placements are confirmed.
- Guests following another curator's link remain read-only.
- Primary controls have 44 CSS pixel touch targets and visible focus.
- No new UI framework, renderer replacement, or per-frame DOM/storage work.
- Use Node 24 and the repository's change-aware CI paths.

## Review Focus

- IndexedDB transaction abort after `put()` succeeds: Task 1 tests that the promise rejects and Task 3 keeps the item in an error state.
- Cloud configured with no session: Task 2 tests that local add/edit/arrange controls are visible while account controls remain optional.
- A mixed valid/corrupt upload batch: Task 3 tests that valid files persist and only the corrupt item offers retry.
- Automatic arrangement with existing manual placements and insufficient capacity: Task 4 tests preservation, deterministic partial results, and undo.
- Cloud migration that fails after one successful upload: Task 5 tests rollback/retention so the local collection and placements remain intact.

---

### Task 1: Await IndexedDB truth

**Files:**
- Create: `src/curator/storage.js`
- Create: `test/unit/curator-storage.test.js`
- Modify: `src/main.js:1551-1608`

**Interfaces:**
- Consumes: browser `indexedDB`, database name `lumiere`, object store `images`.
- Produces: `openCuratorDB(factory?)`, `readLocalWorks(db)`, `putLocalWork(db, record)`, `deleteLocalWork(db, id)`, and `waitForTransaction(tx)`.

- [ ] **Step 1: Write transaction completion tests**

```js
// test/unit/curator-storage.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { putLocalWork, waitForTransaction } from '../../src/curator/storage.js';

function transaction(outcome = 'complete') {
  const tx = new EventTarget();
  tx.error = outcome === 'complete' ? null : new Error('quota exhausted');
  tx.objectStore = () => ({
    put(value) {
      tx.value = value;
      queueMicrotask(() => tx.dispatchEvent(new Event(outcome)));
    },
  });
  return tx;
}

test('putLocalWork resolves only after transaction completion', async () => {
  const tx = transaction('complete');
  const db = { transaction: () => tx };
  await putLocalWork(db, { id: 'u1', name: 'Study', blob: new Blob(['x']) });
  assert.equal(tx.value.id, 'u1');
});

test('putLocalWork rejects when the transaction aborts after put', async () => {
  const tx = transaction('abort');
  const db = { transaction: () => tx };
  await assert.rejects(
    putLocalWork(db, { id: 'u1', name: 'Study', blob: new Blob(['x']) }),
    /quota exhausted/,
  );
});

test('waitForTransaction rejects an errored transaction', async () => {
  const tx = transaction('error');
  const pending = waitForTransaction(tx);
  queueMicrotask(() => tx.dispatchEvent(new Event('error')));
  await assert.rejects(pending, /quota exhausted/);
});
```

- [ ] **Step 2: Run the storage tests and verify RED**

Run: `node --test test/unit/curator-storage.test.js`

Expected: FAIL because `src/curator/storage.js` does not exist.

- [ ] **Step 3: Implement the storage adapter**

```js
// src/curator/storage.js
const STORE = 'images';

export function waitForTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve(), { once: true });
    const fail = () => reject(tx.error || new Error('local collection could not be saved'));
    tx.addEventListener('abort', fail, { once: true });
    tx.addEventListener('error', fail, { once: true });
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('local collection could not be read')), { once: true });
  });
}

export function openCuratorDB(factory = globalThis.indexedDB) {
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = factory.open('lumiere', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readLocalWorks(db) {
  const tx = db.transaction(STORE, 'readonly');
  const result = requestResult(tx.objectStore(STORE).getAll());
  const done = waitForTransaction(tx);
  const [records] = await Promise.all([result, done]);
  return records || [];
}

export async function putLocalWork(db, record) {
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(STORE).put(record);
  await done;
}

export async function deleteLocalWork(db, id) {
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(STORE).delete(id);
  await done;
}
```

Replace `idbOpen()` and the callback-based boot read in `src/main.js` with the adapter. Convert local put/delete call sites in `transformWork()`, `curatorAddFiles()`, `saveWorkText()`, and `curatorRemove()` to await or explicitly handle the returned promise.

- [ ] **Step 4: Run storage and existing unit tests**

Run: `npm run test:unit`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the storage boundary**

```bash
git add src/curator/storage.js src/main.js test/unit/curator-storage.test.js
git commit -m "Await curator storage transactions"
```

### Task 2: Open a local workspace before sign-in

**Files:**
- Create: `test/curator.spec.js`
- Modify: `src/ui/body.html:53-145`
- Modify: `src/ui/styles.css:333-470`
- Modify: `src/main.js:2193-2198,2364-2528,3226-3240`

**Interfaces:**
- Consumes: `curator.mode`, `cloud.on`, `cloud.sess`, `cloud.viewing`, and the existing auth handlers.
- Produces: owner availability rule `!cloud.viewing && !guestVisit.requested`, `#cur-sync`, and status copy **On this device**, **Synced**, or **This visit only**.

- [ ] **Step 1: Write the production-state regression test**

```js
// test/curator.spec.js
import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

test.describe('the local-first curator', () => {
  test('cloud configuration does not hide the signed-out local workspace', async ({ page }) => {
    await page.addInitScript(() => {
      window.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
    });
    await boot(page);
    await page.evaluate(() => window.DBG.cloudReady());
    await page.locator('#sw-curator').click();

    await expect(page.locator('#cur-open')).toBeVisible();
    await expect(page.locator('label[for="cur-file"]')).toBeVisible();
    await expect(page.locator('#cur-gather')).toBeVisible();
    await expect(page.locator('#cur-state')).toContainText(/On this device|This visit only/);
    await expect(page.locator('#cur-sync')).toBeVisible();
    await expect(page.locator('#cur-cloud-lock')).toBeHidden();

    await page.locator('#cur-sync summary').click();
    await expect(page.locator('#cur-cloud-lock')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `npx playwright test test/curator.spec.js -g "cloud configuration" --workers=1`

Expected: FAIL because `#cur-open` is hidden and `#cur-sync` does not exist.

- [ ] **Step 3: Recompose the office around the workspace**

Move the existing cloud sign-in, account, and share rows inside a collapsed
details section at the top of `#cur-open` while preserving every existing ID:

```html
<div id="cur-open" hidden>
  <div class="cur-workspace-status" aria-live="polite">
    <strong id="cur-storage-label">On this device</strong>
    <span id="cur-storage-detail">Works and placements stay in this browser.</span>
  </div>
  <details id="cur-sync">
    <summary>Sync &amp; share</summary>
    <div id="cur-cloud-lock" hidden><!-- existing auth controls --></div>
    <div class="row" id="cur-acct" hidden><!-- existing account controls --></div>
    <div class="row" id="cur-share" hidden><!-- existing public share controls --></div>
    <div class="row" id="cur-private-share" hidden><!-- existing private share controls --></div>
  </details>
  <!-- existing themes, upload, layout, grid, and hint controls -->
</div>
```

Give `summary`, the storage status, and all workspace actions visible focus and
at least 44 CSS pixels of height. Keep the old local-key markup hidden for
archive compatibility during this change; remove it only in a later cleanup
after archive tests prove no consumer relies on it.

- [ ] **Step 4: Make workspace availability independent of authentication**

Use one owner predicate throughout `curatorRefresh()`, `curatorCanEdit()`, and
`hangPill()`:

```js
function curatorOwnsWorkspace() {
  return !cloud.viewing && !guestVisit.requested && !guestWorld;
}

function curatorCanEdit() {
  if (curatorOwnsWorkspace()) return true;
  flashHint('you are a guest here — this collection is read-only');
  return false;
}

function curatorRefresh() {
  const guest = !!cloud.viewing || guestVisit.requested;
  const owner = !guest;
  document.getElementById('cur-lock').hidden = true;
  document.getElementById('cur-open').hidden = !owner && !guest;
  document.getElementById('cur-sync').hidden = !cloud.on || guest;
  document.getElementById('cur-cloud-lock').hidden = !cloud.on || !!cloud.sess || guest;
  document.getElementById('cur-state').textContent = guest
    ? 'guest of ' + (cloud.viewing?.slug || guestVisit.slug || 'an unavailable collection')
    : cloud.sess ? 'Synced · ' + (cloud.sess.email || 'signed in')
    : curator.mode === 'idb' ? 'On this device' : 'This visit only';
}
```

These lines replace only the access calculation and state assignment at the
start of `curatorRefresh()`. Keep the existing guest rendering, account/share
population, grid refresh, and boundary update immediately after them.

Do not auto-focus the email field when the office opens. Focus the Add works
control or panel heading; authentication becomes a deliberate details action.

- [ ] **Step 5: Preserve guest read-only behavior and run focused tests**

Run: `npx playwright test test/curator.spec.js test/boot.spec.js -g "local-first curator|guest gets the collection" --workers=1`

Expected: PASS, two tests, zero failures.

- [ ] **Step 6: Commit the local-first office**

```bash
git add src/main.js src/ui/body.html src/ui/styles.css test/curator.spec.js
git commit -m "Open curator locally before sign-in"
```

### Task 3: Make batch upload observable and durable

**Files:**
- Modify: `src/ui/body.html` inside `#cur-add-row`
- Modify: `src/ui/styles.css`
- Modify: `src/main.js:1920-1957,2291-2330,2809-2814`
- Modify: `test/curator.spec.js`

**Interfaces:**
- Consumes: `putLocalWork(db, record)`, `cloudUploadBlob(name, blob, note)`, `encodeUpload()`, and `quotaRefusal()`.
- Produces: `curator.uploadBatch`, `renderUploadBatch()`, `addCuratorFile(file, item)`, retryable item states `processing | saved | error`, and `#cur-drop`/`#cur-upload-list`.

- [ ] **Step 1: Write upload persistence and partial-failure browser tests**

Add a valid tiny PNG and one corrupt image-shaped payload:

```js
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

test('a signed-out batch persists valid works and isolates a corrupt file', async ({ page }) => {
  await boot(page);
  await page.locator('#sw-curator').click();
  await page.locator('#cur-file').setInputFiles([
    { name: 'sunrise.png', mimeType: 'image/png', buffer: png },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') },
  ]);

  await expect(page.locator('#cur-upload-list [data-state="saved"]')).toHaveCount(1);
  await expect(page.locator('#cur-upload-list [data-state="error"]')).toHaveCount(1);
  await expect(page.locator('#cur-upload-list [data-state="error"] button')).toHaveText('Retry');
  await expect(page.locator('#cur-grid .cur-item')).toHaveCount(1);

  await page.reload();
  await page.waitForFunction(() => typeof window.DBG?.stats === 'function');
  await page.locator('#sw-curator').click();
  await expect(page.locator('#cur-grid .cur-item')).toHaveCount(1);
  await expect(page.locator('#cur-grid .cur-item .nm')).toHaveText('sunrise');
});
```

- [ ] **Step 2: Run the upload test and verify RED**

Run: `npx playwright test test/curator.spec.js -g "batch persists" --workers=1`

Expected: FAIL because there is no per-file status list and the local write is not awaited.

- [ ] **Step 3: Add the drop target and status list**

```html
<div id="cur-drop" role="button" tabindex="0" aria-controls="cur-file">
  <strong>Add works</strong>
  <span>Drop images here or choose files</span>
  <label class="btn" for="cur-file">Choose images</label>
  <input type="file" id="cur-file" accept="image/*" multiple hidden>
</div>
<div id="cur-upload-list" aria-live="polite"></div>
```

Style drag focus, keyboard focus, per-item thumbnail/name/status, error text,
and retry/remove controls. The drop target and buttons retain 44 CSS pixel
minimum targets at phone widths.

- [ ] **Step 4: Persist before reporting success**

Implement one file operation with an item owned by the UI:

```js
async function addCuratorFile(file, item) {
  item.state = 'processing';
  item.message = 'Preparing image…';
  renderUploadBatch();
  let bitmap;
  try {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    bitmap = await createImageBitmap(file);
    const lineArt = looksLikeLineArt(bitmap);
    const shape = { w: bitmap.width, h: bitmap.height, lineArt };
    const blob = await encodeUpload(bitmap, lineArt);
    if (!blob) throw new Error('This image could not be prepared.');
    const refusal = quotaRefusal(blob);
    if (refusal) throw new Error(refusal);
    const name = file.name.replace(/\.[^.]+$/, '');
    let record;
    if (cloud.sess) {
      const saved = await cloudUploadBlob(name, blob, '');
      record = { ...saved, name, note: '', blob, cloudRec: true, url: URL.createObjectURL(blob) };
    } else {
      const id = 'u' + crypto.randomUUID();
      record = { id, name, note: '', blob, url: URL.createObjectURL(blob) };
      if (curator.db) await putLocalWork(curator.db, {
        id, name, note: '', blob, orientation: orientationOf(shape.w, shape.h), lineArt,
      });
    }
    noteShape(record, shape);
    curator.uploads.set(record.id, record);
    item.state = 'saved';
    item.message = curator.db || cloud.sess ? 'Saved' : 'Available for this visit';
    return record;
  } catch (error) {
    item.state = 'error';
    item.message = uploadAdvice(error);
    return null;
  } finally {
    bitmap?.close();
    renderUploadBatch();
  }
}
```

`curatorAddFiles(files)` creates one item per file, awaits each call with bounded
concurrency of one for the first implementation, keeps successful siblings,
refreshes the grid, and opens review only for successful records. Retry invokes
`addCuratorFile(item.file, item)` on the same item. Remove revokes an item preview
URL and removes only that status row.

- [ ] **Step 5: Wire drag, file picker, and keyboard activation**

Use one `acceptFiles(files)` function from `change` and `drop`. Prevent browser
navigation during `dragover/drop`. Enter or Space on `#cur-drop` clicks
`#cur-file`. Do not listen globally, so dropping elsewhere keeps normal browser
behavior.

- [ ] **Step 6: Run upload, storage, and existing review tests**

Run: `node --test test/unit/curator-storage.test.js && npx playwright test test/curator.spec.js -g "batch persists" --workers=1`

Expected: PASS with zero failures and one restored work after reload.

- [ ] **Step 7: Commit durable batch upload**

```bash
git add src/main.js src/ui/body.html src/ui/styles.css test/curator.spec.js
git commit -m "Make curator uploads durable and visible"
```

### Task 4: Offer automatic and manual placement clearly

**Files:**
- Create: `src/curator/arrange.js`
- Create: `test/unit/curator-arrange.test.js`
- Modify: `src/main.js:389-535,2193-2247,2709-2714,3226-3240,4858-4869`
- Modify: `src/ui/body.html`
- Modify: `src/ui/styles.css`
- Modify: `test/curator.spec.js`
- Modify: `test/touch.spec.js:195-284`

**Interfaces:**
- Consumes: works `{ id, orientation, featured? }`, slots `{ key, aspect, priority }`, and current `Map<frameKey, workId>` placements.
- Produces: `planArrangement(works, slots, placements) -> { placements, added, unplaced }`, `curator.arrangeUndo`, and `curator.placing`.

- [ ] **Step 1: Write deterministic arrangement unit tests**

```js
// test/unit/curator-arrange.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { planArrangement } from '../../src/curator/arrange.js';

test('automatic arrangement preserves manual placements and matches shape', () => {
  const works = [
    { id: 'manual', orientation: 'P' },
    { id: 'wide', orientation: 'W', featured: true },
    { id: 'square', orientation: 'S' },
  ];
  const slots = [
    { key: '0,0:0', aspect: 'P', priority: 0 },
    { key: '0,0:1', aspect: 'S', priority: 2 },
    { key: '0,0:2', aspect: 'W', priority: 1 },
  ];
  const original = new Map([['0,0:0', 'manual']]);
  const result = planArrangement(works, slots, original);
  assert.deepEqual([...result.placements], [
    ['0,0:0', 'manual'],
    ['0,0:2', 'wide'],
    ['0,0:1', 'square'],
  ]);
  assert.equal(result.added, 2);
  assert.deepEqual(result.unplaced, []);
});

test('automatic arrangement returns a deterministic partial result', () => {
  const works = [{ id: 'a', orientation: 'L' }, { id: 'b', orientation: 'L' }];
  const slots = [{ key: '0,0:0', aspect: 'L', priority: 0 }];
  const first = planArrangement(works, slots, new Map());
  const second = planArrangement(works, slots, new Map());
  assert.deepEqual([...first.placements], [...second.placements]);
  assert.deepEqual(first.unplaced, ['b']);
});
```

- [ ] **Step 2: Run arrangement tests and verify RED**

Run: `node --test test/unit/curator-arrange.test.js`

Expected: FAIL because `src/curator/arrange.js` does not exist.

- [ ] **Step 3: Implement deterministic placement planning**

```js
// src/curator/arrange.js
const match = (orientation, aspect) => {
  if (orientation === aspect) return 0;
  if ((orientation === 'L' || orientation === 'W') && (aspect === 'L' || aspect === 'W')) return 1;
  return 2;
};

export function planArrangement(works, slots, current) {
  const placements = new Map(current);
  const alreadyPlaced = new Set(placements.values());
  const available = slots
    .filter((slot) => !placements.has(slot.key))
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  const waiting = works
    .filter((work) => !alreadyPlaced.has(work.id))
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || a.id.localeCompare(b.id));
  const unplaced = [];
  let added = 0;
  for (const work of waiting) {
    let best = -1;
    for (let i = 0; i < available.length; i++) {
      if (best < 0 || match(work.orientation, available[i].aspect) < match(work.orientation, available[best].aspect)) best = i;
    }
    if (best < 0) { unplaced.push(work.id); continue; }
    const [slot] = available.splice(best, 1);
    placements.set(slot.key, work.id);
    added++;
  }
  return { placements, added, unplaced };
}
```

- [ ] **Step 4: Write browser tests for arrange, undo, and manual mode**

Add tests that register one manually placed work plus portrait, landscape, and
square works through debug helpers; click **Arrange automatically**; assert the
manual frame is unchanged and every other work is placed once. Click **Undo
arrangement** and assert the exact original map. Click **Place manually**, assert
the office closes, `body` gains `placing`, the selected title appears beside
**Hang here**, and Escape cancels placement without changing a frame.

Run: `npx playwright test test/curator.spec.js -g "arrange|manual placement" --workers=1`

Expected: FAIL because the new labels, undo, and desktop placement mode do not exist.

- [ ] **Step 5: Connect the planner to existing rooms**

Build slots from `wingRoute()` and each room's `artworks`, using `artJobKey()` as
the key, `A.asp` as aspect, and route order plus artwork index as priority. Call
`planArrangement()` with all uploads and current placements. Before applying,
set `curator.arrangeUndo = new Map(curator.placements)`. Apply only returned new
rows, persist local placements, enqueue cloud placement writes when signed in,
refresh bounds/art jobs, and report added/unplaced counts.

The visible controls become:

```html
<button class="btn primary" id="cur-gather">Arrange automatically</button>
<button class="btn" id="cur-place">Place manually</button>
<button class="btn" id="cur-arrange-undo" hidden>Undo arrangement</button>
```

The wing and floor controls may continue using the existing full relayout helper
when the curator explicitly changes layout dimensions. The primary automatic
action must call the preservation planner.

- [ ] **Step 6: Implement persistent manual placement mode**

Add `curator.placing`. **Place manually** selects the first unplaced work when
needed, closes the office, adds `body.placing`, and keeps `#hang-btn` available
on desktop as well as touch when a frame is faced. The pill includes the selected
title through `aria-label`; clicking it still calls `curatorHang()` or
`curatorUnhang()`. Escape or reopening the office clears `placing`. After a hang,
select the next unplaced work; finish placement mode when none remain.

Update `hangPill()` to use `curatorOwnsWorkspace()` and `(body.touch ||
curator.placing)` rather than the old unlock/session gate. Keep the existing
touch test and add the local signed-out case.

- [ ] **Step 7: Run arrangement and interaction tests**

Run: `node --test test/unit/curator-arrange.test.js && npx playwright test test/curator.spec.js test/touch.spec.js -g "arrange|manual placement|no keyboard can still hang" --workers=1`

Expected: PASS with zero failures.

- [ ] **Step 8: Commit placement workflows**

```bash
git add src/curator/arrange.js src/main.js src/ui/body.html src/ui/styles.css test/unit/curator-arrange.test.js test/curator.spec.js test/touch.spec.js
git commit -m "Clarify automatic and manual placement"
```

### Task 5: Preserve local work through cloud migration and ship

**Files:**
- Modify: `src/main.js:2840-2996`
- Modify: `test/curator.spec.js`
- Modify: `README.md`
- Regenerate: `index.html`

**Interfaces:**
- Consumes: `cloudUploadBlob()`, `cloudSetPlacement()`, `cloudDeleteUpload()`, local records and placements.
- Produces: `migrateLocalCollection(records) -> { moved, failed }` with all-or-local-safe behavior and per-item migration status.

- [ ] **Step 1: Write migration failure tests**

Use the existing cloud transport/debug seams to create two local records with
blobs and one placement. Stub the first cloud upload and placement as successful
and the second upload as failed. Assert that both local IDs, blobs, and the
original placement remain available, the migration row reports one failure, and
the successful staged cloud upload receives a cleanup request. Add the success
case and assert that IDs and placements switch only after all uploads and cloud
placements succeed.

Run: `npx playwright test test/curator.spec.js -g "migration" --workers=1`

Expected: FAIL because the current loop mutates the map after each successful upload.

- [ ] **Step 2: Stage migration before mutating local state**

```js
async function migrateLocalCollection(records) {
  const staged = [];
  try {
    for (const local of records) {
      const remote = await cloudUploadBlob(local.name, local.blob, local.note || '');
      staged.push({ local, remote });
    }
    for (const { local, remote } of staged) {
      for (const [key, id] of curator.placements) {
        if (id !== local.id) continue;
        const result = await cloudSetPlacement(key, remote.id);
        if (result && result.ok === false) throw new Error('placement could not be synced');
      }
    }
  } catch (error) {
    await Promise.allSettled(staged.map(({ remote }) => cloudDeleteUpload(remote)));
    return { moved: 0, failed: records.length, error };
  }

  for (const { local, remote } of staged) {
    curator.uploads.delete(local.id);
    curator.uploads.set(remote.id, {
      ...local, ...remote, id: remote.id, cloudRec: true,
    });
    for (const [key, id] of curator.placements) if (id === local.id) curator.placements.set(key, remote.id);
    if (curator.sel === local.id) curator.sel = remote.id;
  }
  return { moved: staged.length, failed: 0 };
}
```

Keep IndexedDB originals after success for this release as a recovery copy;
label them synced in memory and prevent the migration button from offering them
again during the session. A later explicit cleanup can remove confirmed local
copies after cross-device verification.

- [ ] **Step 3: Run curator integration tests**

Run: `node --test test/unit/curator-storage.test.js test/unit/curator-arrange.test.js && npx playwright test test/curator.spec.js test/cloud.spec.js test/touch.spec.js -g "local-first curator|batch persists|arrange|manual placement|migration|no keyboard can still hang|failed write" --workers=1`

Expected: PASS with zero failures.

- [ ] **Step 4: Build every affected artifact**

Run: `npm run build && npm run build:site`

Expected: both commands exit 0; `index.html`, `dist/endless/index.html`, and the curated root are generated.

- [ ] **Step 5: Verify the built site in a clean browser**

Serve `dist/`, open `/endless/` with a clean profile, and verify:

1. Curator opens with **On this device** and visible **Add works**.
2. A two-image batch reaches **Saved** and survives reload.
3. **Arrange automatically** hangs both without moving a manually placed work.
4. **Place manually** exposes **Hang here** with mouse and touch emulation.
5. Expanding **Sync & share** shows sign-in without hiding the workspace.
6. No page errors, failed local requests, or unexpected console errors appear.

Capture desktop and phone screenshots for the review package.

- [ ] **Step 6: Update user-facing documentation**

Update the README curator section to state that local curation requires no
account, explain **Arrange automatically** and **Place manually**, and describe
sign-in as optional sync/share. Remove instructions that make the local key or
cloud sign-in sound mandatory.

- [ ] **Step 7: Commit the complete curator repair**

```bash
git add src/main.js src/ui/body.html src/ui/styles.css src/curator test/curator.spec.js test/cloud.spec.js test/touch.spec.js test/unit README.md index.html
git commit -m "Complete local-first curator workflow"
```

- [ ] **Step 8: Push, inspect CI, and verify GitHub Pages**

Run: `git push origin main`

Expected: the push succeeds. Inspect the selected GitHub Actions jobs, wait for
the Pages deployment associated with the pushed commit, then repeat the clean
browser add/reload/arrange/manual flow against
`https://orgsakigake-lang.github.io/LUMIERE/endless/`. Do not report the curator
fixed until that public flow passes.
