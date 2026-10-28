// Each button kind names the copied Button recipe it draws over and marks the button with its kind, which the kinds'
// sheet sizes and tints.

import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import { kind } from './button-kinds.tsx';

const sheet = readFileSync('src/buttons/button-kinds.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => sheet.match(new RegExp(`^${selector.replace(/[[\]()]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';

test('each kind draws over one recipe of the copied Button and names itself', () => {
  expect((['main', 'start', 'open', 'control', 'other'] as const).map((k) => kind(k))).toEqual([
    { variant: 'primary', 'data-kind': 'main' },
    { variant: 'quiet', 'data-kind': 'start' },
    { variant: 'secondary', 'data-kind': 'open' },
    { variant: 'quiet', 'data-kind': 'control' },
    { variant: 'secondary', 'data-kind': 'other' },
  ]);
});

test('every kind is 28 px tall, over the Copy, which the sheet leaves unlayered so it wins over its utilities', () => {
  expect(sheet).not.toMatch(/@layer/);
  expect(rule('[data-kind]:where(:not([data-toggle]))')).toMatch(/height: --spacing\(7\);/);
  expect(rule('[data-kind]'), 'a toggle keeps its own size').toBe('');
});

test("Start, and an App control marked data-tint, are tinted with the primary colour on the card, with no border or shadow, and deeper on hover", () => {
  expect(rule('[data-kind="start"], [data-tint]')).toMatch(/color: var\(--primary\);\s*background: color-mix\(in srgb, var\(--primary\) 10%, var\(--card\)\);\s*border-color: transparent;\s*box-shadow: none;/);
  expect(sheet).toMatch(/\[data-tint\][^{]*:hover[^{]*\{ background: color-mix\(in srgb, var\(--primary\) 18%, var\(--card\)\); \}/);
});

test('every Button and LinkButton names a kind', () => {
  const unnamed = readdirSync('src', { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx$/.test(file) && !/\.test\./.test(file))
    .flatMap((file) => [...readFileSync(`src/${file}`, 'utf8').matchAll(/<(Button|LinkButton)\b(?:[^>]|=>)*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => !/[kK]ind\(|\bkind="/.test(tag))
      .map((tag) => `${file}: ${tag.slice(0, 80)}`));
  expect(unnamed).toEqual([]);
});

test('an icon-only button is 28 px square, keeping its kind\'s icon, or a 20 px one when marked large', () => {
  expect(rule('[data-kind][data-icon-only]')).toMatch(/width: --spacing\(7\);\s*padding: 0;/);
  expect(rule('[data-kind][data-icon-only="large"] svg')).toMatch(/width: --spacing\(5\);\s*height: --spacing\(5\);/);
  expect(rule('[data-kind][data-icon-only] svg'), 'an unmarked one keeps its kind\'s icon size').toBe('');
});

test("the copied Modal's Close is 28 px square", () => {
  expect(rule('[data-slot="modal-close"]')).toMatch(/width: --spacing\(7\);\s*height: --spacing\(7\);/);
});

test('a destructive Main action is filled in the danger colour', () => {
  expect(kind('main', 'danger')).toEqual({ variant: 'destructive', 'data-kind': 'main' });
});
