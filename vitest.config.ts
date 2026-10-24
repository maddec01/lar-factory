// Lists every package as a Vitest project. The root `pnpm test` builds apps/web first, which
// apps/server's tests serve; a bare `vp test` here needs that build to exist already.
import { defineConfig } from 'vite-plus';
import { sharedTest } from './vitest.shared.ts';

export default defineConfig({
  test: {
    ...sharedTest,
    projects: ['packages/shared', 'apps/web', 'apps/desktop'],
  },
});
