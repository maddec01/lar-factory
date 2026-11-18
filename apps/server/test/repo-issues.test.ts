import type { BoardData } from '@lar-factory/shared';
import { boardIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'vite-plus/test';

import { startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const APPLE = 'acme/ios';
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** A ios issue as the repository issues query returns it. */
const appleIssue = (number: number, extra: object = {}) => ({
    ...boardIssue(number, 'List', APPLE).content!,
    ...extra,
});

/** ios's .lar-factory.json naming its issues, for the fake gh. */
const localSetups = { [APPLE]: { role: 'Apple client', itemSource: { kind: 'issues' } } };

/** A ios issue closed as completed `days` ago. */
const closedIssue = (number: number, days: number, extra: object = {}) =>
    appleIssue(number, {
        state: 'CLOSED',
        stateReason: 'COMPLETED',
        closedAt: daysAgo(days),
        updatedAt: daysAgo(days),
        ...extra,
    });

/** A ios issue as a parent or sub-issue reference. */
const appleRef = (number: number, state: 'OPEN' | 'CLOSED') => ({
    ...sliceRef(number, state),
    url: `https://github.com/${APPLE}/issues/${number}`,
    repository: { nameWithOwner: APPLE },
});

/** The node ids the board read in full by id, across every call. */
const readInFull = async (board: Board) =>
    (await board.calls())
        .filter((args) => args.some((a) => a.includes('nodes(ids:') && a.includes('subIssues(')))
        .flatMap((args) => args.filter((a) => a.startsWith('ids[]=')).map((a) => a.slice('ids[]='.length)));

test('closed issues are paged light and only the kept ones read in full: a closed slice of a build never is, a closed sub-issue of a concept is', async (t) => {
    const repoIssues = {
        [APPLE]: [
            appleIssue(8, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(30, 'CLOSED')] } }),
            closedIssue(30, 1, { parent: appleRef(8, 'OPEN') }),
            appleIssue(20, { labels: { nodes: [{ name: 'concept' }] } }),
            closedIssue(21, 1, { parent: appleRef(20, 'OPEN') }),
            closedIssue(22, 1),
            closedIssue(60, 20, { labels: { nodes: [{ name: 'build' }] } }),
            closedIssue(23, 1, { parent: appleRef(60, 'CLOSED') }),
            closedIssue(24, 1, { stateReason: 'NOT_PLANNED' }),
        ],
    };
    const board = await startBoard(t, { repositories: [APPLE], repoIssues, localSetups });
    const data = await until(board, (d) => d.fetchedAt !== null);

    assert.deepEqual(
        data.items.map((i) => [i.number, i.status]),
        [
            [8, 'List'],
            [20, 'List'],
            [21, 'Done'],
            [22, 'Done'],
            [23, 'Done'],
        ],
    );
    assert.deepEqual(
        (await readInFull(board)).sort(),
        ['I_21', 'I_22', 'I_23'],
        'a slice whose build was not read stays; one closed as not planned is never read',
    );

    const closedPages = (await board.calls()).filter((args) =>
        args.some((a) => a.includes('states: [CLOSED]') || a.includes('is:closed')),
    );

    assert.ok(
        closedPages.length > 0 && closedPages.every((args) => !args.some((a) => a.includes('subIssues('))),
        'closed pages read no sub-issues',
    );
});

test("closed issues are searched in close-date ranges at once, and one the search doesn't list yet shows from the issues updated last", async (t) => {
    const repoIssues = {
        [APPLE]: [
            closedIssue(22, 1),
            closedIssue(25, 3.5),
            closedIssue(26, 6.9),
            closedIssue(27, 0.001),
            closedIssue(28, 8),
        ],
    };
    const board = await startBoard(t, { repositories: [APPLE], repoIssues, localSetups, unindexed: ['I_27'] });
    const data = await until(board, (d) => d.fetchedAt !== null);

    assert.deepEqual(
        data.items.map((i) => [i.number, i.status]).sort((a, b) => String(a).localeCompare(String(b))),
        [
            [22, 'Done'],
            [25, 'Done'],
            [26, 'Done'],
            [27, 'Done'],
        ],
    );

    const ranges = (await board.calls()).flatMap((args) =>
        args.filter((a) => a.startsWith('q=') && a.includes('is:closed')).map((a) => /closed:(\S+)/.exec(a)![1]),
    );

    assert.equal(new Set(ranges).size, 10, 'one search per tenth of the week');

    const recent = (await board.calls()).filter((args) => args.some((a) => a.includes('states: [CLOSED]')));

    assert.equal(recent.length, 1, 'one page of the closed issues updated last, never paged');
    assert.ok(recent[0]!.some((a) => a.includes('UPDATED_AT')));
});
test('in a repository with no factory labels or config, Add item records work locally and a picked ticket gets one record', async (t) => {
    const board = await startBoard(t, {
        repositories: [APPLE],
        repoIssues: { [APPLE]: [appleIssue(8, { title: 'Seek stalls', labels: { nodes: [] }, body: 'Steps.' })] },
        recorded: false,
    });

    await until(board, (d) => d.fetchedAt !== null);

    const draft = { createIssue: false, repo: APPLE, kind: 'feature', title: 'Capture an item', description: '' };
    const captured = await board.postSession({ requestId: randomUUID(), draft }, '/api/items');

    assert.equal(captured.status, 200);

    const { item } = (await captured.json()) as { item: { id: string; number: number; status: string } };

    assert.deepEqual([item.number, item.status], [0, 'List']);

    const search = await fetch(`${board.url}/api/tickets?repo=${APPLE}&q=seek`);

    assert.deepEqual(((await search.json()) as { tickets: unknown[] }).tickets, [
        { number: 8, title: 'Seek stalls', url: `https://github.com/${APPLE}/issues/8` },
    ]);

    const pick = () => board.postSession({ repo: APPLE, number: 8 }, '/api/pick-ticket');
    const first = (await (await pick()).json()) as {
        item: { id: string; number: number; url: string };
        board: BoardData;
    };

    assert.deepEqual([first.item.number, first.item.url], [8, `https://github.com/${APPLE}/issues/8`]);

    const again = (await (await pick()).json()) as { item: { id: string }; board: BoardData };

    assert.equal(again.item.id, first.item.id);
    assert.deepEqual(
        again.board.items.map((i) => i.number).sort((a, b) => a - b),
        [0, 8],
    );

    const searched = (await (await fetch(`${board.url}/api/tickets?repo=${APPLE}&q=seek`)).json()) as {
        tickets: { workId?: string }[];
    };

    assert.equal(searched.tickets[0]!.workId, first.item.id);

    const writes = (await board.calls()).filter(
        (args) =>
            args[0] === 'label' ||
            (args[0] === 'issue' && !['list', 'view'].includes(args[1]!)) ||
            args.includes('POST'),
    );

    assert.deepEqual(writes, []);
});
