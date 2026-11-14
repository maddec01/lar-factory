import { expect, test } from 'vite-plus/test';

import {
    $,
    detailsRead,
    detailsReply,
    fetchMock,
    fresh,
    mountPage,
    posted,
    sample,
    settle,
    text,
} from '@/test/PageTest';

const seed = sample.items.find((work) => work.id === 'I_sample14')!;

test('an open Review dialog shows selection reasons and refreshes results as the record changes', async () => {
    const item = {
        ...seed,
        status: 'Review' as const,
        buildPhase: 'review' as const,
        revision: 1,
        recorded: true,
        threads: [],
    };
    const board = fresh({ ...sample, items: [item] });
    let completed = false;

    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(board));

        const reply = await detailsReply(id).json();

        reply.details.record = {
            bodyKind: 'brief',
            body: 'Review the change.',
            context: '',
            buildPhase: 'review',
            reviewRounds: [],
            reviewers: [
                {
                    id: 'code',
                    name: 'Code',
                    reason: 'Always reviews every build.',
                    status: completed ? 'Completed' : 'Running',
                    ...(completed && { result: 'Approve: regression tests pass.' }),
                },
            ],
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));
    expect(text($('[data-selected-reviewers]'))).toContain('Code · Running');
    expect(text($('[data-selected-reviewers]'))).toContain('Always reviews every build.');
    completed = true;

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive({ ...board, items: [{ ...item, revision: 2 }] }));
    expect(text($('[data-selected-reviewers]'))).toContain('Approve: regression tests pass.');
});

test('active shaping exposes Stop and keeps the dialog and item when interruption fails', async () => {
    const item = {
        ...seed,
        status: 'Shaping' as const,
        recorded: true,
        threads: [
            {
                id: 'shape',
                title: 'Shaping',
                purpose: 'shape',
                state: 'running' as const,
                updated: new Date().toISOString(),
            },
        ],
    };
    const board = fresh({ ...sample, items: [item] });

    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/stop-shaping')
            return new Response(JSON.stringify({ error: 'Stop not confirmed: offline', board }));

        const id = detailsRead(url);

        return id ? detailsReply(id) : new Response(JSON.stringify(board));
    });
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const stop = [...$('[data-item-dialog]')!.querySelectorAll('button')].find((button) => text(button) === 'Stop');

    expect(stop).toBeDefined();
    await settle(() => stop!.click());
    expect(posted()).toContainEqual(['/api/stop-shaping', { itemId: item.id }]);
    expect(text($('[data-item-dialog]'))).toContain('Stop not confirmed: offline');
});
