import { appendFile } from 'node:fs/promises';
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
  let input = '';
  if (!forceFull) {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
  }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
