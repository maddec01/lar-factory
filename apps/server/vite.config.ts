import { defineConfig } from 'vite-plus';
import { sharedTest } from '../../vitest.shared.ts';

export default defineConfig({
  test: {
    ...sharedTest,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/*.test.ts'],
    // The tests spawn the board, which can take many seconds in CI.
    testTimeout: 60_000,
  },
});
