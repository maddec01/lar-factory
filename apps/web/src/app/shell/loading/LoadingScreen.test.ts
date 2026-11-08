// The loading screen on the board page: it covers the board from the first paint until the first read settles and
// the mark has drawn, then fades out once. Restarted-server reads preserve the already loaded board.

import type { BoardData, FirstRead } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, fresh, mountPage, push, sample, settle, stubApp } from '@/test/PageTest';

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
const leaving = () => screen()?.classList.contains('is-leaving') ?? false;
const advance = (ms: number) => settle(() => vi.advanceTimersByTime(ms));
const covered = () => $('#app')!.hasAttribute('inert');

test('a read that settles at once still keeps the screen until the draw has finished, then fades over 600 ms', async () => {
    await mountPage(fresh());
    expect(screen()).not.toBeNull();
    await advance(DRAW_MS - 1);
    expect(leaving()).toBe(false);
    await advance(1);
    expect(leaving()).toBe(true);
    await advance(EXIT_MS - 1);
    expect(screen()).not.toBeNull();
    await advance(1);
    expect(screen()).toBeNull();
});

test('the screen waits for the draw even when the read settled long before, and for the read when the draw is done', async () => {
    await mountPage(unsettled());
    await advance(DRAW_MS + 2_000);
    expect(leaving(), 'drawn but unsettled').toBe(false);
    await push(fresh());
    expect(leaving()).toBe(true);
});

test.each([
    ['the repositories are read, zero of them included', { ...fresh(), repos: [], items: [], onboarding: [] }],
    ['the read fails', { ...fresh(), fetchedAt: null, error: 'gh api failed' }],
    [
        'gh blocks the read',
        {
            ...fresh(),
            fetchedAt: null,
            error: null,
            tools: { ...sample.tools!, gh: { result: 'missing' as const, fix: 'Install gh' } },
        },
    ],
])('the screen ends the same way when %s', async (_name, data) => {
    await mountPage({ ...unsettled(), ...data, firstRead: firstRead('repositories') });
    await push({ ...data, firstRead: firstRead('finishing', [], true) });
    await advance(DRAW_MS);
    expect(leaving()).toBe(true);
    await advance(EXIT_MS);
    expect(screen()).toBeNull();
});

test('an empty successful source reveals the board while another source waits, after the logo and fade', async () => {
    await mountPage(unsettled(firstRead('items', ['lar-server', 'lar-apple'])));
    await push({
        ...unsettled({ ...firstRead('items', ['lar-server']), ready: true, waiting: ['maddec01/lar-server'] }),
        items: [],
    });
    await advance(DRAW_MS - 1);
    expect(leaving()).toBe(false);
    await advance(1);
    expect(leaving()).toBe(true);
    await advance(EXIT_MS);
    expect(screen()).toBeNull();
    expect(covered()).toBe(false);
    await push(unsettled());
    expect(screen()).toBeNull();
});

test('a page opened with ?loading=drawn starts with the mark drawn and leaves at once when the read has settled', async () => {
    await mountPage(fresh(), '', '?loading=drawn');
    expect(screen()!.classList.contains('is-drawn')).toBe(true);
    expect(leaving()).toBe(true);
    await advance(EXIT_MS);
    expect(screen()).toBeNull();
});

test('a restarted server keeps the last complete board visible until fresh data settles', async () => {
    await mountPage(fresh());
    await advance(DRAW_MS);
    await advance(EXIT_MS);

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const before = useBoardStore.getState().data.items;

    await push({ ...unsettled(firstRead('items', ['lar-apple'])), items: [], repos: [] });
    expect(screen()).toBeNull();
    expect(covered()).toBe(false);
    expect(useBoardStore.getState().data.items).toEqual(before);
    expect(useBoardStore.getState().data.repos).toEqual(sample.repos);

    const updated = { ...before[0]!, title: 'Updated during restart' };
    const added = { ...before[1]!, id: 'new-during-restart', title: 'Added during restart' };
    const partial = {
        ...unsettled(firstRead('items', ['lar-apple'])),
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
    const server = sample.items.filter((item) => item.repo === 'maddec01/lar-server');
    const apple = sample.items.filter((item) => item.repo === 'maddec01/lar-apple');
    const read = { ...firstRead('items', ['lar-apple']), waiting: ['maddec01/lar-apple'] };

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
    const read = { ...firstRead('items', ['lar-apple']), waiting: sample.repos.map((repo) => repo.repo) };

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

test('the board behind is inert while the screen is up, through the fade, and set free once it is gone', async () => {
    await mountPage(unsettled());
    expect(covered()).toBe(true);
    expect($('#app .loading-screen'), 'the screen isn’t inside the inert board').toBeNull();
    expect($('#app .title-bar'), 'the board is').not.toBeNull();

    await advance(DRAW_MS);
    await push(fresh());
    expect(leaving()).toBe(true);
    expect(covered(), 'the fade').toBe(true);
    await push(unsettled());
    expect(leaving()).toBe(true);
    expect(covered(), 'the initial fade still covers the board').toBe(true);

    await advance(EXIT_MS);
    expect(screen()).toBeNull();
    expect(covered()).toBe(false);

    await push(unsettled(firstRead('items', ['lar-apple'])));
    expect(covered(), 'a restart keeps the loaded board usable').toBe(false);
});

test('installation readiness waits until the loading screen has finished leaving and the stack is mounted', async () => {
    const bridge = stubApp({
        boardReady: vi.fn(async () => {
            expect(screen()).toBeNull();
            expect(covered()).toBe(false);
            expect($('.notification-stack')).not.toBeNull();
        }),
        getInstallState: async () => ({
            installs: true,
            installed: false,
            version: '1.0.0',
            running: null,
            discovery: 'waiting',
            instances: [],
            targets: [],
            drift: [],
            replaced: [],
            conflicts: [],
            blocked: [],
        }),
    });

    await mountPage(fresh(), '', '?loading=drawn');
    expect(bridge.boardReady).not.toHaveBeenCalled();
    await advance(EXIT_MS - 1);
    expect(bridge.boardReady).not.toHaveBeenCalled();
    await advance(1);
    expect(bridge.boardReady).toHaveBeenCalledOnce();
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
