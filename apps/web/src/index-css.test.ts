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

test("the board's focus outline sits in the base layer, so a T3 control's outline-none wins", () => {
  expect(baseLayer()).toMatch(/^\s*:focus-visible \{/m);
});

test("the board's link rules sit in the base layer, so a link styled as a button keeps its button's colours", () => {
  expect(baseLayer()).toMatch(/^\s*a \{ color: inherit;/m);
});
