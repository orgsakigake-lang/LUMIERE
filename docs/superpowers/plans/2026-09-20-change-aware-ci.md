# Change-Aware CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run only the LUMIÈRE test domains affected by a change while preserving a conservative full-suite fallback and a safe GitHub Pages deployment gate.

**Architecture:** A pure Node classifier maps changed repository paths to boolean check groups and a small CLI writes those groups to GitHub Actions outputs. One always-running scope job feeds conditional quick, legacy-browser, curated-browser, and schema jobs; a stable required-status job accepts intentional skips but blocks failures, and Pages builds only after selected checks pass.

**Tech Stack:** Node.js 22, `node:test`, Git, GitHub Actions, Playwright, npm, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-09-20-ci-scoping-and-graphify-design.md`

## Global Constraints

- Documentation-only changes must not install Node packages or Chromium.
- Curated-only changes must not run the legacy Playwright suite.
- Legacy-only changes must not run curated browser tests unless they affect the combined-site boundary.
- Shared, dependency, CI, classifier, or unclassified executable/configuration files must select the full suite.
- `workflow_dispatch` and the weekly scheduled run must select every check.
- A main-branch site change may deploy only after every selected check passes.
- The classifier must be repository-owned, locally testable, and independent of Graphify or third-party path-filter actions.
- Existing Node 22, npm, Playwright, SQL verifier, and Pages tooling remain in place; add no runtime or development dependency.

## Review Focus

- A first push with an all-zero `before` SHA must run every check; pinned by `manual or missing-base requests force full coverage` in Task 1 and the fallback branch in Task 2.
- A filename containing spaces, `$()`, backticks, or Markdown punctuation must remain inert data; pinned by `CLI treats hostile-looking filenames as data` in Task 1.
- A shared file such as `src/audio.js` must select both gallery suites; pinned by `shared runtime files select both experiences` in Task 1.
- A skipped conditional job must not hide a failed selected job or accidentally block docs-only changes; pinned by the result-matrix verification in Task 2.
- A site build must never deploy before all selected jobs have reached `success` or intentional `skipped`; pinned by the `required` and `pages` dependency checks in Task 2.

---

### Task 1: Build and test the change classifier

**Files:**
- Create: `tools/ci-scope.mjs`
- Create: `test/unit/ci-scope.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: an array of repository-relative POSIX paths and optional `{ forceFull: boolean, reason?: string }`.
- Produces: `classifyChanges(paths, options)` returning `{ flags, reasons }`, where `flags` has exact boolean keys `quick`, `typecheck`, `legacy`, `curated`, `schema`, `site`, and `full`.
- Produces: CLI `node tools/ci-scope.mjs [--full]`, reading newline-delimited paths from stdin and writing lowercase boolean outputs to `$GITHUB_OUTPUT` plus a readable summary to `$GITHUB_STEP_SUMMARY` when those variables exist.

- [ ] **Step 1: Add failing table-driven classification tests**

Create `test/unit/ci-scope.test.js` with these cases:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classifyChanges } from '../../tools/ci-scope.mjs';

const none = { quick: false, typecheck: false, legacy: false, curated: false,
  schema: false, site: false, full: false };
const everything = { quick: true, typecheck: true, legacy: true, curated: true,
  schema: true, site: true, full: true };

test('docs-only changes select no expensive work', () => {
  assert.deepEqual(classifyChanges(['README.md', 'docs/design/desktop.png']).flags, none);
});

test('curated source selects curated checks and the site only', () => {
  assert.deepEqual(classifyChanges(['src/curated/app.ts']).flags,
    { ...none, quick: true, typecheck: true, curated: true, site: true });
});

test('legacy renderer source selects legacy checks and the site only', () => {
  assert.deepEqual(classifyChanges(['src/render/post.js']).flags,
    { ...none, quick: true, legacy: true, site: true });
});

test('shared runtime files select both experiences', () => {
  for (const path of ['src/audio.js', 'src/cloud/gallery-link.js'])
    assert.deepEqual(classifyChanges([path]).flags,
      { ...none, quick: true, typecheck: true, legacy: true, curated: true, site: true }, path);
});

test('database and Edge Function changes stay in their domains', () => {
  assert.deepEqual(classifyChanges(['supabase-setup.sql']).flags,
    { ...none, schema: true });
  assert.deepEqual(classifyChanges(['supabase/functions/_shared/http.ts']).flags,
    { ...none, quick: true });
});

