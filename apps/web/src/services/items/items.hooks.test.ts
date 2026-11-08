// The details hook's refresh: refreshes asked for while one reads never overlap it; they share one read that starts
// once it ends, so a caller after a write still sees details read after it asked.

import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vite-plus/test';

import { useItemDetails } from './items.hooks';
import { detailsRead, detailsReply, fetchMock, settle } from '@/test/PageTest';

test('refreshes asked for while one reads wait for it, then share a single read', async () => {
    const held: ((response: Response) => void)[] = [];

    fetchMock.mockImplementation(async (url: string) =>
        detailsRead(url)
            ? new Promise<Response>((resolve) => held.push(resolve))
            : new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 }),
    );

    let refresh: () => Promise<boolean> = async () => false;

    function Probe() {
        const details = useItemDetails('I_sample13', '2026-10-01T00:00:00Z');

        useEffect(() => {
            refresh = details.refresh;
        });

        return null;
    }

    await settle(() =>
        createRoot(document.body.appendChild(document.createElement('div'))).render(createElement(Probe)),
    );
    expect(held, 'the open reads once').toHaveLength(1);

    const first = refresh();
    const second = refresh();
    const third = refresh();

    expect(held, 'one refresh reads beside the open').toHaveLength(2);
    await settle(() => held[1]!(detailsReply('I_sample13')));
    await settle(() => undefined);
    expect(held, 'the ones asked for meanwhile read once, after it').toHaveLength(3);
    await settle(() => held[2]!(detailsReply('I_sample13')));
    expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
    expect(second).toBe(third);
});
