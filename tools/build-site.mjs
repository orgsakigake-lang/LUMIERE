import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';

// Explicit public-file allowlist: never deploy source, SQL, or local settings.
const root = new URL('../', import.meta.url);
const out = new URL('site/', root);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await Promise.all([
  cp(new URL('preview.jpg', root), new URL('preview.jpg', out)),
  cp(new URL('curated/', root), new URL('curated/', out), {
    recursive: true, filter: path => !path.endsWith('.map') && !path.endsWith('build-meta.json'),
  }),
]);
const [museum, shell] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('src/ui/body.html', root), 'utf8'),
]);
const invitation = shell.match(/<!-- CURATED_LINK_START -->([\s\S]*?)<!-- CURATED_LINK_END -->/)?.[1];
const anchor = '<div id="intro-note"></div>';
if (!invitation || !museum.includes(anchor)) throw new Error('Museum invitation anchor is missing');
await writeFile(new URL('index.html', out), museum.replace(anchor, () => anchor + invitation));
await writeFile(new URL('.nojekyll', out), '');
console.log('Built site/ with the original museum and curated exhibition.');
