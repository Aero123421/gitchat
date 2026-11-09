// Builds the extension into dist/ (load it from chrome://extensions → "Load unpacked").
//   node scripts/build.mjs          one-off build
//   node scripts/build.mjs --watch  rebuild on change
//
// Code is bundled but not minified, so it stays readable for reviewers and the Chrome Web Store.

import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => path.join(root, 'src', p);
const out = (p = '') => path.join(root, 'dist', p);
const watching = process.argv.includes('--watch');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const common = {
  bundle: true,
  target: 'chrome120',
  minify: false,
  sourcemap: watching ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  define: { __GITCHAT_VERSION__: JSON.stringify(pkg.version) },
};

const entries = [
  { entryPoints: { background: src('background/index.ts') }, format: 'esm' },
  { entryPoints: { content: src('content/index.ts') }, format: 'iife' },
  { entryPoints: { frame: src('frame/index.ts') }, format: 'iife' },
  { entryPoints: { popup: src('popup/popup.ts') }, format: 'iife' },
  { entryPoints: { options: src('options/options.ts') }, format: 'iife' },
];

async function copyStatic() {
  const manifest = JSON.parse(await readFile(src('manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(out('manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const f of ['popup/popup.html', 'popup/popup.css', 'options/options.html', 'options/options.css']) {
    await cp(src(f), out(path.basename(f))).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
  await cp(src('_locales'), out('_locales'), { recursive: true });
  await cp(src('icons'), out('icons'), { recursive: true });
}

await rm(out(), { recursive: true, force: true });
await mkdir(out(), { recursive: true });
await copyStatic();

if (watching) {
  for (const e of entries) {
    const ctx = await esbuild.context({ ...common, ...e, outdir: out() });
    await ctx.watch();
  }
  let timer = 0;
  fsWatch(path.join(root, 'src'), { recursive: true }, (_ev, file) => {
    if (!file || /\.(ts|js)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => copyStatic().then(() => console.log(`[static] copied (${file})`)), 80);
  });
  console.log('Watching for changes…');
} else {
  await Promise.all(entries.map((e) => esbuild.build({ ...common, ...e, outdir: out() })));
  console.log(`Built gitchat ${pkg.version} → dist/`);
}
