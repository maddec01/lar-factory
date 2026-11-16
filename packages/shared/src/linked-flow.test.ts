import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { linkedFlow, settleFlows } from './linked-flow.ts';
import type { Item } from './model.ts';

const work = (change: Partial<Item>): Item => ({
    ...(sample.items[0] as Item),
    kind: 'feature',
    flow: 'single',
    repo: 'org/front',
    parent: null,
    parentId: null,
    ...change,
});
const flows = (items: Item[]) => Object.fromEntries(settleFlows(items).map((item) => [item.id, item.flow]));

test('only concepts and work across repositories are linked', () => {
    expect(linkedFlow('concept', ['org/front'])).toBe('linked');
    expect(linkedFlow('bug', ['org/front', 'org/back'])).toBe('linked');
    expect(linkedFlow('bug', ['org/front', 'Org/Front', null, undefined])).toBe('single');
    expect(linkedFlow('feature', ['org/front'])).toBe('single');
});

test("a concept's parts in its own repository join its group", () => {
    const concept = work({ id: 'concept', kind: 'concept', flow: 'linked' });

    expect(flows([concept, work({ id: 'part', parentId: concept.id })])).toEqual({
        concept: 'linked',
        part: 'linked',
    });
});

test('a group across repositories is linked as a whole, its parts found by local id or ticket', () => {
    const parent = work({ id: 'parent', number: 1 });
    const front = work({ id: 'front', parentId: parent.id });
    const back = work({
        id: 'back',
        repo: 'org/back',
        parent: { number: 1, repo: 'org/front', title: 'Parent', url: '', state: 'open' },
    });

    expect(flows([parent, front, back])).toEqual({ parent: 'linked', front: 'linked', back: 'linked' });
});

test('a parent and parts in one repository stay single-flow', () => {
    const parent = work({ id: 'parent' });

    expect(flows([parent, work({ id: 'part', parentId: parent.id }), work({ id: 'alone' })])).toEqual({
        parent: 'single',
        part: 'single',
        alone: 'single',
    });
});
