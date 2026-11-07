// The page styles nothing itself: its one sheet, index.css, brings in the design system's board entry and nothing
// else, and Tailwind scans none of the page's files, whose words would otherwise turn on utilities of the same name.

import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

const src = 'src/';
const rules = (path: string) => readFileSync(src + path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('index.css is the page’s only sheet', () => {
    const sheets = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.css'));

    expect(sheets).toEqual(['index.css']);
});

test('index.css imports the design system’s board entry with no sources and holds no rules of its own', () => {
    expect(rules('index.css').trim()).toBe("@import '@lar-works/design-system/board.css' source(none);");
});
