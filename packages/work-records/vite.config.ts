import { defineConfig } from 'vite-plus';
import { test } from '@lar-works/config';

export default defineConfig({
  test: {
    ...test,
    include: ['src/**/*.test.ts'],
  },
});
