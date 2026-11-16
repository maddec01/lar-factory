import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import type { BoardData } from './board-domain.ts';
import { groupState } from './group-state.ts';
import type { Item } from './item-domain.ts';

const base = sample.items[0] as Item;

function group(kind: Item['kind'] = 'concept') {
    const parent = {
        ...base,
        id: 'group',
        kind,
        flow: 'linked',
        parentId: null,
        status: 'Shaping',
        completion: { complete: false, reasons: [] },
        threads: [],
        subIssues: { total: 3, completed: 0 },
    } as Item;
    const children = ['In progress', 'Review', 'Ready'].map((status, index) => ({
        ...base,
        id: `build-${index}`,
        parentId: parent.id,
        kind: 'build',
        flow: 'linked',
        status,
        linkedPrs: [],
        threads:
            status === 'Ready'
                ? []
                : [{ id: `owner-${index}`, title: 'Build', purpose: 'build', state: 'running', updated: 'now' }],
        completion: { complete: false, reasons: [] },
    })) as Item[];

    return { parent, data: { items: [parent, ...children] } as BoardData };
}

test('concept delivery derives from parts even without an explicit concept run', () => {
    const { parent, data } = group();

    parent.status = 'Ready';
    expect(groupState(parent, data)).toMatchObject({ word: '2 builds running · 1 waiting', running: true });
    data.items[1]!.status = 'Ready to merge';
    data.items[1]!.threads = [{ id: 'merge-owner', title: 'Build', purpose: 'build', state: 'done', updated: 'now' }];
    expect(groupState(parent, data)?.word).toBe('1 build running · 2 waiting');
    data.startProgress = { 'build-0': { build: { phase: 'may-have-started', message: 'Checking T3' } } };
    expect(groupState(parent, data)?.word).toBe('2 builds running · 1 waiting');
});

test('paused runs keep active delivery visible and completion requires parent completion', () => {
    const { parent, data } = group();

    parent.conceptBuild = {
        run: { state: 'paused', prepared: {}, startedAt: '2026-11-13' },
        holds: [],
        members: data.items.slice(1).map((item) => ({
            workId: item.id,
            title: item.title,
            kind: 'build',
            repository: item.repo,
            complete: false,
            status: item.status,
            waits: [],
        })),
    };
    expect(groupState(parent, data)?.word).toBe('Concept builds paused · 2 builds running · 1 waiting');
    parent.completion = { complete: true, reasons: [] };
    expect(groupState(parent, data)?.word).toBe('Delivered');
});
