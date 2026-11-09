// Packs dist/ into gitchat-<version>.zip for the Chrome Web Store or a GitHub release.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const file = path.join(root, `gitchat-${version}.zip`);
rmSync(file, { force: true });
execFileSync('zip', ['-r', '-X', file, '.'], { cwd: path.join(root, 'dist'), stdio: 'inherit' });
console.log(`Wrote ${path.basename(file)}`);
