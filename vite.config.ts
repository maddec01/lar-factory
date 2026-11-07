// The repository's format and lint settings, from Lar's shared toolchain (@lar-works/config), and every package as a
// Vitest project. apps/server's `test` script builds apps/web, which its tests serve, and the root `pnpm test` runs
// apps/desktop after it, so desktop reuses that build. Desktop's own `test` builds apps/web only when dist is missing;
// a stale build is fine there, as its one page check only looks for `<html` (the server runs from source).
// A bare root `vp test` needs the build to exist already.
import { fmt, lint, test } from '@lar-works/config';
import { defineConfig } from 'vite-plus';

const lintConfig = lint({ apps: ['apps/web'] });

export default defineConfig({
  fmt,
  lint: {
    ...lintConfig,
    overrides: [
      ...(lintConfig.overrides ?? []),
      {
        files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
        // Step 2 of the lar-web alignment turns these on.
        rules: { 'lar/boundaries': 'off', 'lar/no-visual-recipes': 'off', 'max-lines': 'off' },
      },
    ],
  },
  test: {
    ...test,
    projects: ['packages/shared', 'packages/ui', 'packages/work-records', 'apps/server', 'apps/web', 'apps/desktop'],
  },
});
