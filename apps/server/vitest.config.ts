import { configDefaults, defineConfig } from 'vitest/config';

/** Unit tests. Emulator-backed integration tests (*.int.test.ts) run via `npm run test:int`. */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});
