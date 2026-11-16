import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import type { Item } from './item-domain.ts';
import { questionOwnerParent } from './question-thread.ts';

const item = (id: string, parentId: string | null, patch: Partial<Item> = {}): Item => ({
    ...(sample.items[0] as Item),
    id,
    parentId,
    kind: 'decision',
    status: 'Needs you',
    threads: [],
    ...patch,
});

test('a nested part uses its nearest concept even when an outer concept has a question', () => {
    const outer = item('outer', null, {
        kind: 'concept',
        threads: [{ id: 'question', state: 'needs you', title: 'Question', updated: '2026-11-13' }],
    });
    const nearest = item('nearest', outer.id, { kind: 'concept' });
    const parent = item('parent', nearest.id);
    const part = item('part', parent.id);

    expect(questionOwnerParent(part, [outer, nearest, parent, part])).toBe(nearest);
});
