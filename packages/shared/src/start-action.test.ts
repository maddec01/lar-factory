import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import type { Item } from './item-domain.ts';
import { startActionChoice } from './start-action.ts';

const item = (patch: Partial<Item>): Item => ({ ...(sample.items[0] as Item), threads: [], ...patch });

test.each([
    [{ status: 'Queued', kind: 'build' }, 'Start shaping'],
    [{ status: 'Queued', kind: 'concept' }, 'Start shaping'],
    [{ status: 'Queued', kind: 'decision', decisionMethod: 'task' }, 'Start decision'],
    [{ status: 'Ready', kind: 'build' }, 'Start build'],
    [{ status: 'Ready', kind: 'concept' }, 'Start concept builds'],
    [{ status: 'Queued', kind: 'issue', recorded: false, labels: ['decision-task'] }, 'Start decision'],
    [{ status: 'Queued', kind: 'build', recorded: true, labels: ['decision-task'] }, 'Start shaping'],
    [{ status: 'Queued', kind: 'issue', recorded: false, labels: ['decision-unknown'] }, 'Start shaping'],
] satisfies [Partial<Item>, string][])('%j names the work it starts', (patch, label) => {
    expect(startActionChoice(item(patch)).label).toBe(label);
});

test('a deferred start names both the work and prerequisite, armed or unarmed', () => {
    const work = item({ status: 'Ready' });

    expect(startActionChoice(work, 'build', { prerequisite: '#42', armed: false }).label).toBe('Start build after #42');
    expect(startActionChoice(work, 'build', { prerequisite: 'server team', armed: true }).label).toBe(
        'Starts build after server team',
    );
});
