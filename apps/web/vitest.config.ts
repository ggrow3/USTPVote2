import { defineConfig } from 'vitest/config';

// Unit tests for the web app's plain TypeScript modules (no components), run in Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
