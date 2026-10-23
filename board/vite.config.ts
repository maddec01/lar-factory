// Vite+ builds the page into dist/, which the board server reads at startup.
// Vitest runs the page tests in test/page/ in a DOM; Node's test runner keeps the rest.

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';
import type { Plugin } from 'vite-plus';

/** Holds the first paint until the page script has run, so it shows the board rather than an empty
 *  page. Vite drops the attribute from index.html, so it goes on the built tag. */
const renderBlockingEntry: Plugin = {
  name: 'render-blocking-entry',
  transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<script type="module"(?![^>]*\bblocking=)/, '<script type="module" blocking="render"') },
};

export default defineConfig({
  plugins: [tailwindcss(), renderBlockingEntry],
  build: { outDir: 'dist' },
  test: {
    environment: 'jsdom',
    include: ['test/page/**/*.test.ts'],
  },
});
