// Each button kind names the copied Button recipe it draws over and marks the button with its kind, which the kinds'
// sheet sizes and tints.

import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import { kind } from './button-kinds.tsx';

const sheet = readFileSync('src/buttons/button-kinds.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => sheet.match(new RegExp(`^${selector.replace(/[[\]()]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';

test('each kind draws over one recipe of the copied Button and names itself', () => {
  expect((['main', 'start', 'open', 'control', 'other'] as const).map(kind)).toEqual([
    { variant: 'primary', 'data-kind': 'main' },
    { variant: 'quiet', 'data-kind': 'start' },
    { variant: 'secondary', 'data-kind': 'open' },
    { variant: 'quiet', 'data-kind': 'control' },
    { variant: 'secondary', 'data-kind': 'other' },
  ]);
});

test('every kind is 28 px tall, over the Copy, which the sheet leaves unlayered so it wins over its utilities', () => {
  expect(sheet).not.toMatch(/@layer/);
  expect(rule('[data-kind]')).toMatch(/height: --spacing\(7\);/);
});

test("Start is tinted with the primary colour on the card, with no border or shadow, and deeper on hover", () => {
  expect(rule('[data-kind="start"]')).toMatch(/color: var\(--primary\);\s*background: color-mix\(in srgb, var\(--primary\) 10%, var\(--card\)\);\s*border-color: transparent;\s*box-shadow: none;/);
  expect(sheet).toMatch(/\[data-kind="start"\]:[^{]*hover[^{]*\{ background: color-mix\(in srgb, var\(--primary\) 18%, var\(--card\)\); \}/);
});
