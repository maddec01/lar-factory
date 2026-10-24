// The test settings every package's config spreads into its `test` block.
import type { UserConfig } from 'vite-plus';

/** Prints logs only from failing tests and turns off Vitest's performance hints. */
export const sharedTest = {
  silent: 'passed-only',
  experimental: { diagnostics: false },
} satisfies UserConfig['test'];
