import type { BoardData, ConceptBuildPlan, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { conceptBuildProgress, conceptBuildWait } from './ConceptBuildProgress';

const build = (id: string, status: Item['status'] = 'Ready') =>
    ({
        id,
        title: id,
        kind: 'build',
        status,
        parentId: 'group',
        passingBrief: true,
        blockers: [],
        slices: [],
    }) as unknown as Item;

function data(state: 'running' | 'paused' = 'running') {
    const items = [build('Building', 'In progress'), build('Waiting'), build('Merge', 'Ready to merge')];
    const plan: ConceptBuildPlan = {
        run: { state, startedAt: '2026-01-01', prepared: {} },
        holds: [],
        members: items.map((item) => ({
            workId: item.id,
            title: item.title,
            repository: 'example/repo',
            kind: item.kind,
            status: item.status,
            complete: false,
            waits: [],
        })),
    };
    const parent = { id: 'group', kind: 'concept', conceptBuild: plan } as Item;

    return { parent, items, board: { items: [parent, ...items] } as BoardData };
}

test('separates active work, capacity waits and PR merge waits, using confirmed completion for totals', () => {
    const { parent, items, board } = data();

    expect(conceptBuildProgress(parent, board)).toMatchObject({
        total: 3,
        building: 1,
        waiting: 2,
        complete: 0,
        names: 'Building',
    });
    expect(conceptBuildWait(items[1]!, board)).toBe('Waiting for shared build capacity.');
    expect(conceptBuildWait(items[2]!, board)).toBe('Waiting for PR merge.');
    items[2]!.status = 'Done';
    expect(conceptBuildProgress(parent, board).complete).toBe(0);
    expect(conceptBuildWait(items[2]!, board)).toBe('Waiting for provider-confirmed merge.');
    parent.conceptBuild!.members[2]!.complete = true;
    expect(conceptBuildProgress(parent, board)).toMatchObject({ complete: 1, waiting: 1 });
});

test('names paused runs, gate holds and scheduler failures ahead of a capacity wait', () => {
    const { items, board } = data('paused');

    expect(conceptBuildWait(items[1]!, board)).toContain('Paused');
    items[1]!.passingBrief = false;
    expect(conceptBuildWait(items[1]!, board)).toContain('approved gate');
    board.autoBuildPass = { paused: { Waiting: 'Fix access.' }, wouldStart: 0, waitsForRefinement: [] };
    expect(conceptBuildWait(items[1]!, board)).toBe('Start paused: Fix access.');
});
