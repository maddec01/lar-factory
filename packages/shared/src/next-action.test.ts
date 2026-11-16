import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

import { nextAction } from './item-next-action.ts';
import type { BoardData } from './model.ts';

const sample = JSON.parse(readFileSync(new URL('../test/sample.json', import.meta.url), 'utf8')) as BoardData;

test.each([
    [31, 'Verify build'],
    [23, 'Answer in T3'],
])('item #%s has one next action for every surface', (number, label) => {
    expect(nextAction(sample.items.find((item) => item.number === number)!)).toMatchObject({ label });
});
