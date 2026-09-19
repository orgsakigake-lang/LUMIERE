import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';

const url = process.argv[2] || 'http://127.0.0.1:8019/curated/?debug';
const output = process.argv[3];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const started = performance.now();
  await page.goto(url);
  await page.getByRole('button', { name: 'Enter the exhibition' }).waitFor();
  const coverMs = performance.now() - started;
  const rendererLoadedAtCover = await page.evaluate(() => performance.getEntriesByType('resource').some(r => /scene-.*\.js/.test(r.name)));
  const entryStart = performance.now();
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await page.waitForFunction(() => window.LUMIERE?.stats().frames > 0);
  const entryMs = performance.now() - entryStart;
  const route = [];
  for (let i = 0; i < 7; i++) {
    await page.getByRole('button', { name: 'Next viewpoint' }).click();
    await page.waitForTimeout(1400);
    route.push(await page.evaluate(() => window.LUMIERE.stats()));
  }
  await page.getByRole('button', { name: 'View artwork', exact: true }).click();
  const before = await page.evaluate(() => window.LUMIERE.stats().frames);
  await page.waitForTimeout(500);
  const viewerFrames = (await page.evaluate(() => window.LUMIERE.stats().frames)) - before;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const idleBefore = await page.evaluate(() => window.LUMIERE.stats().frames);
  await page.waitForTimeout(700);
  const idleFrames = (await page.evaluate(() => window.LUMIERE.stats().frames)) - idleBefore;
  const metrics = await page.evaluate(() => window.LUMIERE.stats());
  const meta = JSON.parse(await readFile('curated/build-meta.json', 'utf8'));
  const bundles = [];
  for (const file of Object.keys(meta.outputs)) {
    const bytes = await readFile(file);
    bundles.push({ file, bytes: (await stat(file)).size, gzipBytes: gzipSync(bytes).byteLength });
  }
  const result = {
    protocol: 'curated-reference-v1',
    environment: { browser: await browser.version(), viewport: [1280, 720], renderer: metrics.renderer,
      rendering: /swiftshader|software|llvmpipe/i.test(metrics.renderer) ? 'software' : 'hardware-or-unknown', network: 'unthrottled localhost' },
    coverMs: +coverMs.toFixed(1), entryMs: +entryMs.toFixed(1), rendererLoadedAtCover,
    viewerFrames, idleFrames, metrics, route, bundles,
    limitations: 'Single warm-host local run, software-rendered if reported. Different scene/content from the legacy route; not a matched renderer speed comparison or a physical-device acceptance result.',
  };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (output) await writeFile(output, json);
  process.stdout.write(json);
} finally { await browser.close(); }
