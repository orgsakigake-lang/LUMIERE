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

const DECL = /^(?:export )?(?:async )?(?:function\*? |const |let |var )([A-Za-z_$][\w$]*)/gm;
const declare = (s) => [...s.matchAll(DECL)].map((m) => m[1]);

const mine = [...new Set(declare(inside))];
const theirs = [...new Set(declare(outside))];
const word = (n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`);

const exports = mine.filter((n) => word(n).test(outside));
const imports = theirs.filter((n) => word(n).test(inside));

console.log(`lines ${a}-${b}  (${b - a + 1} lines)\n`);
console.log(`declares ${mine.length}:`);
console.log('  ' + mine.join(', ') + '\n');
console.log(`must EXPORT (used by the rest of main.js) — ${exports.length}:`);
console.log('  ' + (exports.join(', ') || '(nothing)') + '\n');
console.log(`must IMPORT (module-scope names it reaches for) — ${imports.length}:`);
console.log('  ' + (imports.join(', ') || '(nothing)'));
