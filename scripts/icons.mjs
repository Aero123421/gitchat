// Renders the extension icons (src/icons/*.png) and the README logo (docs/images/gitchat.png) from the
// creature art in src/shared/creature-art.js. Uses an installed Google Chrome through playwright-core
// (no browser download); set CHROME_PATH if Chrome is somewhere else.
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { creatureSVG } from '../src/shared/creature-art.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => p && existsSync(p));
if (!CHROME) {
  console.error('Google Chrome not found: set CHROME_PATH to its executable.');
  process.exit(1);
}

/** [file, CSS size, device scale, detail] */
const outputs = [
  ['src/icons/16.png', 16, 1, 'small'],
  ['src/icons/32.png', 32, 1, 'small'],
  ['src/icons/48.png', 48, 1, 'full'],
  ['src/icons/128.png', 128, 1, 'full'],
  ['docs/images/gitchat.png', 128, 2, 'full'],
];

const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const [file, size, scale, detail] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: scale });
    await page.setContent(`<html><body style="margin:0;background:transparent">${creatureSVG({ size, detail })}</body></html>`);
    const out = path.join(root, file);
    mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
}
