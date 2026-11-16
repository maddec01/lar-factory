import type { BoardData } from '@lar-factory/shared';
import sampleJson from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { expect, test } from 'vite-plus/test';

import { shareBoardData } from './share-board-data';

const sample = sampleJson as unknown as BoardData;
const clone = <T>(value: T): T => structuredClone(value);

test('an identical wire snapshot reuses the board and changing one item keeps every other item and setting', () => {
    expect(shareBoardData(sample, clone(sample))).toBe(sample);

    const next = clone(sample);

    next.items[0]!.title = 'New tracker title';

    const shared = shareBoardData(sample, next);

    expect(shared).toEqual(next);
    expect(shared.items[0]).not.toBe(sample.items[0]);
    expect(shared.items[0]!.labels).toBe(sample.items[0]!.labels);
    expect(shared.items.slice(1).every((item, i) => item === sample.items[i + 1])).toBe(true);
    expect(shared.repos).toBe(sample.repos);
    expect(shared.tools).toBe(sample.tools);
    expect(sample.items[0]!.title).not.toBe('New tracker title');
});

test('fresh activity read times, actions, agent lists and tracker checks are never treated as unchanged', () => {
    const thread = {
        id: 't',
        title: 'Build',
        state: 'running' as const,
        updated: '2026-11-05T10:00:00Z',
        activity: {
            available: true as const,
            readAt: '2026-11-05T10:00:00Z',
            action: 'Read a.ts',
            toolRunning: false,
            agents: [{ title: 'Review', action: 'Read b.ts' }],
        },
    };
    const before = { ...sample, items: [{ ...sample.items[0]!, threads: [thread] }] };
    const next = clone(before);

    next.items[0]!.threads[0]!.activity.readAt = '2026-11-05T10:00:02Z';

    let shared = shareBoardData(before, next);

    expect(shared).toEqual(next);
    expect(shared.items[0]!.threads).not.toBe(before.items[0]!.threads);
    expect((shared.items[0]!.threads as (typeof before.items)[0]['threads'])[0]!.activity.agents).toBe(
        thread.activity.agents,
    );
    next.items[0]!.threads[0]!.activity.action = 'Run tests';
    next.items[0]!.threads[0]!.activity.agents = [];
    shared = shareBoardData(shared, clone(next));
    expect(shared).toEqual(next);
});

test('connection health and removed fields propagate even when no item changes', () => {
    const before = {
        ...sample,
        localProblem: 'Disconnected',
        t3Availability: { availability: 'unavailable' as const },
    };
    const next = clone(before) as BoardData;

    delete next.localProblem;
    next.t3Availability = { availability: 'available' };
    next.fetchedAt = '2026-11-05T10:00:00Z';

    const shared = shareBoardData(before, next);

    expect(shared).toEqual(next);
    expect(shared).not.toHaveProperty('localProblem');
    expect(shared.items).toBe(before.items);
});
