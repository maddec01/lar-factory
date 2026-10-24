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

test("the board's focus outline sits in the base layer, so a T3 control's outline-none wins", () => {
  expect(rules('index.css')).toMatch(/@layer base \{\s*:focus-visible \{/);
});
