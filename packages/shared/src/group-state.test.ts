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

test.each(['concept', 'feature', 'build'] as const)(
    '%s delivery derives from parts even without an explicit concept run',
    (kind) => {
        const { parent, data } = group(kind);

        parent.status = 'Ready';
        expect(groupState(parent, data)).toMatchObject({ word: '2 builds running · 1 waiting', running: true });
        data.items[1]!.status = 'Ready to merge';
        data.items[1]!.threads = [
            { id: 'merge-owner', title: 'Build', purpose: 'build', state: 'done', updated: 'now' },
        ];
        expect(groupState(parent, data)?.word).toBe('1 build running · 2 waiting');
        data.startProgress = { 'build-0': { build: { phase: 'may-have-started', message: 'Checking T3' } } };
        expect(groupState(parent, data)?.word).toBe('2 builds running · 1 waiting');
    },
);

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

test('off-board builds stay in waiting totals and stale activity does not restart merge waits', () => {
    const { parent, data } = group();

    parent.conceptBuild = {
        run: null,
        holds: [],
        members: [
            {
                workId: 'outside',
                title: 'Outside',
                kind: 'build',
                repository: 'other/repo',
                status: 'Ready',
                complete: false,
                waits: [],
            },
            {
                workId: 'build-0',
                title: 'Merge',
                kind: 'build',
                repository: base.repo,
                status: 'Verify',
                complete: false,
                waits: [],
            },
        ],
    };
    data.items[1] = {
        ...data.items[1]!,
        status: 'Verify',
        threads: [
            {
                id: 'b',
                title: 'Build',
                purpose: 'build',
                state: 'running',
                currentRunning: true,
                updated: 'old',
                observedAt: 'old',
            },
        ],
    };
    expect(groupState(parent, data)?.progress).toMatchObject({ total: 2, building: 0, waiting: 2, outside: 1 });
});

test('stopped builds wait while their slots remain occupied', () => {
    const { parent, data } = group();

    data.items[1]!.threads = [
        { id: 'stopped', title: 'Build stopped', purpose: 'build', state: 'stopped', updated: '2026-11-13' },
    ];
    expect(groupState(parent, data)?.word).toBe('1 build running · 2 waiting');
});

test('a shaping-only concept never presents its future Outcome check as the current hold', () => {
    const { parent, data } = group();

    data.items = [parent];
    parent.subIssues = { total: 0, completed: 0 };
    parent.refinement = { complete: true, reasons: [] };
    parent.releasePlan = {
        steps: [],
        outcomeCheck: { what: 'Inspect after release', result: 'pending', evidence: null },
    };
    expect(groupState(parent, data)?.word).toBe('Refined · no delivery planned');
    parent.refinement = { complete: false, reasons: ["Its Fog isn't gone."] };
    expect(groupState(parent, data)?.word).toBe('Shaping');
});

test('a delivery build with its own build run never inherits a group status', () => {
    const { parent, data } = group('build');

    parent.buildPhase = 'implementing';
    expect(groupState(parent, data)).toBeNull();
});
