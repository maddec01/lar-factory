// The loading screen on the board page: it covers the board from the first paint until the first read settles and
// the mark has drawn, then fades out once. Restarted-server reads preserve the already loaded board.

import type { BoardData, FirstRead } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, fresh, mountPage, push, sample, settle } from '@/test/PageTest';

const DRAW_MS = 1750;
const EXIT_MS = 600;

const firstRead = (step: FirstRead['step'], running: string[] = [], settled = false): FirstRead => ({
    step,
    running,
    settled,
});
const unsettled = (read: FirstRead = firstRead('repositories')): BoardData => ({
    ...sample,
    fetchedAt: null,
    firstRead: read,
});

const screen = () => $('.loading-screen');
const advance = (ms: number) => settle(() => vi.advanceTimersByTime(ms));
const covered = () => $('#app')!.hasAttribute('inert');

test('a restarted server keeps the last complete board visible until fresh data settles', async () => {
    await mountPage(fresh());
    await advance(DRAW_MS);
    await advance(EXIT_MS);

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const before = useBoardStore.getState().data.items;

    await push({ ...unsettled(firstRead('items', ['ios'])), items: [], repos: [] });
    expect(screen()).toBeNull();
    expect(covered()).toBe(false);
    expect(useBoardStore.getState().data.items).toEqual(before);
    expect(useBoardStore.getState().data.repos).toEqual(sample.repos);

    const updated = { ...before[0]!, title: 'Updated during restart' };
    const added = { ...before[1]!, id: 'new-during-restart', title: 'Added during restart' };
    const partial = {
        ...unsettled(firstRead('items', ['ios'])),
        items: [updated, added],
        repos: sample.repos.slice(0, 1),
        capture: { enabled: true, session: 'new-server-session' },
        localProblem: 'A new server warning',
    };

    await push(partial);

    const current = useBoardStore.getState().data;

    expect(current.capture?.session).toBe('new-server-session');
    expect(current.localProblem).toBe('A new server warning');
    expect(current.repos).toEqual(partial.repos);
    expect(current.items.find((item) => item.id === updated.id)?.title).toBe(updated.title);
    expect(current.items.find((item) => item.id === added.id)?.title).toBe(added.title);
    expect(screen()).toBeNull();

    const oneItem = { ...fresh(), items: sample.items.slice(0, 1) };

    await push(oneItem);
    expect(screen()).toBeNull();
    expect(useBoardStore.getState().data.items).toEqual(oneItem.items);
});

test('restart snapshots honor completed-source removals while retaining unread source rows', async () => {
    await mountPage(fresh());

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const server = sample.items.filter((item) => item.repo === 'acme/api');
    const apple = sample.items.filter((item) => item.repo === 'acme/ios');
    const read = { ...firstRead('items', ['ios']), waiting: ['acme/ios'] };

    await push({ ...unsettled(read), items: server.slice(1) });

    const items = useBoardStore.getState().data.items;

    expect(
        items.some((item) => item.id === server[0]!.id),
        'removed from the completed source',
    ).toBe(false);
    expect(
        apple.every((old) => items.some((item) => item.id === old.id)),
        'unread source stays visible',
    ).toBe(true);
});

test('Queue and Abandon responses stay authoritative during a restarted read', async () => {
    await mountPage(fresh());
    await advance(DRAW_MS);
    await advance(EXIT_MS);

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const { receive } = await import('@/services/board/board.service');
    const issue = sample.items.find((item) => item.status === 'List')!;
    const queued = { ...issue, id: 'new-work-record', status: 'Queued' as const };
    const read = { ...firstRead('items', ['ios']), waiting: sample.repos.map((repo) => repo.repo) };

    await push({ ...unsettled(read), items: [queued] });
    expect(
        useBoardStore.getState().data.items.filter((item) => item.repo === issue.repo && item.number === issue.number),
    ).toEqual([queued]);
    await settle(() => receive({ error: null, board: { ...unsettled(read), items: [] } }));
    expect(useBoardStore.getState().data.items, 'Abandon doesn’t resurrect a cached row').toEqual([]);
    await settle(() => receive({ error: null, board: { ...unsettled(read), items: [queued] } }));
    expect(useBoardStore.getState().data.items).toEqual([queued]);
    expect(screen(), 'actions never re-open the loading screen').toBeNull();
});

test('restart keeps rows before readiness and through failed settlement, then accepts successful empty sources', async () => {
    await mountPage(fresh());

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const before = useBoardStore.getState().data.items;

    await push({ ...unsettled({ ...firstRead('items'), waiting: [] }), items: [], repos: [] });
    expect(useBoardStore.getState().data.items).toEqual(before);
    expect(useBoardStore.getState().data.repos).toEqual(sample.repos);

    const failed = sample.repos.map((repo) => ({ repo: repo.repo, problem: 'Source unavailable' }));

    await push({ ...fresh(), items: [], itemSourceProblems: failed });
    expect(useBoardStore.getState().data.items).toEqual(before);
    await push({ ...fresh(), items: [], itemSourceProblems: failed.slice(1) });
    expect(useBoardStore.getState().data.items).toEqual(before.filter((item) => item.repo !== failed[0]!.repo));
    await push({ ...fresh(), items: [] });
    expect(useBoardStore.getState().data.items).toEqual([]);
});
