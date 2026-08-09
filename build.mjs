/* ═══════════════════════════════════════════════════════════════════
   LUMIÈRE — build
   Bundles src/ into a single self-contained index.html at the repo root.
   The output has zero runtime dependencies and loads in one request;
   only *authoring* is modular. index.html is committed so GitHub Pages
   keeps deploying from main root with no CI step.
   ═══════════════════════════════════════════════════════════════════ */
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const WATCH = process.argv.includes('--watch');
const MINIFY = process.argv.includes('--archive') || process.argv.includes('--minify');
/* An archival build: minified, and with the cloud layer swapped for an inert
   stub. See docs/permanence.md — it is both the honest artifact for permanent
   storage and what takes the page under the 100 KiB free-upload threshold. */
const ARCHIVE = process.argv.includes('--archive');
/* Watch mode writes somewhere else entirely. Pointing it at index.html meant
   every dev session and every test run silently overwrote the committed,
   minified artifact with an unminified one — which is how a 173 KB build once
   got committed in place of a 103 KB one. */
const OUT = ARCHIVE ? 'archive/index.html' : WATCH ? 'dev/index.html' : 'index.html';
const PORT = 8000;

/* GLSL goes in as raw text, so esbuild's minifier never sees it. Strip
   comments and indentation ourselves — line structure is preserved because
   #version and the other preprocessor directives must stay on their own
   lines. Worth the trouble: see the 100 KiB note at the bottom of this file. */
function minifyGLSL(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const glslPlugin = {
  name: 'glsl',
  setup(b) {
    b.onLoad({ filter: /\.(glsl|vert|frag)$/ }, async (args) => ({
      contents: JSON.stringify(MINIFY ? minifyGLSL(await readFile(args.path, 'utf8'))
                                      : await readFile(args.path, 'utf8')),
      loader: 'json',
    }));
  },
};

/* esbuild's `alias` only accepts bare package names, so the swap is a resolve
   hook. The filter cannot catch client.stub.js itself — it does not end in
   "client.js". */
const stubCloudPlugin = {
  name: 'stub-cloud',
  setup(b) {
    b.onResolve({ filter: /cloud\/client\.js$/ },
      () => ({ path: join(ROOT, 'src/cloud/client.stub.js') }));
  },
};

/* trace() is already a no-op outside local development, but its call sites and
   their template-literal arguments still ship — and esbuild will not drop them
   on its own, because the interpolations read properties, which could in
   principle trigger a getter. Marking it `pure` therefore does nothing. Strip
   the statements instead. Deliberately narrow: whole-line calls only, so a
   trace() used as an expression or spanning lines is left alone rather than
   half-removed. */
const TRACE_LINE = /^[ \t]*trace\((?:`[^`]*`|'[^']*'|"[^"]*")\);?[ \t]*$/gm;
const stripTracePlugin = {
  name: 'strip-trace',
  setup(b) {
    b.onLoad({ filter: /src[/\\].*\.js$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(TRACE_LINE, ''),
      loader: 'js',
    }));
  },
};

const buildOptions = {
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  charset: 'utf8',        /* keep È — · ’ as UTF-8 bytes; the default \uXXXX escaping doubles them */
  minify: MINIFY,
  /* The dev half of window.DBG exists for the harness. Archive builds define
     this false so esbuild drops the whole block — the structural cut that keeps
     that artifact under the 100 KiB free-upload threshold. */
  define: { DBG_FULL: ARCHIVE ? 'false' : 'true' },
  legalComments: 'none',
  plugins: [glslPlugin, ...(MINIFY ? [stripTracePlugin] : []), ...(ARCHIVE ? [stubCloudPlugin] : [])],
  write: false,
};

/* Splice content into the template. split/join rather than String.replace:
   replacement strings interpret $&, $', $1 — and shader/CSS source is full
   of $-adjacent noise waiting to be silently eaten. */
function splice(template, token, content) {
  if (!template.includes(token)) throw new Error(`template is missing ${token}`);
  return template.split(token).join(content);
}

/* Collapse whitespace that sits strictly between tags. Text content is left
   alone — the copy in this page is prose, and eating a space inside a
   sentence is a visible bug for a byte. */
const minifyHTML = (s) => s.replace(/>\s+</g, '><').trim();

async function emit() {
  const t0 = performance.now();
  let [result, css, body, template] = await Promise.all([
    esbuild.build(buildOptions),
    readFile(join(ROOT, 'src/ui/styles.css'), 'utf8'),
    readFile(join(ROOT, 'src/ui/body.html'), 'utf8'),
    readFile(join(ROOT, 'src/index.template.html'), 'utf8'),
  ]);

  if (MINIFY) {
    css = (await esbuild.transform(css, { loader: 'css', minify: true })).code;
    body = minifyHTML(body);
  }

  let js = result.outputFiles[0].text;

  /* A literal </script> inside a string would close the inline tag early. */
  js = js.split('</script').join('<\\/script');

  const html = splice(
    splice(splice(template, '@@CSS@@', css.trimEnd()), '@@BODY@@', body.trimEnd()),
    '@@JS@@',
    js.trimEnd(),
  );

  await mkdir(dirname(join(ROOT, OUT)), { recursive: true });
  await writeFile(join(ROOT, OUT), html);

  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`${OUT}  ${kb} KB  ${ms} ms${ARCHIVE ? '  (archive)' : MINIFY ? '  (minified)' : ''}`);
  if (result.warnings.length) console.warn(esbuild.formatMessagesSync(result.warnings, { kind: 'warning' }).join('\n'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

if (WATCH) {
  /* Spread the existing plugins back in — overwriting the array dropped the
     GLSL loader, and watch mode failed on every .vert while quietly serving
     the last good index.html, which looks exactly like everything working. */
  const ctx = await esbuild.context({ ...buildOptions, plugins: [...buildOptions.plugins, {
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
    const file = join(ROOT, path === '/' ? OUT : path);
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
