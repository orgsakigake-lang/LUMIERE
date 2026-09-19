import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { watch } from 'node:fs';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'curated');
const serve = process.argv.includes('--serve');
// A release must not contain stale hashed chunks from previous builds.
if (!serve) await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
async function copyShell() {
  await Promise.all([
    cp(resolve(root, 'src/curated/index.html'), resolve(out, 'index.html')),
    cp(resolve(root, 'src/curated/styles.css'), resolve(out, 'styles.css')),
    cp(resolve(root, 'assets/curated'), out, { recursive: true }),
  ]);
}
await copyShell();
const options = {
  entryPoints: [{ in: resolve(root, 'src/curated/entry.ts'), out: 'app' }], outdir: out,
  bundle: true, splitting: true, format: 'esm', target: 'es2022',
  minify: true, sourcemap: serve, chunkNames: '[name]-[hash]', metafile: true,
};
if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.rebuild();
  watch(resolve(root, 'src/curated'), (_event, file) => {
    if (file && /\.(html|css)$/.test(file)) copyShell().catch(console.error);
  });
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.json':'application/json', '.svg':'image/svg+xml' };
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const file = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
      res.end(data);
    } catch { res.writeHead(404).end('Not found'); }
  }).listen(8018, '127.0.0.1', () => console.log('Curated gallery: http://127.0.0.1:8018/curated/'));
} else {
  const result = await build(options);
  await writeFile(resolve(out, 'build-meta.json'), JSON.stringify(result.metafile, null, 2));
  console.log('Built curated/index.html (legacy gallery unchanged)');
}
