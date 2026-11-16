// The board's saved Scope, Kind and Labels: they survive a reload, and a saved repository the board no longer offers
// shows as All projects once the first read settles, while the saved value waits for it to return.

import type { BoardData } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, mountPage, sample, settle } from '@/test/PageTest';

const SCOPE_KEY = 'lar-board:scope';
const GONE = 'maddec01/lar-gone';
const reading = { step: 'items', running: ['lar-gone'], waiting: [GONE], settled: false } as BoardData['firstRead'];
const reader = { ...sample, firstRead: reading };

/** The filters the board search field describes itself with; null with none. */
const scopeLabel = () => $('[data-search-field]')!.getAttribute('aria-description');
const ALL = null;
const deskCards = () => $$('.desk-row').length;
const receive = async (data: BoardData) => {
    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(data));
};
const reload = async (data?: BoardData) => {
    vi.resetModules();
    await mountPage(data);
};

test('once the first read settles, a saved repository not on the board shows as All projects and the saved value stays', async () => {
    localStorage.setItem(SCOPE_KEY, GONE);
    await mountPage(reader);
    await receive(sample);
    expect(scopeLabel()).toBe(ALL);
    expect($('[data-reading]')).toBeNull();
    expect(deskCards(), 'the desk is the whole factory’s').toBe(7);
    expect(localStorage.getItem(SCOPE_KEY)).toBe(GONE);
    await reload();
    expect(scopeLabel()).toBe(ALL);
    expect(localStorage.getItem(SCOPE_KEY)).toBe(GONE);
});
