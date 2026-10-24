import { defineConfig } from 'vite-plus';
import { sharedTest } from '../../vitest.shared.ts';

export default defineConfig({
  test: {
    ...sharedTest,
    include: ['src/**/*.test.ts'],
  },
});
