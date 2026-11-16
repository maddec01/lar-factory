import type { BoardData, Item, Status } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { createBoardState } from './board-state.ts';

const item = (id: string, status: Status): Item => ({
    id,
    status,
    statuses: [status],
    content: 'ticket',
    revision: 0,
    kind: 'issue',
    parentId: null,
    flow: 'single',
    number: 1,
    title: id,
    url: null,
    repo: 'maddec01/lar-factory',
    labels: [],
    state: 'open',
    closedAs: null,
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockers: [],
    updatedAt: '2026-10-21T09:00:00Z',
    closedAt: null,
    linkedPrs: [],
    slices: [],
});

const empty = (): BoardData => ({
    repos: [],
    refreshSeconds: 60,
    fetchedAt: null,
    error: null,
    items: [],
    firstRead: { step: 'repositories', running: [], settled: false },
    modelChoices: [],
});
const statuses = (data: BoardData) => data.items.map((i) => `${i.id}:${i.status}`);

test('a change stays until GitHub reports it, or for three reads at most', () => {
    const board = createBoardState(empty());

    board.applyRead([item('a', 'List')], board.revision(), (items) => items);
    board.showChanged(item('a', 'Queued'));
    for (let read = 1; read <= 2; read++) {
        board.applyRead([item('a', 'List')], board.revision(), (items) => items);
        assert.deepEqual(statuses(board.snapshot()), ['a:Queued'], `read ${read}`);
    }
    board.applyRead([item('a', 'List')], board.revision(), (items) => items);
    assert.deepEqual(statuses(board.snapshot()), ['a:List']);
});

test('a read that started before a change keeps the change', () => {
    const board = createBoardState(empty());
    const since = board.revision();

    board.showChanged(item('a', 'Queued'));
    for (let read = 0; read < 3; read++) board.applyRead([item('a', 'List')], since, (items) => items);
    assert.deepEqual(statuses(board.snapshot()), ['a:Queued']);
});

test('a newer provider read brings back an issue reopened after Abandon', () => {
    const board = createBoardState(empty());
    const original = item('a', 'List');

    board.applyRead([original], board.revision(), (items) => items);

    const olderRead = board.revision();

    board.remove('a');

    const reopened = { ...original, updatedAt: '2026-10-21T10:00:00Z' };

    board.applyRead([reopened], olderRead, (items) => items);
    assert.deepEqual(statuses(board.snapshot()), [], 'a read already in flight cannot undo Abandon');
    board.applyRead(
        [reopened],
        board.revision(),
        (items) => items,
        () => false,
    );
    assert.deepEqual(statuses(board.snapshot()), [], 'a cached source cannot undo Abandon');
    board.applyRead([reopened], board.revision(), (items) => items);
    assert.deepEqual(statuses(board.snapshot()), ['a:List']);
    assert.equal(board.removed('a'), false);
});
