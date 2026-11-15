import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import sample from '../../../../packages/shared/test/sample.json' with { type: 'json' };
import { samplePartThreads } from './sample-part-threads.ts';

const fixture = sample as unknown as BoardData;
const part = fixture.items.find((item) => item.number === 201)!;
const now = Date.parse('2026-11-15T12:00:00.000Z');

test('a concept part keeps its running thread, its tool running and acting a minute ago', () => {
    const shown = samplePartThreads(fixture).project({ ...part, threads: [] } as Item, now);
    const [thread] = shown.threads as ItemThread[];

    expect(thread?.state).toBe('running');
    expect(thread?.activity).toMatchObject({
        available: true,
        actionAt: '2026-11-15T11:59:00.000Z',
        toolRunning: true,
        action: 'Read direct-connection-options.md',
    });
});

test('an item outside a concept, or one with threads of its own, is left as it is', () => {
    const lane = fixture.items.find((item) => item.number === 150)!;
    const own = { ...part, threads: [{ id: 'own', title: 'Own', state: 'done', updated: '2026-11-01' }] } as Item;

    expect(samplePartThreads(fixture).project({ ...lane, threads: [] } as Item, now).threads).toEqual([]);
    expect(samplePartThreads(fixture).project(own, now)).toBe(own);
});
