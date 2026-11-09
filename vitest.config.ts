import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // esbuild injects this at extension build time; the settings page reads it while rendering.
  define: { __GITCHAT_VERSION__: JSON.stringify(version) },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // DOM tests opt in per file with `// @vitest-environment happy-dom`
    environment: 'node',
  },
});