test('site packaging selects route coverage without legacy rendering', () => {
  assert.deepEqual(classifyChanges(['tools/build-site.mjs']).flags,
    { ...none, quick: true, typecheck: true, curated: true, site: true });
});

test('dependency, workflow, classifier, and unknown executable changes force full coverage', () => {
  for (const path of ['package-lock.json', '.github/workflows/ci.yml',
    'tools/ci-scope.mjs', 'tools/new-release.mjs'])
    assert.deepEqual(classifyChanges([path]).flags, everything, path);
});

test('manual or missing-base requests force full coverage', () => {
  assert.deepEqual(classifyChanges([], { forceFull: true, reason: 'workflow_dispatch' }).flags,
    everything);
});
```

- [ ] **Step 2: Run the classifier tests and verify the missing module fails**

Run:

```bash
node --test test/unit/ci-scope.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tools/ci-scope.mjs`.

- [ ] **Step 3: Implement the pure classifier**

Create `tools/ci-scope.mjs` with ordered rules and inclusive flags. Use these exact policy boundaries:

```js
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const FLAG_NAMES = ['quick', 'typecheck', 'legacy', 'curated', 'schema', 'site', 'full'];
const blank = () => Object.fromEntries(FLAG_NAMES.map(name => [name, false]));

function select(flags, names) {
  for (const name of names) flags[name] = true;
}

function full(flags) {
  select(flags, FLAG_NAMES);
}

