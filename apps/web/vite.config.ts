// Vite+ builds the page into dist/, which the board server (apps/server) reads at startup.
// Vitest runs the page tests, which sit next to the files they test, in a DOM.

import { test } from '@lar-works/config';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';
import type { Plugin } from 'vite-plus';

const webRoot = dirname(fileURLToPath(import.meta.url));

/** Holds the first paint until the page script has run, so it shows the board rather than an empty
 *  page. Vite drops the attribute from index.html, so it goes on the built tag. */
const renderBlockingEntry: Plugin = {
    name: 'render-blocking-entry',
    transformIndexHtml: {
        order: 'post',
        handler: (html) =>
            html.replace(/<script type="module"(?![^>]*\bblocking=)/, '<script type="module" blocking="render"'),
    },
};

/**
 * Merges the lucide icons that only DynamicIcon's name map reaches into one lazy chunk, where each would otherwise be
 * a chunk of its own, about 1,900 files the server reads at startup. Every icon is in the name map, so an icon that
 * page code imports by name, from lucide-react or the design system's icons, has to stay out: the entry would load the
 * whole chunk with it. Those names are collected as modules load, which is before chunking.
 */
function lazyLucideIcons() {
    const imported = new Set<string>();
    let barrel = '';
    let kept: Set<string> | undefined;
    const plugin: Plugin = {
        name: 'lazy-lucide-icons',
        transform(code, id) {
            if (id.endsWith('/lucide-react/dist/esm/lucide-react.mjs')) barrel = code;
            else
                for (const [, names] of code.matchAll(
                    /\{([^}]*)\}\s*from\s*['"](?:lucide-react|@lar-works\/design-system\/icons)['"]/g,
                )) {
                    for (const name of names!.split(',')) imported.add(name.trim().split(/\s+/)[0]!);
                }
        },
    };
    const isLazyIcon = (id: string) => {
        kept ??= new Set(
            [...barrel.matchAll(/export \{([^}]*)\} from '\.\/icons\/([^']+)'/g)]
                .filter(([, names]) => names!.split(',').some((name) => imported.has(name.trim().split(/\s+/).at(-1)!)))
                .map(([, , file]) => file!),
        );

        if (imported.size && !kept.size)
            throw new Error(
                "Can't read lucide-react's barrel; named icons would pull the lazy icon chunk into the entry",
            );

        const file = id.match(/\/lucide-react\/dist\/esm\/icons\/([^/]+)$/)?.[1];

        return file !== undefined && file !== 'index.mjs' && !kept.has(file);
    };

    return { plugin, isLazyIcon };
}

const lucideIcons = lazyLucideIcons();

export default defineConfig({
    resolve: { alias: { '@': resolve(webRoot, 'src') } },
    plugins: [tailwindcss(), renderBlockingEntry, lucideIcons.plugin],
    build: {
        outDir: 'dist',
        rolldownOptions: {
            output: {
                codeSplitting: {
                    // The icons' own dependencies, lucide's Icon and React, stay where page code needs them.
                    groups: [
                        {
                            name: (id) => (lucideIcons.isLazyIcon(id) ? 'lucide-icons' : null),
                            includeDependenciesRecursively: false,
                        },
                    ],
                },
            },
            // lucide-react marks its modules "use client", which means nothing in a page without server
            // components, so Rolldown's warning that bundling drops the directive is noise.
            onwarn(warning, warn) {
                if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return;

                warn(warning);
            },
        },
    },
    test: {
        ...test,
        environment: 'jsdom',
        maxWorkers: 2,
        include: ['src/**/*.test.ts'],
        setupFiles: ['./src/test/setup.ts'],
        // Each test's mountPage loads src/main.tsx afresh, which is slow while the root `pnpm test` runs packages
        // at once. The warm-up in src/test/PageTest.ts runs in a beforeAll, so hooks get the same time.
        testTimeout: 15_000,
        hookTimeout: 60_000,
        // Every test's page stays mounted, and ninna-ui's toast list is global to its module. Run through Vite, the
        // module is loaded again after each test's vi.resetModules, so a test's toasts reach only its own page.
        server: { deps: { inline: ['@ninna-ui/feedback'] } },
    },
});
