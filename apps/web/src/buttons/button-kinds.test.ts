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
  expect(rule('[data-kind]')).toMatch(/height: --spacing\(7\);/);
});

test("Start is tinted with the primary colour on the card, with no border or shadow, and deeper on hover", () => {
  expect(rule('[data-kind="start"]')).toMatch(/color: var\(--primary\);\s*background: color-mix\(in srgb, var\(--primary\) 10%, var\(--card\)\);\s*border-color: transparent;\s*box-shadow: none;/);
  expect(sheet).toMatch(/\[data-kind="start"\]:[^{]*hover[^{]*\{ background: color-mix\(in srgb, var\(--primary\) 18%, var\(--card\)\); \}/);
});

// The title bar's own controls (scope menu, counters, List, Add item, Update and Settings) take their kinds with the
// title bar.
const TITLE_BAR = /^(title-bar|updates)\/|^settings\/settings\.tsx$/;
const TITLE_BAR_TRIGGER = /\$\{CONTROL\}/;

test('every Button and LinkButton outside the title bar names a kind', () => {
  const unnamed = readdirSync('src', { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx$/.test(file) && !/\.test\./.test(file) && !TITLE_BAR.test(file))
    .flatMap((file) => [...readFileSync(`src/${file}`, 'utf8').matchAll(/<(Button|LinkButton)\b(?:[^>]|=>)*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => !/[kK]ind\(|\bkind="/.test(tag) && !TITLE_BAR_TRIGGER.test(tag))
      .map((tag) => `${file}: ${tag.slice(0, 80)}`));
  expect(unnamed).toEqual([]);
});

test("the copied Modal's Close is 28 px square", () => {
  expect(rule('[data-slot="modal-close"]')).toMatch(/width: --spacing\(7\);\s*height: --spacing\(7\);/);
});

test('a destructive Main action is filled in the danger colour', () => {
  expect(kind('main', 'danger')).toEqual({ variant: 'destructive', 'data-kind': 'main' });
});
