import type { Item, LinkedPr } from '@lar-factory/shared';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';

import { PrReadiness } from './PrReadiness';
import { useBoardStore } from '@/services/board/board.hooks';

const pr = {
    number: 1,
    state: 'open',
    isDraft: false,
    url: 'https://dev.azure.com/o/p/_git/r/pullrequest/1',
    sourceRevision: 'one',
} as LinkedPr;
const item = { id: 'item', azure: {}, status: 'Ready to merge' } as Item;
const success = (revision: string) =>
    new Response(
        JSON.stringify({
            evidence: { available: true, sourceRevision: revision, observedAt: '2026-10-31T00:00:00Z', blockers: [] },
        }),
    );

test('open reads fresh evidence; changed revisions, races, failed refresh and disconnect withdraw readiness', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useBoardStore.setState({ data: { fetchedAt: 'first' } as never, clientError: null });

    const pending: ((response: Response) => void)[] = [];

    vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
    );

    const host = document.createElement('div');
    const root = createRoot(host);
    const click = async (label: string) =>
        act(async () => {
            Array.from(host.querySelectorAll('button'))
                .find((b) => b.textContent === label)!
                .click();
        });

    await act(async () => root.render(createElement(PrReadiness, { item, pr })));
    await click('Checks');
    expect(pending).toHaveLength(1);
    await act(async () => pending[0]!(success('one')));
    expect(host.textContent).toContain('Ready to merge based on this observation.');
    await click('Refresh checks');
    expect(host.textContent).not.toContain('Ready to merge based on this observation.');
    await act(async () => root.render(createElement(PrReadiness, { item, pr: { ...pr, sourceRevision: 'two' } })));
    await act(async () => pending[1]!(success('one')));
    expect(host.textContent).not.toContain('Ready to merge based on this observation.');
    await act(async () => pending[2]!(success('two')));
    expect(host.textContent).toContain('Ready to merge based on this observation.');
    await click('Refresh checks');
    await act(async () => pending[3]!(new Response('', { status: 503 })));
    expect(host.textContent).toContain('Azure evidence is unavailable.');
    await click('Refresh checks');
    await act(async () => useBoardStore.setState({ clientError: 'disconnected' }));
    await act(async () => pending[4]!(success('two')));
    expect(host.textContent).toContain('Checks unavailable: disconnected.');
    expect(host.textContent).not.toContain('Ready to merge based on this observation.');
    expect(item.status).toBe('Ready to merge');
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
});