export function classifyChanges(paths, { forceFull = false, reason = 'forced full run' } = {}) {
  const flags = blank();
  const reasons = [];
  if (forceFull) {
    full(flags);
    reasons.push({ path: '(event)', checks: [...FLAG_NAMES], reason });
    return { flags, reasons };
  }

  for (const raw of paths) {
    const path = raw.replace(/^\.\//, '');
    if (!path) continue;
    let checks = [];

    if (path === 'README.md' || path.startsWith('docs/')) checks = [];
    else if (path === 'src/audio.js' || path === 'src/audio.d.ts'
      || path === 'src/cloud/gallery-link.js')
      checks = ['quick', 'typecheck', 'legacy', 'curated', 'site'];
    else if (path.startsWith('src/curated/') || path.startsWith('assets/curated/')
      || path === 'test/curated.spec.js' || path === 'test/unit/curated.test.ts'
      || path === 'tools/build-curated.mjs')
      checks = ['quick', 'typecheck', 'curated', 'site'];
    else if (path === 'tools/build-site.mjs' || path === 'preview.jpg')
      checks = ['quick', 'typecheck', 'curated', 'site'];
    else if (path.startsWith('src/') || path === 'build.mjs' || path === 'index.html'
      || path === 'test/helpers.js'
      || (/^test\/.+\.spec\.js$/.test(path) && path !== 'test/curated.spec.js')
      || /^test\/unit\/(cloud|metrics|share-token)\.test\.js$/.test(path))
      checks = ['quick', 'legacy', 'site'];
    else if (path.startsWith('supabase/functions/') || path === 'test/unit/edge-http.test.ts')
      checks = ['quick'];
    else if (path === 'supabase-setup.sql' || path === 'supabase-secret-links.sql'
      || path === 'tools/verify-sql.sh' || path === 'tools/supabase-shim.sql')
      checks = ['schema'];
    else if (path === 'package.json' || path === 'package-lock.json'
      || path === 'tsconfig.curated.json' || path.startsWith('playwright.')
      || path.startsWith('.github/') || path === 'tools/ci-scope.mjs'
      || path === 'test/unit/ci-scope.test.js' || path === '.gitignore'
      || path === 'AGENTS.md' || path.startsWith('.agents/')) {
      full(flags);
      checks = [...FLAG_NAMES];
    } else {
      full(flags);
      checks = [...FLAG_NAMES];
    }

    select(flags, checks);
    reasons.push({ path, checks, reason: checks.length ? 'matched policy' : 'documentation only' });
  }
  return { flags, reasons };
}
```

Keep CLI-only functions below this export so imports have no side effects.

- [ ] **Step 4: Run the pure classifier tests**

Run:

```bash
node --test test/unit/ci-scope.test.js
```

Expected: all classification tests PASS.

- [ ] **Step 5: Add a failing CLI safety test**

Append this test to `test/unit/ci-scope.test.js`:

```js
test('CLI treats hostile-looking filenames as data and writes stable outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumiere-scope-'));
  const output = join(dir, 'outputs');
  const summary = join(dir, 'summary');
  const suspicious = 'docs/name with $(touch should-not-run) `ticks` [link].md\n';
  const run = spawnSync(process.execPath, ['tools/ci-scope.mjs'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    input: suspicious,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(readFileSync(output, 'utf8'), /^legacy=false$/m);
  assert.match(readFileSync(output, 'utf8'), /^site=false$/m);
  assert.match(readFileSync(summary, 'utf8'), /name with/);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 6: Run the test and verify the CLI adapter is missing**

Run:

```bash
node --test test/unit/ci-scope.test.js
```

Expected: FAIL because the process does not write `$GITHUB_OUTPUT`.

- [ ] **Step 7: Implement safe GitHub output and summary writing**

Append CLI helpers to `tools/ci-scope.mjs`. Read stdin as text, split on newlines, write only fixed boolean keys to the output file, HTML-escape paths before embedding them in the Markdown summary, and run only when the module is the process entry point:

```js
const escape = value => String(value).replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('`', '&#96;');

export function summaryMarkdown(result) {
  const selected = FLAG_NAMES.filter(name => result.flags[name]);
  const lines = ['## CI scope', '', selected.length
    ? `Selected: ${selected.map(escape).join(', ')}`
    : 'Documentation-only change: no expensive checks selected.', ''];
  for (const item of result.reasons)
    lines.push(`- <code>${escape(item.path)}</code>: ${item.checks.length
      ? item.checks.map(escape).join(', ') : 'no expensive checks'}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const forceFull = process.argv.includes('--full');
  const input = forceFull ? '' : await readFile(0, 'utf8');
  const paths = input.split(/\r?\n/).filter(Boolean);
  const result = classifyChanges(paths, { forceFull,
    reason: process.env.CI_SCOPE_REASON || 'forced full run' });
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT,
      FLAG_NAMES.map(name => `${name}=${result.flags[name]}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(result));
  process.stdout.write(JSON.stringify(result.flags) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 8: Add an explicit classifier test script**

Add to `package.json` scripts:

```json
"test:ci-scope": "node --test test/unit/ci-scope.test.js"
```

The existing `test:unit` glob must continue to include the new test automatically.

- [ ] **Step 9: Run focused and complete unit checks**

Run:

```bash
npm run test:ci-scope
npm run test:unit
git diff --check
```

Expected: classifier tests PASS, all unit tests PASS, and `git diff --check` prints nothing.

- [ ] **Step 10: Commit the classifier**

```bash
git add -- tools/ci-scope.mjs test/unit/ci-scope.test.js package.json
git commit -m "Add conservative CI change classifier"
```

### Task 2: Rewrite CI around conditional domains and a stable release gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/architecture.md`
- Test: `test/unit/ci-scope.test.js`

**Interfaces:**
- Consumes: Task 1 CLI outputs `quick`, `typecheck`, `legacy`, `curated`, `schema`, `site`, `full` as lowercase strings.
- Produces: GitHub jobs named `scope`, `quick-checks`, `legacy-browser`, `curated-browser`, `schema`, `required`, and `pages`.
- Produces: one stable required check named `required`; conditional jobs may report `skipped` without blocking it.

- [ ] **Step 1: Record the expected workflow contract in classifier tests**

Append a test that reads `.github/workflows/ci.yml` and pins the safety-critical wiring without mirroring the full YAML:

```js
test('workflow keeps a stable required gate and full-run events', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^\s*schedule:/m);
  assert.match(workflow, /node tools\/ci-scope\.mjs --full/);
  assert.match(workflow, /^\s*required:/m);
  assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}/);
  assert.match(workflow, /needs:\s*\[scope, quick-checks, legacy-browser, curated-browser, schema\]/);
  assert.match(workflow, /^\s*pages:/m);
  assert.match(workflow, /needs:\s*\[scope, required\]/);
});
```

- [ ] **Step 2: Run the test and verify the current workflow fails the contract**

Run:

```bash
npm run test:ci-scope
```

Expected: FAIL because the current workflow has no `scope` or stable `required` job.

- [ ] **Step 3: Replace the workflow trigger and scope job**

Keep the current push and pull-request triggers, add the exact weekly schedule below, and use full history for reliable diffs:

```yaml
on:
  push:
    branches: [main, next-level, 'feat/**']
  pull_request:
  schedule:
    - cron: '17 2 * * 0'
  workflow_dispatch:

jobs:
  scope:
    runs-on: ubuntu-latest
    outputs:
      quick: ${{ steps.scope.outputs.quick }}
      typecheck: ${{ steps.scope.outputs.typecheck }}
      legacy: ${{ steps.scope.outputs.legacy }}
      curated: ${{ steps.scope.outputs.curated }}
      schema: ${{ steps.scope.outputs.schema }}
      site: ${{ steps.scope.outputs.site }}
      full: ${{ steps.scope.outputs.full }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Select affected checks
        id: scope
        env:
          EVENT_NAME: ${{ github.event_name }}
          BEFORE_SHA: ${{ github.event.before }}
          PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.sha }}
        run: |
          if [[ "$EVENT_NAME" == workflow_dispatch || "$EVENT_NAME" == schedule ]]; then
            CI_SCOPE_REASON="$EVENT_NAME" node tools/ci-scope.mjs --full
            exit 0
          fi
          BASE_SHA="$BEFORE_SHA"
          if [[ "$EVENT_NAME" == pull_request ]]; then BASE_SHA="$PR_BASE_SHA"; fi
          if [[ -z "$BASE_SHA" || "$BASE_SHA" =~ ^0+$ ]] || ! git cat-file -e "${BASE_SHA}^{commit}"; then
            CI_SCOPE_REASON="missing base commit" node tools/ci-scope.mjs --full
            exit 0
          fi
          git diff --name-only --diff-filter=ACMRTD "$BASE_SHA" "$HEAD_SHA" | node tools/ci-scope.mjs
```

All SHAs remain quoted environment data. Do not interpolate event JSON or filenames into generated shell source.

- [ ] **Step 4: Add the conditional quick and browser jobs**

Use one npm installation per selected job. `quick-checks` runs all inexpensive unit tests, optional typecheck, and the committed-artifact comparison only for legacy changes. The browser jobs run in parallel and upload separate reports on failure:

```yaml
  quick-checks:
    needs: scope
    if: needs.scope.outputs.quick == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npm run test:unit
      - if: needs.scope.outputs.typecheck == 'true'
        run: npm run typecheck
      - name: index.html matches src/
        if: needs.scope.outputs.legacy == 'true'
        run: |
          cp index.html /tmp/committed.html
          npm run build
          cmp -s /tmp/committed.html index.html || {
            echo "::error::index.html is stale — run 'npm run build' and commit it"
            exit 1
          }

  legacy-browser:
    needs: scope
    if: needs.scope.outputs.legacy == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: legacy-playwright-report, path: test-results/, retention-days: 7 }

  curated-browser:
    needs: scope
    if: needs.scope.outputs.curated == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:curated
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: curated-playwright-report, path: test-results/, retention-days: 7 }
```

- [ ] **Step 5: Make schema conditional and add the stable required job**

Keep the existing SQL command and comments, add `needs: scope` plus its condition, then aggregate results:

```yaml
  schema:
    needs: scope
    if: needs.scope.outputs.schema == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: row-level security actually applies
        run: npm run verify:sql

  required:
    if: ${{ always() }}
    needs: [scope, quick-checks, legacy-browser, curated-browser, schema]
    runs-on: ubuntu-latest
    steps:
      - name: Require every selected check
        env:
          SCOPE: ${{ needs.scope.result }}
          QUICK: ${{ needs.quick-checks.result }}
          LEGACY: ${{ needs.legacy-browser.result }}
          CURATED: ${{ needs.curated-browser.result }}
          SCHEMA: ${{ needs.schema.result }}
        run: |
          for result in "$SCOPE" "$QUICK" "$LEGACY" "$CURATED" "$SCHEMA"; do
            case "$result" in success|skipped) ;; *) exit 1 ;; esac
          done
```

- [ ] **Step 6: Build and deploy Pages only after the stable gate**

Rename the old deploy job to `pages`, depend directly on `scope` and `required`, and build a fresh artifact after checks pass:

```yaml
  pages:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.scope.outputs.site == 'true' && needs.required.result == 'success'
    needs: [scope, required]
    runs-on: ubuntu-latest
    concurrency:
      group: github-pages
      cancel-in-progress: false
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    permissions:
      contents: read
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npm run build:site
      - uses: actions/upload-artifact@v4
        with: { name: gallery-site, path: site/, retention-days: 7 }
      - uses: actions/upload-pages-artifact@v4
        with: { path: site/ }
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 7: Update architecture documentation**

Replace the stale test counts and “full suite before committing” guidance in `docs/architecture.md` with:

```markdown
CI classifies changed paths into legacy, curated, database, Edge Function, and
site domains. Documentation-only changes finish without installing Node or a
browser. Shared, dependency, workflow, and unknown executable changes fall back
to every check. `workflow_dispatch` and the Sunday 02:17 UTC schedule always run
the full suite. Run `npm run test:ci-scope` when changing that policy.
```

Keep the existing local `test:fast` explanation for development.

- [ ] **Step 8: Validate workflow syntax, policy tests, and existing cheap checks**

Run:

```bash
python3 -c 'import pathlib, yaml; yaml.safe_load(pathlib.Path(".github/workflows/ci.yml").read_text())'
npm run test:ci-scope
npm run test:unit
npm run typecheck
npm run build:site
git diff --check
```

Expected: YAML parses, tests and typecheck PASS, `site/` builds, and `git diff --check` prints nothing.

- [ ] **Step 9: Inspect every conditional and dependency before commit**

Run:

```bash
rg -n "^(  (scope|quick-checks|legacy-browser|curated-browser|schema|required|pages):)|needs:|if:" .github/workflows/ci.yml
git diff -- .github/workflows/ci.yml docs/architecture.md test/unit/ci-scope.test.js
```

Verify the `required` job has `always()`, Pages needs `required`, and no expensive job lacks a scope condition.

- [ ] **Step 10: Commit the workflow**

```bash
git add -- .github/workflows/ci.yml docs/architecture.md test/unit/ci-scope.test.js
git commit -m "Run CI checks only for affected code"
```

### Task 3: Verify the selector and deployment on GitHub

**Files:**
- Modify only if live verification exposes a defect: `.github/workflows/ci.yml`, `tools/ci-scope.mjs`, or `test/unit/ci-scope.test.js`

**Interfaces:**
- Consumes: committed Tasks 1–2 and GitHub Actions event metadata.
- Produces: successful push CI, successful Pages deployment for the site-changing implementation push, and a successful manual full run.

- [ ] **Step 1: Run local pre-push verification**

```bash
git status --short
npm run test:ci-scope
npm run test:unit
npm run typecheck
npm run build:site
git diff --check
```

Expected: clean tracked state apart from ignored build output, all commands PASS.

- [ ] **Step 2: Push the implementation commits to `main`**

```bash
git push origin main
```

- [ ] **Step 3: Watch and inspect the push run**

```bash
gh run list --repo orgsakigake-lang/LUMIERE --workflow ci --limit 1
gh run watch --repo orgsakigake-lang/LUMIERE --exit-status
```

Expected: because the workflow and classifier changed, the scope summary selects `full`; all test jobs pass; `required` passes; `pages` builds and deploys.

- [ ] **Step 4: Trigger and verify the explicit full-run path**

```bash
gh workflow run ci.yml --repo orgsakigake-lang/LUMIERE --ref main
gh run list --repo orgsakigake-lang/LUMIERE --workflow ci --event workflow_dispatch --limit 1
```

Watch the returned run ID with `gh run watch <run-id> --repo orgsakigake-lang/LUMIERE --exit-status`. Expected: the scope summary identifies `workflow_dispatch`, all check groups run, and Pages is skipped because the event is not a push.

- [ ] **Step 5: Exercise representative scope inputs locally**

```bash
printf '%s\n' docs/setup.md | node tools/ci-scope.mjs
printf '%s\n' src/curated/app.ts | node tools/ci-scope.mjs
printf '%s\n' src/render/post.js | node tools/ci-scope.mjs
printf '%s\n' supabase-setup.sql | node tools/ci-scope.mjs
node tools/ci-scope.mjs --full
```

Expected: docs select none; curated selects quick/typecheck/curated/site; renderer selects quick/legacy/site; SQL selects schema; `--full` selects every flag.

- [ ] **Step 6: Fix only evidence-backed live defects, then re-run the affected checks**

If GitHub exposes a YAML expression, checkout range, or skipped-job result defect, first add a focused regression to `test/unit/ci-scope.test.js` when the defect belongs to repository code. Make the minimal workflow or classifier correction, run Task 2 Step 8, commit with:

```bash
git add -- .github/workflows/ci.yml tools/ci-scope.mjs test/unit/ci-scope.test.js
git commit -m "Fix CI scope release gate"
git push origin main
```

Do not repeat the 89-test legacy suite locally after GitHub's full implementation and manual runs both pass.
