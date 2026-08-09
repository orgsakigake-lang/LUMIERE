/* Report the seam around a line range of src/main.js before extracting it:
   what it declares, what the rest of the file still needs from it (exports),
   and which module-scope names it reaches for (imports).
   Usage: node tools/scope.mjs <firstLine> <lastLine>            */
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map(Number);
if (!a || !b) { console.error('usage: node tools/scope.mjs <first> <last>'); process.exit(1); }

const lines = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').split('\n');
const inside = lines.slice(a - 1, b).join('\n');
const outside = lines.slice(0, a - 1).concat(lines.slice(b)).join('\n');

const FN = /^(?:export )?(?:async )?function\*?\s+([A-Za-z_$][\w$]*)/gm;
/* Bindings, including every declarator in `let a, b = {}, c;` — capturing only
   the first is how `progBlur` and friends stayed invisible to this tool while
   being very much required by the code left behind. */
const BINDING = /^(?:export )?(?:const|let|var)\s+([^;\n]*)/gm;
const NAME = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?==|,|$)/g;

function declare(s) {
  const out = [...s.matchAll(FN)].map((m) => m[1]);
  for (const [, tail] of s.matchAll(BINDING)) {
    /* Stop at the first `=`'s right-hand side: only the head of the list and
       names that follow a comma at depth zero are declarators. */
    let depth = 0, cut = '';
    for (const ch of tail) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      cut += depth > 0 ? ' ' : ch;      // blank out anything nested
    }
    for (const m of cut.matchAll(NAME)) out.push(m[1]);
  }
  return out;
}

/* Names already imported into main.js count too. Missing these is how an
   extraction ships a ReferenceError: getRoom lives in world/rooms.js, so it
   was invisible to a scan that only looked at main.js's own declarations. */
const IMPORTED = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)'/gm;
const imported = [...outside.matchAll(IMPORTED)].flatMap(([, names, from]) =>
  names.split(',').map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean).map((n) => [n, from]));
const importedFrom = new Map(imported);

const mine = [...new Set(declare(inside))];
const theirs = [...new Set([...declare(outside), ...importedFrom.keys()])];
const word = (n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`);

const exports = mine.filter((n) => word(n).test(outside));
const imports = theirs.filter((n) => word(n).test(inside));

console.log(`lines ${a}-${b}  (${b - a + 1} lines)\n`);
console.log(`declares ${mine.length}:`);
console.log('  ' + mine.join(', ') + '\n');
console.log(`must EXPORT (used by the rest of main.js) — ${exports.length}:`);
console.log('  ' + (exports.join(', ') || '(nothing)') + '\n');
console.log(`must IMPORT (names it reaches for) — ${imports.length}:`);
for (const n of imports) console.log(`  ${n.padEnd(20)} ${importedFrom.get(n) || '(declared in main.js)'}`);
if (!imports.length) console.log('  (nothing)');
console.log('\nWord-boundary matching, so comments and property names show up here too — check each.');
