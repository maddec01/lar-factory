import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import type { BoardData } from './board-domain.ts';
import { groupCapacityWait } from './group-capacity.ts';
import type { Item } from './item-domain.ts';

function fixture() {
    const base = sample.items[0] as Item;
    const items = ['In progress', 'Review', 'Ready'].map((status, index) => ({
        ...base,
        id: `part-${index}`,
        kind: 'build',
        status,
        buildReserved: status !== 'Ready',
        parentId: 'group',
        threads: [],
        blockers: [],
        linkedPrs: [],
        passingBrief: true,
        needsYou: undefined,
    })) as Item[];
    const parent: Item = {
        ...base,
        id: 'group',
        kind: 'concept',
        conceptBuild: {
            run: { state: 'running', startedAt: '2026-11-13', prepared: {} },
            holds: [],
            members: items.map((item) => ({
                workId: item.id,
                title: item.title,
                repository: item.repo,
                kind: 'build',
                status: item.status,
                complete: false,
                waits: [],
            })),
        },
    };
    const data = { ...sample, items, buildLimit: { limit: 2, automatic: 2 } } as unknown as BoardData;

    return { parent, data, waiting: items[2]! };
}

test('capacity is explained only for an otherwise eligible part with authorization and no free slot', () => {
    const { parent, data } = fixture();

    expect(groupCapacityWait(parent, data)).toBe('Shared capacity full: 2 of 2 slots in use');
    data.buildLimit!.limit = 1;
    expect(groupCapacityWait(parent, data)).toBe('Shared capacity full: 2 of 1 slots in use · 1 over the limit');
    data.buildLimit!.limit = 3;
    expect(groupCapacityWait(parent, data)).toBeNull();
    data.buildLimit!.limit = 2;
    parent.conceptBuild!.run = null;
    expect(groupCapacityWait(parent, data)).toBeNull();
    data.autoBuild = { on: true };
    expect(groupCapacityWait(parent, data)).toBe('Shared capacity full: 2 of 2 slots in use');
});

test('gate, blocker, human, scheduler and paused waits do not claim capacity as their cause', () => {
    const { parent, data, waiting } = fixture();

    waiting.passingBrief = false;
    expect(groupCapacityWait(parent, data)).toBeNull();
    waiting.passingBrief = true;
    waiting.blockers = [{ number: 1, repo: waiting.repo, state: 'open' }];
    expect(groupCapacityWait(parent, data)).toBeNull();
    waiting.blockers = [];
    waiting.briefApproval = { reason: 'Approve the new brief.' };
    expect(groupCapacityWait(parent, data)).toBeNull();
    delete waiting.briefApproval;
    data.autoBuildPass = { paused: { [waiting.id]: 'Fix access.' }, wouldStart: 0, waitsForRefinement: [] };
    expect(groupCapacityWait(parent, data)).toBeNull();
    delete data.autoBuildPass;
    parent.conceptBuild!.holds = [{ workId: parent.id, reason: 'Map needs an answer.' }];
    expect(groupCapacityWait(parent, data)).toBeNull();
    parent.conceptBuild!.holds = [];
    parent.conceptBuild!.run!.state = 'paused';
    expect(groupCapacityWait(parent, data)).toBeNull();
});
