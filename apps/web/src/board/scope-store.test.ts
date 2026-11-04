// The board's saved Scope, Kind and Labels: they survive a reload, and a saved repository the board no longer offers
// shows as All repositories once the first read settles, while the saved value waits for it to return.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData } from '@lar-factory/shared';
import { $, $$, mountPage, sample, settle, text } from '../../test/support.ts';

const SCOPE_KEY = 'lar-board:scope';
const FILTERS_KEY = 'lar-board:filters:board';
const GONE = 'maddec01/lar-gone';
const reading = { step: 'items', running: ['lar-gone'], waiting: [GONE], settled: false } as BoardData['firstRead'];
const reader = { ...sample, firstRead: reading };

const scopeLabel = () => $('[data-search-field]')!.getAttribute('aria-label');
const scoped = (name: string) => `Search, filtered by ${name}`;
const ALL = 'Search';
const deskCards = () => $$('.desk-card').length;
const receive = async (data: BoardData) => {
  const { useBoardStore } = await import('./board-store.ts');
  await settle(() => useBoardStore.getState().receive(data));
};
const store = async () => (await import('./scope-store.ts')).useScopeStore.getState();
const reload = async (data?: BoardData) => {
  vi.resetModules();
  await mountPage(data);
};

test('Scope, Kind and Labels survive a reload', async () => {
  await mountPage();
  await settle(async () => {
    (await store()).setScope('maddec01/lar-apple');
    (await store()).setFilters({ kinds: ['feature'], labels: ['docs'] });
  });
  await reload();
  expect((await store()).filters).toEqual({ kinds: ['feature'], labels: ['docs'] });
  expect(scopeLabel()).toBe(scoped('lar-apple, Feature, docs'));
});

test('filters saved before this store carry over from the same key', async () => {
  localStorage.setItem(FILTERS_KEY, JSON.stringify({ kinds: ['bug'], labels: ['docs'] }));
  await mountPage();
  expect((await store()).filters).toEqual({ kinds: ['bug'], labels: ['docs'] });
});

test('choosing All repositories removes the saved Scope, so a reload stays on all', async () => {
  localStorage.setItem(SCOPE_KEY, 'maddec01/lar-apple');
  await mountPage();
  await settle(async () => (await store()).setScope(null));
  expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
  await reload();
  expect(scopeLabel()).toBe(ALL);
});

test('a board with storage that throws keeps working for this page', async () => {
  // Only these keys: other stores read their own storage unguarded.
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    const real = Storage.prototype[method] as (this: Storage, ...args: unknown[]) => never;
    vi.spyOn(Storage.prototype, method).mockImplementation(function (this: Storage, ...args: unknown[]) {
      if (args[0] === SCOPE_KEY || args[0] === FILTERS_KEY) throw new Error('blocked');
      return real.apply(this, args);
    });
  }
  await mountPage();
  expect(scopeLabel()).toBe(ALL);
  await settle(async () => {
    (await store()).setScope('maddec01/lar-apple');
    (await store()).setFilters({ kinds: ['bug'], labels: [] });
  });
  expect(scopeLabel()).toBe(scoped('lar-apple, Bug'));
  expect((await store()).filters.kinds).toEqual(['bug']);
  await settle(async () => (await store()).setScope(null));
  expect(scopeLabel()).toBe(scoped('Bug'));
});

test('before the first read settles, a saved repository not on the board still shows, with its reading state', async () => {
  localStorage.setItem(SCOPE_KEY, GONE);
  await mountPage(reader);
  expect(scopeLabel()).toBe(scoped('lar-gone'));
  expect(text($('[data-reading]'))).toBe('Loading projects…');
});

test('once the first read settles, a saved repository not on the board shows as All repositories and the saved value stays', async () => {
  localStorage.setItem(SCOPE_KEY, GONE);
  await mountPage(reader);
  await receive(sample);
  expect(scopeLabel()).toBe(ALL);
  expect($('[data-reading]')).toBeNull();
  expect(deskCards(), 'the desk is the whole factory\'s').toBe(7);
  expect(localStorage.getItem(SCOPE_KEY)).toBe(GONE);
  await reload();
  expect(scopeLabel()).toBe(ALL);
  expect(localStorage.getItem(SCOPE_KEY)).toBe(GONE);
});

test('the saved repository shows again when it returns to the board', async () => {
  localStorage.setItem(SCOPE_KEY, GONE);
  await mountPage();
  expect(scopeLabel()).toBe(ALL);
  await receive({ ...sample, repos: [...sample.repos, { ...sample.repos[0]!, repo: GONE }] });
  expect(scopeLabel()).toBe(scoped('lar-gone'));
  expect(deskCards()).toBe(0);
});

test('a repository the board search offers only for its List items stays shown', async () => {
  localStorage.setItem(SCOPE_KEY, GONE);
  const listed = sample.items.find((item) => item.status === 'List')!;
  await mountPage({ ...sample, items: [...sample.items, { ...listed, id: 'gone-item', repo: GONE }] });
  expect(scopeLabel()).toBe(scoped('lar-gone'));
});

test('a saved repository in another case shows as the board names it', async () => {
  localStorage.setItem(SCOPE_KEY, 'MADDEC01/LAR-APPLE');
  await mountPage();
  expect(scopeLabel()).toBe(scoped('lar-apple'));
  await settle(() => $<HTMLButtonElement>('.title-bar button.list-button')!.click());
  expect(text($('[data-list-modal] .scope-board'))).toBe('Board scoped');
});

test('the List modal starts on the shown Scope, and Scope board writes the saved one', async () => {
  localStorage.setItem(SCOPE_KEY, GONE);
  await mountPage();
  await settle(() => $<HTMLButtonElement>('.title-bar button.list-button')!.click());
  const nav = () => $$<HTMLButtonElement>('[data-list-modal] nav[aria-label="Repositories"] button');
  expect(nav().filter((b) => b.getAttribute('aria-current') === 'page').map((b) => text(b.querySelector('.name')))).toEqual(['All repositories']);
  expect($('[data-list-modal] .scope-board')).toBeNull();
  await settle(() => nav().find((b) => b.textContent?.includes('lar-apple'))!.click());
  await settle(() => $<HTMLButtonElement>('[data-list-modal] .scope-board')!.click());
  expect(localStorage.getItem(SCOPE_KEY)).toBe('maddec01/lar-apple');
  expect(scopeLabel()).toBe(scoped('lar-apple'));
});
