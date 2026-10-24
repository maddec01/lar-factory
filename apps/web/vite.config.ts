// Vite+ builds the page into dist/, which the board server (apps/server) reads at startup.
// Vitest runs the page tests, which sit next to the files they test, in a DOM.

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';
import type { Plugin } from 'vite-plus';
import { sharedTest } from '../../vitest.shared.ts';

/** Holds the first paint until the page script has run, so it shows the board rather than an empty
 *  page. Vite drops the attribute from index.html, so it goes on the built tag. */
const renderBlockingEntry: Plugin = {
  name: 'render-blocking-entry',
  transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<script type="module"(?![^>]*\bblocking=)/, '<script type="module" blocking="render"') },
};

export default defineConfig({
  plugins: [tailwindcss(), renderBlockingEntry],
  build: {
    outDir: 'dist',
    rolldownOptions: {
      // @base-ui marks its modules "use client", which means nothing in a page without server
      // components, so Rolldown's warning that bundling drops the directive is noise.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return;
        warn(warning);
      },
    },
  },
  test: {
    ...sharedTest,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
