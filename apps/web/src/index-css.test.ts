// The page's own CSS (index.css and each feature folder's) takes every colour, radius and length from the design
// system's tokens and Tailwind's spacing scale.

import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

const src = 'src/';
const sheets = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.css'));
const rules = (path: string) => readFileSync(src + path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test.each(sheets)('%s sets no raw colour or pixel value', (path) => {
    expect(rules(path)).not.toMatch(/#[\da-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(|\d(px|pt)\b/i);
});

// A folder with no sheet of its own has no page class names, so its class names are all Tailwind utilities.
const sources = [...rules('index.css').matchAll(/^@source "\.\/(.+)";$/gm)].map((m) => m[1]!);
const folders = [
    ...new Set(
        readdirSync(src, { recursive: true, encoding: 'utf8' })
            .filter((path) => path.endsWith('.tsx'))
            .map((path) => path.slice(0, path.lastIndexOf('/') + 1)),
    ),
];
const utilityFiles = folders
    .filter((folder) => !readdirSync(src + folder).some((name) => name.endsWith('.css')))
    .flatMap((folder) =>
        readdirSync(src + folder)
            .filter((name) => name.endsWith('.tsx'))
            .map((name) => `${folder}${name}`),
    )
    .filter((path) => readFileSync(src + path, 'utf8').includes('className="'));

test.each(utilityFiles)('Tailwind scans %s, a file in a folder with no sheet of its own', (path) => {
    expect(sources.some((source) => source === path || path.startsWith(`${source}/`))).toBe(true);
});
