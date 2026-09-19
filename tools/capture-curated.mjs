import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] || 'http://127.0.0.1:8019/curated/?debug';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.getByRole('button', { name: 'Enter the exhibition' }).click();
  await page.waitForFunction(() => window.LUMIERE?.stats().frames > 0);
  const data = await page.evaluate(() => window.LUMIERE.capture());
  await mkdir('assets/curated', { recursive: true });
  await writeFile('assets/curated/cover.webp', Buffer.from(data.split(',')[1], 'base64'));
  console.log(JSON.stringify(await page.evaluate(() => window.LUMIERE.stats()), null, 2));
} finally { await browser.close(); }
