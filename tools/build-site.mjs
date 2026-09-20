import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';

// Explicit public-file allowlist: never deploy source, SQL, or local settings.
const root = new URL('../', import.meta.url);
const out = new URL('site/', root);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await Promise.all([
  mkdir(new URL('curated/', out), { recursive: true }),
  mkdir(new URL('endless/', out), { recursive: true }),
]);
await Promise.all([
  cp(new URL('preview.jpg', root), new URL('endless/preview.jpg', out)),
  cp(new URL('curated/', root), out, {
    recursive: true, filter: path => !path.endsWith('.map') && !path.endsWith('build-meta.json'),
  }),
]);
const [museum, shell, exhibition] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('src/ui/body.html', root), 'utf8'),
  readFile(new URL('curated/index.html', root), 'utf8'),
]);
const invitation = shell.match(/<!-- CURATED_LINK_START -->([\s\S]*?)<!-- CURATED_LINK_END -->/)?.[1];
const anchor = '<div id="intro-note"></div>';
const endlessLink = 'href="../index.html"';
const endlessEntry = 'data-endless-entry="../index.html"';
if (!invitation || !museum.includes(anchor) || !exhibition.includes(endlessLink) || !exhibition.includes(endlessEntry)) {
  throw new Error('Site navigation anchor is missing');
}
const museumInvitation = invitation.replace('href="./curated/"', 'href="../"');
const rootExhibition = exhibition
  .replace(endlessLink, 'href="./endless/"')
  .replace(endlessEntry, 'data-endless-entry="./endless/"');
await Promise.all([
  writeFile(new URL('index.html', out), rootExhibition),
  writeFile(new URL('curated/index.html', out), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Opening LUMIÈRE…</title><link rel="canonical" href="../">
<script>location.replace(new URL('../'+location.search+location.hash,location.href))</script>
<noscript><meta http-equiv="refresh" content="0;url=../"></noscript></head>
<body><a href="../">Open LUMIÈRE</a></body></html>
`),
  writeFile(new URL('endless/index.html', out), museum.replace(anchor, () => anchor + museumInvitation)),
]);
await writeFile(new URL('.nojekyll', out), '');
console.log('Built site/ with the curated exhibition at root and the endless gallery at /endless/.');
