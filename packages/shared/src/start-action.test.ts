import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import type { Item } from './item-domain.ts';
import { startActionChoice } from './start-action.ts';

const item = (patch: Partial<Item>): Item => ({ ...(sample.items[0] as Item), threads: [], ...patch });

test.each([
    [{ status: 'Queued', kind: 'build' }, 'Shape'],
    [{ status: 'Ready', kind: 'build' }, 'Build'],
] satisfies [Partial<Item>, string][])('%j names the work it starts', (patch, label) => {
    expect(startActionChoice(item(patch)).label).toBe(label);
});
