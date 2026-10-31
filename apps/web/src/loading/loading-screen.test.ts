// The loading screen on the board page: it covers the board from the first paint until the first read settles and
// the mark has drawn, then fades out once. Restarted-server reads preserve the already loaded board.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData, FirstRead } from '@lar-factory/shared';
import { $, $$, NOW, mountPage, push, sample, settle, stubApp, text } from '../../test/support.ts';

const DRAW_MS = 1750;
const EXIT_MS = 600;
const ROLL_MS = 380;

const firstRead = (step: FirstRead['step'], running: string[] = [], settled = false): FirstRead => ({ step, running, settled });
const unsettled = (read: FirstRead = firstRead('repositories')): BoardData => ({ ...sample, fetchedAt: null, firstRead: read });
const settled = (): BoardData => ({ ...sample, error: null, fetchedAt: new Date(NOW).toISOString(), firstRead: firstRead('finishing', [], true) });

const screen = () => $('.loading-screen');
const line = () => text($('.loading-line-slot > span:not(.loading-roll-out)'));
const leaving = () => screen()?.classList.contains('is-leaving') ?? false;
const advance = (ms: number) => settle(() => vi.advanceTimersByTime(ms));
const covered = () => $('#app')!.hasAttribute('inert');
const reduceMotion = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }));

test('the board page opens on the loading screen, over the board, with the mark undrawn and the first step named', async () => {
  await mountPage(unsettled());
  expect(screen()).not.toBeNull();
  expect(screen()!.hasAttribute('role'), 'the lockup is not announced').toBe(false);
  expect($('.loading-line')!.getAttribute('role'), 'only the step line is live').toBe('status');
  expect(text($('.loading-wordmark'))).toBe('arFactory');
  expect(screen()!.classList.contains('is-drawn')).toBe(false);
  expect(line()).toBe('Loading projects');
  expect($('.title-bar'), 'the board is under the screen').not.toBeNull();
});

test('the loading line stays stable as projects finish, and waits while the whole read is unsettled', async () => {
  await mountPage(unsettled(firstRead('items', ['lar-apple', 'lar-server'])));
  expect(line()).toBe('Loading projects');

  await push(unsettled(firstRead('items', ['lar-server'])));
  expect(line()).toBe('Loading projects');
  await advance(10_000);
  expect(screen(), 'an unsettled read keeps the screen').not.toBeNull();
  expect(leaving()).toBe(false);
});

test('a new step rolls the old line out while the new one rolls in, and only the line animates', async () => {
  await mountPage(unsettled());
  expect($('.loading-roll-in'), 'the first line arrives with the page, so it does not roll').toBeNull();
  const mark = $('.loading-mark');

  await push(unsettled(firstRead('finishing')));
  expect(text($('.loading-roll-out'))).toBe('Loading projects');
  expect(text($('.loading-roll-in'))).toBe('Finishing up');
  expect($('.loading-mark'), 'the mark is not redrawn').toBe(mark);
  expect($('.loading-roll-out')!.getAttribute('aria-hidden'), 'the leaving line is not announced').toBe('true');
  expect($('.loading-roll-in')!.hasAttribute('aria-hidden')).toBe(false);

  await advance(ROLL_MS + 50);
  expect($('.loading-roll-out')).toBeNull();
  expect(text($('.loading-line'))).toBe('Finishing up');
});

test('a read that settles at once still keeps the screen until the draw has finished, then fades over 600 ms', async () => {
  await mountPage(settled());
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
  await push(settled());
  expect(leaving()).toBe(true);
});

