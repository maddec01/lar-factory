import type { Item, LinkedPr } from '@lar-factory/shared';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vite-plus/test';

import { PrList } from './PrList';
import { useBoardStore } from '@/services/board/board.hooks';

const pr = {
    number: 7,
    url: 'https://dev.azure.com/o/p/_git/r/pullrequest/7',
    state: 'open',
    isDraft: false,
    checks: { passed: 3, failed: 1, running: 0, total: 4, since: null },
    checkProgress: { state: 'stale' },
} as LinkedPr;
const item = { id: 'item', repo: 'o/p/r', azure: {}, status: 'In progress', linkedPrs: [pr] } as unknown as Item;

async function render(linked: LinkedPr) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useBoardStore.setState({ data: { fetchedAt: 'first' } as never, clientError: null });

    const host = document.createElement('div');

    await act(async () => createRoot(host).render(createElement(PrList, { item: { ...item, linkedPrs: [linked] } })));

    return host;
}

test('stale PR checks in item details show their last known counts dimmed as stale', async () => {
    const host = await render(pr);
    const stale = host.querySelector('[data-checks-stale]');

    expect(stale?.textContent).toContain('Checks failed');
    expect(stale?.textContent).toContain('3/4');
    expect(stale?.className).toContain('opacity-50');
    expect(stale?.getAttribute('title')).toContain('Stale check observation');
});

test('current PR checks show their counts undimmed', async () => {
    const host = await render({ ...pr, checkProgress: { state: 'current' } });

    expect(host.textContent).toContain('3/4');
    expect(host.querySelector('[data-checks-stale]')).toBeNull();
});
