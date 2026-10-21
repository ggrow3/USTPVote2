import { defineConfig } from 'vitest/config';

/** Integration tests against the Firebase Auth and Firestore emulators (started by `npm run test:int`). */
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    // One emulator instance is shared and cleared between tests, so files must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
