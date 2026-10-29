// Lists every package as a Vitest project. apps/server's `test` script builds apps/web, which its
// tests serve, and the root `pnpm test` runs apps/desktop after it, so desktop reuses that build.
// Desktop's own `test` builds apps/web only when dist is missing; a stale build is fine there, as its
// one page check only looks for `<html` (the server runs from source).
// A bare root `vp test` needs the build to exist already.
import { defineConfig } from 'vite-plus';
import { sharedTest } from './vitest.shared.ts';

export default defineConfig({
  test: {
    ...sharedTest,
    projects: ['packages/shared', 'packages/ui', 'apps/server', 'apps/web', 'apps/desktop'],
  },
});
