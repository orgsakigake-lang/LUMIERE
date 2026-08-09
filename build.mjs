/* ═══════════════════════════════════════════════════════════════════
   LUMIÈRE — build
   Bundles src/ into a single self-contained index.html at the repo root.
   The output has zero runtime dependencies and loads in one request;
   only *authoring* is modular. index.html is committed so GitHub Pages
   keeps deploying from main root with no CI step.
   ═══════════════════════════════════════════════════════════════════ */
import * as esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const WATCH = process.argv.includes('--watch');
const MINIFY = process.argv.includes('--minify');
const PORT = 8000;

const buildOptions = {
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: MINIFY,
  legalComments: 'none',
  loader: { '.glsl': 'text', '.vert': 'text', '.frag': 'text' },
  write: false,
};

/* Splice content into the template. split/join rather than String.replace:
   replacement strings interpret $&, $', $1 — and shader/CSS source is full
   of $-adjacent noise waiting to be silently eaten. */
function splice(template, token, content) {
  if (!template.includes(token)) throw new Error(`template is missing ${token}`);
  return template.split(token).join(content);
}

async function emit() {
  const t0 = performance.now();
  const [result, css, body, template] = await Promise.all([
    esbuild.build(buildOptions),
    readFile(join(ROOT, 'src/ui/styles.css'), 'utf8'),
    readFile(join(ROOT, 'src/ui/body.html'), 'utf8'),
    readFile(join(ROOT, 'src/index.template.html'), 'utf8'),
  ]);

  let js = result.outputFiles[0].text;

  /* A literal </script> inside a string would close the inline tag early. */
  js = js.split('</script').join('<\\/script');

  const html = splice(
    splice(splice(template, '@@CSS@@', css.trimEnd()), '@@BODY@@', body.trimEnd()),
    '@@JS@@',
    js.trimEnd(),
  );

  await writeFile(join(ROOT, 'index.html'), html);

  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`index.html  ${kb} KB  ${ms} ms${MINIFY ? '  (minified)' : ''}`);
  if (result.warnings.length) console.warn(esbuild.formatMessagesSync(result.warnings, { kind: 'warning' }).join('\n'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

if (WATCH) {
  const ctx = await esbuild.context({ ...buildOptions, plugins: [{
    name: 'emit',
    setup: (b) => b.onEnd(() => emit().catch((e) => console.error(e.message))),
  }] });
  await ctx.watch();

  /* The template, stylesheet and body markup are spliced in by hand, so they
     are invisible to esbuild's dependency graph and would never trigger a
     rebuild on their own. */
  let debounce;
  watch(join(ROOT, 'src'), { recursive: true }, (_e, file) => {
    if (!file || !/\.(css|html)$/.test(file)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => emit().catch((err) => console.error(err.message)), 40);
  });

  createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  }).listen(PORT, () => console.log(`watching · http://localhost:${PORT}`));
} else {
  await emit();
}
