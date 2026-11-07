import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vite-plus/test';

import { compiledCss } from './compiled-css.ts';

const designSystem = fileURLToPath(import.meta.resolve('@lar-works/design-system/styles.css'));
const styles = fileURLToPath(new URL('../styles.css', import.meta.url));

const load = async (css: string) => {
    const dir = await mkdtemp(join(tmpdir(), 'compiled-css-'));

    try {
        await writeFile(join(dir, 'page.css'), css);

        const plugin = compiledCss();
        const context = { addWatchFile: () => {} };
        const id = plugin.resolveId('./page.css?compiled', join(dir, 'page.ts'));

        assert.ok(id !== undefined);

        const code = await plugin.load.call(context, id);

        assert.ok(code !== undefined);

        return JSON.parse(code.replace(/^export default /, '').replace(/;$/, '')) as string;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
};

test('compiledCss turns a ?compiled CSS import into its CSS, with the tokens it imports', async () => {
    const css = await load(
        `@import ${JSON.stringify(designSystem)} source(none);\n@import ${JSON.stringify(styles)};\n.note { @apply text-base-700 gap-2; }`,
    );

    assert.match(css, /--muted-foreground:/);
    assert.match(css, /\.note\{[^}]*color:var\(--color-base-700\)/);
    assert.match(css, /gap:calc\(var\(--spacing\)\s?\*\s?2\)/);
    assert.match(css, /prefers-color-scheme:dark/);
});

test('compiledCss leaves other imports alone', async () => {
    const plugin = compiledCss();

    assert.equal(plugin.resolveId('./page.css', '/x/page.ts'), undefined);
    assert.equal(await plugin.load.call({ addWatchFile: () => {} }, '/x/page.css'), undefined);
});
