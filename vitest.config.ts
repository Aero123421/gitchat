import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // DOM tests opt in per file with `// @vitest-environment happy-dom`
    environment: 'node',
  },
});
