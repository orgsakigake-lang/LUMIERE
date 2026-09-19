// Reproducible authoring step, never run on a visitor's device.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const bundle = await build({
  stdin: { contents: `
    import { works } from './src/curated/exhibition.ts';
    import { paintArt, resetGrain } from './src/art/algos.js';
    import { jitterPal } from './src/art/palettes.js';
    window.exportWork = (index) => {
      const work = works[index];
      const canvas = document.createElement('canvas');
      canvas.width = work.width; canvas.height = work.height;
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      resetGrain();
      const result = paintArt(ctx, work.width, work.height, work.algo, work.seed, work.palette, jitterPal);
      const images = {};
      for (const [tier, edge] of [['thumb',320], ['room',768], ['full',1024]]) {
        const scale = Math.min(1, edge / Math.max(work.width, work.height));
        const out = document.createElement('canvas');
        out.width = Math.round(work.width*scale); out.height = Math.round(work.height*scale);
        out.getContext('2d').drawImage(canvas,0,0,out.width,out.height);
        images[tier] = out.toDataURL('image/webp', tier === 'thumb' ? 0.82 : 0.94).split(',')[1];
      }
      return {id:work.id, canonical:[work.width,work.height], seed:result.seed, images};
    };
    window.workCount = works.length;
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife',
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const output = resolve('assets/curated/art');
  await mkdir(output, { recursive: true });
  const manifest = [];
  for (let i = 0, n = await page.evaluate(() => window.workCount); i < n; i++) {
    const work = await page.evaluate(index => window.exportWork(index), i);
    for (const [tier, data] of Object.entries(work.images))
      await writeFile(resolve(output, `${work.id}-${tier}.webp`), Buffer.from(data, 'base64'));
    manifest.push({ id: work.id, canonical: work.canonical, seed: work.seed });
    console.log(`Exported ${work.id}`);
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ generatorVersion: 'lumiere-v2-curated-1', works: manifest }, null, 2) + '\n');
} finally { await browser.close(); }
