// The board's life: a read that moves an item to another lane marks its new row as arrived (it slides in and flashes),
// and one that puts an item on Your desk marks its card (its amber edge pulses once). The first paint never does.

import type { BoardData } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, $$, mountPage, sample, settle } from '@/test/PageTest';

const arrived = () => $$('[data-arrived]').map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute('data-item')}`);
const withStatus = (data: BoardData, id: string, status: string): BoardData => ({
    ...data,
    items: data.items.map((item) => (item.id === id ? ({ ...item, status } as typeof item) : item)),
});

test('the first paint marks nothing; a read that moves a Queued item to Shaping marks its new row once', async () => {
    await mountPage(sample);
    expect(arrived(), 'the first paint is still').toEqual([]);

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(withStatus(sample, 'I_sample05', 'Shaping')));
    expect($('[data-stage="shaping"] li[data-item="I_sample05"]')!.getAttribute('data-arrived')).toBe('above');
    expect(arrived(), 'only the row that moved').toEqual(['li I_sample05']);
});

test('a read that puts an item on Your desk marks its card', async () => {
    await mountPage(sample);

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(withStatus(sample, 'I_sample07', 'Needs you')));
    expect($('.desk-row[data-item="I_sample07"]')?.hasAttribute('data-arrived')).toBe(true);
});
