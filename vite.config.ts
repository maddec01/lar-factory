// The repository's format and lint settings, from Lar's shared toolchain (@lar-works/config), and every package as a
// Vitest project. apps/server's `test` script builds apps/web, which its tests serve, and the root `pnpm test` runs
// apps/desktop after it, so desktop reuses that build. Desktop's own `test` builds apps/web only when dist is missing;
// a stale build is fine there, as its one page check only looks for `<html` (the server runs from source).
// A bare root `vp test` needs the build to exist already.
import { fmt, lint, test } from '@lar-works/config';
import { defineConfig } from 'vite-plus';

const lintConfig = lint({ apps: ['apps/web'] });

/** Copies match their upstream byte for byte (UPSTREAM.md, packages/ui/UPSTREAM.md), so neither tool rewrites them. */
const copies = [
    'skills/lar-build/skills/**',
    'skills/lar-build/references/**',
    'packages/ui/src/search-dialog/useModalAutoFocus.ts',
    'packages/ui/src/search-dialog/useScrollFade.ts',
    'apps/desktop/scripts/ensure-electron-runtime.mjs',
];

/** Skill text and the copy record, which skill-sync compares with upstream and edits with its own scripts. */
const skillSync = ['skills/**/*.md', '.agents/skills/**/*.md', 'UPSTREAM.md'];

export default defineConfig({
    fmt: { ...fmt, ignorePatterns: [...(fmt.ignorePatterns ?? []), ...copies, ...skillSync] },
    lint: {
        ...lintConfig,
        ignorePatterns: [...(lintConfig.ignorePatterns ?? []), ...copies],
        overrides: [
            ...(lintConfig.overrides ?? []),
            {
                // CommonJS files (the commit-msg check, the release plan, the fake CLIs the server tests run) load
                // modules with require.
                files: ['**/*.cjs'],
                rules: { 'typescript/no-require-imports': 'off' },
            },
            {
                files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
                // The board's visual code still sits in apps/web (shared/ui and the features' class names and sheets);
                // step 2b of the lar-web alignment moves it into the design system and turns this on.
                rules: { 'lar/no-visual-recipes': 'off' },
            },
        ],
    },
    test: {
        ...test,
        projects: [
            'packages/shared',
            'packages/ui',
            'packages/work-records',
            'apps/server',
            'apps/web',
            'apps/desktop',
        ],
    },
});
