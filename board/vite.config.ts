// Vite+ builds the page into dist/, which the board server reads at startup.
// Vitest runs the page tests in test/page/ in a DOM; Node's test runner keeps the rest.

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [tailwindcss()],
  build: { outDir: 'dist' },
  test: {
    environment: 'jsdom',
    include: ['test/page/**/*.test.ts'],
  },
});
