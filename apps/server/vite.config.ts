import { defineConfig } from 'vite-plus';
import { test } from '@lar-works/config';

export default defineConfig({
  test: {
    ...test,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/*.test.ts'],
    // The tests spawn the board, which can take many seconds in CI.
    testTimeout: 60_000,
  },
});
