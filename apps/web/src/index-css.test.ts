// The page's own CSS.

import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

const src = 'src/';
const rules = (path: string) => readFileSync(src + path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test("the board's focus outline sits in the base layer, so a T3 control's outline-none wins", () => {
  expect(rules('index.css')).toMatch(/@layer base \{\s*:focus-visible \{/);
});