test.each([
  ['the repositories are read, zero of them included', { ...settled(), repos: [], items: [], onboarding: [] }],
  ['the read fails', { ...settled(), fetchedAt: null, error: 'gh api failed' }],
  ['gh blocks the read', { ...settled(), fetchedAt: null, error: null, tools: { ...sample.tools!, gh: { result: 'missing' as const, fix: 'Install gh' } } }],
])('the screen ends the same way when %s', async (_name, data) => {
  await mountPage({ ...unsettled(), ...data, firstRead: firstRead('repositories') });
  await push({ ...data, firstRead: firstRead('finishing', [], true) });
  await advance(DRAW_MS);
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test("the screen waits for the whole first read instead of revealing a second project loader", async () => {
  await mountPage(unsettled(firstRead('items', ['lar-server', 'lar-apple'])));
  await advance(DRAW_MS);
  await push(unsettled({ ...firstRead('items', ['lar-server']), waiting: ['maddec01/lar-server'] }));
  expect(leaving()).toBe(false);
  expect(line()).toBe('Loading projects');
  await advance(EXIT_MS);
  expect(screen()).not.toBeNull();
  await push(settled());
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('a page opened with ?loading=drawn starts with the mark drawn and leaves at once when the read has settled', async () => {
  await mountPage(settled(), '', '?loading=drawn');
  expect(screen()!.classList.contains('is-drawn')).toBe(true);
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('a drawn page still waits for an unsettled read, with its current step and no roll', async () => {
  await mountPage(unsettled(firstRead('items', ['lar-server'])), '', '?loading=drawn');
  expect(screen()!.classList.contains('is-drawn')).toBe(true);
  expect(leaving()).toBe(false);
  expect(line()).toBe('Loading projects');
  expect($('.loading-roll-in')).toBeNull();
});

test('without the flag a browser visit draws the mark', async () => {
  await mountPage(unsettled(), '', '?other=1');
  expect(screen()!.classList.contains('is-drawn')).toBe(false);
  await advance(DRAW_MS);
  expect(screen()!.classList.contains('is-drawn')).toBe(true);
});

test('a restarted server keeps the last complete board visible until fresh data settles', async () => {
  await mountPage(settled());
  await advance(DRAW_MS);
  await advance(EXIT_MS);
  const { useBoardStore } = await import('../board/board-store.ts');
  const before = useBoardStore.getState().data.items;

  await push({ ...unsettled(firstRead('items', ['lar-apple'])), items: [], repos: [] });
  expect(screen()).toBeNull();
  expect(covered()).toBe(false);
  expect(useBoardStore.getState().data.items).toEqual(before);
  expect(useBoardStore.getState().data.repos).toEqual(sample.repos);

  const updated = { ...before[0]!, title: 'Updated during restart' };
  const added = { ...before[1]!, id: 'new-during-restart', title: 'Added during restart' };
  const partial = { ...unsettled(firstRead('items', ['lar-apple'])), items: [updated, added],
    repos: sample.repos.slice(0, 1), capture: { enabled: true, session: 'new-server-session' },
    localProblem: 'A new server warning' };
  await push(partial);
  const current = useBoardStore.getState().data;
  expect(current.capture?.session).toBe('new-server-session');
  expect(current.localProblem).toBe('A new server warning');
  expect(current.repos).toEqual(partial.repos);
  expect(current.items.find(item => item.id === updated.id)?.title).toBe(updated.title);
  expect(current.items.find(item => item.id === added.id)?.title).toBe(added.title);
  expect(screen()).toBeNull();

  const fresh = { ...settled(), items: sample.items.slice(0, 1) };
  await push(fresh);
  expect(screen()).toBeNull();
  expect(useBoardStore.getState().data.items).toEqual(fresh.items);
});

test('restart snapshots honor completed-source removals while retaining unread source rows', async () => {
  await mountPage(settled());
  const { useBoardStore } = await import('../board/board-store.ts');
  const server = sample.items.filter(item => item.repo === 'maddec01/lar-server');
  const apple = sample.items.filter(item => item.repo === 'maddec01/lar-apple');
  const read = { ...firstRead('items', ['lar-apple']), waiting: ['maddec01/lar-apple'] };
  await push({ ...unsettled(read), items: server.slice(1) });
  const items = useBoardStore.getState().data.items;
  expect(items.some(item => item.id === server[0]!.id), 'removed from the completed source').toBe(false);
  expect(apple.every(old => items.some(item => item.id === old.id)), 'unread source stays visible').toBe(true);
});

test('Queue and Abandon responses stay authoritative during a restarted read', async () => {
  await mountPage(settled());
  await advance(DRAW_MS);
  await advance(EXIT_MS);
  const { useBoardStore } = await import('../board/board-store.ts');
  const { receive } = await import('../items/card-actions.ts');
  const issue = sample.items.find(item => item.status === 'List')!;
  const queued = { ...issue, id: 'new-work-record', status: 'Queued' as const };
  const read = { ...firstRead('items', ['lar-apple']), waiting: sample.repos.map(repo => repo.repo) };
  await push({ ...unsettled(read), items: [queued] });
  expect(useBoardStore.getState().data.items.filter(item => item.repo === issue.repo && item.number === issue.number))
    .toEqual([queued]);
  await settle(() => receive({ error: null, board: { ...unsettled(read), items: [] } }));
  expect(useBoardStore.getState().data.items, 'Abandon does not resurrect a cached row').toEqual([]);
  await settle(() => receive({ error: null, board: { ...unsettled(read), items: [queued] } }));
  expect(useBoardStore.getState().data.items).toEqual([queued]);
  expect(screen(), 'actions never re-open the loading screen').toBeNull();
});

test('a new background read during the fade does not restart the loading screen', async () => {
  await mountPage(settled());
  await advance(DRAW_MS);
  expect(leaving()).toBe(true);
  await push(unsettled());
  expect(leaving()).toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('with reduced motion the finished mark shows at once, the line swaps without rolling and the exit stays a fade', async () => {
  reduceMotion();
  await mountPage(unsettled());
  expect(screen()!.classList.contains('is-drawn')).toBe(true);

  await push(unsettled(firstRead('items', ['lar-apple'])));
  expect($$('.loading-line-slot > span')).toHaveLength(1);
  expect(text($('.loading-line'))).toBe('Loading projects');

  await push(settled());
  expect(leaving(), 'no draw to wait for').toBe(true);
  await advance(EXIT_MS);
  expect(screen()).toBeNull();
});

test('project updates do not roll or name individual projects', async () => {
  await mountPage(unsettled());
  await push(unsettled(firstRead('items', ['lar-apple', 'lar-server'])));
  expect(line()).toBe('Loading projects');
  expect($('.loading-roll-in')).toBeNull();
  await push(unsettled(firstRead('items', ['lar-server'])));
  expect(line()).toBe('Loading projects');
  expect($('.loading-roll-in')).toBeNull();
  await push(unsettled(firstRead('finishing')));
  expect(text($('.loading-roll-out'))).toBe('Loading projects');
  expect(line()).toBe('Finishing up');
});

test('the board behind is inert while the screen is up, through the fade, and set free once it is gone', async () => {
  await mountPage(unsettled());
  expect(covered()).toBe(true);
  expect($('#app .loading-screen'), 'the screen is not inside the inert board').toBeNull();
  expect($('#app .title-bar'), 'the board is').not.toBeNull();

  await advance(DRAW_MS);
  await push(settled());
  expect(leaving()).toBe(true);
  expect(covered(), 'the fade').toBe(true);
  await push(unsettled());
  expect(leaving()).toBe(true);
  expect(covered(), 'the initial fade still covers the board').toBe(true);

  await push(settled());
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
    getInstallState: async () => ({ installs: true, installed: false, version: '1.0.0', running: null,
      discovery: 'waiting', instances: [], targets: [], drift: [], replaced: [], conflicts: [], blocked: [] }),
  });
  await mountPage(settled(), '', '?loading=drawn');
  expect(bridge.boardReady).not.toHaveBeenCalled();
  await advance(EXIT_MS - 1);
  expect(bridge.boardReady).not.toHaveBeenCalled();
  await advance(1);
  expect(bridge.boardReady).toHaveBeenCalledOnce();
});

test('a development app without installation enabled never sends installation readiness', async () => {
  const bridge = stubApp({
    boardReady: vi.fn(async () => {}),
    getInstallState: async () => ({ installs: false, installed: false, version: '1.0.0', running: null,
      discovery: 'waiting', instances: [], targets: [], drift: [], replaced: [], conflicts: [], blocked: [] }),
  });
  await mountPage(settled(), '', '?loading=drawn');
  await advance(EXIT_MS);
  expect(bridge.boardReady).not.toHaveBeenCalled();
});
