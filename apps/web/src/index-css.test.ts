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

const baseLayer = () => rules('index.css').match(/@layer base \{([\s\S]*?)\n\}/)?.[1] ?? '';

test("the board's focus outline sits in the base layer, so a copied control's outline-none wins", () => {
  expect(baseLayer()).toMatch(/^\s*:focus-visible \{/m);
});

test("the board's link rules sit in the base layer, so a link styled as a button keeps its button's colours", () => {
  expect(baseLayer()).toMatch(/^\s*a \{ color: inherit;/m);
});

// A feature folder with no sheet of its own has no page class names, so its class names are all Tailwind utilities.
const sources = [...rules('index.css').matchAll(/^@source "\.\/(.+)";$/gm)].map((m) => m[1]);
const folders = readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const utilityFiles = folders
  .filter((folder) => !readdirSync(src + folder).some((name) => name.endsWith('.css')))
  .flatMap((folder) => readdirSync(src + folder).filter((name) => name.endsWith('.tsx')).map((name) => `${folder}/${name}`))
  .filter((path) => readFileSync(src + path, 'utf8').includes('className="'));

test.each(utilityFiles)('Tailwind scans %s, a file in a folder with no sheet of its own', (path) => {
  expect(sources.some((source) => source === path || source === path.split('/')[0])).toBe(true);
});
