import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_SERVICES } from '../../src/background/validate';
import { ADAPTER_HOSTS } from '../../src/content/adapters/registry';
import { ALLOWED_PARENTS } from '../../src/frame/index';

const manifest = JSON.parse(readFileSync(new URL('../../src/manifest.json', import.meta.url), 'utf8')) as {
  content_scripts: Array<{ matches: string[]; js: string[] }>;
};
const contentMatches = manifest.content_scripts.find((s) => s.js.includes('content.js'))?.matches ?? [];

describe('adapter hosts', () => {
  it.each(ADAPTER_HOSTS)('%s is a content-script match, a sender origin, and an allowed frame parent', (host) => {
    expect(contentMatches).toContain(`https://${host}/*`);
    expect(SITE_SERVICES[`https://${host}`]).toBeTruthy();
    expect(ALLOWED_PARENTS.has(`https://${host}`)).toBe(true);
  });
});
