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
